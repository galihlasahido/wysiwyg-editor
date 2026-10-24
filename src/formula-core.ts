/**
 * The values of the formula engine and the helpers every function uses: errors, ranges, arrays, conversions, comparison, the
 * conditions of COUNTIF and friends, and Excel date serial numbers. It imports nothing.
 */

/** An Excel error value (`#N/A`, `#DIV/0!`, ...). It is thrown while a scalar is computed and sits in an array as a value. */
export class FormulaError {
  constructor(readonly message: string) {}
  toString() { return this.message; }
}
export const NA = new FormulaError('#N/A');
export const VALUE = new FormulaError('#VALUE!');
export const REF = new FormulaError('#REF!');
export const NAME = new FormulaError('#NAME?');
export const NUM = new FormulaError('#NUM!');
export const DIV0 = new FormulaError('#DIV/0!');
export const NULLERR = new FormulaError('#NULL!');
export const SPILL = new FormulaError('#SPILL!');
export const SYNTAX = new FormulaError('#ERR!');
export const CYCLE = new FormulaError('#CYCLE!');
const KNOWN = new Map([NA, VALUE, REF, NAME, NUM, DIV0, NULLERR, SPILL, SYNTAX, CYCLE, new FormulaError('#CALC!')].map((e) => [e.message, e]));
export const errorOf = (code: string): FormulaError => KNOWN.get(code.toUpperCase()) ?? new FormulaError(code);

export type Scalar = number | string | boolean | null | FormulaError;
export type Arr = Scalar[][];

/** One sheet as the formulas see it. */
export interface SheetCtx {
  name: string;
  cols: number;
  rows: number;
  cell(col: number, row: number): Scalar;
  /** The cell holds a formula. */
  isFormula(col: number, row: number): boolean;
}

/** A reference to a block of cells; the values are read only when a function asks for them. */
export class Rng {
  constructor(readonly sheet: SheetCtx, readonly c0: number, readonly r0: number, readonly c1: number, readonly r1: number) {}
  get rows() { return this.r1 - this.r0 + 1; }
  get cols() { return this.c1 - this.c0 + 1; }
  matrix(): Arr {
    spend(this.rows * this.cols);
    const out: Arr = [];
    for (let r = this.r0; r <= this.r1; r++) { const row: Scalar[] = []; for (let c = this.c0; c <= this.c1; c++) row.push(this.sheet.cell(c, r)); out.push(row); }
    return out;
  }
}

export type V = Scalar | Arr | Rng;
export type Thunk = () => V;
export interface Ctx {
  sheet: SheetCtx;
  /** The cell the formula is in. */
  col: number;
  row: number;
  sheets(name: string): SheetCtx | undefined;
  now: number;
  rand(): number;
  /** The names a formula may use (defined names), as formula text. */
  name(n: string): string | undefined;
  /** Evaluate formula text in this context (INDIRECT, defined names). */
  evalText(src: string): V;
}

export const isErr = (v: unknown): v is FormulaError => v instanceof FormulaError;
export const isArr = (v: V | undefined): v is Arr => Array.isArray(v);
export const isRng = (v: V | undefined): v is Rng => v instanceof Rng;
export const isMulti = (v: V | undefined): boolean => (isRng(v) ? v.rows * v.cols > 1 : isArr(v) ? v.length > 1 || (v[0]?.length ?? 0) > 1 : false);
export const mat = (v: V | undefined): Arr => (isRng(v) ? v.matrix() : isArr(v) ? v : [[v === undefined ? null : v]]);
export const dims = (v: V | undefined): [number, number] => (isRng(v) ? [v.rows, v.cols] : isArr(v) ? [v.length, v[0]?.length ?? 0] : [1, 1]);

/** One value out of a cell, a 1x1 array or the top-left of a block. Throws the error when it is one. */
export function sc(v: V | undefined): Scalar {
  let s: Scalar;
  if (v === undefined) s = null;
  else if (isRng(v)) s = v.sheet.cell(v.c0, v.r0);
  else if (isArr(v)) s = v[0]?.[0] ?? null;
  else s = v;
  if (s instanceof FormulaError) throw s;
  return s;
}

// ---- numbers and text -------------------------------------------------------------------------------------------------------

const PLAIN = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
const MAX_TEXT = 10000; // a cell's text result; stops =A1&A1 chains from doubling into gigabytes
export const capText = (s: string): string => { if (s.length > MAX_TEXT) throw VALUE; return s; };

/** A number as Excel writes it with the General format: 15 significant digits. */
export function numText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const s = String(Number(n.toPrecision(15)));
  return /e/.test(s) ? s.replace(/e\+?(-?)(\d)$/, 'E$1+0$2').replace('e+', 'E+').replace('e-', 'E-') : s;
}

export function parseNumberText(t0: string): number | null {
  const t = t0.trim();
  if (t === '') return null;
  if (PLAIN.test(t)) return Number(t);
  let m = /^([-+]?)\$?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?$/.exec(t);
  if (m && (t.includes('$') || t.includes(','))) return Number(`${m[1]}${m[2].replace(/,/g, '')}${m[3] ?? ''}`);
  m = /^([-+]?(?:\d+\.?\d*|\.\d+))\s*%$/.exec(t);
  if (m) return Number(m[1]) / 100;
  const d = parseDateText(t);
  return d;
}

/** "2024-03-05", "2024-03-05 14:30", "3/5/2024", "14:30", "14:30:15" as an Excel serial number. */
export function parseDateText(t: string): number | null {
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/.exec(t);
  if (m) return makeDate(+m[1], +m[2], +m[3]) + (m[4] ? (+m[4] * 3600 + +m[5] * 60 + +(m[6] ?? 0)) / 86400 : 0);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return makeDate(+m[3], +m[1], +m[2]);
  m = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(?:\s*([AP]M))?$/i.exec(t);
  if (m) { let h = +m[1]; if (m[4]) { h = h % 12 + (m[4].toUpperCase() === 'PM' ? 12 : 0); } return (h * 3600 + +m[2] * 60 + +(m[3] ?? 0)) / 86400; }
  return null;
}

export function toNum(s: Scalar | undefined): number {
  if (s === undefined || s === null) return 0;
  if (typeof s === 'number') return s;
  if (typeof s === 'boolean') return s ? 1 : 0;
  if (s instanceof FormulaError) throw s;
  const n = parseNumberText(s);
  if (n === null) throw VALUE;
  return n;
}
export function toStr(s: Scalar | undefined): string {
  if (s === undefined || s === null) return '';
  if (typeof s === 'number') return numText(s);
  if (typeof s === 'boolean') return s ? 'TRUE' : 'FALSE';
  if (s instanceof FormulaError) throw s;
  return s;
}
export function toBool(s: Scalar | undefined): boolean {
  if (s === undefined || s === null) return false;
  if (typeof s === 'boolean') return s;
  if (typeof s === 'number') return s !== 0;
  if (s instanceof FormulaError) throw s;
  const u = s.trim().toUpperCase();
  if (u === 'TRUE') return true;
  if (u === 'FALSE') return false;
  throw VALUE;
}
export const toInt = (s: Scalar | undefined): number => Math.trunc(toNum(s));

/** Numbers for SUM, AVERAGE and the like: text, booleans and blanks inside a range are skipped; typed-in arguments are converted. */
export function collectNumbers(args: (V | undefined)[], o: { text?: boolean } = {}): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (a === undefined) continue;
    if (isRng(a) || isArr(a)) {
      for (const row of mat(a)) for (const v of row) {
        if (v instanceof FormulaError) throw v;
        if (typeof v === 'number') out.push(v);
        else if (o.text && typeof v === 'boolean') out.push(v ? 1 : 0);
      }
    } else if (a instanceof FormulaError) throw a;
    else if (a === null) out.push(0);
    else out.push(toNum(a));
  }
  return out;
}

/** Every value of the arguments, flattened in row order (errors thrown). */
export function flatten(args: (V | undefined)[]): Scalar[] {
  const out: Scalar[] = [];
  for (const a of args) {
    if (a === undefined) continue;
    if (isRng(a) || isArr(a)) { for (const row of mat(a)) for (const v of row) { if (v instanceof FormulaError) throw v; out.push(v); } }
    else { if (a instanceof FormulaError) throw a; out.push(a); }
  }
  return out;
}

// ---- comparison ---------------------------------------------------------------------------------------------------------------

const rank = (v: Scalar): number => (typeof v === 'number' || v === null ? 1 : typeof v === 'string' ? 2 : typeof v === 'boolean' ? 3 : 4);
/** Excel's order: numbers, then text (case-insensitive), then booleans. A blank counts as 0 or "". */
export function compare(a: Scalar, b: Scalar): number {
  if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
  if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
  const ra = rank(a); const rb = rank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  if (typeof a === 'number') return a < (b as number) ? -1 : a > (b as number) ? 1 : 0;
  if (typeof a === 'string') { const x = a.toLowerCase(); const y = (b as string).toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  if (typeof a === 'boolean') return a === b ? 0 : a ? 1 : -1;
  return 0;
}
export const same = (a: Scalar, b: Scalar): boolean => compare(a, b) === 0;

/** The work one formula may do: every cell read and every element made is charged, so a hostile sheet cannot freeze the page. */
export const budget = { cell: 0, total: 0 };
export const CALC = new FormulaError('#CALC!');
export function spend(n: number): void {
  budget.cell -= n; budget.total -= n;
  if (budget.cell < 0 || budget.total < 0) throw CALC;
}

type Glob = { k: 'lit'; c: string } | { k: 'any' } | { k: 'star' };
function compileGlob(p: string): Glob[] {
  const out: Glob[] = [];
  for (let i = 0; i < p.length; i++) {
    const ch = p[i];
    if (ch === '~' && i + 1 < p.length) out.push({ k: 'lit', c: p[++i] });
    else if (ch === '*') { if (out[out.length - 1]?.k !== 'star') out.push({ k: 'star' }); }
    else if (ch === '?') out.push({ k: 'any' });
    else out.push({ k: 'lit', c: ch });
  }
  return out;
}
/** Does the whole text match a pattern with `?`, `*` and `~` escapes (case-insensitive)? Linear in the text, never backtracks badly. */
function globRun(toks: Glob[], t: string): boolean {
  let i = 0; let j = 0; let star = -1; let mark = 0;
  while (i < t.length) {
    if (j < toks.length && toks[j].k === 'star') { star = j++; mark = i; }
    else if (j < toks.length && (toks[j].k === 'any' || (toks[j] as { c: string }).c === t[i])) { i++; j++; }
    else if (star >= 0) { j = star + 1; i = ++mark; }
    else return false;
  }
  while (j < toks.length && toks[j].k === 'star') j++;
  return j === toks.length;
}
/** A case-insensitive wildcard test (the whole text, `?` one character, `*` any run, `~` escapes the next). */
export function wildcard(p: string): { test(s: string): boolean } {
  const toks = compileGlob(p.toLowerCase());
  return { test: (s) => { spend(s.length + toks.length); return globRun(toks, s.toLowerCase()); } };
}
/** The first position at or after `from` where the pattern matches the start of the text there, or -1 (SEARCH with wildcards). */
export function globIndex(p: string, text: string, from: number): number {
  const toks = compileGlob(p.toLowerCase());
  toks.push({ k: 'star' });
  const t = text.toLowerCase();
  for (let s = from; s <= t.length; s++) { spend(t.length - s + toks.length); if (globRun(toks, t.slice(s))) return s; }
  return -1;
}
export const hasWildcard = (p: string) => /[*?]/.test(p);

/** A COUNTIF / SUMIF condition: 5, ">5", "<=2", "<>x", "app*", "". */
export function criterion(c: Scalar): (v: Scalar) => boolean {
  if (c instanceof FormulaError) throw c;
  if (typeof c === 'number') return (v) => (typeof v === 'number' ? v === c : typeof v === 'string' && parseNumberText(v) === c);
  if (typeof c === 'boolean') return (v) => v === c;
  if (c === null) return (v) => v === null || v === '';
  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(c)!;
  const op = m[1] ?? '=';
  const want = m[2];
  const n = want.trim() === '' ? null : parseNumberText(want);
  if (n !== null && !/^\d{1,4}[-/]/.test(want)) {
    return (v) => {
      const x = typeof v === 'number' ? v : (op === '=' || op === '<>') && typeof v === 'string' ? parseNumberText(v) : null;
      if (x === null) return op === '<>';
      return op === '=' ? x === n : op === '<>' ? x !== n : op === '<' ? x < n : op === '>' ? x > n : op === '<=' ? x <= n : x >= n;
    };
  }
  if (/^(TRUE|FALSE)$/i.test(want) && (op === '=' || op === '<>')) { const b = want.toUpperCase() === 'TRUE'; return (v) => (typeof v === 'boolean' && v === b) === (op === '='); }
  if (want === '') return op === '=' ? (v) => v === null || v === '' : op === '<>' ? (v) => v !== null && v !== '' : () => false;
  if (op === '=' || op === '<>') {
    const re = wildcard(want);
    return (v) => { const hit = typeof v === 'string' ? re.test(v) : v !== null && !(v instanceof FormulaError) && re.test(toStr(v)); return op === '=' ? hit : !hit; };
  }
  const w = want.toLowerCase();
  return (v) => {
    if (typeof v !== 'string') return false;
    const x = v.toLowerCase();
    return op === '<' ? x < w : op === '>' ? x > w : op === '<=' ? x <= w : x >= w;
  };
}

// ---- dates (Excel's 1900 system, with its leap-year quirk) ------------------------------------------------------------------------

const DAY = 86400000;
const EPOCH = Date.UTC(1899, 11, 30);
/** The serial number of a date; months and days outside their range roll over like Excel's DATE. */
export function makeDate(y: number, m: number, d: number): number {
  if (y >= 0 && y < 1900) y += 1900;
  const t = new Date(Date.UTC(2000, 0, 1));
  t.setUTCFullYear(y, m - 1, d);
  const serial = Math.round((t.getTime() - EPOCH) / DAY);
  return serial < 61 && serial >= 1 ? serial - 1 : serial; // the phantom 1900-02-29 sits at 60
}
export function serialToDate(serial: number): { y: number; m: number; d: number; wd: number; h: number; mi: number; s: number } {
  let n = Math.floor(serial);
  const frac = serial - n;
  if (n === 60) return { y: 1900, m: 2, d: 29, wd: 3, ...timeOf(frac) };
  if (n < 60) n += 1;
  const dt = new Date(EPOCH + n * DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay(), ...timeOf(frac) };
}
function timeOf(frac: number) {
  const secs = Math.round(frac * 86400);
  return { h: Math.floor(secs / 3600) % 24, mi: Math.floor(secs / 60) % 60, s: secs % 60 };
}
export const serialNow = (ms: number): number => (ms - EPOCH) / DAY - new Date(ms).getTimezoneOffset() / 1440;

// ---- operators over arrays and the shapes of functions -------------------------------------------------------------------------

/** An operator over two values: element by element when either is an array, with a one-row or one-column array stretched. */
export function broadcast(a: V, b: V, f: (x: Scalar, y: Scalar) => Scalar): V {
  if (!isMulti(a) && !isMulti(b)) return f(sc(a), sc(b));
  const A = mat(a); const B = mat(b);
  const rows = Math.max(A.length, B.length); const cols = Math.max(A[0].length, B[0].length);
  spend(rows * cols);
  const out: Arr = [];
  for (let r = 0; r < rows; r++) {
    const row: Scalar[] = [];
    for (let c = 0; c < cols; c++) {
      const x = A.length === 1 ? A[0][A[0].length === 1 ? 0 : c] : A[r]?.[A[0].length === 1 ? 0 : c];
      const y = B.length === 1 ? B[0][B[0].length === 1 ? 0 : c] : B[r]?.[B[0].length === 1 ? 0 : c];
      if (x === undefined || y === undefined) { row.push(NA); continue; }
      try { if (isErr(x)) throw x; if (isErr(y)) throw y; row.push(f(x, y)); } catch (e) { if (e instanceof FormulaError) row.push(e); else throw e; }
    }
    out.push(row);
  }
  return out;
}
/** A function of one value over an array. */
export function mapArr(a: V, f: (x: Scalar) => Scalar): V {
  if (!isMulti(a)) return f(sc(a));
  return mat(a).map((row) => row.map((x) => { try { if (isErr(x)) throw x; return f(x); } catch (e) { if (e instanceof FormulaError) return e; throw e; } }));
}


/** The letters of a column to its 0-based index ("A" 0, "AA" 26). */
export const colNameOf = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colNameOf(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
export const colIndexOf = (s: string): number => [...s.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

export interface Fn {
  min: number;
  max: number;
  /** The function gets its arguments as thunks and decides what to evaluate (IF, IFERROR, ...). */
  lazy?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  f: (a: any[], x: Ctx) => V;
}
export type FnTable = Record<string, Fn>;

/** A function of plain values: an array argument runs it for each element and gives an array back. */
export function scalarFn(min: number, max: number, f: (...a: (Scalar | undefined)[]) => Scalar): Fn {
  return {
    min, max,
    f: (args) => {
      if (!args.some((a) => isMulti(a))) return f(...args.map((a) => (a === undefined ? undefined : sc(a))));
      const ms = args.map((a) => (a === undefined ? undefined : mat(a)));
      const rows = Math.max(...ms.map((m) => m?.length ?? 1)); const cols = Math.max(...ms.map((m) => m?.[0].length ?? 1));
      spend(rows * cols);
      const out: Arr = [];
      for (let r = 0; r < rows; r++) {
        const row: Scalar[] = [];
        for (let c = 0; c < cols; c++) {
          try {
            const vals = ms.map((m) => { if (!m) return undefined; const x = m.length === 1 ? m[0][m[0].length === 1 ? 0 : c] : m[r]?.[m[0].length === 1 ? 0 : c]; if (x === undefined) throw NA; if (x instanceof FormulaError) throw x; return x; });
            row.push(f(...vals));
          } catch (e) { if (e instanceof FormulaError) row.push(e); else throw e; }
        }
        out.push(row);
      }
      return out;
    },
  };
}
/** A function that takes the arguments as they are (ranges stay ranges). */
export const rawFn = (min: number, max: number, f: Fn['f']): Fn => ({ min, max, f });
export const lazyFn = (min: number, max: number, f: (a: Thunk[], x: Ctx) => V): Fn => ({ min, max, lazy: true, f: f as Fn['f'] });
/** The value of a thunk, an error being a value. */
export const tryV = (t: Thunk): V => { try { return t(); } catch (e) { if (e instanceof FormulaError) return e; throw e; } };
