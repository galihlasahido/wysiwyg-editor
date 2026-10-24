/**
 * Formula text to a value: a tokenizer, a parser (Excel's operator order) and an evaluator over the function library. There is no
 * `eval`; a name that is not a function is `#NAME?`. Arrays are first-class: operators and most functions work on them element by
 * element, and a function that returns an array can spill (see `createEvaluator`).
 */
import {
  Ctx, FormulaError, NAME, REF, Rng, SYNTAX, V, VALUE, DIV0, NUM, broadcast, capText, colIndexOf, compare, errorOf, isArr, isRng, mapArr, sc, toNum, toStr,
} from './formula-core';
import { LIBRARY } from './formula-lib';
import type { Fn } from './formula-core';

type Node =
  | { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'bool'; v: boolean } | { k: 'err'; v: FormulaError } | { k: 'empty' }
  | { k: 'ref'; sheet?: string; c0: number; r0: number; c1: number; r1: number; whole?: 'col' | 'row' }
  | { k: 'name'; n: string } | { k: 'arr'; rows: Node[][] }
  | { k: 'un'; op: string; a: Node } | { k: 'pct'; a: Node } | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'call'; name: string; args: Node[] };

type Tok = { t: 'num' | 'str' | 'id' | 'fn' | 'ref' | 'col' | 'row' | 'op' | 'err' | 'sheet'; v: string; sheet?: string };

const REF_AT = /\$?([A-Za-z]{1,3})\$?(\d{1,7})(?![A-Za-z0-9_.(!])/y;
const COLS_AT = /\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![A-Za-z0-9_.(])/y;
const ROWS_AT = /\$?(\d{1,7}):\$?(\d{1,7})(?![A-Za-z0-9_.(])/y;
const NUM_AT = /(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
const ID_AT = /[A-Za-z_\\][A-Za-z0-9_.]*/y;
const ERR_AT = /#(?:N\/A|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|NULL!|SPILL!|CALC!)/iy;
const OP_AT = /<>|<=|>=|[-+*/^&=<>(),:%{};@]/y;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const at = (re: RegExp): RegExpExecArray | null => { re.lastIndex = i; return re.exec(src); };
  let sheet: string | undefined;
  const push = (t: Tok) => { if (sheet !== undefined) { t.sheet = sheet; sheet = undefined; } out.push(t); };
  while (i < src.length) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '"') {
      let j = i + 1; let s = '';
      for (;;) {
        if (j >= src.length) throw SYNTAX;
        if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; }
        s += src[j++];
      }
      i = j + 1; push({ t: 'str', v: s }); continue;
    }
    if (ch === "'") {
      let j = i + 1; let s = '';
      for (;;) {
        if (j >= src.length) throw SYNTAX;
        if (src[j] === "'") { if (src[j + 1] === "'") { s += "'"; j += 2; continue; } break; }
        s += src[j++];
      }
      if (src[j + 1] !== '!') throw SYNTAX;
      i = j + 2; sheet = s; continue;
    }
    let m: RegExpExecArray | null;
    if (ch === '#' && (m = at(ERR_AT))) { i += m[0].length; push({ t: 'err', v: m[0].toUpperCase() }); continue; }
    if ((m = at(COLS_AT))) { i += m[0].length; push({ t: 'col', v: `${m[1]}:${m[2]}` }); continue; }
    if ((m = at(ROWS_AT)) && !/[A-Za-z]/.test(src[i - 1] ?? '')) { i += m[0].length; push({ t: 'row', v: `${m[1]}:${m[2]}` }); continue; }
    if ((m = at(REF_AT)) && !/[A-Za-z0-9_.]/.test(src[i - 1] ?? '')) { i += m[0].length; push({ t: 'ref', v: `${m[1].toUpperCase()}${m[2]}` }); continue; }
    if ((m = at(NUM_AT))) { i += m[0].length; push({ t: 'num', v: m[0] }); continue; }
    if ((m = at(ID_AT))) {
      i += m[0].length;
      if (src[i] === '!') { i++; sheet = m[0]; continue; }
      push({ t: src[i] === '(' ? 'fn' : 'id', v: m[0].toUpperCase().replace(/^_XLFN\./, '') });
      continue;
    }
    if ((m = at(OP_AT))) { i += m[0].length; push({ t: 'op', v: m[0] }); continue; }
    throw SYNTAX;
  }
  if (sheet !== undefined) throw SYNTAX;
  return out;
}

const cellParts = (r: string): [number, number] => { const m = /^([A-Z]+)(\d+)$/.exec(r)!; return [colIndexOf(m[1]), Number(m[2]) - 1]; };

function parse(src: string, legacyPow: boolean): Node {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => toks[i]?.t === 'op' && toks[i].v === v;
  const eat = (v: string) => { if (!isOp(v)) throw SYNTAX; i++; };

  function cmp(): Node {
    let l = concat();
    while (peek()?.t === 'op' && ['<', '>', '=', '<>', '<=', '>='].includes(peek().v)) { const op = toks[i++].v; l = { k: 'bin', op, a: l, b: concat() }; }
    return l;
  }
  function concat(): Node {
    let l = add();
    while (isOp('&')) { i++; l = { k: 'bin', op: '&', a: l, b: add() }; }
    return l;
  }
  function add(): Node {
    let l = mul();
    while (isOp('+') || isOp('-')) { const op = toks[i++].v; l = { k: 'bin', op, a: l, b: mul() }; }
    return l;
  }
  function mul(): Node {
    let l = pow();
    while (isOp('*') || isOp('/')) { const op = toks[i++].v; l = { k: 'bin', op, a: l, b: pow() }; }
    return l;
  }
  function pow(): Node {
    const l = unary();
    if (isOp('^')) {
      if (legacyPow) { i++; return { k: 'bin', op: '^', a: l, b: pow() }; } // the editor's tables: right to left
      let n = l;
      while (isOp('^')) { i++; n = { k: 'bin', op: '^', a: n, b: unary() }; }
      return n;
    }
    return l;
  }
  function unary(): Node {
    if (isOp('-') || isOp('+') || isOp('@')) { const op = toks[i++].v; return { k: 'un', op, a: unary() }; }
    return postfix();
  }
  function postfix(): Node {
    let v = range();
    while (isOp('%')) { i++; v = { k: 'pct', a: v }; }
    return v;
  }
  function range(): Node {
    let l = primary();
    while (isOp(':')) { i++; l = { k: 'bin', op: ':', a: l, b: primary() }; }
    return l;
  }
  function list(close: string): Node[] {
    const out: Node[] = [];
    if (isOp(close)) { i++; return out; }
    for (;;) {
      if (isOp(',') || isOp(close)) out.push({ k: 'empty' }); else out.push(cmp());
      if (isOp(',')) { i++; continue; }
      eat(close);
      return out;
    }
  }
  function primary(): Node {
    const t = toks[i];
    if (!t) throw SYNTAX;
    i++;
    switch (t.t) {
      case 'num': return { k: 'num', v: Number(t.v) };
      case 'str': return { k: 'str', v: t.v };
      case 'err': return { k: 'err', v: errorOf(t.v) };
      case 'ref': { const [c, r] = cellParts(t.v); return { k: 'ref', sheet: t.sheet, c0: c, r0: r, c1: c, r1: r }; }
      case 'col': { const [a, b] = t.v.split(':').map(colIndexOf); return { k: 'ref', sheet: t.sheet, c0: Math.min(a, b), c1: Math.max(a, b), r0: 0, r1: -1, whole: 'col' }; }
      case 'row': { const [a, b] = t.v.split(':').map((x) => Number(x) - 1); return { k: 'ref', sheet: t.sheet, r0: Math.min(a, b), r1: Math.max(a, b), c0: 0, c1: -1, whole: 'row' }; }
      case 'fn': { eat('('); return { k: 'call', name: t.v, args: list(')') }; }
      case 'id':
        if (t.v === 'TRUE') return { k: 'bool', v: true };
        if (t.v === 'FALSE') return { k: 'bool', v: false };
        return { k: 'name', n: t.v };
      case 'op':
        if (t.v === '(') { const n = cmp(); eat(')'); return n; }
        if (t.v === '{') {
          const rows: Node[][] = [[]];
          for (;;) {
            let neg = false;
            if (isOp('-')) { i++; neg = true; }
            const e = primary();
            rows[rows.length - 1].push(neg && e.k === 'num' ? { k: 'num', v: -e.v } : e);
            if (isOp(',')) { i++; continue; }
            if (isOp(';')) { i++; rows.push([]); continue; }
            eat('}');
            return { k: 'arr', rows };
          }
        }
    }
    throw SYNTAX;
  }
  const n = cmp();
  if (i < toks.length) throw SYNTAX;
  return n;
}

const CACHE = new Map<string, Node | FormulaError>();
function parsed(src: string, legacyPow: boolean): Node {
  const key = (legacyPow ? '1' : '0') + src;
  let n = CACHE.get(key);
  if (n === undefined) {
    try { n = parse(src, legacyPow); } catch (e) { n = e instanceof FormulaError ? e : SYNTAX; }
    if (CACHE.size > 5000) CACHE.clear();
    CACHE.set(key, n);
  }
  if (n instanceof FormulaError) throw n;
  return n;
}

// ---- evaluation --------------------------------------------------------------------------------------------------------------------

const num = (v: number): number => { if (!Number.isFinite(v)) throw NUM; return v; };
const ARITH: Record<string, (x: number, y: number) => number> = {
  '+': (x, y) => x + y, '-': (x, y) => x - y, '*': (x, y) => x * y,
  '/': (x, y) => { if (y === 0) throw DIV0; return x / y; },
  '^': (x, y) => { if (x === 0 && y === 0) throw NUM; if (x === 0 && y < 0) throw DIV0; const r = x ** y; if (Number.isNaN(r)) throw NUM; return r; },
};
const CMP: Record<string, (c: number) => boolean> = { '=': (c) => c === 0, '<>': (c) => c !== 0, '<': (c) => c < 0, '>': (c) => c > 0, '<=': (c) => c <= 0, '>=': (c) => c >= 0 };

export interface EvalOptions {
  legacyPow?: boolean;
  /** Ranges that run past the grid are an error (the editor's tables) instead of being cut to the grid (the spreadsheet). */
  strictBounds?: boolean;
}

export const MAX_FORMULA = 8192; // Excel's own limit

export function evaluate(src: string, ctx: Ctx, opts: EvalOptions = {}): V {
  if (src.length > MAX_FORMULA) throw SYNTAX;
  const root = parsed(src, !!opts.legacyPow);
  const env: Map<string, V>[] = [];
  const sheetOf = (name: string | undefined) => { if (name === undefined) return ctx.sheet; const s = ctx.sheets(name); if (!s) throw REF; return s; };

  function reference(n: Extract<Node, { k: 'ref' }>): Rng {
    const sh = sheetOf(n.sheet);
    let { c0, r0, c1, r1 } = n;
    if (n.whole === 'col') { r0 = 0; r1 = sh.rows - 1; } else if (n.whole === 'row') { c0 = 0; c1 = sh.cols - 1; }
    if (c0 >= sh.cols || r0 >= sh.rows) throw REF;
    if (c1 >= sh.cols || r1 >= sh.rows) { if (opts.strictBounds) throw REF; c1 = Math.min(c1, sh.cols - 1); r1 = Math.min(r1, sh.rows - 1); }
    return new Rng(sh, c0, r0, c1, r1);
  }

  function ev(n: Node): V {
    switch (n.k) {
      case 'num': return n.v;
      case 'str': return n.v;
      case 'bool': return n.v;
      case 'err': throw n.v;
      case 'empty': return null;
      case 'ref': return reference(n);
      case 'name': {
        for (let j = env.length - 1; j >= 0; j--) { const v = env[j].get(n.n); if (v !== undefined) return v; }
        const def = ctx.name(n.n);
        if (def === undefined) throw NAME;
        return ctx.evalText(def);
      }
      case 'arr': return n.rows.map((row) => row.map((e) => { try { const v = ev(e); return isArr(v) || isRng(v) ? sc(v) : v; } catch (x) { if (x instanceof FormulaError) return x; throw x; } }));
      case 'un': {
        const a = ev(n.a);
        if (n.op === '@') return sc(a);
        if (n.op === '+') return a;
        return mapArr(a, (x) => -toNum(x));
      }
      case 'pct': return mapArr(ev(n.a), (x) => toNum(x) / 100);
      case 'bin': return binary(n);
      case 'call': return call(n);
    }
  }

  function binary(n: Extract<Node, { k: 'bin' }>): V {
    const a = ev(n.a);
    const b = ev(n.b);
    if (n.op === ':') {
      if (!isRng(a) || !isRng(b) || a.sheet !== b.sheet) throw VALUE;
      return new Rng(a.sheet, Math.min(a.c0, b.c0), Math.min(a.r0, b.r0), Math.max(a.c1, b.c1), Math.max(a.r1, b.r1));
    }
    const arith = ARITH[n.op];
    if (arith) return broadcast(a, b, (x, y) => num(arith(toNum(x), toNum(y))));
    if (n.op === '&') return broadcast(a, b, (x, y) => capText(toStr(x) + toStr(y)));
    const test = CMP[n.op];
    return broadcast(a, b, (x, y) => test(compare(x, y)));
  }

  function call(n: Extract<Node, { k: 'call' }>): V {
    if (n.name === 'LET') return let_(n);
    const def: Fn | undefined = Object.prototype.hasOwnProperty.call(LIBRARY, n.name) ? LIBRARY[n.name] : undefined;
    if (!def) throw NAME;
    const count = n.args.length;
    if (count < def.min || count > def.max) throw SYNTAX;
    if (def.lazy) return def.f(n.args.map((a) => () => ev(a)), ctx);
    const vals: (V | undefined)[] = n.args.map((a) => (a.k === 'empty' ? undefined : ev(a)));
    return def.f(vals as V[], ctx);
  }

  function let_(n: Extract<Node, { k: 'call' }>): V {
    const a = n.args;
    if (a.length < 3 || a.length % 2 === 0) throw SYNTAX;
    const scope = new Map<string, V>();
    env.push(scope);
    try {
      for (let j = 0; j < a.length - 1; j += 2) {
        const nm = a[j];
        if (nm.k !== 'name') throw SYNTAX;
        scope.set(nm.n, ev(a[j + 1]));
      }
      return ev(a[a.length - 1]);
    } finally { env.pop(); }
  }

  return ev(root);
}
