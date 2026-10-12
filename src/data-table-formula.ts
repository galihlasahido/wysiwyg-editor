/**
 * Formulas for the columns of a data table: `[Price] * [Qty]`, `IF([Stock] < 5, "Reorder", "OK")`.
 * A small parser and evaluator (no `eval`, no loops), so a formula saved in a document can do nothing but calculate from its own row.
 */

export type FormulaValue = number | string | boolean | null;

class FormulaError extends Error {
  constructor(public code: string) { super(code); }
}

type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'ref'; name: string }
  | { t: 'un'; op: '-' | '!'; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; fn: string; args: Node[] };

type Tok = { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'ref'; v: string } | { k: 'id'; v: string } | { k: 'op'; v: string };

const MAX_LENGTH = 500;
const MAX_TOKENS = 300;
const MAX_DEPTH = 40;
const MAX_TEXT = 5000;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (out.length >= MAX_TOKENS) throw new FormulaError('#SYNTAX!');
    let m: RegExpExecArray | null;
    const rest = src.slice(i);
    if ((m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest))) { out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; }
    else if (ch === '"' || ch === "'") {
      let j = i + 1; let s = '';
      while (j < src.length && src[j] !== ch) { if (src[j] === '\\' && j + 1 < src.length) j++; s += src[j]; j++; }
      if (j >= src.length) throw new FormulaError('#SYNTAX!');
      out.push({ k: 'str', v: s }); i = j + 1;
    }
    else if (ch === '[') { const j = src.indexOf(']', i); if (j < 0) throw new FormulaError('#SYNTAX!'); out.push({ k: 'ref', v: src.slice(i + 1, j).trim() }); i = j + 1; }
    else if (ch === '{') { const j = src.indexOf('}', i); if (j < 0) throw new FormulaError('#SYNTAX!'); out.push({ k: 'ref', v: src.slice(i + 1, j).trim() }); i = j + 1; }
    else if ((m = /^[A-Za-z_][\w.]*/.exec(rest))) { out.push({ k: 'id', v: m[0] }); i += m[0].length; }
    else if ((m = /^(<=|>=|<>|!=|==|&&|\|\|)/.exec(rest))) { out.push({ k: 'op', v: m[0] }); i += 2; }
    else if ('+-*/%^&()<>=,!'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; }
    else throw new FormulaError('#SYNTAX!');
  }
  return out;
}

function parse(src: string): Node {
  if (src.length > MAX_LENGTH) throw new FormulaError('#SYNTAX!');
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (...ops: string[]) => { const t = toks[p]; return t?.k === 'op' && ops.includes(t.v); };
  const next = () => toks[p++];
  const expr = (d: number): Node => {
    if (d > MAX_DEPTH) throw new FormulaError('#SYNTAX!');
    return compare(d);
  };
  const compare = (d: number): Node => {
    let a = concat(d);
    while (isOp('=', '==', '<>', '!=', '<', '<=', '>', '>=')) { const op = String(next().v); a = { t: 'bin', op: op === '==' ? '=' : op === '!=' ? '<>' : op, a, b: concat(d) }; }
    return a;
  };
  const concat = (d: number): Node => {
    let a = add(d);
    while (isOp('&')) { next(); a = { t: 'bin', op: '&', a, b: add(d) }; }
    return a;
  };
  const add = (d: number): Node => {
    let a = mul(d);
    while (isOp('+', '-')) { const op = String(next().v); a = { t: 'bin', op, a, b: mul(d) }; }
    return a;
  };
  const mul = (d: number): Node => {
    let a = pow(d);
    while (isOp('*', '/', '%')) { const op = String(next().v); a = { t: 'bin', op, a, b: pow(d) }; }
    return a;
  };
  const pow = (d: number): Node => {
    const a = unary(d);
    if (isOp('^')) { next(); return { t: 'bin', op: '^', a, b: pow(d + 1) }; }
    return a;
  };
  const unary = (d: number): Node => {
    if (d > MAX_DEPTH) throw new FormulaError('#SYNTAX!');
    if (isOp('-')) { next(); return { t: 'un', op: '-', a: unary(d + 1) }; }
    if (isOp('+')) { next(); return unary(d + 1); }
    if (isOp('!')) { next(); return { t: 'un', op: '!', a: unary(d + 1) }; }
    return primary(d);
  };
  const primary = (d: number): Node => {
    const t = next();
    if (!t) throw new FormulaError('#SYNTAX!');
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'ref') return { t: 'ref', name: t.v };
    if (t.k === 'id') {
      if (isOp('(')) {
        next();
        const args: Node[] = [];
        if (!isOp(')')) { do { args.push(expr(d + 1)); } while (isOp(',') && next()); }
        if (!isOp(')')) throw new FormulaError('#SYNTAX!');
        next();
        return { t: 'call', fn: t.v.toUpperCase(), args };
      }
      return { t: 'ref', name: t.v };
    }
    if (t.v === '(') { const e = expr(d + 1); if (!isOp(')')) throw new FormulaError('#SYNTAX!'); next(); return e; }
    throw new FormulaError('#SYNTAX!');
  };
  const tree = expr(0);
  if (peek()) throw new FormulaError('#SYNTAX!');
  return tree;
}

// ---- evaluation

const num = (v: FormulaValue): number => {
  if (typeof v === 'number') return v;
  if (v === null || v === '') return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new FormulaError('#VALUE!');
  return n;
};
const text = (v: FormulaValue): string => (v === null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v));
const truthy = (v: FormulaValue): boolean => (typeof v === 'string' ? v !== '' && !/^(false|no|0)$/i.test(v) : Boolean(v));
const clip = (s: string) => (s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) : s);
const isoDate = (v: FormulaValue): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v));
  if (!m) throw new FormulaError('#VALUE!');
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
};
const check = (n: number) => { if (!Number.isFinite(n)) throw new FormulaError('#VALUE!'); return n; };

function compareValues(a: FormulaValue, b: FormulaValue): number {
  const numeric = (v: FormulaValue) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
  if ((numeric(a) || a === null) && (numeric(b) || b === null)) return num(a) - num(b);
  return text(a).toLowerCase() < text(b).toLowerCase() ? -1 : text(a).toLowerCase() > text(b).toLowerCase() ? 1 : 0;
}

type Fn = (args: FormulaValue[], lazy: Node[], ev: (n: Node) => FormulaValue) => FormulaValue;
const flat = (a: FormulaValue[]) => a.filter((v) => v !== null && v !== '').map(num);
const FUNCTIONS: Record<string, Fn> = {
  IF: (_a, n, ev) => { if (n.length < 2 || n.length > 3) throw new FormulaError('#VALUE!'); return truthy(ev(n[0])) ? ev(n[1]) : n[2] ? ev(n[2]) : ''; },
  AND: (a) => a.every(truthy),
  OR: (a) => a.some(truthy),
  NOT: (a) => !truthy(a[0] ?? null),
  ROUND: (a) => { const d = Math.max(0, Math.min(10, Math.trunc(num(a[1] ?? 0)))); const f = 10 ** d; return Math.round((num(a[0] ?? null) + Number.EPSILON) * f) / f; },
  FLOOR: (a) => Math.floor(num(a[0] ?? null)),
  CEIL: (a) => Math.ceil(num(a[0] ?? null)),
  ABS: (a) => Math.abs(num(a[0] ?? null)),
  SQRT: (a) => { const n = num(a[0] ?? null); if (n < 0) throw new FormulaError('#VALUE!'); return Math.sqrt(n); },
  POWER: (a) => check(num(a[0] ?? null) ** num(a[1] ?? null)),
  MOD: (a) => { const d = num(a[1] ?? null); if (d === 0) throw new FormulaError('#DIV/0!'); return ((num(a[0] ?? null) % d) + d) % d; },
  MIN: (a) => { const n = flat(a); return n.length ? Math.min(...n) : 0; },
  MAX: (a) => { const n = flat(a); return n.length ? Math.max(...n) : 0; },
  SUM: (a) => flat(a).reduce((x, y) => x + y, 0),
  AVERAGE: (a) => { const n = flat(a); if (!n.length) throw new FormulaError('#DIV/0!'); return n.reduce((x, y) => x + y, 0) / n.length; },
  COUNT: (a) => a.filter((v) => typeof v === 'number').length,
  LEN: (a) => text(a[0] ?? null).length,
  UPPER: (a) => text(a[0] ?? null).toUpperCase(),
  LOWER: (a) => text(a[0] ?? null).toLowerCase(),
  TRIM: (a) => text(a[0] ?? null).trim(),
  LEFT: (a) => text(a[0] ?? null).slice(0, Math.max(0, num(a[1] ?? 1))),
  RIGHT: (a) => { const s = text(a[0] ?? null); const n = Math.max(0, num(a[1] ?? 1)); return n ? s.slice(-n) : ''; },
  CONCAT: (a) => clip(a.map(text).join('')),
  CONTAINS: (a) => text(a[0] ?? null).toLowerCase().includes(text(a[1] ?? null).toLowerCase()),
  ISEMPTY: (a) => a[0] === null || a[0] === '',
  TODAY: () => new Date().toISOString().slice(0, 10),
  YEAR: (a) => new Date(isoDate(a[0] ?? null)).getUTCFullYear(),
  MONTH: (a) => new Date(isoDate(a[0] ?? null)).getUTCMonth() + 1,
  DAY: (a) => new Date(isoDate(a[0] ?? null)).getUTCDate(),
  DAYS: (a) => Math.round((isoDate(a[0] ?? null) - isoDate(a[1] ?? null)) / 86400000),
};
const KNOWN = new Set(Object.keys(FUNCTIONS));

function evaluate(node: Node, resolve: (name: string) => FormulaValue): FormulaValue {
  const ev = (n: Node): FormulaValue => {
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'ref': {
        const u = n.name.toUpperCase();
        const v = resolve(n.name);
        if (v === undefined as unknown) {
          if (u === 'TRUE') return true;
          if (u === 'FALSE') return false;
          if (u === 'PI') return Math.PI;
          throw new FormulaError('#REF!');
        }
        return v;
      }
      case 'un': return n.op === '-' ? -num(ev(n.a)) : !truthy(ev(n.a));
      case 'bin': {
        if (n.op === '&') return clip(text(ev(n.a)) + text(ev(n.b)));
        const a = ev(n.a); const b = ev(n.b);
        switch (n.op) {
          case '+': return check(num(a) + num(b));
          case '-': return check(num(a) - num(b));
          case '*': return check(num(a) * num(b));
          case '/': { const d = num(b); if (d === 0) throw new FormulaError('#DIV/0!'); return check(num(a) / d); }
          case '%': { const d = num(b); if (d === 0) throw new FormulaError('#DIV/0!'); return check(num(a) % d); }
          case '^': return check(num(a) ** num(b));
          case '=': return compareValues(a, b) === 0;
          case '<>': return compareValues(a, b) !== 0;
          case '<': return compareValues(a, b) < 0;
          case '<=': return compareValues(a, b) <= 0;
          case '>': return compareValues(a, b) > 0;
          default: return compareValues(a, b) >= 0;
        }
      }
      case 'call': {
        const fn = FUNCTIONS[n.fn];
        if (!fn) throw new FormulaError('#NAME?');
        return fn(n.fn === 'IF' ? [] : n.args.map(ev), n.args, ev);
      }
    }
  };
  return ev(node);
}

const cache = new Map<string, Node | string>();
function compile(src: string): Node {
  let hit = cache.get(src);
  if (hit === undefined) {
    try { hit = parse(src); } catch (e) { hit = e instanceof FormulaError ? e.code : '#SYNTAX!'; }
    if (cache.size > 500) cache.clear();
    cache.set(src, hit);
  }
  if (typeof hit === 'string') throw new FormulaError(hit);
  return hit;
}

/** Runs a formula. `resolve` gives the value of a column by its name (or undefined when there is none). Errors come back as `#CODE!` text. */
export function runFormula(src: string, resolve: (name: string) => FormulaValue | undefined): FormulaValue {
  try {
    return evaluate(compile(src), resolve as (name: string) => FormulaValue);
  } catch (e) {
    return e instanceof FormulaError ? e.code : '#ERR';
  }
}

/** Why a formula cannot be used (a mistake in it, an unknown function or column), or null when it is fine. `names` are the column titles and keys. */
export function checkFormula(src: string, names: string[]): string | null {
  let tree: Node;
  try { tree = compile(src); } catch (e) { return e instanceof FormulaError && e.code === '#SYNTAX!' ? 'This formula has a mistake in it (a missing bracket, quote or operator).' : 'This formula cannot be used.'; }
  const known = new Set(names.map((n) => n.toLowerCase()));
  let problem: string | null = null;
  const walk = (n: Node) => {
    if (problem) return;
    if (n.t === 'ref') { if (!known.has(n.name.toLowerCase()) && !['TRUE', 'FALSE', 'PI'].includes(n.name.toUpperCase())) problem = `There is no column called “${n.name}”.`; }
    else if (n.t === 'un') walk(n.a);
    else if (n.t === 'bin') { walk(n.a); walk(n.b); }
    else if (n.t === 'call') { if (!KNOWN.has(n.fn)) problem = `“${n.fn}” is not a known function.`; n.args.forEach(walk); }
  };
  walk(tree);
  return problem;
}

export const FORMULA_FUNCTIONS = [...KNOWN].sort();
