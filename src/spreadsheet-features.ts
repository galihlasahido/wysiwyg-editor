/**
 * The extras of a sheet that are not cells: merged cells, conditional formats and charts. Their shapes, the cleaning of what comes
 * from outside (a file, JSON, a paste), how a range follows when rows or columns are inserted or deleted, and how a conditional
 * format is worked out for a cell. No DOM.
 */
import { shiftFormula } from './grid-formulas';
import { cleanChart, parseNumber, specFromRows, CHART_COLORS, type ChartSpec, type ChartType } from './chart';
import type { Range } from './spreadsheet-model';

// ---- limits -----------------------------------------------------------------------------------------------------------------------

export const MAX_MERGES = 2000;
export const MAX_RULES = 100;
export const MAX_CHARTS = 50;
const MAX_SCAN = 250_000; // cells looked at to rank, average or scale a range

const COLOR = /^#[0-9a-f]{3,8}$/i;
const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : '');
const int = (v: unknown, lo: number, hi: number, d: number): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export function cleanRange(v: unknown, rows: number, cols: number): Range | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const r0 = int(o.r0, 0, rows - 1, -1); const c0 = int(o.c0, 0, cols - 1, -1); const r1 = int(o.r1, 0, rows - 1, -1); const c1 = int(o.c1, 0, cols - 1, -1);
  if (r0 < 0 || c0 < 0 || r1 < 0 || c1 < 0) return null;
  return { r0: Math.min(r0, r1), c0: Math.min(c0, c1), r1: Math.max(r0, r1), c1: Math.max(c0, c1) };
}

// ---- following inserted and deleted rows and columns ----------------------------------------------------------------------------

/** A range after `n` rows or columns were inserted at `at`, or deleted from `at`; null when nothing of it is left. */
export function adjustRange(r: Range, axis: 'row' | 'col', kind: 'insert' | 'delete', at: number, n: number): Range | null {
  const lo = axis === 'row' ? r.r0 : r.c0;
  const hi = axis === 'row' ? r.r1 : r.c1;
  let nlo: number; let nhi: number;
  if (kind === 'insert') { nlo = lo >= at ? lo + n : lo; nhi = hi >= at ? hi + n : hi; }
  else {
    const end = at + n - 1;
    nlo = lo >= at && lo <= end ? at : lo > end ? lo - n : lo;
    nhi = hi >= at && hi <= end ? at - 1 : hi > end ? hi - n : hi;
    if (nlo > nhi) return null;
  }
  return axis === 'row' ? { ...r, r0: nlo, r1: nhi } : { ...r, c0: nlo, c1: nhi };
}

export const inRange = (r: Range, row: number, col: number): boolean => row >= r.r0 && row <= r.r1 && col >= r.c0 && col <= r.c1;
export const overlaps = (a: Range, b: Range): boolean => a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;

// ---- conditional formats ----------------------------------------------------------------------------------------------------------

export interface CondStyle { color?: string; bg?: string; b?: 1; i?: 1; s?: 1 }
export type CellOp = '>' | '<' | '>=' | '<=' | '=' | '<>' | 'between' | 'notBetween';
export type TextOp = 'contains' | 'notContains' | 'begins' | 'ends';

export type CondRule = { range: Range } & (
  | { type: 'cell'; op: CellOp; a: string; b?: string; style: CondStyle }
  | { type: 'text'; op: TextOp; text: string; style: CondStyle }
  | { type: 'blank' | 'notBlank' | 'error' | 'duplicate' | 'unique'; style: CondStyle }
  | { type: 'rank'; n: number; bottom?: 1; percent?: 1; style: CondStyle }
  | { type: 'average'; above: 1 | 0; style: CondStyle }
  | { type: 'formula'; formula: string; style: CondStyle }
  | { type: 'scale'; colors: string[] }
  | { type: 'bar'; color: string }
);

const CELL_OPS: CellOp[] = ['>', '<', '>=', '<=', '=', '<>', 'between', 'notBetween'];
const TEXT_OPS: TextOp[] = ['contains', 'notContains', 'begins', 'ends'];

export function cleanCondStyle(s: unknown): CondStyle {
  const o = (s && typeof s === 'object' ? s : {}) as Record<string, unknown>;
  const out: CondStyle = {};
  if (typeof o.color === 'string' && COLOR.test(o.color)) out.color = o.color;
  if (typeof o.bg === 'string' && COLOR.test(o.bg)) out.bg = o.bg;
  if (o.b) out.b = 1;
  if (o.i) out.i = 1;
  if (o.s) out.s = 1;
  return out;
}

export function cleanRule(v: unknown, rows: number, cols: number): CondRule | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const range = cleanRange(o.range, rows, cols);
  if (!range) return null;
  const style = cleanCondStyle(o.style);
  switch (o.type) {
    case 'cell': return CELL_OPS.includes(o.op as CellOp) && typeof o.a === 'string' ? { type: 'cell', range, op: o.op as CellOp, a: str(o.a, 200), ...(typeof o.b === 'string' ? { b: str(o.b, 200) } : {}), style } : null;
    case 'text': return TEXT_OPS.includes(o.op as TextOp) && typeof o.text === 'string' ? { type: 'text', range, op: o.op as TextOp, text: str(o.text, 200), style } : null;
    case 'blank': case 'notBlank': case 'error': case 'duplicate': case 'unique': return { type: o.type, range, style };
    case 'rank': return { type: 'rank', range, n: int(o.n, 1, 1000, 10), ...(o.bottom ? { bottom: 1 as const } : {}), ...(o.percent ? { percent: 1 as const } : {}), style };
    case 'average': return { type: 'average', range, above: o.above === 0 || o.above === false ? 0 : 1, style };
    case 'formula': return typeof o.formula === 'string' && o.formula.trim() ? { type: 'formula', range, formula: str(o.formula, 500).replace(/^\s*=?/, '='), style } : null;
    case 'scale': {
      const colors = (Array.isArray(o.colors) ? o.colors : []).filter((c): c is string => typeof c === 'string' && COLOR.test(c)).slice(0, 3);
      return colors.length >= 2 ? { type: 'scale', range, colors } : null;
    }
    case 'bar': return { type: 'bar', range, color: typeof o.color === 'string' && COLOR.test(o.color) ? o.color : '#638ec6' };
    default: return null;
  }
}

/** What the formatting of a cell needs from the sheet. */
export interface CondHost {
  /** The value (a number, text, a boolean or an error code) and whether the cell is empty. */
  value(r: number, c: number): number | string | boolean;
  text(r: number, c: number): string;
  blank(r: number, c: number): boolean;
  error(r: number, c: number): boolean;
  /** Evaluate formula text as if it stood in this cell. */
  formula(src: string, r: number, c: number): number | string | boolean;
  /** The last row and column that hold anything, so a rule over a whole column scans no further. */
  used(): { row: number; col: number };
}

export interface CondResult { style: CondStyle; bar?: { pct: number; color: string } }

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hex = (c: string): [number, number, number] => {
  const h = c.slice(1);
  const f = h.length === 3 || h.length === 4 ? [...h.slice(0, 3)].map((x) => x + x).join('') : h.slice(0, 6);
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
};
const mix = (a: string, b: string, t: number): string => {
  const x = hex(a); const y = hex(b);
  return `#${[0, 1, 2].map((i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0')).join('')}`;
};

interface Agg { nums: number[]; min: number; max: number; mean: number; counts?: Map<string, number>; threshold?: number }

/** Works out the conditional formatting of cells; keeps what it learns about a range until you make a new one (after every change). */
export class CondEngine {
  private agg = new Map<CondRule, Agg>();
  constructor(private host: CondHost) {}

  private aggregate(rule: CondRule, wantCounts = false): Agg {
    const hit = this.agg.get(rule);
    if (hit && (!wantCounts || hit.counts)) return hit;
    const u = this.host.used();
    const r1 = Math.min(rule.range.r1, u.row); const c1 = Math.min(rule.range.c1, u.col);
    const nums: number[] = []; const counts = wantCounts ? new Map<string, number>() : undefined;
    let seen = 0;
    scan: for (let r = rule.range.r0; r <= r1; r++) for (let c = rule.range.c0; c <= c1; c++) {
      if (++seen > MAX_SCAN) break scan;
      if (this.host.blank(r, c)) continue;
      const v = this.host.value(r, c);
      if (num(v)) nums.push(v);
      if (counts) { const k = this.host.text(r, c).toLowerCase(); counts.set(k, (counts.get(k) ?? 0) + 1); }
    }
    const sorted = [...nums].sort((a, b) => a - b);
    const a: Agg = { nums: sorted, min: sorted[0] ?? 0, max: sorted[sorted.length - 1] ?? 0, mean: nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : 0, counts };
    if (rule.type === 'rank' && sorted.length) {
      const n = rule.percent ? Math.max(1, Math.ceil((sorted.length * Math.min(100, rule.n)) / 100)) : Math.min(sorted.length, rule.n);
      a.threshold = rule.bottom ? sorted[n - 1] : sorted[sorted.length - n];
    }
    this.agg.set(rule, a);
    return a;
  }

  /** The formatting for one cell: the first rule that sets a property wins, as in Excel's order. */
  compute(rules: CondRule[], r: number, c: number): CondResult | null {
    let out: CondResult | null = null;
    for (const rule of rules) {
      if (!inRange(rule.range, r, c)) continue;
      const res = this.one(rule, r, c);
      if (!res) continue;
      out ??= { style: {} };
      const s = res.style;
      if (s.color && !out.style.color) out.style.color = s.color;
      if (s.bg && !out.style.bg) out.style.bg = s.bg;
      if (s.b) out.style.b = 1;
      if (s.i) out.style.i = 1;
      if (s.s) out.style.s = 1;
      if (res.bar && !out.bar) out.bar = res.bar;
    }
    return out;
  }

  private one(rule: CondRule, r: number, c: number): CondResult | null {
    const h = this.host;
    switch (rule.type) {
      case 'blank': return h.blank(r, c) ? { style: rule.style } : null;
      case 'notBlank': return !h.blank(r, c) ? { style: rule.style } : null;
      case 'error': return h.error(r, c) ? { style: rule.style } : null;
      case 'cell': {
        if (h.blank(r, c) && rule.op !== '=' && rule.op !== '<>') return null;
        if (h.error(r, c)) return null;
        const v = h.value(r, c);
        const a = parseNumber(rule.a); const b = rule.b === undefined ? NaN : parseNumber(rule.b);
        let ok: boolean;
        if (num(v) && !Number.isNaN(a)) {
          switch (rule.op) {
            case '>': ok = v > a; break; case '<': ok = v < a; break; case '>=': ok = v >= a; break; case '<=': ok = v <= a; break;
            case '=': ok = v === a; break; case '<>': ok = v !== a; break;
            case 'between': ok = !Number.isNaN(b) && v >= Math.min(a, b) && v <= Math.max(a, b); break;
            default: ok = !Number.isNaN(b) && (v < Math.min(a, b) || v > Math.max(a, b));
          }
        } else {
          const x = h.text(r, c).toLowerCase(); const y = rule.a.toLowerCase(); const z = (rule.b ?? '').toLowerCase();
          switch (rule.op) {
            case '=': ok = x === y; break; case '<>': ok = x !== y; break; case '>': ok = x > y; break; case '<': ok = x < y; break;
            case '>=': ok = x >= y; break; case '<=': ok = x <= y; break;
            case 'between': ok = x >= y && x <= z; break;
            default: ok = x < y || x > z;
          }
        }
        return ok ? { style: rule.style } : null;
      }
      case 'text': {
        const x = h.text(r, c).toLowerCase(); const t = rule.text.toLowerCase();
        if (!t) return null;
        const ok = rule.op === 'contains' ? x.includes(t) : rule.op === 'notContains' ? !x.includes(t) : rule.op === 'begins' ? x.startsWith(t) : x.endsWith(t);
        return ok ? { style: rule.style } : null;
      }
      case 'duplicate': case 'unique': {
        if (h.blank(r, c)) return null;
        const n = this.aggregate(rule, true).counts!.get(h.text(r, c).toLowerCase()) ?? 0;
        return (rule.type === 'duplicate' ? n > 1 : n === 1) ? { style: rule.style } : null;
      }
      case 'rank': {
        if (h.blank(r, c)) return null;
        const v = h.value(r, c); const a = this.aggregate(rule);
        return num(v) && a.threshold !== undefined && (rule.bottom ? v <= a.threshold : v >= a.threshold) ? { style: rule.style } : null;
      }
      case 'average': {
        if (h.blank(r, c)) return null;
        const v = h.value(r, c); const a = this.aggregate(rule);
        return num(v) && (rule.above ? v > a.mean : v < a.mean) ? { style: rule.style } : null;
      }
      case 'formula': {
        let v: number | string | boolean;
        try { v = h.formula(shiftFormula(rule.formula, c - rule.range.c0, r - rule.range.r0), r, c); } catch { return null; }
        return v === true || (num(v) && v !== 0) ? { style: rule.style } : null;
      }
      case 'scale': {
        if (h.blank(r, c)) return null;
        const v = h.value(r, c); const a = this.aggregate(rule);
        if (!num(v)) return null;
        const span = a.max - a.min;
        const t = span === 0 ? 0.5 : (v - a.min) / span;
        const cs = rule.colors;
        const bg = cs.length === 2 ? mix(cs[0], cs[1], t) : t < 0.5 ? mix(cs[0], cs[1], t * 2) : mix(cs[1], cs[2], (t - 0.5) * 2);
        return { style: { bg } };
      }
      case 'bar': {
        if (h.blank(r, c)) return null;
        const v = h.value(r, c); const a = this.aggregate(rule);
        if (!num(v)) return null;
        const lo = Math.min(0, a.min); const hi = Math.max(0, a.max);
        const pct = hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
        return { style: {}, bar: { pct, color: rule.color } };
      }
    }
  }
}

// ---- charts ---------------------------------------------------------------------------------------------------------------------------

export type SheetChartType = ChartType;

export interface ChartDef {
  id: string;
  type: ChartType;
  /** The cells the chart reads: the first row names the series and the first column the labels (when they are text). */
  range: Range;
  title: string;
  /** Where it sits on the sheet and how big it is, in pixels at 100% zoom. */
  x: number; y: number; w: number; h: number;
}

export const CHART_TYPES: { id: ChartType; label: string }[] = [{ id: 'bar', label: 'Column' }, { id: 'line', label: 'Line' }, { id: 'pie', label: 'Pie' }];
let chartSeq = 0;
export const newChartId = (): string => `ch${Date.now().toString(36)}${(chartSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export function cleanChartDef(v: unknown, rows: number, cols: number): ChartDef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const range = cleanRange(o.range, rows, cols);
  if (!range) return null;
  const px = (n: unknown, lo: number, hi: number, d: number) => { const x = Number(n); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, Math.round(x))) : d; };
  return {
    id: typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : newChartId(),
    type: o.type === 'line' || o.type === 'pie' ? o.type : 'bar',
    range, title: str(o.title, 120),
    x: px(o.x, 0, 2_000_000, 0), y: px(o.y, 0, 2_000_000, 0), w: px(o.w, 160, 2000, 480), h: px(o.h, 120, 1600, 300),
  };
}

const isNum = (t: string): boolean => !Number.isNaN(parseNumber(t));

/** The chart's data from the text of its cells (what the sheet shows). Null when there is nothing numeric to draw. */
export function chartSpecFrom(grid: string[][], type: ChartType, title: string): ChartSpec | null {
  if (!grid.length || !grid[0].length) return null;
  const rows = grid.length; const cols = grid[0].length;
  if (cols >= 2 && rows >= 2) {
    const firstColText = grid.slice(1).some((r) => r[0] !== '' && !isNum(r[0]));
    const headerText = grid[0].slice(1).some((t) => t !== '' && !isNum(t));
    if (headerText && (firstColText || !grid.slice(1).every((r) => isNum(r[0] ?? '')))) { const s = specFromRows(grid, type); return s ? cleanChart({ ...s, title }) : null; }
    if (headerText) { // numbers in the first column: a series of its own, labels are 1, 2, 3
      const header = grid[0];
      const body = grid.slice(1);
      return cleanChart({ type, title, labels: body.map((_, i) => String(i + 1)), series: header.map((n, c) => ({ name: n || `Series ${c + 1}`, values: body.map((r) => (isNum(r[c] ?? '') ? parseNumber(r[c]) : 0)) })) });
    }
  }
  // no header row: a first text column gives the labels, every other column is a series; one column of numbers is one series
  const labelCol = cols >= 2 && grid.some((r) => r[0] !== '' && !isNum(r[0]));
  const first = labelCol ? 1 : 0;
  const series = [];
  for (let c = first; c < cols; c++) series.push({ name: `Series ${c - first + 1}`, values: grid.map((r) => (isNum(r[c] ?? '') ? parseNumber(r[c]) : 0)) });
  if (!series.some((s) => s.values.some((x) => x !== 0))) return null;
  return cleanChart({ type, title, labels: grid.map((r, i) => (labelCol ? r[0] : String(i + 1))), series });
}

export { CHART_COLORS };
