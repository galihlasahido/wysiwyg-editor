/** Formula functions: text, dates and times, logic, information. */
import {
  Arr, DIV0, FormulaError, FnTable, NA, NUM, REF, Rng, Scalar, V, VALUE, capText, collectNumbers, compare, criterion, errorOf, flatten, hasWildcard, isArr, isErr, isMulti, isRng, lazyFn,
  makeDate, mat, numText, parseDateText, parseNumberText, rawFn, same, scalarFn, sc, serialNow, serialToDate, toBool, toNum, toStr, tryV, globIndex, spend,
} from './formula-core';
import { roundTo } from './formula-lib-math';

const S = scalarFn;
const n = toNum;
const str = toStr;

// ---- TEXT(): number and date formats --------------------------------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function sections(fmt: string): string[] {
  const out: string[] = []; let cur = ''; let q = false; let br = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') q = !q; else if (!q && ch === '[') br = true; else if (!q && ch === ']') br = false;
    if (ch === ';' && !q && !br) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
/** A format split into tokens: quoted text and escaped characters become literals. */
function lex(fmt: string): { lit?: string; tok?: string }[] {
  const out: { lit?: string; tok?: string }[] = [];
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch === '"') { const j = fmt.indexOf('"', i + 1); const end = j < 0 ? fmt.length : j; out.push({ lit: fmt.slice(i + 1, end) }); i = end; continue; }
    if (ch === '\\' || ch === '_' || ch === '*') { if (ch === '\\') out.push({ lit: fmt[i + 1] ?? '' }); else if (ch === '_') out.push({ lit: ' ' }); i++; continue; }
    if (ch === '[') { const j = fmt.indexOf(']', i); const body = fmt.slice(i + 1, j < 0 ? fmt.length : j); if (/^(h+|m+|s+)$/i.test(body)) out.push({ tok: `[${body.toLowerCase()}]` }); else if (/^\$[^-]*(-.*)?$/.test(body)) out.push({ lit: body.slice(1).split('-')[0] }); i = j < 0 ? fmt.length : j; continue; }
    const rest = fmt.slice(i);
    let m = /^(?:AM\/PM|A\/P)/i.exec(rest);
    if (m) { out.push({ tok: m[0].toUpperCase() }); i += m[0].length - 1; continue; }
    m = /^(?:y+|m+|d+|h+|s+|E[+-]0+|0|#|\?|,|\.|%|@|General)/i.exec(rest);
    if (m) { out.push({ tok: /^[a-z]/i.test(m[0]) && !/^E/i.test(m[0]) ? m[0].toLowerCase() === 'general' ? 'General' : m[0].toLowerCase() : m[0] }); i += m[0].length - 1; continue; }
    out.push({ lit: ch });
  }
  return out;
}
const isDateFmt = (toks: ReturnType<typeof lex>) => toks.some((t) => t.tok && /^(y+|m+|d+|h+|s+|\[[hms]+\]|AM\/PM|A\/P)$/i.test(t.tok));

function formatDate(v: number, toks: ReturnType<typeof lex>): string {
  if (v < 0) throw VALUE;
  const rounded = Math.round(v * 86400) / 86400;
  const d = serialToDate(rounded);
  const ampm = toks.some((t) => t.tok === 'AM/PM' || t.tok === 'A/P');
  let out = '';
  toks.forEach((t, i) => {
    if (t.lit !== undefined) { out += t.lit; return; }
    const k = t.tok!;
    const prev = toks.slice(0, i).reverse().find((x) => x.tok && /^(h+|\[h+\])$/.test(x.tok));
    const next = toks.slice(i + 1).find((x) => x.tok && /^(s+|\[s+\])$/.test(x.tok));
    const lastNonLit = toks.slice(0, i).reverse().find((x) => x.tok);
    const minutes = k[0] === 'm' && ((prev && lastNonLit && /^(h+|\[h+\])$/.test(lastNonLit.tok!)) || next && toks.slice(i + 1).find((x) => x.tok)?.tok?.[0] === 's');
    if (k[0] === 'y') out += k.length <= 2 ? String(d.y % 100).padStart(2, '0') : String(d.y).padStart(4, '0');
    else if (k[0] === 'm' && !minutes) out += k.length === 1 ? String(d.m) : k.length === 2 ? String(d.m).padStart(2, '0') : k.length === 3 ? MONTHS[d.m - 1].slice(0, 3) : k.length === 5 ? MONTHS[d.m - 1][0] : MONTHS[d.m - 1];
    else if (k[0] === 'd') out += k.length === 1 ? String(d.d) : k.length === 2 ? String(d.d).padStart(2, '0') : k.length === 3 ? DAYS[d.wd].slice(0, 3) : DAYS[d.wd];
    else if (k[0] === 'h') { const h = ampm ? d.h % 12 || 12 : d.h; out += k.length === 1 ? String(h) : String(h).padStart(2, '0'); }
    else if (k === '[h]' || /^\[h+\]$/.test(k)) out += String(Math.floor(rounded * 24));
    else if (/^\[m+\]$/.test(k)) out += String(Math.floor(rounded * 1440));
    else if (/^\[s+\]$/.test(k)) out += String(Math.floor(rounded * 86400));
    else if (k[0] === 'm') out += k.length === 1 ? String(d.mi) : String(d.mi).padStart(2, '0');
    else if (k[0] === 's') out += k.length === 1 ? String(d.s) : String(d.s).padStart(2, '0');
    else if (k === 'AM/PM') out += d.h < 12 ? 'AM' : 'PM';
    else if (k === 'A/P') out += d.h < 12 ? 'A' : 'P';
    else out += k;
  });
  return out;
}

function formatNumberPattern(v: number, toks: ReturnType<typeof lex>, signed: boolean): string {
  let pct = 0;
  for (const t of toks) if (t.tok === '%') pct++;
  let x = Math.abs(v) * 100 ** pct;
  // scientific
  const ei = toks.findIndex((t) => t.tok && /^E[+-]0+$/i.test(t.tok));
  let expo = '';
  if (ei >= 0) {
    const digitsBefore = toks.slice(0, ei).filter((t) => t.tok && /^[0#?]$/.test(t.tok)).length;
    const intDigits = Math.max(1, toks.slice(0, toks.findIndex((t) => t.tok === '.') < 0 ? ei : toks.findIndex((t) => t.tok === '.')).filter((t) => t.tok && /^[0#?]$/.test(t.tok)).length);
    void digitsBefore;
    let e = x === 0 ? 0 : Math.floor(Math.log10(x));
    e -= intDigits - 1;
    x = x / 10 ** e;
    const fracDigits = toks.slice(0, ei).filter((t, j) => t.tok && /^[0#?]$/.test(t.tok) && j > toks.findIndex((q) => q.tok === '.') && toks.findIndex((q) => q.tok === '.') >= 0).length;
    if (Number(x.toFixed(fracDigits)) >= 10 ** intDigits) { x /= 10; e++; }
    const spec = toks[ei].tok!;
    expo = `E${e < 0 ? '-' : spec[1] === '+' ? '+' : ''}${String(Math.abs(e)).padStart(spec.length - 2, '0')}`;
    toks = toks.slice(0, ei);
  }
  // trailing commas scale by 1000
  let last = -1;
  toks.forEach((t, i) => { if (t.tok && /^[0#?]$/.test(t.tok)) last = i; });
  let scale = 0;
  for (let i = last + 1; i < toks.length && toks[i].tok === ','; i++) { scale++; }
  x /= 1000 ** scale;
  const body = toks.filter((t, i) => !(scale && i > last && t.tok === ','));
  const dot = body.findIndex((t) => t.tok === '.');
  const isPh = (t: { tok?: string }) => !!t.tok && /^[0#?]$/.test(t.tok);
  const fracPh = dot < 0 ? [] : body.slice(dot + 1).filter(isPh);
  const grouping = body.slice(0, dot < 0 ? body.length : dot).some((t, i, a) => t.tok === ',' && a.slice(0, i).some(isPh) && a.slice(i + 1).some(isPh));
  const fixed = roundTo(x, fracPh.length);
  let [ip, fp = ''] = fixed.toFixed(fracPh.length).split('.');
  // fractional digits: drop trailing zeros that '#' allows
  const fr: string[] = [];
  fracPh.forEach((t, i) => fr.push(fp[i] ?? '0'));
  for (let i = fracPh.length - 1; i >= 0; i--) { if (fracPh[i].tok === '#' && fr[i] === '0') fr[i] = ''; else if (fracPh[i].tok === '?' && fr[i] === '0') fr[i] = ' '; else break; }
  // integer digits
  const intToks = body.slice(0, dot < 0 ? body.length : dot).filter((t) => !(t.tok === ','));
  const phCount = intToks.filter(isPh).length;
  const zeros = intToks.filter((t) => t.tok === '0').length;
  if (ip === '0' && zeros === 0) ip = '';
  if (ip.length < zeros) ip = ip.padStart(zeros, '0');
  let digits = ip.split('');
  if (grouping) {
    const g: string[] = []; digits.forEach((d, i) => { if (i > 0 && (digits.length - i) % 3 === 0) g.push(','); g.push(d); }); digits = g;
  }
  // pour the digits into the placeholders from the right; the first placeholder takes any extra on the left
  const out: string[] = [];
  let di = digits.length - 1;
  const pieces: string[] = [];
  let placed = 0;
  for (let i = intToks.length - 1; i >= 0; i--) {
    const t = intToks[i];
    if (isPh(t)) {
      placed++;
      if (placed === phCount) { pieces.unshift(digits.slice(0, di + 1).join('') || (t.tok === '?' ? ' ' : '')); di = -1; }
      else { let d = digits[di]; if (d === ',') { pieces.unshift(','); di--; d = digits[di]; } pieces.unshift(d === undefined ? (t.tok === '?' ? ' ' : '') : d); di--; }
    } else pieces.unshift(t.lit ?? (t.tok === '%' ? '%' : t.tok === '@' ? '' : t.tok ?? ''));
  }
  if (phCount === 0) pieces.push(...intToks.map((t) => t.lit ?? t.tok ?? ''));
  out.push(pieces.join(''));
  if (dot >= 0) {
    out.push(fr.some((c) => c !== '') || fracPh.some((t) => t.tok === '0') ? `.${fr.join('')}` : '');
    for (const t of body.slice(dot + 1)) if (!isPh(t)) out.push(t.lit ?? (t.tok === '%' ? '%' : t.tok ?? ''));
  }
  return (signed && v < 0 && Math.abs(Number(fixed)) > 0 ? '-' : '') + out.join('') + expo;
}

/** TEXT(): number and date formats ("0.00", "#,##0", "0%", "yyyy-mm-dd", "hh:mm AM/PM", "0.0E+00", "[h]:mm"). */
export function formatText(value: Scalar, fmt: string): string {
  if (value instanceof FormulaError) throw value;
  const secs = sections(fmt);
  if (typeof value === 'string') {
    const t = secs[3] ?? (secs.length === 1 && /@/.test(secs[0]) ? secs[0] : undefined);
    if (t === undefined) return value;
    return lex(t).map((k) => (k.lit !== undefined ? k.lit : k.tok === '@' ? value : k.tok ?? '')).join('');
  }
  const v = typeof value === 'boolean' ? (value ? 1 : 0) : value ?? 0;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  let sec = secs[0]; let signed = true;
  if (v < 0 && secs.length > 1) { sec = secs[1]; signed = false; }
  else if (v === 0 && secs.length > 2) sec = secs[2];
  if (/^\s*general\s*$/i.test(sec)) return numText(v);
  const toks = lex(sec);
  if (isDateFmt(toks)) return formatDate(v, toks);
  return formatNumberPattern(v, toks.map((t) => (t.tok === 'General' ? { lit: numText(Math.abs(v)) } : t)), signed);
}

// ---- text helpers ---------------------------------------------------------------------------------------------------------------------

const upperFirst = (t: string) => t.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
const startAt = (v: Scalar | undefined, len: number): number => { const k = v === undefined ? 1 : Math.floor(n(v)); if (k < 1 || k > len + 1) throw VALUE; return k - 1; };
function findIn(needle: string, hay: string, start: number, ci: boolean, wild: boolean): number {
  if (wild) return globIndex(needle, hay, start);
  spend(hay.length);
  return ci ? hay.toLowerCase().indexOf(needle.toLowerCase(), start) : hay.indexOf(needle, start);
}
const DOLLAR = (x: number, d: number) => { const r = roundTo(Math.abs(x), d); const t = r.toLocaleString('en-US', { minimumFractionDigits: Math.max(0, d), maximumFractionDigits: Math.max(0, d) }); return x < 0 ? `($${t})` : `$${t}`; };

/** The values of the args as text pieces, ranges flattened. */
const texts = (a: (V | undefined)[]): string[] => flatten(a).map((x) => (x === null ? '' : toStr(x)));

// ---- dates ------------------------------------------------------------------------------------------------------------------------------

const dateOf = (v: Scalar | undefined) => { const x = n(v); if (x < 0) throw NUM; return serialToDate(x); };
const eom = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function addMonths(serial: number, k: number): number {
  const d = serialToDate(serial);
  const t = d.m - 1 + k; const y = d.y + Math.floor(t / 12); const m = ((t % 12) + 12) % 12 + 1;
  return makeDate(y, m, Math.min(d.d, eom(y, m)));
}
function weekdayOf(serial: number): number { return serialToDate(serial).wd; }
function weekend(arg: Scalar | undefined): boolean[] {
  const w = new Array(7).fill(false);
  if (arg === undefined || arg === null) { w[0] = true; w[6] = true; return w; }
  if (typeof arg === 'string' && /^[01]{7}$/.test(arg)) { for (let i = 0; i < 7; i++) w[(i + 1) % 7] = arg[i] === '1'; return w; }
  const k = n(arg);
  if (k >= 1 && k <= 7) { w[k === 7 ? 0 : k === 1 ? 6 : k - 2] = true; w[k === 1 ? 0 : k === 7 ? 6 : k - 1] = true; return w; }
  if (k >= 11 && k <= 17) { w[k === 17 ? 6 : k - 10 === 7 ? 0 : k - 10] = true; return w; }
  throw NUM;
}
function holidays(v: V | undefined): Set<number> { return new Set(v === undefined ? [] : collectNumbers([v]).map(Math.floor)); }
function networkdays(a: number, b: number, w: boolean[], hol: Set<number>): number {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  if (hi - lo > 200000) throw NUM;
  let k = 0;
  for (let d = Math.floor(lo); d <= Math.floor(hi); d++) if (!w[weekdayOf(d)] && !hol.has(d)) k++;
  return a <= b ? k : -k;
}
function workday(start: number, days: number, w: boolean[], hol: Set<number>): number {
  if (w.every(Boolean)) throw VALUE;
  let d = Math.floor(start); let left = Math.abs(Math.trunc(days)); const step = days < 0 ? -1 : 1;
  while (left > 0) { d += step; if (!w[weekdayOf(d)] && !hol.has(d)) left--; }
  return d;
}
function days360(a: number, b: number, european: boolean): number {
  const x = serialToDate(a); const y = serialToDate(b);
  let d1 = x.d; let d2 = y.d;
  if (european) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
  else {
    const lastFeb = (d: { y: number; m: number; d: number }) => d.m === 2 && d.d === eom(d.y, 2);
    if (lastFeb(x) && lastFeb(y)) d2 = 30;
    if (lastFeb(x)) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  }
  return (y.y - x.y) * 360 + (y.m - x.m) * 30 + (d2 - d1);
}
function yearFrac(a: number, b: number, basis: number): number {
  if (a > b) [a, b] = [b, a];
  a = Math.floor(a); b = Math.floor(b);
  const x = serialToDate(a); const y = serialToDate(b);
  const leap = (yr: number) => (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
  switch (basis) {
    case 0: return days360(a, b, false) / 360;
    case 1: {
      if (x.y === y.y) return (b - a) / (leap(x.y) ? 366 : 365);
      let t = 0; for (let yr = x.y; yr <= y.y; yr++) t += leap(yr) ? 366 : 365;
      return (b - a) / (t / (y.y - x.y + 1));
    }
    case 2: return (b - a) / 360;
    case 3: return (b - a) / 365;
    case 4: return days360(a, b, true) / 360;
    default: throw NUM;
  }
}
function weeknum(serial: number, type: number): number {
  const d = serialToDate(serial);
  const jan1 = makeDate(d.y, 1, 1);
  if (type === 21) return isoWeek(serial);
  const startDay = type === 1 || type === 17 ? 0 : type === 2 || type === 11 ? 1 : type >= 12 && type <= 16 ? type - 10 : -1;
  if (startDay < 0) throw NUM;
  const offset = (weekdayOf(jan1) - startDay + 7) % 7;
  return Math.floor((serial - jan1 + offset) / 7) + 1;
}
function isoWeek(serial: number): number {
  const wd = (weekdayOf(serial) + 6) % 7; // Monday = 0
  const thursday = Math.floor(serial) - wd + 3;
  const ty = serialToDate(thursday).y;
  return Math.floor((thursday - makeDate(ty, 1, 1)) / 7) + 1;
}

// ---- the table -----------------------------------------------------------------------------------------------------------------------------

const info = (name: string, f: (v: V | undefined) => boolean): FnTable => ({ [name]: lazyFn(1, 1, (a) => { const v = tryV(a[0]); return mapInfo(v, f); }) });
function mapInfo(v: V, f: (x: V | undefined) => boolean): V {
  if (isArr(v) || (isRng(v) && isMulti(v))) return mat(v).map((row) => row.map((x) => f(x)));
  return f(isRng(v) ? v.sheet.cell(v.c0, v.r0) : v);
}

const IFS_ = lazyFn(2, 254, (a) => { if (a.length % 2) throw NA; for (let i = 0; i < a.length; i += 2) if (toBool(sc(a[i]()))) return a[i + 1](); throw NA; });

function cmpIf(cond: V, yes: () => V, no: (() => V) | undefined): V {
  if (!isMulti(cond)) return toBool(sc(cond)) ? yes() : no ? no() : false;
  const c = mat(cond); const y = mat(yes()); const nn = no ? mat(no()) : [[false]];
  return c.map((row, r) => row.map((x, k) => {
    try {
      const b = toBool(x instanceof FormulaError ? (() => { throw x; })() : x);
      const m = b ? y : nn;
      const v = m.length === 1 ? m[0][m[0].length === 1 ? 0 : k] : m[r]?.[m[0].length === 1 ? 0 : k];
      return v === undefined ? NA : v;
    } catch (e) { if (e instanceof FormulaError) return e; throw e; }
  }));
}

export const TEXT: FnTable = {
  // text
  CONCAT: rawFn(1, 255, (a) => capText(texts(a).join(''))),
  CONCATENATE: scalarFn(1, 255, (...a) => capText(a.map((x) => str(x)).join(''))),
  TEXTJOIN: rawFn(3, 255, (a) => {
    const delims = flatten([a[0]]).map(str); const skip = toBool(sc(a[1]));
    const parts = flatten(a.slice(2)).filter((x) => !(skip && (x === null || x === ''))).map((x) => (x === null ? '' : str(x)));
    return capText(parts.reduce((s, p, i) => (i === 0 ? p : s + delims[(i - 1) % delims.length] + p), ''));
  }),
  LEFT: S(1, 2, (t, k) => { const c = k === undefined ? 1 : Math.floor(n(k)); if (c < 0) throw VALUE; return str(t).slice(0, c); }),
  RIGHT: S(1, 2, (t, k) => { const s = str(t); const c = k === undefined ? 1 : Math.floor(n(k)); if (c < 0) throw VALUE; return c ? s.slice(-c) : ''; }),
  MID: S(3, 3, (t, st, k) => { const s = str(t); const i = Math.floor(n(st)); const c = Math.floor(n(k)); if (i < 1 || c < 0) throw VALUE; return s.slice(i - 1, i - 1 + c); }),
  LEN: S(1, 1, (t) => [...str(t)].length),
  LENB: S(1, 1, (t) => new TextEncoder().encode(str(t)).length),
  FIND: S(2, 3, (f, t, st) => { const s = str(t); const i = findIn(str(f), s, startAt(st, s.length), false, false); if (i < 0) throw VALUE; return i + 1; }),
  SEARCH: S(2, 3, (f, t, st) => { const s = str(t); const needle = str(f); const i = findIn(needle, s, startAt(st, s.length), true, hasWildcard(needle)); if (i < 0) throw VALUE; return i + 1; }),
  REPLACE: S(4, 4, (t, st, k, r) => { const s = str(t); const i = Math.floor(n(st)); const c = Math.floor(n(k)); if (i < 1 || c < 0) throw VALUE; return capText(s.slice(0, i - 1) + str(r) + s.slice(i - 1 + c)); }),
  SUBSTITUTE: S(3, 4, (t, o, w, inst) => {
    const s = str(t); const old = str(o); const nw = str(w);
    if (old === '') return s;
    if (inst === undefined) return capText(s.split(old).join(nw));
    const k = Math.floor(n(inst)); if (k < 1) throw VALUE;
    let pos = -1; for (let i = 0; i < k; i++) { pos = s.indexOf(old, pos + 1); if (pos < 0) return s; }
    return capText(s.slice(0, pos) + nw + s.slice(pos + old.length));
  }),
  UPPER: S(1, 1, (t) => str(t).toUpperCase()),
  LOWER: S(1, 1, (t) => str(t).toLowerCase()),
  PROPER: S(1, 1, (t) => upperFirst(str(t))),
  TRIM: S(1, 1, (t) => str(t).replace(/^ +| +$/g, '').replace(/ {2,}/g, ' ')),
  CLEAN: S(1, 1, (t) => str(t).replace(/[\x00-\x1f]/g, '')),
  EXACT: S(2, 2, (a, b) => str(a) === str(b)),
  REPT: S(2, 2, (t, k) => { const c = Math.floor(n(k)); if (c < 0) throw VALUE; const s = str(t); if (s.length * c > 10000) throw VALUE; return s.repeat(c); }),
  TEXT: S(2, 2, (v, f) => formatText(v === undefined ? null : v, str(f))),
  VALUE: S(1, 1, (t) => { if (typeof t === 'number') return t; const r = parseNumberText(str(t)); if (r === null) throw VALUE; return r; }),
  NUMBERVALUE: S(1, 3, (t, dec, grp) => {
    const d = dec === undefined ? '.' : str(dec); const g = grp === undefined ? ',' : str(grp);
    let s = str(t).replace(/\s/g, '').split(g).join('');
    let pct = 0; while (s.endsWith('%')) { s = s.slice(0, -1); pct++; }
    if (d !== '.') s = s.replace(d, '.');
    if (s === '') return 0;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) throw VALUE;
    return Number(s) / 100 ** pct;
  }),
  CHAR: S(1, 1, (x) => { const k = Math.floor(n(x)); if (k < 1 || k > 255) throw VALUE; return String.fromCharCode(k); }),
  CODE: S(1, 1, (t) => { const s = str(t); if (!s) throw VALUE; return s.charCodeAt(0); }),
  UNICHAR: S(1, 1, (x) => { const k = Math.floor(n(x)); if (k < 1 || k > 0x10ffff || (k >= 0xd800 && k < 0xe000)) throw VALUE; return String.fromCodePoint(k); }),
  UNICODE: S(1, 1, (t) => { const s = str(t); if (!s) throw VALUE; return s.codePointAt(0)!; }),
  T: S(1, 1, (v) => (typeof v === 'string' ? v : '')),
  FIXED: S(1, 3, (x, d, nc) => { const dec = d === undefined ? 2 : Math.trunc(n(d)); const r = roundTo(n(x), dec); const t = (Math.abs(r)).toLocaleString('en-US', { useGrouping: !(nc !== undefined && toBool(nc)), minimumFractionDigits: Math.max(0, dec), maximumFractionDigits: Math.max(0, dec) }); return (r < 0 ? '-' : '') + t; }),
  DOLLAR: S(1, 2, (x, d) => DOLLAR(n(x), d === undefined ? 2 : Math.trunc(n(d)))),
  TEXTBEFORE: S(2, 6, (t, dl, inst, mode, _ms, nf) => { const r = split(str(t), str(dl), inst === undefined ? 1 : n(inst), mode === undefined ? 0 : n(mode), true); if (r === null) { if (nf !== undefined) return nf; throw NA; } return r; }),
  TEXTAFTER: S(2, 6, (t, dl, inst, mode, _ms, nf) => { const r = split(str(t), str(dl), inst === undefined ? 1 : n(inst), mode === undefined ? 0 : n(mode), false); if (r === null) { if (nf !== undefined) return nf; throw NA; } return r; }),
  TEXTSPLIT: rawFn(2, 6, (a) => {
    const text = str(sc(a[0])); const cd = a[1] === undefined ? [] : flatten([a[1]]).map(str).filter(Boolean); const rd = a[2] === undefined ? [] : flatten([a[2]]).map(str).filter(Boolean);
    const skip = a[3] !== undefined && toBool(sc(a[3])); const ci = a[4] !== undefined && n(sc(a[4])) === 1; const pad: Scalar = a[5] === undefined ? NA : sc(a[5]);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const splitBy = (s: string, ds: string[]) => (ds.length ? s.split(new RegExp(ds.map(esc).join('|'), ci ? 'i' : '')) : [s]);
    let rows = splitBy(text, rd).map((r) => splitBy(r, cd));
    if (skip) rows = rows.map((r) => r.filter((x) => x !== '')).filter((r) => r.length);
    const w = Math.max(...rows.map((r) => r.length));
    return rows.map((r) => [...r, ...new Array(w - r.length).fill(pad)] as Scalar[]);
  }),
  VALUETOTEXT: S(1, 2, (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? numText(v) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v))),
  ARRAYTOTEXT: rawFn(1, 2, (a) => capText(mat(a[0]).map((row) => row.map((x) => (isErr(x) ? x.message : x === null ? '' : typeof x === 'string' ? x : str(x))).join(', ')).join('; '))),
  HYPERLINK: scalarFn(1, 2, (u, f) => (f === undefined ? str(u) : f)),

  // logic
  IF: lazyFn(2, 3, (a) => cmpIf(a[0](), a[1], a[2])),
  IFS: IFS_,
  IFERROR: lazyFn(2, 2, (a) => { const v = tryV(a[0]); if (isErr(v)) return a[1](); if (isArr(v) || (isRng(v) && isMulti(v))) { const m = mat(v); if (m.flat().some(isErr)) { const alt = mat(a[1]()); return m.map((row, r) => row.map((x, c) => (isErr(x) ? alt[r % alt.length][c % alt[0].length] : x))); } } return v; }),
  IFNA: lazyFn(2, 2, (a) => { const v = tryV(a[0]); return isErr(v) && v.message === '#N/A' ? a[1]() : v; }),
  SWITCH: lazyFn(3, 254, (a) => {
    const x = sc(a[0]());
    let i = 1;
    for (; i + 1 < a.length; i += 2) if (same(x, sc(a[i]()))) return a[i + 1]();
    if (i < a.length) return a[i]();
    throw NA;
  }),
  CHOOSE: lazyFn(2, 255, (a) => { const k = Math.floor(n(sc(a[0]()))); if (k < 1 || k >= a.length) throw VALUE; return a[k](); }),
  AND: rawFn(1, 255, (a) => logic(a, (x, y) => x && y, true)),
  OR: rawFn(1, 255, (a) => logic(a, (x, y) => x || y, false)),
  XOR: rawFn(1, 255, (a) => logic(a, (x, y) => x !== y, false)),
  NOT: S(1, 1, (x) => !toBool(x)),
  TRUE: rawFn(0, 0, () => true),
  FALSE: rawFn(0, 0, () => false),
  NA: rawFn(0, 0, () => NA),

  // information
  ...info('ISBLANK', (v) => v === null || v === undefined),
  ...info('ISNUMBER', (v) => typeof v === 'number'),
  ...info('ISTEXT', (v) => typeof v === 'string'),
  ...info('ISNONTEXT', (v) => typeof v !== 'string'),
  ...info('ISLOGICAL', (v) => typeof v === 'boolean'),
  ...info('ISERROR', (v) => isErr(v)),
  ...info('ISERR', (v) => isErr(v) && v.message !== '#N/A'),
  ...info('ISNA', (v) => isErr(v) && v.message === '#N/A'),
  ISEVEN: S(1, 1, (x) => Math.floor(Math.abs(n(x))) % 2 === 0),
  ISODD: S(1, 1, (x) => Math.floor(Math.abs(n(x))) % 2 === 1),
  ISREF: lazyFn(1, 1, (a) => isRng(tryV(a[0]))),
  ISFORMULA: lazyFn(1, 1, (a) => { const v = a[0](); return isRng(v) && v.sheet.isFormula(v.c0, v.r0); }),
  N: S(1, 1, (v) => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 0)),
  TYPE: lazyFn(1, 1, (a) => { const v = tryV(a[0]); if (isErr(v)) return 16; if (isArr(v)) return 64; const x = isRng(v) ? (isMulti(v) ? [] : v.sheet.cell(v.c0, v.r0)) : v; return Array.isArray(x) ? 64 : typeof x === 'string' ? 2 : typeof x === 'boolean' ? 4 : isErr(x) ? 16 : 1; }),
  'ERROR.TYPE': lazyFn(1, 1, (a) => { const v = tryV(a[0]); const codes = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A']; if (!isErr(v)) throw NA; const i = codes.indexOf(v.message); if (i < 0) throw NA; return i + 1; }),
  SHEET: rawFn(0, 1, (a, x) => { if (a[0] === undefined) return 1; if (isRng(a[0])) return 1; const s = x.sheets(str(sc(a[0]))); if (!s) throw NA; return 1; }),
  SHEETS: rawFn(0, 1, () => 1),

  // dates and times
  TODAY: rawFn(0, 0, (_a, x) => Math.floor(serialNow(x.now))),
  NOW: rawFn(0, 0, (_a, x) => serialNow(x.now)),
  DATE: S(3, 3, (y, m, d) => { const v = makeDate(Math.trunc(n(y)), Math.trunc(n(m)), Math.trunc(n(d))); if (v < 0) throw NUM; return v; }),
  TIME: S(3, 3, (h, m, s) => { const t = (Math.trunc(n(h)) * 3600 + Math.trunc(n(m)) * 60 + Math.trunc(n(s))) / 86400; if (t < 0) throw NUM; return t - Math.floor(t); }),
  YEAR: S(1, 1, (v) => dateOf(v).y),
  MONTH: S(1, 1, (v) => dateOf(v).m),
  DAY: S(1, 1, (v) => dateOf(v).d),
  HOUR: S(1, 1, (v) => dateOf(v).h),
  MINUTE: S(1, 1, (v) => dateOf(v).mi),
  SECOND: S(1, 1, (v) => dateOf(v).s),
  WEEKDAY: S(1, 2, (v, t) => { const wd = dateOf(v).wd; const type = t === undefined ? 1 : n(t); if (type === 1) return wd + 1; if (type === 2) return ((wd + 6) % 7) + 1; if (type === 3) return (wd + 6) % 7; if (type >= 11 && type <= 17) return ((wd - (type - 10) % 7 + 7) % 7) + 1; throw NUM; }),
  WEEKNUM: S(1, 2, (v, t) => weeknum(n(v), t === undefined ? 1 : n(t))),
  ISOWEEKNUM: S(1, 1, (v) => isoWeek(n(v))),
  DATEVALUE: S(1, 1, (t) => { const d = parseDateText(str(t).trim()); if (d === null) throw VALUE; return Math.floor(d); }),
  TIMEVALUE: S(1, 1, (t) => { const d = parseDateText(str(t).trim()); if (d === null) throw VALUE; return d - Math.floor(d); }),
  EDATE: S(2, 2, (s, k) => addMonths(Math.floor(n(s)), Math.trunc(n(k)))),
  EOMONTH: S(2, 2, (s, k) => { const d = serialToDate(addMonths(Math.floor(n(s)), Math.trunc(n(k)))); return makeDate(d.y, d.m, eom(d.y, d.m)); }),
  DAYS: S(2, 2, (e, s) => Math.floor(n(e)) - Math.floor(n(s))),
  DAYS360: S(2, 3, (s, e, m) => days360(n(s), n(e), m !== undefined && toBool(m))),
  YEARFRAC: S(2, 3, (s, e, b) => yearFrac(n(s), n(e), b === undefined ? 0 : Math.trunc(n(b)))),
  DATEDIF: S(3, 3, (s, e, u) => {
    const a = Math.floor(n(s)); const b = Math.floor(n(e));
    if (a > b) throw NUM;
    const x = serialToDate(a); const y = serialToDate(b);
    let months = (y.y - x.y) * 12 + y.m - x.m; if (y.d < x.d) months--;
    switch (str(u).toUpperCase()) {
      case 'Y': return Math.floor(months / 12);
      case 'M': return months;
      case 'D': return b - a;
      case 'MD': { let d = y.d - x.d; if (d < 0) d += eom(y.m === 1 ? y.y - 1 : y.y, y.m === 1 ? 12 : y.m - 1); return d; }
      case 'YM': return ((months % 12) + 12) % 12;
      case 'YD': { let ref = makeDate(y.y, x.m, Math.min(x.d, eom(y.y, x.m))); if (ref > b) ref = makeDate(y.y - 1, x.m, Math.min(x.d, eom(y.y - 1, x.m))); return b - ref; }
      default: throw NUM;
    }
  }),
  NETWORKDAYS: rawFn(2, 3, (a) => networkdays(n(sc(a[0])), n(sc(a[1])), weekend(undefined), holidays(a[2]))),
  'NETWORKDAYS.INTL': rawFn(2, 4, (a) => networkdays(n(sc(a[0])), n(sc(a[1])), weekend(a[2] === undefined ? undefined : sc(a[2])), holidays(a[3]))),
  WORKDAY: rawFn(2, 3, (a) => workday(n(sc(a[0])), n(sc(a[1])), weekend(undefined), holidays(a[2]))),
  'WORKDAY.INTL': rawFn(2, 4, (a) => workday(n(sc(a[0])), n(sc(a[1])), weekend(a[2] === undefined ? undefined : sc(a[2])), holidays(a[3]))),
};

function split(text: string, delim: string, inst: number, mode: number, before: boolean): string | null {
  if (delim === '') return before ? '' : text;
  const hay = mode ? text.toLowerCase() : text; const d = mode ? delim.toLowerCase() : delim;
  let pos = -1;
  if (inst > 0) { for (let i = 0; i < inst; i++) { pos = hay.indexOf(d, pos + 1); if (pos < 0) return null; } }
  else if (inst < 0) { pos = hay.length; for (let i = 0; i < -inst; i++) { pos = hay.lastIndexOf(d, pos - 1); if (pos < 0) return null; } }
  else throw VALUE;
  return before ? text.slice(0, pos) : text.slice(pos + delim.length);
}
function logic(a: (V | undefined)[], f: (x: boolean, y: boolean) => boolean, init: boolean): boolean {
  let acc: boolean | undefined; let seen = false;
  for (const v of a) {
    if (v === undefined) continue;
    const items = isRng(v) || isArr(v) ? mat(v).flat().filter((x) => typeof x !== 'string' && x !== null) : [v];
    for (const x of items) {
      if (isErr(x)) throw x;
      if (!(isRng(v) || isArr(v)) && typeof x === 'string' && !/^(true|false)$/i.test(x.trim())) throw VALUE;
      seen = true;
      const b = toBool(x as Scalar);
      acc = acc === undefined ? b : f(acc, b);
    }
  }
  if (!seen) throw VALUE;
  return acc ?? init;
}

export { compare, criterion, errorOf, REF, DIV0, Rng };
export type { Arr };
