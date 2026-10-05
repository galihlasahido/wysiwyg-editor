import * as D from 'docx';

/** A node of Word's equation tree. */
export type MathNode = InstanceType<typeof D.MathRun> | InstanceType<typeof D.MathFraction> | InstanceType<typeof D.MathRadical> | InstanceType<typeof D.MathSuperScript> | InstanceType<typeof D.MathSubScript> | InstanceType<typeof D.MathSubSuperScript> | InstanceType<typeof D.MathSum> | InstanceType<typeof D.MathIntegral> | InstanceType<typeof D.MathRoundBrackets> | InstanceType<typeof D.MathSquareBrackets> | InstanceType<typeof D.MathCurlyBrackets> | InstanceType<typeof D.MathLimitLower>;

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  pm: '±', mp: '∓', times: '×', cdot: '·', div: '÷', le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', propto: '∝', infty: '∞', partial: '∂', nabla: '∇',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', Leftarrow: '⇐', leftrightarrow: '↔', Leftrightarrow: '⇔', in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', cup: '∪', cap: '∩', forall: '∀', exists: '∃', emptyset: '∅', ldots: '…', cdots: '⋯', dots: '…', degree: '°',
  prime: '′', angle: '∠', perp: '⊥', parallel: '∥', neg: '¬', land: '∧', lor: '∨', circ: '∘', bullet: '•', star: '⋆', ',': ' ', ';': ' ', ':': ' ', '!': '', quad: '  ', qquad: '    ',
};
const FUNCTIONS = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'log', 'ln', 'exp', 'det', 'max', 'min', 'gcd', 'lg', 'sup', 'inf', 'lim']);
const BLACKBOARD: Record<string, string> = { R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', P: 'ℙ' };

type Tok = { t: 'cmd' | 'ch' | '{' | '}' | '^' | '_' | '['  | ']'; v: string };
class Unsupported extends Error {}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const m = /^[A-Za-z]+/.exec(src.slice(i + 1));
      if (m) { out.push({ t: 'cmd', v: m[0] }); i += m[0].length; }
      else if (i + 1 < src.length) { out.push({ t: 'cmd', v: src[i + 1] }); i++; } // \, \; \{ \} \\
    } else if (c === '{' || c === '}' || c === '^' || c === '_' || c === '[' || c === ']') out.push({ t: c as Tok['t'], v: c });
    else if (!/\s/.test(c)) out.push({ t: 'ch', v: c });
  }
  return out;
}

/**
 * Convert LaTeX to Word's native equation objects (fractions, roots, scripts, sums, integrals, limits, brackets, Greek letters
 * and common operators). Returns null when the formula uses something outside this subset (matrices, aligned environments,
 * custom macros), so the caller can fall back to the LaTeX text instead of writing a wrong equation.
 */
export function latexToDocx(tex: string): MathNode[] | null {
  let toks: Tok[];
  try { toks = tokenize(tex.slice(0, 5000)); } catch { return null; }
  let i = 0;
  let depth = 0; // nesting guard: a hostile formula must not overflow the stack
  const peek = () => toks[i];
  const run = (text: string) => new D.MathRun(text);

  const group = (): MathNode[] => {
    if (peek()?.t !== '{') { // a single token: x^2, \frac12
      const a = atom();
      if (!a) throw new Unsupported(); // "x^" with nothing after it
      return [a];
    }
    i++;
    const out = sequence((t) => t.t === '}');
    if (peek()?.t !== '}') throw new Unsupported();
    i++;
    return out;
  };
  const optional = (): MathNode[] | null => {
    if (peek()?.t !== '[') return null;
    i++;
    const out = sequence((t) => t.t === ']');
    if (peek()?.t !== ']') throw new Unsupported();
    i++;
    return out;
  };
  const text = (): string => { // \text{...}: raw characters up to the closing brace
    if (peek()?.t !== '{') throw new Unsupported();
    i++;
    let s = '';
    while (peek() && peek().t !== '}') { const t = toks[i++]; s += t.t === 'cmd' ? (SYMBOLS[t.v] ?? ` ${t.v}`) : t.v; }
    if (peek()?.t !== '}') throw new Unsupported();
    i++;
    return s;
  };

  /** One atom plus any ^ _ that follow it. */
  const withScripts = (base: MathNode[]): MathNode[] => {
    let sub: MathNode[] | null = null;
    let sup: MathNode[] | null = null;
    for (let n = 0; n < 2 && (peek()?.t === '^' || peek()?.t === '_'); n++) {
      const which = toks[i++].t;
      const arg = group();
      if (which === '^') sup = arg; else sub = arg;
    }
    if (sub && sup) return [new D.MathSubSuperScript({ children: base, subScript: sub, superScript: sup })];
    if (sup) return [new D.MathSuperScript({ children: base, superScript: sup })];
    if (sub) return [new D.MathSubScript({ children: base, subScript: sub })];
    return base;
  };

  const atom = (): MathNode | null => {
    if (++depth > 60) throw new Unsupported();
    try { return atomInner(); } finally { depth--; }
  };
  const atomInner = (): MathNode | null => {
    const t = toks[i];
    if (!t) return null;
    if (t.t === '{') return (i++, wrap(sequence((x) => x.t === '}', true)));
    if (t.t === 'ch') { i++; return run(t.v); }
    if (t.t === 'cmd') {
      i++;
      const c = t.v;
      if (c === 'frac' || c === 'dfrac' || c === 'tfrac') { const n = group(); const d = group(); return new D.MathFraction({ numerator: n, denominator: d }); }
      if (c === 'sqrt') { const deg = optional(); const body = group(); return new D.MathRadical(deg ? { children: body, degree: deg } : { children: body }); }
      if (c === 'text' || c === 'mathrm' || c === 'operatorname') return run(text());
      if (c === 'mathbb') { const s = text(); return run([...s].map((ch) => BLACKBOARD[ch] ?? ch).join('')); }
      if (c === 'left' || c === 'right') throw new Unsupported(); // handled in sequence()
      if (SYMBOLS[c] !== undefined) return run(SYMBOLS[c]);
      if (FUNCTIONS.has(c)) return run(c);
      if (['{', '}', '#', '%', '&', '$', '_'].includes(c)) return run(c);
      throw new Unsupported(); // \begin, \matrix, macros ...
    }
    throw new Unsupported(); // a stray ^ _ ] }
  };
  const wrap = (nodes: MathNode[]): MathNode => (nodes.length === 1 ? nodes[0] : new D.MathRoundBrackets({ children: nodes })); // only used for {…} used as one atom

  /** Words after \sum / \int / \lim limits: the operand is the next atom with its scripts. */
  const operand = (): MathNode[] => {
    const a = atom();
    return a ? withScripts([a]) : [];
  };

  function sequence(stop: (t: Tok) => boolean, flatten = false): MathNode[] {
    if (++depth > 60) throw new Unsupported();
    try { return sequenceInner(stop, flatten); } finally { depth--; }
  }
  function sequenceInner(stop: (t: Tok) => boolean, flatten: boolean): MathNode[] {
    const out: MathNode[] = [];
    while (peek() && !stop(peek())) {
      const t = peek();
      if (t.t === 'cmd' && (t.v === 'sum' || t.v === 'int' || t.v === 'prod' || t.v === 'lim' || t.v === 'limits')) {
        i++;
        if (t.v === 'limits') continue;
        let sub: MathNode[] | undefined;
        let sup: MathNode[] | undefined;
        for (let n = 0; n < 2 && (peek()?.t === '^' || peek()?.t === '_'); n++) { const w = toks[i++].t; const g = group(); if (w === '^') sup = g; else sub = g; }
        if (t.v === 'lim') { out.push(new D.MathLimitLower({ children: [run('lim')], limit: sub ?? [] })); continue; }
        const body = operand();
        if (t.v === 'int') out.push(new D.MathIntegral({ children: body, subScript: sub, superScript: sup }));
        else out.push(new D.MathSum({ children: body, subScript: sub, superScript: sup })); // \prod is written as a sum sign when Word lacks a product class
        continue;
      }
      if (t.t === 'cmd' && t.v === 'left') {
        i++;
        const open = toks[i++];
        const inner = sequence((x) => x.t === 'cmd' && x.v === 'right');
        i++; // \right
        const close = toks[i++];
        if (!open || !close) throw new Unsupported();
        const o = open.v;
        out.push(o === '[' ? new D.MathSquareBrackets({ children: inner }) : o === '{' || (open.t === 'cmd' && open.v === '{') ? new D.MathCurlyBrackets({ children: inner }) : new D.MathRoundBrackets({ children: inner }));
        continue;
      }
      const a = atom();
      if (!a) break;
      out.push(...withScripts([a]));
    }
    return flatten && out.length === 1 ? out : out;
  }

  try {
    const result = sequence(() => false);
    return i >= toks.length && result.length ? result : null;
  } catch (e) {
    if (e instanceof Unsupported) return null;
    throw e;
  }
}
