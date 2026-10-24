/** Formula functions: lookup and reference, arrays, finance, databases. */
import {
  Arr, DIV0, FormulaError, FnTable, NA, NUM, REF, Rng, Scalar, V, VALUE, collectNumbers, compare, criterion, flatten, isArr, isErr, isMulti, isRng, lazyFn, mat, makeDate, rawFn, same, sc, serialToDate,
  toBool, toNum, toStr, tryV, wildcard, hasWildcard, spend, dims, colNameOf, parseNumberText, scalarFn,
} from './formula-core';
import { roundTo } from './formula-lib-math';

const n = toNum;
const S = scalarFn;
const cell = (m: Arr, r: number, c: number): Scalar => m[r]?.[c] ?? null;
const orNA = (i: number) => { if (i < 0) throw NA; return i; };

// ---- lookup ---------------------------------------------------------------------------------------------------------------------------

/** The position of `key` in a one-dimensional list: exact (-1/0) with wildcards, or sorted-approximate (1 ascending, -1 descending). */
function findPos(list: Scalar[], key: Scalar, mode: number, wild: boolean, searchFrom: 'first' | 'last' | 'binary' = 'first'): number {
  if (key instanceof FormulaError) throw key;
  spend(list.length);
  const isText = typeof key === 'string';
  const re = wild && isText && hasWildcard(key as string) ? wildcard(key as string) : null;
  const eq = (v: Scalar) => (re ? typeof v === 'string' && re.test(v) : typeof v === typeof key || (v === null && key === '') ? compare(v, key) === 0 : false);
  if (mode === 0 || mode === 2) {
    if (searchFrom === 'last') { for (let i = list.length - 1; i >= 0; i--) if (eq(list[i])) return i; return -1; }
    for (let i = 0; i < list.length; i++) if (eq(list[i])) return i;
    return -1;
  }
  // approximate: the largest value <= key (mode 1, ascending list) or the smallest >= key (mode -1)
  let best = -1;
  if (mode === 1) {
    for (let i = 0; i < list.length; i++) { const v = list[i]; if (v === null || typeof v !== typeof key) continue; if (compare(v, key) <= 0) { if (best < 0 || compare(v, list[best]) >= 0) best = i; } }
  } else {
    for (let i = 0; i < list.length; i++) { const v = list[i]; if (v === null || typeof v !== typeof key) continue; if (compare(v, key) >= 0) { if (best < 0 || compare(v, list[best]) <= 0) best = i; } }
  }
  return best;
}
const colOf = (m: Arr, c: number): Scalar[] => m.map((row) => row[c] ?? null);

const lookupRaw = (a: V[], vertical: boolean): V => {
  const key = sc(a[0]); const m = mat(a[1]); const idx = Math.trunc(n(sc(a[2])));
  const approx = a[3] === undefined ? true : toBool(sc(a[3]));
  const lines = vertical ? colOf(m, 0) : m[0];
  const limit = vertical ? m[0].length : m.length;
  if (idx < 1) throw VALUE;
  if (idx > limit) throw REF;
  let i: number;
  if (approx) {
    // binary-search semantics: the last value <= key in a sorted list
    i = -1;
    for (let k = 0; k < lines.length; k++) { const v = lines[k]; if (v === null || typeof v !== typeof key) continue; if (compare(v, key) <= 0) i = k; else if (compare(v, key) > 0) break; }
  } else i = findPos(lines, key, 0, true);
  if (i < 0) throw NA;
  return vertical ? cell(m, i, idx - 1) : cell(m, idx - 1, i);
};

function xmatchIndex(key: Scalar, list: Scalar[], matchMode: number, searchMode: number): number {
  const wild = matchMode === 2;
  if (matchMode === 0 || wild) return findPos(list, key, 0, wild, searchMode < 0 ? 'last' : 'first');
  if (matchMode === 1 || matchMode === -1) {
    const exact = findPos(list, key, 0, false, searchMode < 0 ? 'last' : 'first');
    if (exact >= 0) return exact;
    return findPos(list, key, matchMode === 1 ? -1 : 1, false);
  }
  throw VALUE;
}

// ---- reshaping arrays -----------------------------------------------------------------------------------------------------------------

const rowsOf = (m: Arr) => m.length;
const colsOf = (m: Arr) => m[0]?.length ?? 0;
const sortKey = (v: Scalar, asc: boolean) => (a: Scalar, b: Scalar) => (asc ? compare(a, b) : compare(b, a));

function sortRows(m: Arr, keys: { col: number; asc: boolean }[]): Arr {
  spend(m.length * (Math.ceil(Math.log2(m.length + 1)) + 1));
  return m.map((row, i) => ({ row, i })).sort((x, y) => { for (const k of keys) { const c = sortKey(null, k.asc)(x.row[k.col], y.row[k.col]); if (c) return c; } return x.i - y.i; }).map((e) => e.row);
}
const transpose = (m: Arr): Arr => m[0].map((_, c) => m.map((row) => row[c]));
function toOneCol(m: Arr, ignore: number, scanByCol: boolean): Arr {
  const flat: Scalar[] = [];
  const rows = rowsOf(m); const cols = colsOf(m);
  const push = (x: Scalar) => { if ((ignore === 1 || ignore === 3) && x === null) return; if ((ignore === 2 || ignore === 3) && x instanceof FormulaError) return; flat.push(x); };
  if (scanByCol) for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) push(m[r][c]); else for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) push(m[r][c]);
  if (!flat.length) throw NA;
  return flat.map((x) => [x]);
}
function wrap(v: V[], byRow: boolean): Arr {
  const list = flatten([v[0]]); const k = Math.floor(n(sc(v[1]))); const pad = v[2] === undefined ? NA : sc(v[2]);
  if (k < 1) throw NUM;
  const out: Scalar[][] = [];
  for (let i = 0; i < list.length; i += k) { const part = list.slice(i, i + k); while (part.length < k) part.push(pad); out.push(part); }
  return byRow ? out : transpose(out);
}

// ---- finance --------------------------------------------------------------------------------------------------------------------------

function pmt(rate: number, nper: number, pv: number, fv: number, type: number): number {
  if (rate === 0) return -(pv + fv) / nper;
  const f = (1 + rate) ** nper;
  return -(rate * (pv * f + fv)) / ((1 + rate * type) * (f - 1));
}
function fv(rate: number, nper: number, p: number, pv: number, type: number): number {
  if (rate === 0) return -(pv + p * nper);
  const f = (1 + rate) ** nper;
  return -(pv * f + p * (1 + rate * type) * ((f - 1) / rate));
}
function ipmt(rate: number, per: number, nper: number, pv: number, f: number, type: number): number {
  const pay = pmt(rate, nper, pv, f, type);
  if (type === 1 && per === 1) return 0;
  const bal = fv(rate, type === 1 ? per - 2 : per - 1, pay, pv, type);
  return (type === 1 ? bal + pay : bal) * rate;
}
/** Newton's method with a bisection fallback. */
function solve(f: (x: number) => number, guess: number, lo = -0.999999, hi = 1e6): number {
  let x = guess;
  for (let i = 0; i < 100; i++) {
    const y = f(x);
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const d = (f(x + h) - y) / h;
    if (!Number.isFinite(d) || d === 0) break;
    const nx = x - y / d;
    if (!Number.isFinite(nx) || nx <= lo) break;
    if (Math.abs(nx - x) < 1e-12) return nx;
    x = nx;
  }
  let a = lo + 1e-9; let b = Math.min(hi, 1000); const fa = f(a);
  if (!Number.isFinite(fa)) throw NUM;
  let sa = Math.sign(fa);
  for (let k = 0; k < 200; k++) {
    const mid = (a + b) / 2; const fm = f(mid);
    if (!Number.isFinite(fm)) break;
    if (Math.sign(fm) === sa) a = mid; else b = mid;
    if (b - a < 1e-13) return mid;
  }
  throw NUM;
}
const npv = (rate: number, v: number[]) => v.reduce((t, x, i) => t + x / (1 + rate) ** (i + 1), 0);
function xnpv(rate: number, v: number[], d: number[]): number { return v.reduce((t, x, i) => t + x / (1 + rate) ** ((d[i] - d[0]) / 365), 0); }
function cashflows(a: V): number[] { return flatten([a]).filter((x) => typeof x === 'number') as number[]; }
const hasBoth = (v: number[]) => v.some((x) => x > 0) && v.some((x) => x < 0);

function depreciationDB(cost: number, salvage: number, life: number, period: number, month: number): number {
  const rate = Math.round((1 - (salvage / cost) ** (1 / life)) * 1000) / 1000;
  let total = 0; let dep = 0;
  for (let p = 1; p <= period; p++) {
    dep = p === 1 ? (cost * rate * month) / 12 : p === life + 1 ? ((cost - total) * rate * (12 - month)) / 12 : (cost - total) * rate;
    total += dep;
  }
  return dep;
}

// ---- databases (D functions) ----------------------------------------------------------------------------------------------------------

function dbRows(db: V, field: V, crit: V): { rows: Arr; col: number } {
  const m = mat(db); const heads = m[0].map((h) => toStr(h).toLowerCase());
  const f = sc(field);
  const col = typeof f === 'number' ? f - 1 : heads.indexOf(toStr(f).toLowerCase());
  if (col < 0 || col >= heads.length) throw VALUE;
  const c = mat(crit); const ch = c[0].map((h) => toStr(h).toLowerCase());
  const rows = m.slice(1).filter((row) => c.slice(1).some((cr) => cr.every((cv, k) => { if (cv === null || cv === '') return true; const idx = heads.indexOf(ch[k]); return idx >= 0 && criterion(cv)(row[idx]); })));
  return { rows, col };
}
const dfn = (g: (vals: Scalar[], nums: number[]) => V): ReturnType<typeof rawFn> => rawFn(3, 3, (a) => { const { rows, col } = dbRows(a[0], a[1], a[2]); const vals = rows.map((r) => r[col]); return g(vals, vals.filter((v): v is number => typeof v === 'number')); });

// ---- the table ---------------------------------------------------------------------------------------------------------------------------

export const DATA: FnTable = {
  VLOOKUP: rawFn(3, 4, (a) => lookupRaw(a, true)),
  HLOOKUP: rawFn(3, 4, (a) => lookupRaw(a, false)),
  LOOKUP: rawFn(2, 3, (a) => {
    const key = sc(a[0]); const look = mat(a[1]);
    const vec = rowsOf(look) > colsOf(look) || colsOf(look) === 1 ? colOf(look, 0) : look[0];
    let i = -1;
    for (let k = 0; k < vec.length; k++) { const v = vec[k]; if (v === null || typeof v !== typeof key) continue; if (compare(v, key) <= 0) i = k; else break; }
    if (i < 0) throw NA;
    if (a[2] === undefined) { if (colsOf(look) > rowsOf(look)) return look[look.length - 1][i]; return look[i][look[0].length - 1]; }
    const res = mat(a[2]); const flat = res.flat();
    return flat[i] ?? NA;
  }),
  MATCH: rawFn(2, 3, (a) => {
    const key = sc(a[0]); const list = mat(a[1]).flat(); const t = a[2] === undefined ? 1 : Math.trunc(n(sc(a[2])));
    return orNA(findPos(list, key, t === 0 ? 0 : t > 0 ? 1 : -1, true)) + 1;
  }),
  XMATCH: rawFn(2, 4, (a) => { const list = mat(a[1]).flat(); return orNA(xmatchIndex(sc(a[0]), list, a[2] === undefined ? 0 : n(sc(a[2])), a[3] === undefined ? 1 : n(sc(a[3])))) + 1; }),
  XLOOKUP: {
    min: 3, max: 6, lazy: true,
    f: (t: (() => V)[]) => {
      const key = sc(t[0]()); const look = t[1](); const ret = t[2]();
      const lm = mat(look); const rm = mat(ret);
      const vertical = rowsOf(lm) >= colsOf(lm) && colsOf(lm) === 1 || rowsOf(lm) > 1;
      const list = vertical && colsOf(lm) === 1 ? colOf(lm, 0) : rowsOf(lm) === 1 ? lm[0] : colOf(lm, 0);
      const mm = t[4] ? n(sc(t[4]())) : 0; const sm = t[5] ? n(sc(t[5]())) : 1;
      const i = xmatchIndex(key, list, mm, sm);
      if (i < 0) { if (t[3]) { const nf = t[3](); if (!(nf === null)) return nf; } throw NA; }
      return rowsOf(lm) === 1 && colsOf(lm) > 1 ? rm.map((row) => [row[i]]) : [rm[i]];
    },
  },
  INDEX: rawFn(2, 4, (a) => {
    const base = a[0];
    const m = mat(base); const rows = rowsOf(m); const cols = colsOf(m);
    let r = a[1] === undefined ? 0 : Math.trunc(n(sc(a[1]))); let c = a[2] === undefined ? 0 : Math.trunc(n(sc(a[2])));
    if (rows === 1 && a[2] === undefined) { c = r; r = a[1] === undefined ? 0 : 1; if (a[1] !== undefined) { r = 1; } }
    if (r < 0 || c < 0 || r > rows || c > cols) throw REF;
    if (isRng(base)) {
      const r0 = r === 0 ? base.r0 : base.r0 + r - 1; const r1 = r === 0 ? base.r1 : r0; const c0 = c === 0 ? base.c0 : base.c0 + c - 1; const c1 = c === 0 ? base.c1 : c0;
      return new Rng(base.sheet, c0, r0, c1, r1);
    }
    if (r === 0 && c === 0) return m;
    if (r === 0) return m.map((row) => [row[c - 1]]);
    if (c === 0) return [m[r - 1]];
    return m[r - 1][c - 1];
  }),
  OFFSET: rawFn(3, 5, (a) => {
    const base = a[0];
    if (!isRng(base)) throw VALUE;
    const dr = Math.trunc(n(sc(a[1]))); const dc = Math.trunc(n(sc(a[2])));
    const h = a[3] === undefined ? base.rows : Math.trunc(n(sc(a[3]))); const w = a[4] === undefined ? base.cols : Math.trunc(n(sc(a[4])));
    if (h < 1 || w < 1) throw REF;
    const r0 = base.r0 + dr; const c0 = base.c0 + dc;
    if (r0 < 0 || c0 < 0 || r0 + h > base.sheet.rows || c0 + w > base.sheet.cols) throw REF;
    return new Rng(base.sheet, c0, r0, c0 + w - 1, r0 + h - 1);
  }),
  INDIRECT: rawFn(1, 2, (a, x) => x.evalText(toStr(sc(a[0])).replace(/^\s*(=)?/, ''))),
  ROW: rawFn(0, 1, (a, x) => (a[0] === undefined ? x.row + 1 : isRng(a[0]) ? (a[0].rows === 1 ? a[0].r0 + 1 : Array.from({ length: a[0].rows }, (_, i) => [a[0].r0 + i + 1])) : (() => { throw VALUE; })())),
  COLUMN: rawFn(0, 1, (a, x) => (a[0] === undefined ? x.col + 1 : isRng(a[0]) ? (a[0].cols === 1 ? a[0].c0 + 1 : [Array.from({ length: a[0].cols }, (_, i) => a[0].c0 + i + 1)]) : (() => { throw VALUE; })())),
  ROWS: rawFn(1, 1, (a) => dims(a[0])[0]),
  COLUMNS: rawFn(1, 1, (a) => dims(a[0])[1]),
  AREAS: rawFn(1, 1, () => 1),
  ADDRESS: S(2, 5, (r, c, abs, a1, sheet) => {
    const row = Math.trunc(n(r)); const col = Math.trunc(n(c)); const k = abs === undefined ? 1 : Math.trunc(n(abs));
    if (row < 1 || col < 1) throw VALUE;
    const style1 = a1 === undefined || toBool(a1);
    const cn = colNameOf(col - 1);
    const ref = style1 ? `${k === 1 || k === 3 ? '$' : ''}${cn}${k === 1 || k === 2 ? '$' : ''}${row}` : `R${k === 1 || k === 2 ? row : `[${row}]`}C${k === 1 || k === 3 ? col : `[${col}]`}`;
    return sheet === undefined ? ref : `${/^[A-Za-z_]\w*$/.test(toStr(sheet)) ? toStr(sheet) : `'${toStr(sheet).replace(/'/g, "''")}'`}!${ref}`;
  }),
  CHOOSEROWS: rawFn(2, 255, (a) => { const m = mat(a[0]); return a.slice(1).flatMap((v) => flatten([v]).map((k) => { let i = Math.trunc(n(k)); if (i < 0) i += m.length + 1; if (i < 1 || i > m.length) throw VALUE; return m[i - 1]; })); }),
  CHOOSECOLS: rawFn(2, 255, (a) => { const m = mat(a[0]); const idx = a.slice(1).flatMap((v) => flatten([v]).map((k) => { let i = Math.trunc(n(k)); if (i < 0) i += colsOf(m) + 1; if (i < 1 || i > colsOf(m)) throw VALUE; return i - 1; })); return m.map((row) => idx.map((i) => row[i])); }),
  TRANSPOSE: rawFn(1, 1, (a) => transpose(mat(a[0]))),
  SORT: rawFn(1, 4, (a) => {
    const m = mat(a[0]); const byCol = a[3] !== undefined && toBool(sc(a[3]));
    const idx = Math.trunc(a[1] === undefined ? 1 : n(sc(a[1]))); const asc = a[2] === undefined ? true : n(sc(a[2])) !== -1;
    const src = byCol ? transpose(m) : m;
    if (idx < 1 || idx > colsOf(src)) throw VALUE;
    const out = sortRows(src, [{ col: idx - 1, asc }]);
    return byCol ? transpose(out) : out;
  }),
  SORTBY: rawFn(2, 255, (a) => {
    const m = mat(a[0]); const keys: { v: Scalar[]; asc: boolean }[] = [];
    for (let i = 1; i < a.length; i += 2) { const k = mat(a[i]).flat(); if (k.length !== m.length) throw VALUE; keys.push({ v: k, asc: a[i + 1] === undefined ? true : n(sc(a[i + 1])) !== -1 }); }
    return m.map((row, i) => ({ row, i })).sort((x, y) => { for (const k of keys) { const c = sortKey(null, k.asc)(k.v[x.i], k.v[y.i]); if (c) return c; } return x.i - y.i; }).map((e) => e.row);
  }),
  FILTER: lazyFn(2, 3, (t) => {
    const m = mat(t[0]()); const inc = mat(t[1]());
    const byRow = inc.length === m.length && colsOf(inc) === 1; const byCol = rowsOf(inc) === 1 && colsOf(inc) === colsOf(m);
    if (!byRow && !byCol) throw VALUE;
    const keep = inc.flat().map((x) => { if (x instanceof FormulaError) throw x; return toBool(x as Scalar); });
    const out = byRow ? m.filter((_, i) => keep[i]) : m.map((row) => row.filter((_, i) => keep[i]));
    if (!out.length || !out[0].length) { if (t[2]) return t[2](); throw new FormulaError('#CALC!'); }
    return out;
  }),
  UNIQUE: rawFn(1, 3, (a) => {
    const m = mat(a[0]); const byCol = a[1] !== undefined && toBool(sc(a[1])); const once = a[2] !== undefined && toBool(sc(a[2]));
    const items = byCol ? transpose(m) : m;
    const keyOf = (row: Scalar[]) => row.map((x) => (typeof x === 'string' ? `s${x.toLowerCase()}` : `${typeof x}${String(x)}`)).join('\u0001');
    spend(items.length * 4);
    const counts = new Map<string, number>(); for (const row of items) counts.set(keyOf(row), (counts.get(keyOf(row)) ?? 0) + 1);
    const seen = new Set<string>(); const out: Arr = [];
    for (const row of items) { const k = keyOf(row); if (seen.has(k)) continue; seen.add(k); if (once && counts.get(k)! > 1) continue; out.push(row); }
    if (!out.length) throw new FormulaError('#CALC!');
    return byCol ? transpose(out) : out;
  }),
  SEQUENCE: rawFn(1, 4, (a) => {
    const r = Math.trunc(n(sc(a[0]))); const c = a[1] === undefined ? 1 : Math.trunc(n(sc(a[1]))); const s = a[2] === undefined ? 1 : n(sc(a[2])); const st = a[3] === undefined ? 1 : n(sc(a[3]));
    if (r < 1 || c < 1 || r * c > 1e6) throw new FormulaError('#CALC!');
    spend(r * c * 4);
    return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => s + (i * c + j) * st));
  }),
  RANDARRAY: rawFn(0, 5, (a, x) => {
    const r = a[0] === undefined ? 1 : Math.trunc(n(sc(a[0]))); const c = a[1] === undefined ? 1 : Math.trunc(n(sc(a[1])));
    const lo = a[2] === undefined ? 0 : n(sc(a[2])); const hi = a[3] === undefined ? 1 : n(sc(a[3])); const whole = a[4] !== undefined && toBool(sc(a[4]));
    if (r < 1 || c < 1 || r * c > 1e6) throw VALUE;
    spend(r * c * 4);
    return Array.from({ length: r }, () => Array.from({ length: c }, () => (whole ? Math.ceil(lo) + Math.floor(x.rand() * (Math.floor(hi) - Math.ceil(lo) + 1)) : lo + x.rand() * (hi - lo))));
  }),
  TOCOL: rawFn(1, 3, (a) => toOneCol(mat(a[0]), a[1] === undefined ? 0 : n(sc(a[1])), a[2] !== undefined && toBool(sc(a[2])))),
  TOROW: rawFn(1, 3, (a) => transpose(toOneCol(mat(a[0]), a[1] === undefined ? 0 : n(sc(a[1])), a[2] !== undefined && toBool(sc(a[2]))))),
  VSTACK: rawFn(1, 255, (a) => { const ms = a.map((v) => mat(v)); const w = Math.max(...ms.map(colsOf)); return ms.flatMap((m) => m.map((row) => [...row, ...new Array(w - row.length).fill(NA)])); }),
  HSTACK: rawFn(1, 255, (a) => { const ms = a.map((v) => mat(v)); const h = Math.max(...ms.map(rowsOf)); return Array.from({ length: h }, (_, r) => ms.flatMap((m) => (m[r] ?? new Array(colsOf(m)).fill(NA)))); }),
  TAKE: rawFn(2, 3, (a) => {
    const m = mat(a[0]); const r = Math.trunc(n(sc(a[1]))); const c = a[2] === undefined ? undefined : Math.trunc(n(sc(a[2])));
    const rr = r >= 0 ? m.slice(0, r) : m.slice(r); const out = c === undefined ? rr : rr.map((row) => (c >= 0 ? row.slice(0, c) : row.slice(c)));
    if (!out.length || !out[0].length) throw new FormulaError('#CALC!');
    return out;
  }),
  DROP: rawFn(2, 3, (a) => {
    const m = mat(a[0]); const r = Math.trunc(n(sc(a[1]))); const c = a[2] === undefined ? 0 : Math.trunc(n(sc(a[2])));
    const rr = r >= 0 ? m.slice(r) : m.slice(0, r); const out = rr.map((row) => (c >= 0 ? row.slice(c) : row.slice(0, c)));
    if (!out.length || !out[0].length) throw new FormulaError('#CALC!');
    return out;
  }),
  EXPAND: rawFn(2, 4, (a) => {
    const m = mat(a[0]); const r = Math.trunc(n(sc(a[1]))); const c = a[2] === undefined ? colsOf(m) : Math.trunc(n(sc(a[2]))); const pad = a[3] === undefined ? NA : sc(a[3]);
    if (r < rowsOf(m) || c < colsOf(m)) throw VALUE;
    if (r * c > 1e6) throw VALUE;
    spend(r * c * 4);
    return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => (m[i]?.[j] === undefined ? pad : m[i][j])));
  }),
  WRAPROWS: rawFn(2, 3, (a) => wrap(a, true)),
  WRAPCOLS: rawFn(2, 3, (a) => wrap(a, false)),

  // finance
  PMT: S(3, 5, (r, np, pv, f, t) => pmt(n(r), n(np), n(pv), f === undefined ? 0 : n(f), t === undefined ? 0 : n(t))),
  PV: S(3, 5, (r, np, p, f, t) => { const rate = n(r); const per = n(np); const type = t === undefined ? 0 : n(t); const fvv = f === undefined ? 0 : n(f); if (rate === 0) return -(fvv + n(p) * per); const g = (1 + rate) ** per; return -(fvv + n(p) * (1 + rate * type) * ((g - 1) / rate)) / g; }),
  FV: S(3, 5, (r, np, p, pv, t) => fv(n(r), n(np), n(p), pv === undefined ? 0 : n(pv), t === undefined ? 0 : n(t))),
  NPER: S(3, 5, (r, p, pv, f, t) => {
    const rate = n(r); const pay = n(p); const pvv = n(pv); const fvv = f === undefined ? 0 : n(f); const type = t === undefined ? 0 : n(t);
    if (rate === 0) { if (pay === 0) throw NUM; return -(pvv + fvv) / pay; }
    const a = pay * (1 + rate * type) - fvv * rate; const b = pvv * rate + pay * (1 + rate * type);
    if (a / b <= 0) throw NUM;
    return Math.log(a / b) / Math.log(1 + rate);
  }),
  RATE: S(3, 6, (np, p, pv, f, t, g) => {
    const per = n(np); const pay = n(p); const pvv = n(pv); const fvv = f === undefined ? 0 : n(f); const type = t === undefined ? 0 : n(t);
    return solve((x) => (x === 0 ? pvv + pay * per + fvv : pvv * (1 + x) ** per + pay * (1 + x * type) * (((1 + x) ** per - 1) / x) + fvv), g === undefined ? 0.1 : n(g), -0.99, 1e3);
  }),
  IPMT: S(4, 6, (r, per, np, pv, f, t) => { const k = n(per); if (k < 1 || k > n(np)) throw NUM; return ipmt(n(r), k, n(np), n(pv), f === undefined ? 0 : n(f), t === undefined ? 0 : n(t)); }),
  PPMT: S(4, 6, (r, per, np, pv, f, t) => { const k = n(per); if (k < 1 || k > n(np)) throw NUM; const type = t === undefined ? 0 : n(t); const fvv = f === undefined ? 0 : n(f); return pmt(n(r), n(np), n(pv), fvv, type) - ipmt(n(r), k, n(np), n(pv), fvv, type); }),
  CUMIPMT: S(6, 6, (r, np, pv, s, e, t) => { let tot = 0; for (let k = n(s); k <= n(e); k++) tot += ipmt(n(r), k, n(np), n(pv), 0, n(t)); return tot; }),
  CUMPRINC: S(6, 6, (r, np, pv, s, e, t) => { let tot = 0; const pay = pmt(n(r), n(np), n(pv), 0, n(t)); for (let k = n(s); k <= n(e); k++) tot += pay - ipmt(n(r), k, n(np), n(pv), 0, n(t)); return tot; }),
  ISPMT: S(4, 4, (r, per, np, pv) => -n(pv) * n(r) * (1 - n(per) / n(np))),
  NPV: rawFn(2, 255, (a) => npv(n(sc(a[0])), collectNumbers(a.slice(1)))),
  IRR: rawFn(1, 2, (a) => { const v = cashflows(a[0]); if (!hasBoth(v)) throw NUM; return solve((x) => v.reduce((t, c, i) => t + c / (1 + x) ** i, 0), a[1] === undefined ? 0.1 : n(sc(a[1]))); }),
  XNPV: rawFn(3, 3, (a) => { const v = cashflows(a[1]); const d = cashflows(a[2]); if (v.length !== d.length) throw NUM; return xnpv(n(sc(a[0])), v, d); }),
  XIRR: rawFn(2, 3, (a) => { const v = cashflows(a[0]); const d = cashflows(a[1]); if (v.length !== d.length || !hasBoth(v)) throw NUM; return solve((x) => xnpv(x, v, d), a[2] === undefined ? 0.1 : n(sc(a[2]))); }),
  MIRR: rawFn(3, 3, (a) => { const v = cashflows(a[0]); const fr = n(sc(a[1])); const rr = n(sc(a[2])); const k = v.length; if (!hasBoth(v)) throw DIV0; const pos = v.map((x) => (x > 0 ? x : 0)); const neg = v.map((x) => (x < 0 ? x : 0)); return ((-npv(rr, pos) * (1 + rr) ** k) / (npv(fr, neg) * (1 + fr))) ** (1 / (k - 1)) - 1; }),
  FVSCHEDULE: rawFn(2, 2, (a) => collectNumbers([a[1]]).reduce((t, r) => t * (1 + r), n(sc(a[0])))),
  EFFECT: S(2, 2, (r, k) => { const p = Math.trunc(n(k)); if (n(r) <= 0 || p < 1) throw NUM; return (1 + n(r) / p) ** p - 1; }),
  NOMINAL: S(2, 2, (r, k) => { const p = Math.trunc(n(k)); if (n(r) <= 0 || p < 1) throw NUM; return p * ((1 + n(r)) ** (1 / p) - 1); }),
  PDURATION: S(3, 3, (r, pv, f) => { if (n(r) <= 0 || n(pv) <= 0 || n(f) <= 0) throw NUM; return (Math.log(n(f)) - Math.log(n(pv))) / Math.log(1 + n(r)); }),
  RRI: S(3, 3, (np, pv, f) => { if (n(np) <= 0 || n(pv) === 0) throw NUM; return (n(f) / n(pv)) ** (1 / n(np)) - 1; }),
  SLN: S(3, 3, (c, s, l) => { if (n(l) === 0) throw DIV0; return (n(c) - n(s)) / n(l); }),
  SYD: S(4, 4, (c, s, l, p) => { if (n(l) <= 0 || n(p) < 1 || n(p) > n(l)) throw NUM; return ((n(c) - n(s)) * (n(l) - n(p) + 1) * 2) / (n(l) * (n(l) + 1)); }),
  DDB: S(4, 5, (c, s, l, p, f) => { const cost = n(c); const salv = n(s); const life = n(l); const per = n(p); const fac = f === undefined ? 2 : n(f); if (cost < 0 || salv < 0 || life <= 0 || per < 1 || per > life) throw NUM; let book = cost; let dep = 0; for (let i = 1; i <= per; i++) { dep = Math.min((book * fac) / life, Math.max(0, book - salv)); book -= dep; } return dep; }),
  DB: S(4, 5, (c, s, l, p, m) => { if (n(c) <= 0 || n(s) < 0 || n(l) <= 0 || n(p) < 1) throw NUM; return depreciationDB(n(c), n(s), n(l), n(p), m === undefined ? 12 : n(m)); }),
  DOLLARDE: S(2, 2, (d, f) => { const k = Math.trunc(n(f)); if (k < 1) throw NUM; const v = n(d); const ip = Math.trunc(v); return ip + ((v - ip) * 10 ** Math.ceil(Math.log10(k))) / k; }),
  DOLLARFR: S(2, 2, (d, f) => { const k = Math.trunc(n(f)); if (k < 1) throw NUM; const v = n(d); const ip = Math.trunc(v); return ip + ((v - ip) * k) / 10 ** Math.ceil(Math.log10(k)); }),

  // databases
  DSUM: dfn((_v, nums) => nums.reduce((a, b) => a + b, 0)),
  DAVERAGE: dfn((_v, nums) => { if (!nums.length) throw DIV0; return nums.reduce((a, b) => a + b, 0) / nums.length; }),
  DCOUNT: dfn((_v, nums) => nums.length),
  DCOUNTA: dfn((v) => v.filter((x) => x !== null && x !== '').length),
  DMAX: dfn((_v, nums) => (nums.length ? Math.max(...nums) : 0)),
  DMIN: dfn((_v, nums) => (nums.length ? Math.min(...nums) : 0)),
  DPRODUCT: dfn((_v, nums) => nums.reduce((a, b) => a * b, 1)),
  DGET: dfn((v) => { if (v.length === 0) throw NA; if (v.length > 1) throw NUM; return v[0]; }),

  // subtotals
  SUBTOTAL: rawFn(2, 255, (a, x) => {
    const code = Math.trunc(n(sc(a[0]))) % 100; const nums = collectNumbers(a.slice(1));
    const v = nums; const mean = v.length ? v.reduce((p, q) => p + q, 0) / v.length : 0;
    switch (code) {
      case 1: if (!v.length) throw DIV0; return mean;
      case 2: return v.length;
      case 3: return flatten(a.slice(1)).filter((q) => q !== null && q !== '').length;
      case 4: return v.length ? Math.max(...v) : 0;
      case 5: return v.length ? Math.min(...v) : 0;
      case 6: return v.reduce((p, q) => p * q, 1);
      case 7: { if (v.length < 2) throw DIV0; return Math.sqrt(v.reduce((p, q) => p + (q - mean) ** 2, 0) / (v.length - 1)); }
      case 8: { if (!v.length) throw DIV0; return Math.sqrt(v.reduce((p, q) => p + (q - mean) ** 2, 0) / v.length); }
      case 9: return v.reduce((p, q) => p + q, 0);
      case 10: { if (v.length < 2) throw DIV0; return v.reduce((p, q) => p + (q - mean) ** 2, 0) / (v.length - 1); }
      case 11: { if (!v.length) throw DIV0; return v.reduce((p, q) => p + (q - mean) ** 2, 0) / v.length; }
      default: void x; throw VALUE;
    }
  }),
  AGGREGATE: rawFn(3, 255, (a) => {
    const code = Math.trunc(n(sc(a[0]))); const opt = Math.trunc(n(sc(a[1])));
    const ignoreErr = [2, 3, 6, 7].includes(opt);
    const pick = (v: V | undefined): V | undefined => (!ignoreErr || v === undefined ? v : (isRng(v) || isArr(v) ? mat(v).map((row) => row.map((x) => (isErr(x) ? null : x))) : v));
    const vals = a.slice(2).map(pick) as V[];
    const nums = collectNumbers(vals);
    const sorted = [...nums].sort((p, q) => p - q);
    const mean = nums.length ? nums.reduce((p, q) => p + q, 0) / nums.length : 0;
    const k = vals[1] === undefined ? 0 : Math.trunc(n(sc(vals[1])));
    switch (code) {
      case 1: if (!nums.length) throw DIV0; return mean;
      case 2: return nums.length;
      case 3: return flatten(vals).filter((q) => q !== null && q !== '').length;
      case 4: return nums.length ? Math.max(...nums) : 0;
      case 5: return nums.length ? Math.min(...nums) : 0;
      case 6: return nums.reduce((p, q) => p * q, 1);
      case 7: { if (nums.length < 2) throw DIV0; return Math.sqrt(nums.reduce((p, q) => p + (q - mean) ** 2, 0) / (nums.length - 1)); }
      case 8: { if (!nums.length) throw DIV0; return Math.sqrt(nums.reduce((p, q) => p + (q - mean) ** 2, 0) / nums.length); }
      case 9: return nums.reduce((p, q) => p + q, 0);
      case 10: { if (nums.length < 2) throw DIV0; return nums.reduce((p, q) => p + (q - mean) ** 2, 0) / (nums.length - 1); }
      case 11: { if (!nums.length) throw DIV0; return nums.reduce((p, q) => p + (q - mean) ** 2, 0) / nums.length; }
      case 12: { const m = sorted.length >> 1; if (!sorted.length) throw NUM; return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2; }
      case 14: { const nn = collectNumbers([vals[0]]).sort((p, q) => q - p); if (k < 1 || k > nn.length) throw NUM; return nn[k - 1]; }
      case 15: { const nn = collectNumbers([vals[0]]).sort((p, q) => p - q); if (k < 1 || k > nn.length) throw NUM; return nn[k - 1]; }
      default: throw VALUE;
    }
  }),
};

export { roundTo, same, makeDate, serialToDate, isMulti, tryV, parseNumberText, Rng };
