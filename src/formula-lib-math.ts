/** Formula functions: arithmetic, rounding, trigonometry, counting and statistics, distributions, base conversion. */
import {
  Arr, DIV0, FormulaError, FnTable, NA, NUM, Scalar, V, VALUE, collectNumbers, compare, criterion, flatten, isArr, isRng, mat, rawFn, scalarFn, sc, toBool, toNum, toStr, dims,
} from './formula-core';

type N = (x: Scalar | undefined) => number;
const n: N = toNum;
const fin = (v: number): number => { if (!Number.isFinite(v)) throw NUM; return v; };
const S = scalarFn;

// ---- helpers --------------------------------------------------------------------------------------------------------------------

/** ROUND the way Excel does: half away from zero, and 2.675 with 2 digits is 2.68. */
export function roundTo(x: number, d: number, mode: 'near' | 'up' | 'down' = 'near'): number {
  const f = 10 ** Math.abs(d);
  const y = Math.abs(x) * (d >= 0 ? f : 1 / f);
  const t = Number(y.toPrecision(15));
  const r = mode === 'near' ? Math.round(t) : mode === 'up' ? Math.ceil(t) : Math.floor(t);
  return Math.sign(x) * (d >= 0 ? r / f : r * f);
}

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => { if (!a.length) throw DIV0; return sum(a) / a.length; };
const sumSq = (a: number[], m: number) => a.reduce((s, x) => s + (x - m) ** 2, 0);
const varS = (a: number[]) => { if (a.length < 2) throw DIV0; return sumSq(a, mean(a)) / (a.length - 1); };
const varP = (a: number[]) => sumSq(a, mean(a)) / a.length;
const sorted = (a: number[]) => [...a].sort((x, y) => x - y);

/** The numbers of the arguments; with `a` the way STDEVA/AVERAGEA count: text 0, TRUE 1. */
function numsA(args: V[]): number[] {
  const out: number[] = [];
  for (const a of args) {
    if (isRng(a) || isArr(a)) { for (const row of mat(a)) for (const v of row) { if (v instanceof FormulaError) throw v; if (typeof v === 'number') out.push(v); else if (typeof v === 'boolean') out.push(v ? 1 : 0); else if (typeof v === 'string') out.push(0); } }
    else out.push(toNum(sc(a)));
  }
  return out;
}

const factorial = (k: number): number => { k = Math.floor(k); if (k < 0 || k > 170) throw NUM; let r = 1; for (let i = 2; i <= k; i++) r *= i; return r; };
const gcd2 = (a: number, b: number): number => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };

function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  x -= 1;
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}
const gammaFn = (x: number): number => {
  if (Number.isInteger(x) && x <= 0) throw NUM;
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  return Math.exp(lnGamma(x));
};

/** Regularized lower incomplete gamma P(a, x). */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  if (x < a + 1) {
    let ap = a; let del = 1 / a; let s = del;
    for (let i = 0; i < 300; i++) { ap++; del *= x / ap; s += del; if (Math.abs(del) < Math.abs(s) * 1e-16) break; }
    return s * Math.exp(-x + a * Math.log(x) - lnGamma(a));
  }
  let b = x + 1 - a; let c = 1 / 1e-300; let d = 1 / b; let h = d;
  for (let i = 1; i < 300; i++) {
    const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300; c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
    const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break;
  }
  return 1 - Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}
/** Regularized incomplete beta I_x(a, b). */
function betaI(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (xx: number, aa: number, bb: number): number => {
    let c = 1; let d = 1 - ((aa + bb) * xx) / (aa + 1); if (Math.abs(d) < 1e-300) d = 1e-300; d = 1 / d; let h = d;
    for (let m = 1; m <= 300; m++) {
      const m2 = 2 * m;
      let an = (m * (bb - m) * xx) / ((aa + m2 - 1) * (aa + m2));
      d = 1 + an * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d; h *= d * c;
      an = (-(aa + m) * (aa + bb + m) * xx) / ((aa + m2) * (aa + m2 + 1));
      d = 1 + an * d; if (Math.abs(d) < 1e-300) d = 1e-300; c = 1 + an / c; if (Math.abs(c) < 1e-300) c = 1e-300; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < 1e-16) break;
    }
    return h;
  };
  return x < (a + 1) / (a + b + 2) ? (bt * cf(x, a, b)) / a : 1 - (bt * cf(1 - x, b, a)) / b;
}
function erf(x: number): number {
  if (x < 0) return -erf(-x);
  return gammaP(0.5, x * x);
}
const normCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
const normPdf = (z: number) => Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
function normInv(p: number): number {
  if (p <= 0 || p >= 1) throw NUM;
  // Acklam's approximation, then two Halley steps
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.383577518672690e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  let x: number;
  if (p < 0.02425) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p > 1 - 0.02425) { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else { const q = p - 0.5; const r = q * q; x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
  for (let i = 0; i < 2; i++) { const e = normCdf(x) - p; const u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2); x -= u / (1 + x * u / 2); }
  return x;
}
/** Invert a continuous, increasing CDF by bisection. */
function invert(cdf: (x: number) => number, p: number, lo: number, hi: number): number {
  if (p <= 0 || p >= 1) throw NUM;
  while (cdf(hi) < p && hi < 1e300) hi = hi > 0 ? hi * 2 : 1;
  while (cdf(lo) > p && lo > -1e300) lo = lo < 0 ? lo * 2 : -1;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (cdf(mid) < p) lo = mid; else hi = mid; if (hi - lo <= 1e-15 * Math.max(1, Math.abs(mid))) break; }
  return (lo + hi) / 2;
}
const tCdf = (x: number, df: number) => { const b = betaI(df / (df + x * x), df / 2, 0.5); return x > 0 ? 1 - b / 2 : b / 2; };
const tPdf = (x: number, df: number) => Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2)) / Math.sqrt(df * Math.PI) * (1 + x * x / df) ** (-(df + 1) / 2);
const chiCdf = (x: number, df: number) => gammaP(df / 2, x / 2);
const chiPdf = (x: number, df: number) => (x < 0 ? 0 : Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.log(2) - lnGamma(df / 2)));
const fCdf = (x: number, d1: number, d2: number) => (x <= 0 ? 0 : betaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2));
const fPdf = (x: number, d1: number, d2: number) => (x < 0 ? 0 : Math.exp(0.5 * (d1 * Math.log(d1 * x) + d2 * Math.log(d2) - (d1 + d2) * Math.log(d1 * x + d2)) - Math.log(x) - (lnGamma(d1 / 2) + lnGamma(d2 / 2) - lnGamma((d1 + d2) / 2))));
const gamCdf = (x: number, a: number, b: number) => gammaP(a, x / b);
const gamPdf = (x: number, a: number, b: number) => (x < 0 ? 0 : Math.exp((a - 1) * Math.log(x) - x / b - a * Math.log(b) - lnGamma(a)));
const betaPdf = (x: number, a: number, b: number) => (x < 0 || x > 1 ? 0 : Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x)));
const lnComb = (a: number, b: number) => lnGamma(a + 1) - lnGamma(b + 1) - lnGamma(a - b + 1);
const binomPmf = (k: number, t: number, p: number) => (p === 0 ? (k === 0 ? 1 : 0) : p === 1 ? (k === t ? 1 : 0) : Math.exp(lnComb(t, k) + k * Math.log(p) + (t - k) * Math.log(1 - p)));
const poisPmf = (k: number, m: number) => Math.exp(-m + k * Math.log(m) - lnGamma(k + 1));

// ---- criteria functions ---------------------------------------------------------------------------------------------------------

/** The cells of a criteria range that meet every pair of (range, condition). */
function matching(pairs: V[], first = 0): boolean[][] {
  const [rows, cols] = dims(pairs[first]);
  const hit: boolean[][] = Array.from({ length: rows }, () => new Array(cols).fill(true));
  for (let i = first; i < pairs.length; i += 2) {
    const m = mat(pairs[i]);
    if (m.length !== rows || m[0].length !== cols) throw VALUE;
    const ok = criterion(sc(pairs[i + 1]));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (hit[r][c] && !ok(m[r][c] instanceof FormulaError ? (m[r][c] as FormulaError).message : m[r][c])) hit[r][c] = false;
  }
  return hit;
}
function pickNumbers(values: V, hit: boolean[][]): number[] {
  const m = mat(values);
  if (m.length !== hit.length || m[0].length !== hit[0].length) throw VALUE;
  const out: number[] = [];
  for (let r = 0; r < hit.length; r++) for (let c = 0; c < hit[0].length; c++) if (hit[r][c]) { const v = m[r][c]; if (v instanceof FormulaError) throw v; if (typeof v === 'number') out.push(v); }
  return out;
}

// ---- statistics over data -------------------------------------------------------------------------------------------------------

function percentile(a: number[], k: number, exclusive: boolean): number {
  const s = sorted(a); const len = s.length;
  if (!len) throw NUM;
  if (exclusive) { if (k <= 0 || k >= 1) throw NUM; const pos = k * (len + 1); if (pos < 1 || pos > len) throw NUM; const lo = Math.floor(pos); return s[lo - 1] + (pos - lo) * ((s[lo] ?? s[lo - 1]) - s[lo - 1]); }
  if (k < 0 || k > 1) throw NUM;
  const pos = k * (len - 1); const lo = Math.floor(pos);
  return s[lo] + (pos - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
}
function pairs(a: V, b: V): [number[], number[]] {
  const x = mat(a).flat(); const y = mat(b).flat();
  if (x.length !== y.length) throw NA;
  const xs: number[] = []; const ys: number[] = [];
  for (let i = 0; i < x.length; i++) { if (x[i] instanceof FormulaError) throw x[i]; if (y[i] instanceof FormulaError) throw y[i]; if (typeof x[i] === 'number' && typeof y[i] === 'number') { xs.push(x[i] as number); ys.push(y[i] as number); } }
  if (!xs.length) throw DIV0;
  return [xs, ys];
}
function regression(ys: V, xs: V) { // y on x
  const [x, y] = pairs(xs, ys);
  const mx = mean(x); const my = mean(y);
  let sxy = 0; let sxx = 0; let syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  if (sxx === 0) throw DIV0;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, sxy, sxx, syy, n: x.length, mx, my };
}

// ---- base conversion ------------------------------------------------------------------------------------------------------------

function fromBase(s: Scalar | undefined, base: number): number {
  const t = toStr(s).trim();
  if (t.length > 10) throw NUM;
  const digits = '0123456789ABCDEF'.slice(0, base);
  if (t === '' ) return 0;
  const up = t.toUpperCase();
  for (const ch of up) if (!digits.includes(ch)) throw NUM;
  let v = parseInt(up, base);
  const bits = base === 2 ? 10 : base === 8 ? 30 : 40;
  if (up.length === 10 && v >= 2 ** (bits - 1)) v -= 2 ** bits;
  return v;
}
function toBase(v: number, base: number, places: Scalar | undefined, lo: number, hi: number): string {
  v = Math.trunc(v);
  if (v < lo || v > hi) throw NUM;
  const bits = base === 2 ? 10 : base === 8 ? 30 : 40;
  let s = (v < 0 ? v + 2 ** bits : v).toString(base).toUpperCase();
  if (v < 0) return s.padStart(10, base === 16 ? 'F' : base === 8 ? '7' : '1');
  if (places !== undefined && places !== null) { const p = toNum(places); if (p < s.length || p > 10 || p < 1) throw NUM; s = s.padStart(Math.trunc(p), '0'); }
  return s;
}
const convertTable: Record<string, [string, number]> = {
  m: ['len', 1], km: ['len', 1000], cm: ['len', 0.01], mm: ['len', 0.001], mi: ['len', 1609.344], yd: ['len', 0.9144], ft: ['len', 0.3048], in: ['len', 0.0254], nmi: ['len', 1852],
  g: ['mass', 1], kg: ['mass', 1000], mg: ['mass', 0.001], lbm: ['mass', 453.59237], oz: ['mass', 28.349523125], ton: ['mass', 907184.74],
  sec: ['time', 1], s: ['time', 1], min: ['time', 60], hr: ['time', 3600], day: ['time', 86400], yr: ['time', 31557600],
  l: ['vol', 1], ml: ['vol', 0.001], gal: ['vol', 3.785411784], qt: ['vol', 0.946352946], pt: ['vol', 0.473176473], cup: ['vol', 0.2365882365], tsp: ['vol', 0.00492892159375], tbs: ['vol', 0.01478676478125],
  j: ['en', 1], kj: ['en', 1000], cal: ['en', 4.184], kcal: ['en', 4184], wh: ['en', 3600], kwh: ['en', 3600000], btu: ['en', 1055.05585262],
  pa: ['prs', 1], kpa: ['prs', 1000], bar: ['prs', 100000], atm: ['prs', 101325], mmhg: ['prs', 133.322387415], psi: ['prs', 6894.757293168],
  w: ['pow', 1], kw: ['pow', 1000], hp: ['pow', 745.69987158227],
  n: ['frc', 1], lbf: ['frc', 4.4482216152605], dyn: ['frc', 1e-5],
  'm/s': ['spd', 1], 'km/h': ['spd', 1 / 3.6], mph: ['spd', 0.44704], kn: ['spd', 1852 / 3600],
  c: ['tmp', 0], f: ['tmp', 0], k: ['tmp', 0],
};
function convert(v: number, from: string, to: string): number {
  const a = convertTable[from] ?? convertTable[from.toLowerCase()];
  const b = convertTable[to] ?? convertTable[to.toLowerCase()];
  if (!a || !b || a[0] !== b[0]) throw NA;
  if (a[0] === 'tmp') {
    const f = from.toLowerCase(); const t = to.toLowerCase();
    const k = f === 'c' ? v + 273.15 : f === 'f' ? (v - 32) / 1.8 + 273.15 : v;
    return t === 'c' ? k - 273.15 : t === 'f' ? (k - 273.15) * 1.8 + 32 : k;
  }
  return (v * a[1]) / b[1];
}

// ---- roman numerals -------------------------------------------------------------------------------------------------------------

const ROMAN: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const toRoman = (v: number): string => { if (v < 0 || v > 3999) throw VALUE; let s = ''; for (const [k, r] of ROMAN) while (v >= k) { s += r; v -= k; } return s; };
const fromRoman = (t: string): number => {
  const s = t.trim().toUpperCase(); if (s === '') return 0;
  const val: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) { const a = val[s[i]]; const b = val[s[i + 1]]; if (!a) throw VALUE; total += b && b > a ? -a : a; }
  return total;
};

// ---- matrices ---------------------------------------------------------------------------------------------------------------------

const numMatrix = (v: V): number[][] => mat(v).map((row) => row.map((x) => { if (x instanceof FormulaError) throw x; if (typeof x !== 'number') throw VALUE; return x; }));
function det(m: number[][]): number {
  const a = m.map((r) => [...r]); const sz = a.length; let d = 1;
  for (let i = 0; i < sz; i++) {
    let p = i; for (let r = i + 1; r < sz; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (Math.abs(a[p][i]) < 1e-300) return 0;
    if (p !== i) { [a[p], a[i]] = [a[i], a[p]]; d = -d; }
    d *= a[i][i];
    for (let r = i + 1; r < sz; r++) { const f = a[r][i] / a[i][i]; for (let c = i; c < sz; c++) a[r][c] -= f * a[i][c]; }
  }
  return d;
}
function inverse(m: number[][]): number[][] {
  const sz = m.length; const a = m.map((r, i) => [...r, ...Array.from({ length: sz }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < sz; i++) {
    let p = i; for (let r = i + 1; r < sz; r++) if (Math.abs(a[r][i]) > Math.abs(a[p][i])) p = r;
    if (Math.abs(a[p][i]) < 1e-12) throw NUM;
    [a[p], a[i]] = [a[i], a[p]];
    const pv = a[i][i]; for (let c = 0; c < 2 * sz; c++) a[i][c] /= pv;
    for (let r = 0; r < sz; r++) if (r !== i) { const f = a[r][i]; if (f) for (let c = 0; c < 2 * sz; c++) a[r][c] -= f * a[i][c]; }
  }
  return a.map((r) => r.slice(sz));
}

// ---- the table ----------------------------------------------------------------------------------------------------------------------

const trig = (f: (x: number) => number): ReturnType<typeof S> => S(1, 1, (x) => fin(f(n(x))));
const dist2 = (cdf: (x: number, a: number, b: number) => number, pdf: (x: number, a: number, b: number) => number) => S(4, 4, (x, a, b, cum) => fin(toBool(cum) ? cdf(n(x), n(a), n(b)) : pdf(n(x), n(a), n(b))));

export const MATH: FnTable = {
  // arithmetic and rounding
  SUM: rawFn(1, 255, (a) => sum(collectNumbers(a))),
  PRODUCT: rawFn(1, 255, (a) => collectNumbers(a).reduce((x, y) => x * y, 1)),
  SUMSQ: rawFn(1, 255, (a) => collectNumbers(a).reduce((s, x) => s + x * x, 0)),
  ABS: S(1, 1, (x) => Math.abs(n(x))),
  SIGN: S(1, 1, (x) => Math.sign(n(x))),
  SQRT: S(1, 1, (x) => { const v = n(x); if (v < 0) throw NUM; return Math.sqrt(v); }),
  SQRTPI: S(1, 1, (x) => { const v = n(x); if (v < 0) throw NUM; return Math.sqrt(v * Math.PI); }),
  EXP: S(1, 1, (x) => fin(Math.exp(n(x)))),
  LN: S(1, 1, (x) => { const v = n(x); if (v <= 0) throw NUM; return Math.log(v); }),
  LOG10: S(1, 1, (x) => { const v = n(x); if (v <= 0) throw NUM; return Math.log10(v); }),
  LOG: S(1, 2, (x, b) => { const v = n(x); const base = b === undefined ? 10 : n(b); if (v <= 0 || base <= 0 || base === 1) throw NUM; return Math.log(v) / Math.log(base); }),
  POWER: S(2, 2, (x, y) => { const a = n(x); const b = n(y); if (a === 0 && b === 0) throw NUM; if (a === 0 && b < 0) throw DIV0; return fin(a ** b); }),
  MOD: S(2, 2, (x, y) => { const d = n(y); if (d === 0) throw DIV0; const v = n(x); return v - d * Math.floor(v / d); }),
  INT: S(1, 1, (x) => Math.floor(n(x))),
  TRUNC: S(1, 2, (x, d) => roundTo(n(x), d === undefined ? 0 : Math.trunc(n(d)), 'down')),
  ROUND: S(2, 2, (x, d) => roundTo(n(x), Math.trunc(n(d)))),
  ROUNDUP: S(2, 2, (x, d) => roundTo(n(x), Math.trunc(n(d)), 'up')),
  ROUNDDOWN: S(2, 2, (x, d) => roundTo(n(x), Math.trunc(n(d)), 'down')),
  MROUND: S(2, 2, (x, m) => { const v = n(x); const k = n(m); if (k === 0) return 0; if (v * k < 0) throw NUM; return roundTo(v / k, 0) * k; }),
  CEILING: S(1, 2, (x, s) => { const v = n(x); const k = s === undefined ? (v < 0 ? -1 : 1) : n(s); if (k === 0) return 0; if (v > 0 && k < 0) throw NUM; return Math.ceil(Number((v / k).toPrecision(15))) * k; }),
  'CEILING.MATH': S(1, 3, (x, s, mode) => { const v = n(x); const k = Math.abs(s === undefined ? 1 : n(s)); if (k === 0) return 0; return v < 0 && mode !== undefined && n(mode) !== 0 ? -Math.ceil(Number((-v / k).toPrecision(15))) * k : Math.ceil(Number((v / k).toPrecision(15))) * k; }),
  'CEILING.PRECISE': S(1, 2, (x, s) => { const k = Math.abs(s === undefined ? 1 : n(s)); return k === 0 ? 0 : Math.ceil(Number((n(x) / k).toPrecision(15))) * k; }),
  'ISO.CEILING': S(1, 2, (x, s) => { const k = Math.abs(s === undefined ? 1 : n(s)); return k === 0 ? 0 : Math.ceil(Number((n(x) / k).toPrecision(15))) * k; }),
  FLOOR: S(2, 2, (x, s) => { const v = n(x); const k = n(s); if (k === 0) { if (v === 0) return 0; throw DIV0; } if (v > 0 && k < 0) throw NUM; return Math.floor(Number((v / k).toPrecision(15))) * k; }),
  'FLOOR.MATH': S(1, 3, (x, s, mode) => { const v = n(x); const k = Math.abs(s === undefined ? 1 : n(s)); if (k === 0) return 0; return v < 0 && mode !== undefined && n(mode) !== 0 ? -Math.floor(Number((-v / k).toPrecision(15))) * k : Math.floor(Number((v / k).toPrecision(15))) * k; }),
  'FLOOR.PRECISE': S(1, 2, (x, s) => { const k = Math.abs(s === undefined ? 1 : n(s)); return k === 0 ? 0 : Math.floor(Number((n(x) / k).toPrecision(15))) * k; }),
  EVEN: S(1, 1, (x) => { const v = n(x); const r = Math.ceil(Math.abs(v) / 2) * 2; return v < 0 ? -r : r; }),
  ODD: S(1, 1, (x) => { const v = n(x); const a = Math.abs(v); const r = a === 0 ? 1 : Math.ceil((a - 1) / 2) * 2 + 1; return v < 0 ? -r : r; }),
  QUOTIENT: S(2, 2, (x, y) => { const d = n(y); if (d === 0) throw DIV0; return Math.trunc(n(x) / d); }),
  FACT: S(1, 1, (x) => factorial(n(x))),
  FACTDOUBLE: S(1, 1, (x) => { let k = Math.floor(n(x)); if (k < -1) throw NUM; let r = 1; for (; k > 1; k -= 2) r *= k; return fin(r); }),
  COMBIN: S(2, 2, (a, b) => { const t = Math.floor(n(a)); const k = Math.floor(n(b)); if (t < 0 || k < 0 || k > t) throw NUM; return Math.round(Math.exp(lnComb(t, k))); }),
  COMBINA: S(2, 2, (a, b) => { const t = Math.floor(n(a)); const k = Math.floor(n(b)); if (t < 0 || k < 0) throw NUM; return Math.round(Math.exp(lnComb(t + k - 1, k))); }),
  PERMUT: S(2, 2, (a, b) => { const t = Math.floor(n(a)); const k = Math.floor(n(b)); if (t < 0 || k < 0 || k > t) throw NUM; return Math.round(Math.exp(lnGamma(t + 1) - lnGamma(t - k + 1))); }),
  PERMUTATIONA: S(2, 2, (a, b) => { const t = Math.floor(n(a)); const k = Math.floor(n(b)); if (t < 0 || k < 0) throw NUM; return t ** k; }),
  GCD: rawFn(1, 255, (a) => collectNumbers(a).map((v) => { if (v < 0) throw NUM; return Math.floor(v); }).reduce(gcd2, 0)),
  LCM: rawFn(1, 255, (a) => collectNumbers(a).map((v) => { if (v < 0) throw NUM; return Math.floor(v); }).reduce((x, y) => (x === 0 || y === 0 ? 0 : (x / gcd2(x, y)) * y), 1)),
  MULTINOMIAL: rawFn(1, 255, (a) => { const v = collectNumbers(a).map(Math.floor); if (v.some((x) => x < 0)) throw NUM; return Math.round(factorial(sum(v)) / v.reduce((p, x) => p * factorial(x), 1)); }),
  PI: rawFn(0, 0, () => Math.PI),
  RADIANS: S(1, 1, (x) => (n(x) * Math.PI) / 180),
  DEGREES: S(1, 1, (x) => (n(x) * 180) / Math.PI),
  SIN: trig(Math.sin), COS: trig(Math.cos), TAN: trig(Math.tan),
  ASIN: S(1, 1, (x) => { const v = n(x); if (Math.abs(v) > 1) throw NUM; return Math.asin(v); }),
  ACOS: S(1, 1, (x) => { const v = n(x); if (Math.abs(v) > 1) throw NUM; return Math.acos(v); }),
  ATAN: trig(Math.atan),
  ATAN2: S(2, 2, (x, y) => { const a = n(x); const b = n(y); if (a === 0 && b === 0) throw DIV0; return Math.atan2(b, a); }),
  SINH: trig(Math.sinh), COSH: trig(Math.cosh), TANH: trig(Math.tanh),
  ASINH: trig(Math.asinh),
  ACOSH: S(1, 1, (x) => { const v = n(x); if (v < 1) throw NUM; return Math.acosh(v); }),
  ATANH: S(1, 1, (x) => { const v = n(x); if (Math.abs(v) >= 1) throw NUM; return Math.atanh(v); }),
  COT: S(1, 1, (x) => { const v = n(x); if (v === 0) throw DIV0; return 1 / Math.tan(v); }),
  ACOT: S(1, 1, (x) => Math.PI / 2 - Math.atan(n(x))),
  COTH: S(1, 1, (x) => { const v = n(x); if (v === 0) throw DIV0; return 1 / Math.tanh(v); }),
  ACOTH: S(1, 1, (x) => { const v = n(x); if (Math.abs(v) <= 1) throw NUM; return Math.atanh(1 / v); }),
  SEC: S(1, 1, (x) => 1 / Math.cos(n(x))),
  CSC: S(1, 1, (x) => { const v = n(x); if (v === 0) throw DIV0; return 1 / Math.sin(v); }),
  SECH: S(1, 1, (x) => 1 / Math.cosh(n(x))),
  CSCH: S(1, 1, (x) => { const v = n(x); if (v === 0) throw DIV0; return 1 / Math.sinh(v); }),
  RAND: { min: 0, max: 0, f: (_a, x) => x.rand() },
  RANDBETWEEN: { min: 2, max: 2, f: (a, x) => { const lo = Math.ceil(n(sc(a[0]))); const hi = Math.floor(n(sc(a[1]))); if (lo > hi) throw NUM; return lo + Math.floor(x.rand() * (hi - lo + 1)); } },
  ROMAN: S(1, 2, (x) => toRoman(Math.floor(n(x)))),
  ARABIC: S(1, 1, (x) => fromRoman(toStr(x))),
  BASE: S(2, 3, (x, r, m) => { const v = Math.floor(n(x)); const b = Math.floor(n(r)); if (v < 0 || b < 2 || b > 36) throw NUM; return v.toString(b).toUpperCase().padStart(m === undefined ? 0 : Math.floor(n(m)), '0'); }),
  DECIMAL: S(2, 2, (x, r) => { const b = Math.floor(n(r)); if (b < 2 || b > 36) throw NUM; const t = toStr(x).trim().toLowerCase(); const v = parseInt(t, b); if (Number.isNaN(v) || [...t].some((ch) => parseInt(ch, 36) >= b)) throw NUM; return v; }),
  SERIESSUM: rawFn(4, 4, (a) => { const x = n(sc(a[0])); const s = n(sc(a[1])); const st = n(sc(a[2])); return collectNumbers([a[3]]).reduce((t, c, i) => t + c * x ** (s + i * st), 0); }),
  SUMPRODUCT: rawFn(1, 255, (a) => {
    const ms = a.map((v) => mat(v));
    const [R, C] = [ms[0].length, ms[0][0].length];
    if (ms.some((m) => m.length !== R || m[0].length !== C)) throw VALUE;
    let t = 0;
    for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) { let p = 1; for (const m of ms) { const v = m[r][c]; if (v instanceof FormulaError) throw v; p *= typeof v === 'number' ? v : 0; } t += p; }
    return t;
  }),
  SUMX2MY2: rawFn(2, 2, (a) => { const [x, y] = pairs(a[0], a[1]); return x.reduce((t, v, i) => t + v * v - y[i] * y[i], 0); }),
  SUMX2PY2: rawFn(2, 2, (a) => { const [x, y] = pairs(a[0], a[1]); return x.reduce((t, v, i) => t + v * v + y[i] * y[i], 0); }),
  SUMXMY2: rawFn(2, 2, (a) => { const [x, y] = pairs(a[0], a[1]); return x.reduce((t, v, i) => t + (v - y[i]) ** 2, 0); }),
  MMULT: rawFn(2, 2, (a) => { const A = numMatrix(a[0]); const B = numMatrix(a[1]); if (A[0].length !== B.length) throw VALUE; return A.map((row) => B[0].map((_, j) => row.reduce((t, v, k) => t + v * B[k][j], 0))); }),
  MDETERM: rawFn(1, 1, (a) => { const m = numMatrix(a[0]); if (m.length !== m[0].length) throw VALUE; return det(m); }),
  MINVERSE: rawFn(1, 1, (a) => { const m = numMatrix(a[0]); if (m.length !== m[0].length) throw VALUE; return inverse(m); }),
  MUNIT: rawFn(1, 1, (a) => { const k = Math.floor(n(sc(a[0]))); if (k < 1 || k > 200) throw VALUE; return Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1 : 0))); }),

  // counting
  COUNT: rawFn(1, 255, (a) => collectNumbers(a.map((v) => (isRng(v) || isArr(v) ? mat(v).map((row) => row.map((x) => (x instanceof FormulaError ? null : x))) : v))).length),
  COUNTA: rawFn(1, 255, (a) => { let k = 0; for (const v of a) { if (isRng(v) || isArr(v)) { for (const row of mat(v)) for (const x of row) if (x !== null && x !== '') k++; } else k++; } return k; }),
  COUNTBLANK: rawFn(1, 1, (a) => mat(a[0]).flat().filter((x) => x === null || x === '').length),
  COUNTIF: rawFn(2, 2, (a) => matching([a[0], a[1]]).flat().filter(Boolean).length),
  COUNTIFS: rawFn(2, 254, (a) => { if (a.length % 2) throw VALUE; return matching(a).flat().filter(Boolean).length; }),
  SUMIF: rawFn(2, 3, (a) => { const hit = matching([a[0], a[1]]); const vals = a[2] === undefined ? a[0] : a[2]; return sum(pickNumbers(sameShape(vals, a[0]), hit)); }),
  SUMIFS: rawFn(3, 255, (a) => { if (a.length % 2 === 0) throw VALUE; return sum(pickNumbers(a[0], matching(a, 1))); }),
  AVERAGEIF: rawFn(2, 3, (a) => { const hit = matching([a[0], a[1]]); const v = pickNumbers(sameShape(a[2] === undefined ? a[0] : a[2], a[0]), hit); return mean(v); }),
  AVERAGEIFS: rawFn(3, 255, (a) => { if (a.length % 2 === 0) throw VALUE; return mean(pickNumbers(a[0], matching(a, 1))); }),
  MAXIFS: rawFn(3, 255, (a) => { if (a.length % 2 === 0) throw VALUE; const v = pickNumbers(a[0], matching(a, 1)); return v.length ? Math.max(...v) : 0; }),
  MINIFS: rawFn(3, 255, (a) => { if (a.length % 2 === 0) throw VALUE; const v = pickNumbers(a[0], matching(a, 1)); return v.length ? Math.min(...v) : 0; }),

  // statistics
  AVERAGE: rawFn(1, 255, (a) => mean(collectNumbers(a))),
  AVERAGEA: rawFn(1, 255, (a) => mean(numsA(a))),
  MIN: rawFn(1, 255, (a) => { const v = collectNumbers(a); return v.length ? v.reduce((x, y) => Math.min(x, y)) : 0; }),
  MAX: rawFn(1, 255, (a) => { const v = collectNumbers(a); return v.length ? v.reduce((x, y) => Math.max(x, y)) : 0; }),
  MINA: rawFn(1, 255, (a) => { const v = numsA(a); return v.length ? Math.min(...v) : 0; }),
  MAXA: rawFn(1, 255, (a) => { const v = numsA(a); return v.length ? Math.max(...v) : 0; }),
  MEDIAN: rawFn(1, 255, (a) => { const v = sorted(collectNumbers(a)); if (!v.length) throw NUM; const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; }),
  MODE: rawFn(1, 255, (a) => mode(collectNumbers(a))[0] ?? NA),
  'MODE.SNGL': rawFn(1, 255, (a) => mode(collectNumbers(a))[0] ?? NA),
  'MODE.MULT': rawFn(1, 255, (a) => { const m = mode(collectNumbers(a)); if (!m.length) throw NA; return m.map((x) => [x]); }),
  LARGE: rawFn(2, 2, (a) => { const v = sorted(collectNumbers([a[0]])); const k = Math.ceil(n(sc(a[1]))); if (k < 1 || k > v.length) throw NUM; return v[v.length - k]; }),
  SMALL: rawFn(2, 2, (a) => { const v = sorted(collectNumbers([a[0]])); const k = Math.ceil(n(sc(a[1]))); if (k < 1 || k > v.length) throw NUM; return v[k - 1]; }),
  RANK: rawFn(2, 3, (a) => rank(a, false)),
  'RANK.EQ': rawFn(2, 3, (a) => rank(a, false)),
  'RANK.AVG': rawFn(2, 3, (a) => rank(a, true)),
  PERCENTILE: rawFn(2, 2, (a) => percentile(collectNumbers([a[0]]), n(sc(a[1])), false)),
  'PERCENTILE.INC': rawFn(2, 2, (a) => percentile(collectNumbers([a[0]]), n(sc(a[1])), false)),
  'PERCENTILE.EXC': rawFn(2, 2, (a) => percentile(collectNumbers([a[0]]), n(sc(a[1])), true)),
  QUARTILE: rawFn(2, 2, (a) => { const q = Math.trunc(n(sc(a[1]))); if (q < 0 || q > 4) throw NUM; return percentile(collectNumbers([a[0]]), q / 4, false); }),
  'QUARTILE.INC': rawFn(2, 2, (a) => { const q = Math.trunc(n(sc(a[1]))); if (q < 0 || q > 4) throw NUM; return percentile(collectNumbers([a[0]]), q / 4, false); }),
  'QUARTILE.EXC': rawFn(2, 2, (a) => { const q = Math.trunc(n(sc(a[1]))); if (q < 1 || q > 3) throw NUM; return percentile(collectNumbers([a[0]]), q / 4, true); }),
  PERCENTRANK: rawFn(2, 3, (a) => percentRank(a, false)),
  'PERCENTRANK.INC': rawFn(2, 3, (a) => percentRank(a, false)),
  'PERCENTRANK.EXC': rawFn(2, 3, (a) => percentRank(a, true)),
  STDEV: rawFn(1, 255, (a) => Math.sqrt(varS(collectNumbers(a)))),
  'STDEV.S': rawFn(1, 255, (a) => Math.sqrt(varS(collectNumbers(a)))),
  STDEVA: rawFn(1, 255, (a) => Math.sqrt(varS(numsA(a)))),
  STDEVP: rawFn(1, 255, (a) => Math.sqrt(varP(collectNumbers(a)))),
  'STDEV.P': rawFn(1, 255, (a) => Math.sqrt(varP(collectNumbers(a)))),
  STDEVPA: rawFn(1, 255, (a) => Math.sqrt(varP(numsA(a)))),
  VAR: rawFn(1, 255, (a) => varS(collectNumbers(a))),
  'VAR.S': rawFn(1, 255, (a) => varS(collectNumbers(a))),
  VARA: rawFn(1, 255, (a) => varS(numsA(a))),
  VARP: rawFn(1, 255, (a) => varP(collectNumbers(a))),
  'VAR.P': rawFn(1, 255, (a) => varP(collectNumbers(a))),
  VARPA: rawFn(1, 255, (a) => varP(numsA(a))),
  AVEDEV: rawFn(1, 255, (a) => { const v = collectNumbers(a); const m = mean(v); return sum(v.map((x) => Math.abs(x - m))) / v.length; }),
  DEVSQ: rawFn(1, 255, (a) => { const v = collectNumbers(a); return v.length ? sumSq(v, mean(v)) : 0; }),
  GEOMEAN: rawFn(1, 255, (a) => { const v = collectNumbers(a); if (!v.length || v.some((x) => x <= 0)) throw NUM; return Math.exp(mean(v.map(Math.log))); }),
  HARMEAN: rawFn(1, 255, (a) => { const v = collectNumbers(a); if (!v.length || v.some((x) => x <= 0)) throw NUM; return v.length / sum(v.map((x) => 1 / x)); }),
  TRIMMEAN: rawFn(2, 2, (a) => { const v = sorted(collectNumbers([a[0]])); const p = n(sc(a[1])); if (p < 0 || p >= 1 || !v.length) throw NUM; const k = Math.floor((v.length * p) / 2); return mean(v.slice(k, v.length - k)); }),
  SKEW: rawFn(1, 255, (a) => { const v = collectNumbers(a); const m = mean(v); const s = Math.sqrt(varS(v)); if (v.length < 3 || s === 0) throw DIV0; return (v.length / ((v.length - 1) * (v.length - 2))) * sum(v.map((x) => ((x - m) / s) ** 3)); }),
  'SKEW.P': rawFn(1, 255, (a) => { const v = collectNumbers(a); const m = mean(v); const s = Math.sqrt(varP(v)); if (!v.length || s === 0) throw DIV0; return sum(v.map((x) => ((x - m) / s) ** 3)) / v.length; }),
  KURT: rawFn(1, 255, (a) => { const v = collectNumbers(a); const k = v.length; const m = mean(v); const s = Math.sqrt(varS(v)); if (k < 4 || s === 0) throw DIV0; return ((k * (k + 1)) / ((k - 1) * (k - 2) * (k - 3))) * sum(v.map((x) => ((x - m) / s) ** 4)) - (3 * (k - 1) ** 2) / ((k - 2) * (k - 3)); }),
  CORREL: rawFn(2, 2, (a) => { const r = regression(a[0], a[1]); if (r.syy === 0) throw DIV0; return r.sxy / Math.sqrt(r.sxx * r.syy); }),
  PEARSON: rawFn(2, 2, (a) => { const r = regression(a[0], a[1]); if (r.syy === 0) throw DIV0; return r.sxy / Math.sqrt(r.sxx * r.syy); }),
  RSQ: rawFn(2, 2, (a) => { const r = regression(a[0], a[1]); if (r.syy === 0) throw DIV0; return (r.sxy * r.sxy) / (r.sxx * r.syy); }),
  SLOPE: rawFn(2, 2, (a) => regression(a[0], a[1]).slope),
  INTERCEPT: rawFn(2, 2, (a) => regression(a[0], a[1]).intercept),
  STEYX: rawFn(2, 2, (a) => { const r = regression(a[0], a[1]); if (r.n < 3) throw DIV0; return Math.sqrt((r.syy - (r.sxy * r.sxy) / r.sxx) / (r.n - 2)); }),
  COVAR: rawFn(2, 2, (a) => { const [x, y] = pairs(a[0], a[1]); const mx = mean(x); const my = mean(y); return sum(x.map((v, i) => (v - mx) * (y[i] - my))) / x.length; }),
  'COVARIANCE.P': rawFn(2, 2, (a) => { const [x, y] = pairs(a[0], a[1]); const mx = mean(x); const my = mean(y); return sum(x.map((v, i) => (v - mx) * (y[i] - my))) / x.length; }),
  'COVARIANCE.S': rawFn(2, 2, (a) => { const [x, y] = pairs(a[0], a[1]); if (x.length < 2) throw DIV0; const mx = mean(x); const my = mean(y); return sum(x.map((v, i) => (v - mx) * (y[i] - my))) / (x.length - 1); }),
  FORECAST: S2((x, ys, xs) => { const r = regression(ys, xs); return r.intercept + r.slope * x; }),
  'FORECAST.LINEAR': S2((x, ys, xs) => { const r = regression(ys, xs); return r.intercept + r.slope * x; }),
  TREND: rawFn(1, 4, (a) => {
    const known = a[1] === undefined ? mat(a[0]).map((_, i) => [i + 1]) : mat(a[1]);
    const r = regression(a[0], known);
    const at = a[2] === undefined ? known : mat(a[2]);
    return at.map((row) => row.map((x) => r.intercept + r.slope * toNum(x)));
  }),
  GROWTH: rawFn(1, 4, (a) => {
    const ys = mat(a[0]).map((row) => row.map((v) => Math.log(toNum(v))));
    const known = a[1] === undefined ? mat(a[0]).map((row, i) => row.map(() => i + 1)) : mat(a[1]);
    const r = regression(ys, known);
    const at = a[2] === undefined ? known : mat(a[2]);
    return at.map((row) => row.map((x) => Math.exp(r.intercept + r.slope * toNum(x))));
  }),
  LINEST: rawFn(1, 4, (a) => { const known = a[1] === undefined ? mat(a[0]).map((_, i) => [i + 1]) : mat(a[1]); const r = regression(a[0], known); return [[r.slope, r.intercept]]; }),
  FREQUENCY: rawFn(2, 2, (a) => { const d = collectNumbers([a[0]]); const bins = sorted(collectNumbers([a[1]])); const out = new Array(bins.length + 1).fill(0); for (const x of d) { let i = bins.findIndex((b) => x <= b); if (i < 0) i = bins.length; out[i]++; } return out.map((x) => [x]); }),
  PROB: rawFn(3, 4, (a) => { const x = collectNumbers([a[0]]); const p = collectNumbers([a[1]]); const lo = n(sc(a[2])); const hi = a[3] === undefined ? lo : n(sc(a[3])); if (x.length !== p.length || Math.abs(sum(p) - 1) > 1e-9) throw NA; return sum(x.map((v, i) => (v >= lo && v <= hi ? p[i] : 0))); }),
  STANDARDIZE: S(3, 3, (x, m, s) => { if (n(s) <= 0) throw NUM; return (n(x) - n(m)) / n(s); }),
  FISHER: S(1, 1, (x) => { const v = n(x); if (Math.abs(v) >= 1) throw NUM; return Math.atanh(v); }),
  FISHERINV: S(1, 1, (x) => Math.tanh(n(x))),
  GAUSS: S(1, 1, (x) => normCdf(n(x)) - 0.5),
  PHI: S(1, 1, (x) => normPdf(n(x))),

  // distributions
  'NORM.S.DIST': S(2, 2, (z, c) => (toBool(c) ? normCdf(n(z)) : normPdf(n(z)))),
  NORMSDIST: S(1, 1, (z) => normCdf(n(z))),
  'NORM.DIST': S(4, 4, (x, m, s, c) => { const sd = n(s); if (sd <= 0) throw NUM; const z = (n(x) - n(m)) / sd; return toBool(c) ? normPdf(z) / sd : normCdf(z); }),
  NORMDIST: S(4, 4, (x, m, s, c) => { const sd = n(s); if (sd <= 0) throw NUM; const z = (n(x) - n(m)) / sd; return toBool(c) ? normPdf(z) / sd : normCdf(z); }),
  'NORM.S.INV': S(1, 1, (p) => normInv(n(p))),
  NORMSINV: S(1, 1, (p) => normInv(n(p))),
  'NORM.INV': S(3, 3, (p, m, s) => { if (n(s) <= 0) throw NUM; return n(m) + n(s) * normInv(n(p)); }),
  NORMINV: S(3, 3, (p, m, s) => { if (n(s) <= 0) throw NUM; return n(m) + n(s) * normInv(n(p)); }),
  'LOGNORM.DIST': S(4, 4, (x, m, s, c) => { const v = n(x); const sd = n(s); if (v <= 0 || sd <= 0) throw NUM; const z = (Math.log(v) - n(m)) / sd; return toBool(c) ? normPdf(z) / (v * sd) : normCdf(z); }),
  LOGNORMDIST: S(3, 3, (x, m, s) => { const v = n(x); if (v <= 0 || n(s) <= 0) throw NUM; return normCdf((Math.log(v) - n(m)) / n(s)); }),
  'LOGNORM.INV': S(3, 3, (p, m, s) => { if (n(s) <= 0) throw NUM; return Math.exp(n(m) + n(s) * normInv(n(p))); }),
  LOGINV: S(3, 3, (p, m, s) => { if (n(s) <= 0) throw NUM; return Math.exp(n(m) + n(s) * normInv(n(p))); }),
  'CONFIDENCE.NORM': S(3, 3, (al, sd, sz) => { const k = Math.floor(n(sz)); if (n(al) <= 0 || n(al) >= 1 || n(sd) <= 0 || k < 1) throw NUM; return (-normInv(n(al) / 2) * n(sd)) / Math.sqrt(k); }),
  CONFIDENCE: S(3, 3, (al, sd, sz) => { const k = Math.floor(n(sz)); if (n(al) <= 0 || n(al) >= 1 || n(sd) <= 0 || k < 1) throw NUM; return (-normInv(n(al) / 2) * n(sd)) / Math.sqrt(k); }),
  'CONFIDENCE.T': S(3, 3, (al, sd, sz) => { const k = Math.floor(n(sz)); if (k < 2) throw DIV0; return (-invert((x) => tCdf(x, k - 1), n(al) / 2, -10, 10) * n(sd)) / Math.sqrt(k); }),
  'BINOM.DIST': S(4, 4, (k, t, p, c) => binom(n(k), n(t), n(p), toBool(c))),
  BINOMDIST: S(4, 4, (k, t, p, c) => binom(n(k), n(t), n(p), toBool(c))),
  'BINOM.INV': S(3, 3, (t, p, al) => { const tr = Math.floor(n(t)); const pr = n(p); const a = n(al); if (tr < 0 || pr < 0 || pr > 1 || a < 0 || a > 1) throw NUM; let c = 0; for (let k = 0; k <= tr; k++) { c += binomPmf(k, tr, pr); if (c >= a - 1e-12) return k; } return tr; }),
  CRITBINOM: S(3, 3, (t, p, al) => { const tr = Math.floor(n(t)); const pr = n(p); const a = n(al); if (tr < 0 || pr < 0 || pr > 1 || a < 0 || a > 1) throw NUM; let c = 0; for (let k = 0; k <= tr; k++) { c += binomPmf(k, tr, pr); if (c >= a - 1e-12) return k; } return tr; }),
  'NEGBINOM.DIST': S(4, 4, (f, s, p, c) => { const fk = Math.floor(n(f)); const sk = Math.floor(n(s)); const pr = n(p); if (fk < 0 || sk < 1 || pr < 0 || pr > 1) throw NUM; const pmf = (k: number) => Math.exp(lnComb(k + sk - 1, k) + sk * Math.log(pr) + k * Math.log(1 - pr)); if (!toBool(c)) return pmf(fk); let t = 0; for (let k = 0; k <= fk; k++) t += pmf(k); return t; }),
  'POISSON.DIST': S(3, 3, (k, m, c) => poisson(n(k), n(m), toBool(c))),
  POISSON: S(3, 3, (k, m, c) => poisson(n(k), n(m), toBool(c))),
  'EXPON.DIST': S(3, 3, (x, l, c) => { const v = n(x); const la = n(l); if (v < 0 || la <= 0) throw NUM; return toBool(c) ? 1 - Math.exp(-la * v) : la * Math.exp(-la * v); }),
  EXPONDIST: S(3, 3, (x, l, c) => { const v = n(x); const la = n(l); if (v < 0 || la <= 0) throw NUM; return toBool(c) ? 1 - Math.exp(-la * v) : la * Math.exp(-la * v); }),
  'WEIBULL.DIST': S(4, 4, (x, al, be, c) => { const v = n(x); const a = n(al); const b = n(be); if (v < 0 || a <= 0 || b <= 0) throw NUM; return toBool(c) ? 1 - Math.exp(-((v / b) ** a)) : (a / b) * (v / b) ** (a - 1) * Math.exp(-((v / b) ** a)); }),
  WEIBULL: S(4, 4, (x, al, be, c) => { const v = n(x); const a = n(al); const b = n(be); if (v < 0 || a <= 0 || b <= 0) throw NUM; return toBool(c) ? 1 - Math.exp(-((v / b) ** a)) : (a / b) * (v / b) ** (a - 1) * Math.exp(-((v / b) ** a)); }),
  GAMMA: S(1, 1, (x) => fin(gammaFn(n(x)))),
  GAMMALN: S(1, 1, (x) => { const v = n(x); if (v <= 0) throw NUM; return lnGamma(v); }),
  'GAMMALN.PRECISE': S(1, 1, (x) => { const v = n(x); if (v <= 0) throw NUM; return lnGamma(v); }),
  'GAMMA.DIST': dist2(gamCdf, gamPdf),
  GAMMADIST: dist2(gamCdf, gamPdf),
  'GAMMA.INV': S(3, 3, (p, a, b) => invert((x) => gamCdf(x, n(a), n(b)), n(p), 0, 10)),
  GAMMAINV: S(3, 3, (p, a, b) => invert((x) => gamCdf(x, n(a), n(b)), n(p), 0, 10)),
  'BETA.DIST': S(4, 6, (x, a, b, c, lo, hi) => { const A = lo === undefined ? 0 : n(lo); const B = hi === undefined ? 1 : n(hi); const z = (n(x) - A) / (B - A); return toBool(c) ? betaI(z, n(a), n(b)) : betaPdf(z, n(a), n(b)) / (B - A); }),
  BETADIST: S(3, 5, (x, a, b, lo, hi) => { const A = lo === undefined ? 0 : n(lo); const B = hi === undefined ? 1 : n(hi); return betaI((n(x) - A) / (B - A), n(a), n(b)); }),
  'BETA.INV': S(3, 5, (p, a, b, lo, hi) => { const A = lo === undefined ? 0 : n(lo); const B = hi === undefined ? 1 : n(hi); return A + (B - A) * invert((x) => betaI(x, n(a), n(b)), n(p), 0, 1); }),
  BETAINV: S(3, 5, (p, a, b, lo, hi) => { const A = lo === undefined ? 0 : n(lo); const B = hi === undefined ? 1 : n(hi); return A + (B - A) * invert((x) => betaI(x, n(a), n(b)), n(p), 0, 1); }),
  'CHISQ.DIST': S(3, 3, (x, df, c) => { const d = Math.floor(n(df)); if (d < 1 || n(x) < 0) throw NUM; return toBool(c) ? chiCdf(n(x), d) : chiPdf(n(x), d); }),
  'CHISQ.DIST.RT': S(2, 2, (x, df) => { const d = Math.floor(n(df)); if (d < 1 || n(x) < 0) throw NUM; return 1 - chiCdf(n(x), d); }),
  CHIDIST: S(2, 2, (x, df) => { const d = Math.floor(n(df)); if (d < 1 || n(x) < 0) throw NUM; return 1 - chiCdf(n(x), d); }),
  'CHISQ.INV': S(2, 2, (p, df) => invert((x) => chiCdf(x, Math.floor(n(df))), n(p), 0, 10)),
  'CHISQ.INV.RT': S(2, 2, (p, df) => invert((x) => chiCdf(x, Math.floor(n(df))), 1 - n(p), 0, 10)),
  CHIINV: S(2, 2, (p, df) => invert((x) => chiCdf(x, Math.floor(n(df))), 1 - n(p), 0, 10)),
  'T.DIST': S(3, 3, (x, df, c) => { const d = Math.floor(n(df)); if (d < 1) throw NUM; return toBool(c) ? tCdf(n(x), d) : tPdf(n(x), d); }),
  'T.DIST.RT': S(2, 2, (x, df) => { const d = Math.floor(n(df)); if (d < 1) throw NUM; return 1 - tCdf(n(x), d); }),
  'T.DIST.2T': S(2, 2, (x, df) => { const d = Math.floor(n(df)); if (d < 1 || n(x) < 0) throw NUM; return 2 * (1 - tCdf(n(x), d)); }),
  TDIST: S(3, 3, (x, df, t) => { const d = Math.floor(n(df)); if (d < 1 || n(x) < 0) throw NUM; return (n(t) === 2 ? 2 : 1) * (1 - tCdf(n(x), d)); }),
  'T.INV': S(2, 2, (p, df) => invert((x) => tCdf(x, Math.floor(n(df))), n(p), -10, 10)),
  'T.INV.2T': S(2, 2, (p, df) => invert((x) => tCdf(x, Math.floor(n(df))), 1 - n(p) / 2, -10, 10)),
  TINV: S(2, 2, (p, df) => invert((x) => tCdf(x, Math.floor(n(df))), 1 - n(p) / 2, -10, 10)),
  'F.DIST': S(4, 4, (x, d1, d2, c) => (toBool(c) ? fCdf(n(x), n(d1), n(d2)) : fPdf(n(x), n(d1), n(d2)))),
  'F.DIST.RT': S(3, 3, (x, d1, d2) => 1 - fCdf(n(x), n(d1), n(d2))),
  FDIST: S(3, 3, (x, d1, d2) => 1 - fCdf(n(x), n(d1), n(d2))),
  'F.INV': S(3, 3, (p, d1, d2) => invert((x) => fCdf(x, n(d1), n(d2)), n(p), 0, 10)),
  'F.INV.RT': S(3, 3, (p, d1, d2) => invert((x) => fCdf(x, n(d1), n(d2)), 1 - n(p), 0, 10)),
  FINV: S(3, 3, (p, d1, d2) => invert((x) => fCdf(x, n(d1), n(d2)), 1 - n(p), 0, 10)),
  'HYPGEOM.DIST': S(5, 5, (k, ns, kp, np, c) => { const x = Math.floor(n(k)); const s = Math.floor(n(ns)); const K = Math.floor(n(kp)); const N = Math.floor(n(np)); if (s < 0 || K < 0 || N < 1 || s > K || s > N || K > N) throw NUM; const pmf = (i: number) => Math.exp(lnComb(K, i) + lnComb(N - K, s - i) - lnComb(N, s)); if (!toBool(c)) return pmf(x); let t = 0; for (let i = 0; i <= x; i++) t += pmf(i); return t; }),
  'Z.TEST': rawFn(2, 3, (a) => { const v = collectNumbers([a[0]]); const x = n(sc(a[1])); const sd = a[2] === undefined ? Math.sqrt(varS(v)) : n(sc(a[2])); return 1 - normCdf((mean(v) - x) / (sd / Math.sqrt(v.length))); }),
  ERF: S(1, 2, (lo, hi) => (hi === undefined ? erf(n(lo)) : erf(n(hi)) - erf(n(lo)))),
  'ERF.PRECISE': S(1, 1, (x) => erf(n(x))),
  ERFC: S(1, 1, (x) => 1 - erf(n(x))),
  'ERFC.PRECISE': S(1, 1, (x) => 1 - erf(n(x))),

  // engineering
  BIN2DEC: S(1, 1, (x) => fromBase(x, 2)),
  BIN2HEX: S(1, 2, (x, p) => toBase(fromBase(x, 2), 16, p, -549755813888, 549755813887)),
  BIN2OCT: S(1, 2, (x, p) => toBase(fromBase(x, 2), 8, p, -536870912, 536870911)),
  DEC2BIN: S(1, 2, (x, p) => toBase(n(x), 2, p, -512, 511)),
  DEC2HEX: S(1, 2, (x, p) => toBase(n(x), 16, p, -549755813888, 549755813887)),
  DEC2OCT: S(1, 2, (x, p) => toBase(n(x), 8, p, -536870912, 536870911)),
  HEX2BIN: S(1, 2, (x, p) => toBase(fromBase(x, 16), 2, p, -512, 511)),
  HEX2DEC: S(1, 1, (x) => fromBase(x, 16)),
  HEX2OCT: S(1, 2, (x, p) => toBase(fromBase(x, 16), 8, p, -536870912, 536870911)),
  OCT2BIN: S(1, 2, (x, p) => toBase(fromBase(x, 8), 2, p, -512, 511)),
  OCT2DEC: S(1, 1, (x) => fromBase(x, 8)),
  OCT2HEX: S(1, 2, (x, p) => toBase(fromBase(x, 8), 16, p, -549755813888, 549755813887)),
  BITAND: S(2, 2, (x, y) => bit(x, y, (a, b) => a & b)),
  BITOR: S(2, 2, (x, y) => bit(x, y, (a, b) => a | b)),
  BITXOR: S(2, 2, (x, y) => bit(x, y, (a, b) => a ^ b)),
  BITLSHIFT: S(2, 2, (x, s) => { const v = n(x); const k = Math.trunc(n(s)); if (v < 0 || v >= 2 ** 48 || Math.abs(k) > 53) throw NUM; return k >= 0 ? v * 2 ** k : Math.floor(v / 2 ** -k); }),
  BITRSHIFT: S(2, 2, (x, s) => { const v = n(x); const k = Math.trunc(n(s)); if (v < 0 || v >= 2 ** 48 || Math.abs(k) > 53) throw NUM; return k >= 0 ? Math.floor(v / 2 ** k) : v * 2 ** -k; }),
  DELTA: S(1, 2, (a, b) => (n(a) === (b === undefined ? 0 : n(b)) ? 1 : 0)),
  GESTEP: S(1, 2, (a, b) => (n(a) >= (b === undefined ? 0 : n(b)) ? 1 : 0)),
  CONVERT: S(3, 3, (x, f, t) => convert(n(x), toStr(f), toStr(t))),
};

function S2(f: (x: number, ys: V, xs: V) => number) {
  return rawFn(3, 3, (a) => f(n(sc(a[0])), a[1], a[2]));
}
function sameShape(vals: V, crit: V): V {
  // SUMIF's sum range is anchored at its top-left cell and takes the shape of the criteria range
  if (!isRng(vals) || !isRng(crit)) return vals;
  return new (vals.constructor as typeof import('./formula-core').Rng)(vals.sheet, vals.c0, vals.r0, Math.min(vals.sheet.cols - 1, vals.c0 + crit.cols - 1), Math.min(vals.sheet.rows - 1, vals.r0 + crit.rows - 1));
}
function mode(v: number[]): number[] {
  const counts = new Map<number, number>();
  for (const x of v) counts.set(x, (counts.get(x) ?? 0) + 1);
  const best = Math.max(0, ...counts.values());
  if (best < 2) return [];
  return v.filter((x, i) => counts.get(x) === best && v.indexOf(x) === i);
}
function rank(a: V[], avg: boolean): number {
  const x = n(sc(a[0]));
  const v = collectNumbers([a[1]]);
  const asc = a[2] !== undefined && n(sc(a[2])) !== 0;
  if (!v.includes(x)) throw NA;
  const better = v.filter((y) => (asc ? y < x : y > x)).length;
  const ties = v.filter((y) => y === x).length;
  return avg ? better + (ties + 1) / 2 : better + 1;
}
function percentRank(a: V[], exclusive: boolean): number {
  const v = sorted(collectNumbers([a[0]])); const x = n(sc(a[1])); const sig = a[2] === undefined ? 3 : Math.trunc(n(sc(a[2])));
  const len = v.length;
  if (!len || x < v[0] || x > v[len - 1]) throw NA;
  let i = v.findIndex((y) => y >= x);
  let pos: number;
  if (v[i] === x) pos = i; else pos = i - 1 + (x - v[i - 1]) / (v[i] - v[i - 1]);
  const r = exclusive ? (pos + 1) / (len + 1) : pos / (len - 1);
  const f = 10 ** sig;
  return Math.floor(r * f) / f;
}
function binom(k: number, t: number, p: number, cum: boolean): number {
  k = Math.floor(k); t = Math.floor(t);
  if (k < 0 || k > t || p < 0 || p > 1) throw NUM;
  if (!cum) return binomPmf(k, t, p);
  let s = 0; for (let i = 0; i <= k; i++) s += binomPmf(i, t, p);
  return Math.min(1, s);
}
function poisson(k: number, m: number, cum: boolean): number {
  k = Math.floor(k);
  if (k < 0 || m < 0) throw NUM;
  if (m === 0) return k === 0 || cum ? 1 : 0;
  if (!cum) return poisPmf(k, m);
  let s = 0; for (let i = 0; i <= k; i++) s += poisPmf(i, m);
  return Math.min(1, s);
}
function bit(x: Scalar | undefined, y: Scalar | undefined, f: (a: number, b: number) => number): number {
  const a = n(x); const b = n(y);
  if (a < 0 || b < 0 || a >= 2 ** 48 || b >= 2 ** 48 || a !== Math.floor(a) || b !== Math.floor(b)) throw NUM;
  const hi = f(Math.floor(a / 2 ** 24), Math.floor(b / 2 ** 24)); const lo = f(a % 2 ** 24, b % 2 ** 24);
  return hi * 2 ** 24 + lo;
}

/** For callers that want the raw helpers (the text and date library reuses them). */
export { compare, flatten, lnGamma };
export type { Arr };
