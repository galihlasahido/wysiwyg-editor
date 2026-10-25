/**
 * The data of the spreadsheet, with no DOM: sheets and cells, styles, undo and redo, inserting and deleting rows and columns (formulas
 * follow), sorting, filling a series, filters, CSV and JSON. `spreadsheet-view.ts` draws it.
 */
import { serialToDate } from './formula-core';
import { CondEngine, adjustRange, cleanChartDef, cleanRule, inRange, newChartId, overlaps, MAX_CHARTS, MAX_MERGES, MAX_RULES, type ChartDef, type CondHost, type CondResult, type CondRule } from './spreadsheet-features';
import { chartSpecFrom } from './spreadsheet-features';
import type { ChartSpec, ChartType } from './chart';
import { asValue, cellRef, isErrorValue, colName, createEvaluator, mapFormulaRefs, parseCellRef, shiftFormula, type CellValue, type Evaluator, type RangeMove, type RefMove } from './grid-formulas';

export type NumFmt = 'general' | 'number' | 'currency' | 'percent' | 'date' | 'text';

export interface CellStyle {
  b?: 1; i?: 1; u?: 1; s?: 1;
  /** Text colour and fill colour (`#rrggbb`). */
  color?: string;
  bg?: string;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'middle' | 'bottom';
  wrap?: 1;
  fmt?: NumFmt;
  /** Digits after the point; without it a format picks its own. */
  dec?: number;
  /** Font size in points and family. */
  size?: number;
  font?: string;
  /** Borders: top, right, bottom, left. */
  bt?: 1; br?: 1; bb?: 1; bl?: 1;
}

export interface CellData { v?: string; s?: CellStyle }

export interface Range { r0: number; c0: number; r1: number; c1: number }

export interface FilterSpec {
  /** The header row; the filter covers the rows under it. */
  row: number;
  /** The last row the filter covers. */
  r1: number;
  c0: number;
  c1: number;
  /** For each column, the values (as displayed) that are hidden. */
  hide: Record<number, string[]>;
}

export interface SheetData {
  name: string;
  rows: number;
  cols: number;
  /** Cells by A1 name; only cells with a value or a style. */
  cells: Record<string, CellData>;
  colWidths?: Record<number, number>;
  rowHeights?: Record<number, number>;
  hiddenRows?: number[];
  freezeRows?: number;
  freezeCols?: number;
  filter?: FilterSpec | null;
  /** Merged cells, as `A1:C2`. */
  merges?: string[];
  /** Conditional formats. */
  cf?: CondRule[];
  charts?: ChartDef[];
}

export interface WorkbookData {
  sheets: SheetData[];
  active?: number;
  currency?: string;
}

export const DEFAULT_COL_W = 100;
export const DEFAULT_ROW_H = 24;
export const MAX_ROWS = 20000;
export const MAX_COLS = 702;

export const normRange = (r: Range): Range => ({ r0: Math.min(r.r0, r.r1), c0: Math.min(r.c0, r.c1), r1: Math.max(r.r0, r.r1), c1: Math.max(r.c0, r.c1) });
export const rangeRef = (r: Range): string => { const n = normRange(r); return n.r0 === n.r1 && n.c0 === n.c1 ? cellRef(n.c0, n.r0) : `${cellRef(n.c0, n.r0)}:${cellRef(n.c1, n.r1)}`; };
export function parseRangeRef(s: string): Range | null {
  const [a, b] = s.trim().split(':');
  const p = parseCellRef(a);
  const q = b === undefined ? p : parseCellRef(b);
  return p && q ? normRange({ r0: p.row, c0: p.col, r1: q.row, c1: q.col }) : null;
}

const key = (r: number, c: number) => `${r},${c}`;
const unkey = (k: string): [number, number] => { const i = k.indexOf(','); return [Number(k.slice(0, i)), Number(k.slice(i + 1))]; };

export class Sheet {
  name: string;
  rows: number;
  cols: number;
  cells = new Map<string, CellData>();
  colW = new Map<number, number>();
  rowH = new Map<number, number>();
  hidden = new Set<number>();
  freezeRows = 0;
  freezeCols = 0;
  filter: FilterSpec | null = null;
  merges: Range[] = [];
  cf: CondRule[] = [];
  charts: ChartDef[] = [];

  constructor(name: string, rows = 200, cols = 26) {
    this.name = name;
    this.rows = rows;
    this.cols = cols;
  }

  get(r: number, c: number): CellData | undefined { return this.cells.get(key(r, c)); }

  /** The last row and column that hold something (-1 when the sheet is empty). */
  used(): { row: number; col: number } {
    let row = -1; let col = -1;
    for (const k of this.cells.keys()) { const [r, c] = unkey(k); if (r > row) row = r; if (c > col) col = c; }
    return { row, col };
  }

  /** The merged area that holds this cell, if any. */
  mergeAt(r: number, c: number): Range | undefined {
    for (const m of this.merges) if (inRange(m, r, c)) return m;
    return undefined;
  }

  colWidth(c: number): number { return this.colW.get(c) ?? DEFAULT_COL_W; }
  rowHeight(r: number): number { return this.hidden.has(r) ? 0 : this.rowH.get(r) ?? DEFAULT_ROW_H; }

  toJSON(): SheetData {
    const cells: Record<string, CellData> = {};
    const list = [...this.cells.entries()].map(([k, v]) => ({ k: unkey(k), v })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]);
    for (const { k, v } of list) cells[cellRef(k[1], k[0])] = v;
    const out: SheetData = { name: this.name, rows: this.rows, cols: this.cols, cells };
    if (this.colW.size) out.colWidths = Object.fromEntries(this.colW);
    if (this.rowH.size) out.rowHeights = Object.fromEntries(this.rowH);
    if (this.hidden.size) out.hiddenRows = [...this.hidden].sort((a, b) => a - b);
    if (this.freezeRows) out.freezeRows = this.freezeRows;
    if (this.freezeCols) out.freezeCols = this.freezeCols;
    if (this.filter) out.filter = JSON.parse(JSON.stringify(this.filter));
    if (this.merges.length) out.merges = this.merges.map((m) => rangeRef(m));
    if (this.cf.length) out.cf = JSON.parse(JSON.stringify(this.cf));
    if (this.charts.length) out.charts = JSON.parse(JSON.stringify(this.charts));
    return out;
  }

  static fromJSON(d: SheetData): Sheet {
    const rows = Math.max(1, Math.min(MAX_ROWS, Math.floor(Number(d.rows)) || 200));
    const cols = Math.max(1, Math.min(MAX_COLS, Math.floor(Number(d.cols)) || 26));
    const s = new Sheet(typeof d.name === 'string' && d.name ? d.name.slice(0, 60) : 'Sheet', rows, cols);
    for (const [ref, cell] of Object.entries(d.cells ?? {})) {
      const p = parseCellRef(ref);
      if (!p || p.row >= MAX_ROWS || p.col >= MAX_COLS || !cell || typeof cell !== 'object') continue;
      const clean = cleanCell(cell);
      if (clean) {
        s.cells.set(key(p.row, p.col), clean);
        if (p.row >= s.rows) s.rows = p.row + 1;
        if (p.col >= s.cols) s.cols = p.col + 1;
      }
    }
    for (const [k, v] of Object.entries(d.colWidths ?? {})) if (Number.isFinite(Number(v)) && Number(v) >= 0) s.colW.set(Number(k), Math.min(2000, Number(v)));
    for (const [k, v] of Object.entries(d.rowHeights ?? {})) if (Number.isFinite(Number(v)) && Number(v) >= 0) s.rowH.set(Number(k), Math.min(2000, Number(v)));
    for (const r of d.hiddenRows ?? []) if (Number.isInteger(r) && r >= 0 && r < s.rows) s.hidden.add(r);
    s.freezeRows = Math.max(0, Math.min(s.rows - 1, Math.floor(Number(d.freezeRows)) || 0));
    s.freezeCols = Math.max(0, Math.min(s.cols - 1, Math.floor(Number(d.freezeCols)) || 0));
    if (d.filter && typeof d.filter === 'object') {
      const f = d.filter;
      if ([f.row, f.c0, f.c1].every((n) => Number.isInteger(n) && n >= 0)) {
        const r1 = Number.isInteger(f.r1) && f.r1 >= f.row ? f.r1 : f.row;
        const hide: Record<number, string[]> = {};
        for (const [k, v] of Object.entries(f.hide ?? {})) if (Array.isArray(v)) hide[Number(k)] = v.map(String);
        s.filter = { row: f.row, r1, c0: f.c0, c1: f.c1, hide };
      }
    }
    // merged cells, conditional formats and charts: each one checked, none may overlap or point outside the sheet
    for (const ref of Array.isArray(d.merges) ? d.merges.slice(0, MAX_MERGES) : []) {
      const m = typeof ref === 'string' ? parseRangeRef(ref) : null;
      if (m && m.r1 < s.rows && m.c1 < s.cols && (m.r0 !== m.r1 || m.c0 !== m.c1) && !s.merges.some((x) => overlaps(x, m))) s.merges.push(m);
    }
    for (const r of Array.isArray(d.cf) ? d.cf.slice(0, MAX_RULES) : []) { const rule = cleanRule(r, s.rows, s.cols); if (rule) s.cf.push(rule); }
    const ids = new Set<string>();
    for (const ch of Array.isArray(d.charts) ? d.charts.slice(0, MAX_CHARTS) : []) {
      const c = cleanChartDef(ch, s.rows, s.cols);
      if (c) { if (ids.has(c.id)) c.id = newChartId(); ids.add(c.id); s.charts.push(c); }
    }
    return s;
  }
}

const COLOR = /^#[0-9a-f]{3,8}$/i;
const FMTS: NumFmt[] = ['general', 'number', 'currency', 'percent', 'date', 'text'];

/** A cell from outside (a file, a paste, JSON): only known fields with sane values survive. */
export function cleanCell(c: CellData): CellData | undefined {
  const out: CellData = {};
  if (c.v !== undefined && c.v !== null && String(c.v) !== '') out.v = String(c.v).slice(0, 32000);
  const s = c.s;
  if (s && typeof s === 'object') {
    const t: CellStyle = {};
    for (const f of ['b', 'i', 'u', 's', 'wrap', 'bt', 'br', 'bb', 'bl'] as const) if (s[f]) t[f] = 1;
    if (typeof s.color === 'string' && COLOR.test(s.color)) t.color = s.color;
    if (typeof s.bg === 'string' && COLOR.test(s.bg)) t.bg = s.bg;
    if (s.align === 'left' || s.align === 'center' || s.align === 'right') t.align = s.align;
    if (s.valign === 'top' || s.valign === 'middle' || s.valign === 'bottom') t.valign = s.valign;
    if (s.fmt && FMTS.includes(s.fmt) && s.fmt !== 'general') t.fmt = s.fmt;
    if (Number.isInteger(s.dec) && s.dec! >= 0 && s.dec! <= 10) t.dec = s.dec;
    if (Number.isFinite(s.size) && s.size! >= 6 && s.size! <= 96) t.size = s.size;
    if (typeof s.font === 'string' && /^[\w \-,\x27\x22]{1,80}$/.test(s.font)) t.font = s.font;
    if (Object.keys(t).length) out.s = t;
  }
  return out.v === undefined && !out.s ? undefined : out;
}

interface Meta { name: string; rows: number; cols: number; colW: [number, number][]; rowH: [number, number][]; hidden: number[]; freezeRows: number; freezeCols: number; filter: FilterSpec | null; merges: Range[]; cf: CondRule[]; charts: ChartDef[] }
type Change =
  | { k: 'cell'; sheet: Sheet; key: string; before: CellData | undefined; after: CellData | undefined }
  | { k: 'cells'; sheet: Sheet; before: Map<string, CellData>; after: Map<string, CellData>; metaBefore: Meta; metaAfter: Meta }
  | { k: 'meta'; sheet: Sheet; before: Meta; after: Meta }
  | { k: 'sheets'; before: Sheet[]; after: Sheet[]; activeBefore: number; activeAfter: number };
interface Step { label: string; changes: Change[] }

const metaOf = (s: Sheet): Meta => ({ name: s.name, rows: s.rows, cols: s.cols, colW: [...s.colW], rowH: [...s.rowH], hidden: [...s.hidden], freezeRows: s.freezeRows, freezeCols: s.freezeCols, filter: s.filter ? JSON.parse(JSON.stringify(s.filter)) : null, merges: s.merges.map((m) => ({ ...m })), cf: JSON.parse(JSON.stringify(s.cf)), charts: JSON.parse(JSON.stringify(s.charts)) });
const applyMeta = (s: Sheet, m: Meta) => {
  s.name = m.name; s.rows = m.rows; s.cols = m.cols;
  s.colW = new Map(m.colW); s.rowH = new Map(m.rowH); s.hidden = new Set(m.hidden);
  s.freezeRows = m.freezeRows; s.freezeCols = m.freezeCols;
  s.filter = m.filter ? JSON.parse(JSON.stringify(m.filter)) : null;
  s.merges = m.merges.map((x) => ({ ...x })); s.cf = JSON.parse(JSON.stringify(m.cf)); s.charts = JSON.parse(JSON.stringify(m.charts));
};

export interface ChangeEvent {
  /** What happened: an edit, `'undo'`, `'redo'`, or a structural change. */
  label: string;
  /** The sheet that changed, when it is one. */
  sheet: Sheet | null;
}

export interface WorkbookOptions { currency?: string; locale?: string; maxHistory?: number }

/** Digits, grouping and the currency symbol come from `Intl`. */
export function formatNumber(n: number, s: CellStyle | undefined, o: { currency: string; locale?: string }): string {
  const fmt = s?.fmt ?? 'general';
  const loc = o.locale;
  if (fmt === 'number') { const d = s?.dec ?? 2; return n.toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d }); }
  if (fmt === 'currency') {
    const d = s?.dec ?? 2;
    try { return n.toLocaleString(loc, { style: 'currency', currency: o.currency, minimumFractionDigits: d, maximumFractionDigits: d }); } catch { return `${o.currency} ${n.toFixed(d)}`; }
  }
  if (fmt === 'percent') { const d = s?.dec ?? 0; return `${(n * 100).toLocaleString(loc, { minimumFractionDigits: d, maximumFractionDigits: d })}%`; }
  if (s?.dec !== undefined) return n.toLocaleString(loc, { minimumFractionDigits: s.dec, maximumFractionDigits: s.dec });
  const r = Math.round(n * 1e10) / 1e10;
  if (Math.abs(r) >= 1e15 || (r !== 0 && Math.abs(r) < 1e-9)) return r.toExponential(6).replace(/\.?0+e/, 'e');
  return String(r);
}

export class Workbook {
  sheets: Sheet[] = [];
  active = 0;
  currency: string;
  locale?: string;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private open: Step | null = null;
  private depth = 0;
  private maxHistory: number;
  private evals = new Map<Sheet, Evaluator>();
  /** The cells being calculated, across every sheet, so a loop between sheets is found. */
  private evalScope = new Set<string>();
  private listeners = new Set<(e: ChangeEvent) => void>();

  constructor(data?: WorkbookData | null, o: WorkbookOptions = {}) {
    this.currency = o.currency ?? 'USD';
    this.locale = o.locale;
    this.maxHistory = o.maxHistory ?? 200;
    this.load(data);
  }

  /** Replace everything. The history starts again. */
  load(data?: WorkbookData | null): void {
    const list = Array.isArray(data?.sheets) ? data!.sheets.slice(0, 100) : [];
    this.sheets = list.length ? list.map((d) => Sheet.fromJSON(d)) : [new Sheet('Sheet1')];
    this.active = Math.max(0, Math.min(this.sheets.length - 1, Math.floor(Number(data?.active)) || 0));
    if (typeof data?.currency === 'string' && /^[A-Za-z]{3}$/.test(data.currency)) this.currency = data.currency.toUpperCase();
    this.undoStack = []; this.redoStack = []; this.open = null; this.depth = 0; this.evals.clear(); this.evalScope.clear(); this.conds.clear();
    this.emit({ label: 'load', sheet: null });
  }

  toJSON(): WorkbookData { return { sheets: this.sheets.map((s) => s.toJSON()), active: this.active, currency: this.currency }; }

  get sheet(): Sheet { return this.sheets[this.active]; }

  on(fn: (e: ChangeEvent) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(e: ChangeEvent) { this.evals.clear(); this.evalScope.clear(); this.conds.clear(); for (const fn of [...this.listeners]) { try { fn(e); } catch (err) { console.error('Spreadsheet listener failed', err); } } }

  // ---- history

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  /** Group everything `fn` changes into one undo step. */
  transact<T>(label: string, fn: () => T, sheet: Sheet | null = this.sheet): T {
    if (this.depth === 0) this.open = { label, changes: [] };
    this.depth++;
    try { return fn(); } finally {
      this.depth--;
      if (this.depth === 0) {
        const step = this.open!;
        this.open = null;
        if (step.changes.length) {
          this.undoStack.push(step);
          if (this.undoStack.length > this.maxHistory) this.undoStack.shift();
          this.redoStack = [];
          this.emit({ label, sheet });
        }
      }
    }
  }

  private record(c: Change) { (this.open ?? (() => { throw new Error('Change outside transact'); })()).changes.push(c); }

  private apply(c: Change, undo: boolean) {
    if (c.k === 'cell') { const v = undo ? c.before : c.after; if (v) c.sheet.cells.set(c.key, v); else c.sheet.cells.delete(c.key); }
    else if (c.k === 'cells') { c.sheet.cells = undo ? c.before : c.after; applyMeta(c.sheet, undo ? c.metaBefore : c.metaAfter); }
    else if (c.k === 'meta') applyMeta(c.sheet, undo ? c.before : c.after);
    else { this.sheets = [...(undo ? c.before : c.after)]; this.active = Math.max(0, Math.min(this.sheets.length - 1, undo ? c.activeBefore : c.activeAfter)); }
  }

  undo(): boolean {
    const step = this.undoStack.pop();
    if (!step) return false;
    for (let i = step.changes.length - 1; i >= 0; i--) this.apply(step.changes[i], true);
    this.redoStack.push(step);
    this.emit({ label: 'undo', sheet: null });
    return true;
  }

  redo(): boolean {
    const step = this.redoStack.pop();
    if (!step) return false;
    for (const c of step.changes) this.apply(c, false);
    this.undoStack.push(step);
    this.emit({ label: 'redo', sheet: null });
    return true;
  }

  // ---- reading

  private evaluator(sheet: Sheet): Evaluator {
    let ev = this.evals.get(sheet);
    if (!ev) {
      ev = createEvaluator((c, r) => (r < 0 || c < 0 || r >= sheet.rows || c >= sheet.cols ? undefined : sheet.cells.get(key(r, c))?.v ?? ''), [sheet.cols, sheet.rows], {
        name: sheet.name,
        scope: this.evalScope,
        sheets: (name) => { const o = this.sheets.find((x) => x.name.toLowerCase() === name.toLowerCase()); return o ? this.evaluator(o).sheet : undefined; },
        scan: (visit) => { for (const [k, d] of sheet.cells) if (d.v?.trimStart().startsWith('=')) { const [r, c] = unkey(k); visit(c, r, d.v); } },
      });
      this.evals.set(sheet, ev);
    }
    return ev;
  }

  raw(sheet: Sheet, r: number, c: number): string { return sheet.cells.get(key(r, c))?.v ?? ''; }
  style(sheet: Sheet, r: number, c: number): CellStyle { return sheet.cells.get(key(r, c))?.s ?? {}; }
  value(sheet: Sheet, r: number, c: number): CellValue { return this.evaluator(sheet).value(c, r); }
  error(sheet: Sheet, r: number, c: number): string | null { return this.evaluator(sheet).error(c, r); }

  /** What the cell shows: its value in the cell's number format. */
  display(sheet: Sheet, r: number, c: number): { text: string; number: boolean; error: boolean } {
    const raw = this.raw(sheet, r, c);
    const style = this.style(sheet, r, c);
    let v: CellValue;
    if (raw === '') {
      const sp = this.evaluator(sheet).spilled(c, r);
      if (sp === undefined) return { text: '', number: false, error: false };
      if (isErrorValue(sp)) return { text: sp as string, number: false, error: true };
      v = sp;
    } else {
      const err = this.error(sheet, r, c);
      if (err) return { text: err, number: false, error: true };
      v = style.fmt === 'text' && !raw.trim().startsWith('=') ? raw : this.value(sheet, r, c);
    }
    if (typeof v === 'number') {
      if (style.fmt === 'date') {
        const d = serialToDate(v);
        if (v >= 1 && d.y > 1) return { text: new Date(d.y, d.m - 1, d.d).toLocaleDateString(this.locale, { year: 'numeric', month: 'short', day: 'numeric' }), number: false, error: false };
      }
      return { text: formatNumber(v, style, { currency: this.currency, locale: this.locale }), number: true, error: false };
    }
    if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', number: false, error: false };
    if (style.fmt === 'date' && /^\d{4}-\d{2}-\d{2}/.test(v)) {
      const d = new Date(v.length === 10 ? `${v}T00:00:00` : v);
      if (!Number.isNaN(d.getTime())) return { text: d.toLocaleDateString(this.locale, { year: 'numeric', month: 'short', day: 'numeric' }), number: false, error: false };
    }
    return { text: v, number: false, error: false };
  }

  /** The value a formula elsewhere spills into this empty cell, or undefined. */
  spilled(sheet: Sheet, r: number, c: number): boolean { return this.evaluator(sheet).spilled(c, r) !== undefined; }

  // ---- editing cells

  private setCell(sheet: Sheet, r: number, c: number, data: CellData | undefined) {
    const k = key(r, c);
    const before = sheet.cells.get(k);
    const clean = data ? cleanCell(data) : undefined;
    if (before === clean || (before && clean && before.v === clean.v && JSON.stringify(before.s) === JSON.stringify(clean.s))) return;
    this.growTo(sheet, r + 1, c + 1);
    if (clean) sheet.cells.set(k, clean); else sheet.cells.delete(k);
    this.record({ k: 'cell', sheet, key: k, before, after: clean });
  }

  private growTo(sheet: Sheet, rows: number, cols: number) {
    if ((rows > sheet.rows || cols > sheet.cols) && this.open) {
      const before = metaOf(sheet);
      sheet.rows = Math.min(MAX_ROWS, Math.max(sheet.rows, rows));
      sheet.cols = Math.min(MAX_COLS, Math.max(sheet.cols, cols));
      this.record({ k: 'meta', sheet, before, after: metaOf(sheet) });
    }
  }

  /** Make room so that row `rows - 1` and column `cols - 1` exist. */
  ensureSize(sheet: Sheet, rows: number, cols: number): void {
    if (rows <= sheet.rows && cols <= sheet.cols) return;
    this.transact('resize', () => this.growTo(sheet, rows, cols), sheet);
  }

  /** What typing `text` into a cell stores: a number for "12%" or "$1,200", the formula as typed, else the text. */
  parseInput(text: string, style: CellStyle | undefined): { v: string; fmt?: NumFmt } {
    const t = text.trim();
    if (t.startsWith('=')) return { v: t };
    if (style?.fmt === 'text') return { v: text };
    let m = /^(-?\d+(?:[.,]\d+)?|-?\d{1,3}(?:,\d{3})+(?:\.\d+)?)\s*%$/.exec(t);
    if (m) { const n = Number(m[1].replace(/,(?=\d{3})/g, '').replace(',', '.')) / 100; return { v: String(Math.round(n * 1e12) / 1e12), fmt: style?.fmt && style.fmt !== 'general' ? undefined : 'percent' }; }
    m = /^[$€£¥]\s?(-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)$/.exec(t);
    if (m) return { v: m[1].replace(/,/g, ''), fmt: style?.fmt && style.fmt !== 'general' ? undefined : 'currency' };
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) return { v: t.replace(/,/g, '') };
    return { v: text };
  }

  /** The person typed `text` into a cell. */
  input(sheet: Sheet, r: number, c: number, text: string): void {
    this.transact('edit', () => this.putInput(sheet, r, c, text), sheet);
  }

  private putInput(sheet: Sheet, r: number, c: number, text: string) {
    if (r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) return;
    const cur = sheet.cells.get(key(r, c));
    const p = this.parseInput(text, cur?.s);
    const s = p.fmt ? { ...(cur?.s ?? {}), fmt: p.fmt } : cur?.s;
    this.setCell(sheet, r, c, { v: p.v === '' ? undefined : p.v, s });
  }

  /** Put a block of text (from a paste of plain text) with its top-left corner at `r`, `c`. */
  pasteText(sheet: Sheet, r: number, c: number, grid: string[][]): Range {
    const rows = grid.length;
    const cols = Math.max(0, ...grid.map((g) => g.length));
    this.transact('paste', () => { grid.forEach((row, i) => row.forEach((t, j) => this.putInput(sheet, r + i, c + j, t))); }, sheet);
    return { r0: r, c0: c, r1: r + Math.max(0, rows - 1), c1: c + Math.max(0, cols - 1) };
  }

  /** Cells of a range as copied: their data, for pasting with the styles and for moving formulas. */
  copyCells(sheet: Sheet, range: Range): (CellData | undefined)[][] {
    const n = normRange(range);
    const out: (CellData | undefined)[][] = [];
    for (let r = n.r0; r <= n.r1; r++) {
      const row: (CellData | undefined)[] = [];
      for (let c = n.c0; c <= n.c1; c++) { const d = sheet.cells.get(key(r, c)); row.push(d ? { v: d.v, s: d.s ? { ...d.s } : undefined } : undefined); }
      out.push(row);
    }
    return out;
  }

  /** Paste copied cells at `r`, `c`: formulas move with the cells, styles come along. `what` limits it to values or formats. */
  pasteCells(sheet: Sheet, r: number, c: number, cells: (CellData | undefined)[][], from: { r: number; c: number }, what: 'all' | 'values' | 'formats' = 'all'): Range {
    const rows = cells.length;
    const cols = Math.max(0, ...cells.map((x) => x.length));
    this.transact('paste', () => {
      cells.forEach((row, i) => row.forEach((d, j) => {
        const tr = r + i; const tc = c + j;
        if (tr >= MAX_ROWS || tc >= MAX_COLS) return;
        const cur = sheet.cells.get(key(tr, tc));
        const v = d?.v !== undefined && d.v.trim().startsWith('=') ? shiftFormula(d.v, tc - (from.c + j), tr - (from.r + i)) : d?.v;
        if (what === 'values') this.setCell(sheet, tr, tc, { v, s: cur?.s });
        else if (what === 'formats') this.setCell(sheet, tr, tc, { v: cur?.v, s: d?.s });
        else this.setCell(sheet, tr, tc, d ? { v, s: d.s } : undefined);
      }));
    }, sheet);
    return { r0: r, c0: c, r1: r + Math.max(0, rows - 1), c1: c + Math.max(0, cols - 1) };
  }

  /** Remove what is in the range: its values, its formats, or both. */
  clear(sheet: Sheet, range: Range, what: 'all' | 'values' | 'formats' = 'values'): void {
    const n = normRange(range);
    this.transact('clear', () => {
      for (const k of [...sheet.cells.keys()]) {
        const [r, c] = unkey(k);
        if (r < n.r0 || r > n.r1 || c < n.c0 || c > n.c1) continue;
        const d = sheet.cells.get(k)!;
        this.setCell(sheet, r, c, what === 'all' ? undefined : what === 'values' ? { v: undefined, s: d.s } : { v: d.v });
      }
    }, sheet);
  }

  /** Change the style of every cell in the range. A field set to `undefined` is removed. */
  patchStyle(sheet: Sheet, range: Range, patch: Partial<Record<keyof CellStyle, unknown>> | ((cell: CellStyle, r: number, c: number) => Partial<Record<keyof CellStyle, unknown>>)): void {
    const n = normRange(range);
    const rows = Math.min(n.r1, sheet.rows - 1);
    const cols = Math.min(n.c1, sheet.cols - 1);
    // a whole column or row is not turned into thousands of empty styled cells: only the cells that exist and, for a small range, the empty ones
    const area = (rows - n.r0 + 1) * (cols - n.c0 + 1);
    this.transact('format', () => {
      const apply = (r: number, c: number) => {
        const cur = sheet.cells.get(key(r, c));
        const p = typeof patch === 'function' ? patch(cur?.s ?? {}, r, c) : patch;
        const s: Record<string, unknown> = { ...(cur?.s ?? {}) };
        for (const [f, v] of Object.entries(p)) { if (v === undefined || v === null || v === false || v === 0 && f !== 'dec') delete s[f]; else s[f] = v; }
        this.setCell(sheet, r, c, { v: cur?.v, s: s as CellStyle });
      };
      if (area <= 4000) { for (let r = n.r0; r <= rows; r++) for (let c = n.c0; c <= cols; c++) apply(r, c); }
      else for (const k of [...sheet.cells.keys()]) { const [r, c] = unkey(k); if (r >= n.r0 && r <= rows && c >= n.c0 && c <= cols) apply(r, c); }
    }, sheet);
  }

  /** The style of the first cell of the range (what the ribbon shows as "on"). */
  styleAt(sheet: Sheet, range: Range): CellStyle { const n = normRange(range); return this.style(sheet, n.r0, n.c0); }

  /** Set the borders of a range: `all`, `outer`, `none`, or one side. */
  setBorders(sheet: Sheet, range: Range, kind: 'all' | 'outer' | 'none' | 'top' | 'bottom' | 'left' | 'right'): void {
    const n = normRange(range);
    this.patchStyle(sheet, n, (_s, r, c) => {
      if (kind === 'none') return { bt: undefined, br: undefined, bb: undefined, bl: undefined };
      if (kind === 'all') return { bt: 1, br: 1, bb: 1, bl: 1 };
      const p: Record<string, unknown> = {};
      const outer = kind === 'outer';
      if ((outer || kind === 'top') && r === n.r0) p.bt = 1;
      if ((outer || kind === 'bottom') && r === n.r1) p.bb = 1;
      if ((outer || kind === 'left') && c === n.c0) p.bl = 1;
      if ((outer || kind === 'right') && c === n.c1) p.br = 1;
      return p;
    });
  }

  // ---- size, freeze, sheets

  private meta(sheet: Sheet, label: string, fn: () => void) {
    this.transact(label, () => { const before = metaOf(sheet); fn(); this.record({ k: 'meta', sheet, before, after: metaOf(sheet) }); }, sheet);
  }

  setColWidth(sheet: Sheet, c: number, w: number | null): void { this.meta(sheet, 'resize', () => { if (w === null || w === DEFAULT_COL_W) sheet.colW.delete(c); else sheet.colW.set(c, Math.max(12, Math.min(1000, Math.round(w)))); }); }
  setRowHeight(sheet: Sheet, r: number, h: number | null): void { this.meta(sheet, 'resize', () => { if (h === null || h === DEFAULT_ROW_H) sheet.rowH.delete(r); else sheet.rowH.set(r, Math.max(10, Math.min(600, Math.round(h)))); }); }
  setFreeze(sheet: Sheet, rows: number, cols: number): void { this.meta(sheet, 'freeze', () => { sheet.freezeRows = Math.max(0, Math.min(sheet.rows - 1, rows)); sheet.freezeCols = Math.max(0, Math.min(sheet.cols - 1, cols)); }); }
  hideRows(sheet: Sheet, r0: number, r1: number, hide: boolean): void { this.meta(sheet, hide ? 'hide' : 'unhide', () => { for (let r = r0; r <= r1; r++) { if (hide) sheet.hidden.add(r); else sheet.hidden.delete(r); } }); }

  addSheet(name?: string): Sheet {
    return this.transact('add sheet', () => {
      const before = [...this.sheets]; const activeBefore = this.active;
      let n = this.sheets.length + 1;
      const names = new Set(this.sheets.map((s) => s.name));
      let nm = name?.trim() || `Sheet${n}`;
      while (names.has(nm)) nm = `Sheet${++n}`;
      const s = new Sheet(nm.slice(0, 60));
      this.sheets.push(s);
      this.active = this.sheets.length - 1;
      this.record({ k: 'sheets', before, after: [...this.sheets], activeBefore, activeAfter: this.active });
      return s;
    }, null);
  }

  deleteSheet(sheet: Sheet): boolean {
    if (this.sheets.length <= 1) return false;
    this.transact('delete sheet', () => {
      const before = [...this.sheets]; const activeBefore = this.active;
      this.sheets = this.sheets.filter((s) => s !== sheet);
      this.active = Math.min(this.active, this.sheets.length - 1);
      this.record({ k: 'sheets', before, after: [...this.sheets], activeBefore, activeAfter: this.active });
    }, null);
    return true;
  }

  duplicateSheet(sheet: Sheet): Sheet {
    return this.transact('duplicate sheet', () => {
      const before = [...this.sheets]; const activeBefore = this.active;
      const copy = Sheet.fromJSON(sheet.toJSON());
      const names = new Set(this.sheets.map((s) => s.name));
      let nm = `${sheet.name} (2)`; let n = 2;
      while (names.has(nm)) nm = `${sheet.name} (${++n})`;
      copy.name = nm.slice(0, 60);
      this.sheets.splice(this.sheets.indexOf(sheet) + 1, 0, copy);
      this.active = this.sheets.indexOf(copy);
      this.record({ k: 'sheets', before, after: [...this.sheets], activeBefore, activeAfter: this.active });
      return copy;
    }, null);
  }

  renameSheet(sheet: Sheet, name: string): boolean {
    const nm = name.trim().slice(0, 60);
    if (!nm || this.sheets.some((s) => s !== sheet && s.name.toLowerCase() === nm.toLowerCase())) return false;
    this.meta(sheet, 'rename sheet', () => { sheet.name = nm; });
    return true;
  }

  setActive(i: number): void { const n = Math.max(0, Math.min(this.sheets.length - 1, i)); if (n !== this.active) { this.active = n; this.emit({ label: 'sheet', sheet: this.sheet }); } }

  // ---- structure

  /** Replace all cells at once (insert, delete, sort), with the formulas rewritten by `moveRef`. */
  private rebuild(sheet: Sheet, label: string, build: (put: (r: number, c: number, d: CellData) => void) => void, size?: { rows?: number; cols?: number }, after?: (s: Sheet) => void) {
    this.transact(label, () => {
      const metaBefore = metaOf(sheet);
      const before = sheet.cells;
      const next = new Map<string, CellData>();
      build((r, c, d) => { if (r >= 0 && c >= 0 && r < MAX_ROWS && c < MAX_COLS) next.set(key(r, c), d); });
      sheet.cells = next;
      if (size?.rows) sheet.rows = Math.max(1, Math.min(MAX_ROWS, size.rows));
      if (size?.cols) sheet.cols = Math.max(1, Math.min(MAX_COLS, size.cols));
      after?.(sheet);
      this.record({ k: 'cells', sheet, before, after: next, metaBefore, metaAfter: metaOf(sheet) });
    }, sheet);
  }

  private moveFormulas(d: CellData, ref: RefMove, range: RangeMove): CellData {
    return d.v !== undefined && d.v.trim().startsWith('=') ? { ...d, v: mapFormulaRefs(d.v, ref, range) } : d;
  }

  insertRows(sheet: Sheet, at: number, n = 1): void {
    if (sheet.rows + n > MAX_ROWS) return;
    const mv = (r: number) => (r >= at ? r + n : r);
    const ref: RefMove = (col, row) => ({ col, row: mv(row) });
    const range: RangeMove = (a, b) => [{ col: a.col, row: mv(a.row) }, { col: b.col, row: mv(b.row) }];
    this.rebuild(sheet, 'insert rows', (put) => { for (const [k, d] of sheet.cells) { const [r, c] = unkey(k); put(mv(r), c, this.moveFormulas(d, ref, range)); } }, { rows: sheet.rows + n }, (s) => {
      s.rowH = new Map([...s.rowH].map(([r, h]) => [mv(r), h]));
      s.hidden = new Set([...s.hidden].map(mv));
      if (s.freezeRows > at) s.freezeRows += n;
      if (s.filter) { if (s.filter.row >= at) s.filter.row += n; if (s.filter.r1 >= at) s.filter.r1 += n; }
      this.followRanges(s, 'row', 'insert', at, n);
    });
  }

  deleteRows(sheet: Sheet, at: number, n = 1): void {
    if (sheet.rows - n < 1) { this.clear(sheet, { r0: at, r1: at + n - 1, c0: 0, c1: sheet.cols - 1 }, 'all'); return; }
    const end = at + n - 1;
    const mv = (r: number) => (r > end ? r - n : r);
    const ref: RefMove = (col, row) => (row >= at && row <= end ? null : { col, row: mv(row) });
    const range: RangeMove = (a, b) => {
      const lo = Math.min(a.row, b.row); const hi = Math.max(a.row, b.row);
      const nlo = lo >= at && lo <= end ? at : mv(lo);
      const nhi = hi >= at && hi <= end ? at - 1 : mv(hi);
      if (nlo > nhi) return null;
      return a.row <= b.row ? [{ col: a.col, row: nlo }, { col: b.col, row: nhi }] : [{ col: a.col, row: nhi }, { col: b.col, row: nlo }];
    };
    this.rebuild(sheet, 'delete rows', (put) => { for (const [k, d] of sheet.cells) { const [r, c] = unkey(k); if (r >= at && r <= end) continue; put(mv(r), c, this.moveFormulas(d, ref, range)); } }, { rows: sheet.rows - n }, (s) => {
      s.rowH = new Map([...s.rowH].filter(([r]) => r < at || r > end).map(([r, h]) => [mv(r), h]));
      s.hidden = new Set([...s.hidden].filter((r) => r < at || r > end).map(mv));
      s.freezeRows = Math.min(s.freezeRows, s.rows - 1);
      if (s.filter) {
        const f = s.filter;
        if (f.row >= at && f.row <= end) s.filter = null;
        else {
          const deleted = f.r1 >= at ? Math.min(f.r1, end) - at + 1 : 0;
          if (f.row > end) f.row -= n;
          f.r1 = Math.max(f.row, f.r1 - deleted);
        }
      }
      this.followRanges(s, 'row', 'delete', at, n);
    });
  }

  insertCols(sheet: Sheet, at: number, n = 1): void {
    if (sheet.cols + n > MAX_COLS) return;
    const mv = (c: number) => (c >= at ? c + n : c);
    const ref: RefMove = (col, row) => ({ col: mv(col), row });
    const range: RangeMove = (a, b) => [{ col: mv(a.col), row: a.row }, { col: mv(b.col), row: b.row }];
    this.rebuild(sheet, 'insert columns', (put) => { for (const [k, d] of sheet.cells) { const [r, c] = unkey(k); put(r, mv(c), this.moveFormulas(d, ref, range)); } }, { cols: sheet.cols + n }, (s) => {
      s.colW = new Map([...s.colW].map(([c, w]) => [mv(c), w]));
      if (s.freezeCols > at) s.freezeCols += n;
      this.followRanges(s, 'col', 'insert', at, n);
      if (s.filter) { if (s.filter.c0 >= at) s.filter.c0 += n; if (s.filter.c1 >= at) s.filter.c1 += n; s.filter.hide = Object.fromEntries(Object.entries(s.filter.hide).map(([c, v]) => [mv(Number(c)), v])); }
    });
  }

  deleteCols(sheet: Sheet, at: number, n = 1): void {
    if (sheet.cols - n < 1) { this.clear(sheet, { r0: 0, r1: sheet.rows - 1, c0: at, c1: at + n - 1 }, 'all'); return; }
    const end = at + n - 1;
    const mv = (c: number) => (c > end ? c - n : c);
    const ref: RefMove = (col, row) => (col >= at && col <= end ? null : { col: mv(col), row });
    const range: RangeMove = (a, b) => {
      const lo = Math.min(a.col, b.col); const hi = Math.max(a.col, b.col);
      const nlo = lo >= at && lo <= end ? at : mv(lo);
      const nhi = hi >= at && hi <= end ? at - 1 : mv(hi);
      if (nlo > nhi) return null;
      return a.col <= b.col ? [{ col: nlo, row: a.row }, { col: nhi, row: b.row }] : [{ col: nhi, row: a.row }, { col: nlo, row: b.row }];
    };
    this.rebuild(sheet, 'delete columns', (put) => { for (const [k, d] of sheet.cells) { const [r, c] = unkey(k); if (c >= at && c <= end) continue; put(r, mv(c), this.moveFormulas(d, ref, range)); } }, { cols: sheet.cols - n }, (s) => {
      s.colW = new Map([...s.colW].filter(([c]) => c < at || c > end).map(([c, w]) => [mv(c), w]));
      s.freezeCols = Math.min(s.freezeCols, s.cols - 1);
      if (s.filter) s.filter = null;
      this.followRanges(s, 'col', 'delete', at, n);
    });
  }

  // ---- merged cells, conditional formats, charts

  /** Merges, rules and charts follow the cells when rows or columns are inserted or deleted. */
  private followRanges(s: Sheet, axis: 'row' | 'col', kind: 'insert' | 'delete', at: number, n: number) {
    const adj = (r: Range) => adjustRange(r, axis, kind, at, n);
    s.merges = s.merges.map(adj).filter((m): m is Range => !!m && (m.r0 !== m.r1 || m.c0 !== m.c1));
    s.cf = s.cf.map((rule) => { const r = adj(rule.range); return r ? { ...rule, range: r } : null; }).filter((x): x is CondRule => !!x);
    s.charts = s.charts.map((ch) => { const r = adj(ch.range); return r ? { ...ch, range: r } : null; }).filter((x): x is ChartDef => !!x);
  }

  /** The area a selection has to cover so no merged cell is cut in half. */
  expandToMerges(sheet: Sheet, range: Range): Range {
    let n = normRange(range);
    for (let again = true, guard = 0; again && guard < 50; guard++) {
      again = false;
      for (const m of sheet.merges) {
        if (!overlaps(m, n)) continue;
        const e = { r0: Math.min(n.r0, m.r0), c0: Math.min(n.c0, m.c0), r1: Math.max(n.r1, m.r1), c1: Math.max(n.c1, m.c1) };
        if (e.r0 !== n.r0 || e.c0 !== n.c0 || e.r1 !== n.r1 || e.c1 !== n.c1) { n = e; again = true; }
      }
    }
    return n;
  }

  /** Merge the cells of a range into one that keeps the value and format of the top left cell (the others are emptied). */
  mergeCells(sheet: Sheet, range: Range): boolean {
    const n = this.expandToMerges(sheet, range);
    if ((n.r0 === n.r1 && n.c0 === n.c1) || sheet.merges.length >= MAX_MERGES) return false;
    this.transact('merge', () => {
      const before = metaOf(sheet);
      for (const k of [...sheet.cells.keys()]) {
        const [r, c] = unkey(k);
        if (inRange(n, r, c) && !(r === n.r0 && c === n.c0)) this.setCell(sheet, r, c, undefined);
      }
      sheet.merges = [...sheet.merges.filter((m) => !overlaps(m, n)), n];
      this.record({ k: 'meta', sheet, before, after: metaOf(sheet) });
    }, sheet);
    return true;
  }

  /** Split every merged area that touches the range. */
  unmergeCells(sheet: Sheet, range: Range): boolean {
    const n = normRange(range);
    if (!sheet.merges.some((m) => overlaps(m, n))) return false;
    this.meta(sheet, 'unmerge', () => { sheet.merges = sheet.merges.filter((m) => !overlaps(m, n)); });
    return true;
  }

  addRule(sheet: Sheet, rule: unknown): boolean {
    const r = cleanRule(rule, sheet.rows, sheet.cols);
    if (!r || sheet.cf.length >= MAX_RULES) return false;
    this.meta(sheet, 'conditional format', () => { sheet.cf = [...sheet.cf, r]; });
    return true;
  }

  removeRule(sheet: Sheet, index: number): void {
    if (index < 0 || index >= sheet.cf.length) return;
    this.meta(sheet, 'remove rule', () => { sheet.cf = sheet.cf.filter((_, i) => i !== index); });
  }

  /** Remove the rules that touch the range (or all of them without one). */
  clearRules(sheet: Sheet, range?: Range): void {
    const n = range ? normRange(range) : null;
    if (!sheet.cf.some((r) => !n || overlaps(r.range, n))) return;
    this.meta(sheet, 'clear rules', () => { sheet.cf = n ? sheet.cf.filter((r) => !overlaps(r.range, n)) : []; });
  }

  private conds = new Map<Sheet, CondEngine>();
  /** The formatting conditional rules give a cell (colours, bold, a data bar), or null. */
  condFor(sheet: Sheet, r: number, c: number): CondResult | null {
    if (!sheet.cf.length) return null;
    let e = this.conds.get(sheet);
    if (!e) {
      const host: CondHost = {
        value: (rr, cc) => { const v = this.value(sheet, rr, cc); return v; },
        text: (rr, cc) => this.display(sheet, rr, cc).text,
        blank: (rr, cc) => this.raw(sheet, rr, cc) === '' && !this.evaluator(sheet).spilled(cc, rr),
        error: (rr, cc) => this.display(sheet, rr, cc).error,
        formula: (src, rr, cc) => this.evaluator(sheet).formula(src, cc, rr),
        used: () => sheet.used(),
      };
      e = new CondEngine(host);
      this.conds.set(sheet, e);
    }
    return e.compute(sheet.cf, r, c);
  }

  addChart(sheet: Sheet, def: { range: Range; type?: ChartType; title?: string; x: number; y: number; w?: number; h?: number }): ChartDef | null {
    if (sheet.charts.length >= MAX_CHARTS) return null;
    const c = cleanChartDef({ ...def, id: newChartId() }, sheet.rows, sheet.cols);
    if (!c) return null;
    this.meta(sheet, 'chart', () => { sheet.charts = [...sheet.charts, c]; });
    return c;
  }

  updateChart(sheet: Sheet, id: string, patch: Partial<Omit<ChartDef, 'id'>>, label = 'chart'): void {
    const i = sheet.charts.findIndex((c) => c.id === id);
    if (i < 0) return;
    const next = cleanChartDef({ ...sheet.charts[i], ...patch, id }, sheet.rows, sheet.cols);
    if (!next) return;
    this.meta(sheet, label, () => { sheet.charts = sheet.charts.map((c) => (c.id === id ? next : c)); });
  }

  removeChart(sheet: Sheet, id: string): void {
    if (!sheet.charts.some((c) => c.id === id)) return;
    this.meta(sheet, 'delete chart', () => { sheet.charts = sheet.charts.filter((c) => c.id !== id); });
  }

  /** The data of a chart as the chart library takes it. */
  chartSpec(sheet: Sheet, def: ChartDef): ChartSpec | null {
    const n = def.range;
    const grid: string[][] = [];
    for (let r = n.r0; r <= Math.min(n.r1, n.r0 + 499); r++) {
      const row: string[] = [];
      for (let c = n.c0; c <= Math.min(n.c1, n.c0 + 49); c++) row.push(this.display(sheet, r, c).text);
      grid.push(row);
    }
    return chartSpecFrom(grid, def.type, def.title);
  }

  // ---- sort, fill, filter

  /** Sort the rows of `range` by one column (`col` is a sheet column inside the range). With `header` the first row stays. */
  sortRange(sheet: Sheet, range: Range, col: number, ascending: boolean, header = false): void {
    const n = normRange(range);
    const first = header ? n.r0 + 1 : n.r0;
    if (first >= n.r1 || col < n.c0 || col > n.c1) return;
    const rows: { r: number; cells: (CellData | undefined)[]; key: CellValue }[] = [];
    for (let r = first; r <= n.r1; r++) {
      const cells: (CellData | undefined)[] = [];
      for (let c = n.c0; c <= n.c1; c++) cells.push(sheet.cells.get(key(r, c)));
      rows.push({ r, cells, key: this.raw(sheet, r, col) === '' ? '' : this.value(sheet, r, col) });
    }
    const cmp = (a: CellValue, b: CellValue) => {
      if (a === '' && b === '') return 0;
      if (a === '') return 1;                                  // blanks last, whichever way
      if (b === '') return -1;
      const an = typeof a === 'number'; const bn = typeof b === 'number';
      if (an && bn) return (a as number) - (b as number);
      if (an !== bn) return an ? -1 : 1;                       // numbers before text
      return String(a).localeCompare(String(b), this.locale, { numeric: true, sensitivity: 'base' });
    };
    const sorted = [...rows].sort((x, y) => (x.key === '' || y.key === '' ? cmp(x.key, y.key) : ascending ? cmp(x.key, y.key) : cmp(y.key, x.key)));
    this.transact('sort', () => {
      sorted.forEach((row, i) => {
        const target = first + i;
        row.cells.forEach((d, j) => {
          const v = d?.v !== undefined && d.v.trim().startsWith('=') ? shiftFormula(d.v, 0, target - row.r) : d?.v;
          this.setCell(sheet, target, n.c0 + j, d ? { v, s: d.s } : undefined);
        });
      });
    }, sheet);
  }

  /**
   * Fill `target` from the cells of `source` (which it should start at or touch): the series goes on (1, 2, 3 · Mon, Tue · Item 1, Item 2),
   * a single value is copied, formulas move like a copy would.
   */
  fill(sheet: Sheet, source: Range, target: Range): void {
    const s = normRange(source); const t = normRange(target);
    const vertical = t.c0 === s.c0 && t.c1 === s.c1 && (t.r0 > s.r1 || t.r1 < s.r0);
    const horizontal = t.r0 === s.r0 && t.r1 === s.r1 && (t.c0 > s.c1 || t.c1 < s.c0);
    if (!vertical && !horizontal) return;
    this.transact('fill', () => {
      const lines = vertical ? s.c1 - s.c0 + 1 : s.r1 - s.r0 + 1;
      for (let line = 0; line < lines; line++) {
        const src: (CellData | undefined)[] = [];
        if (vertical) for (let r = s.r0; r <= s.r1; r++) src.push(sheet.cells.get(key(r, s.c0 + line)));
        else for (let c = s.c0; c <= s.c1; c++) src.push(sheet.cells.get(key(s.r0 + line, c)));
        const forward = vertical ? t.r0 > s.r1 : t.c0 > s.c1;
        const count = vertical ? t.r1 - t.r0 + 1 : t.c1 - t.c0 + 1;
        const series = seriesFor(src.map((d) => d?.v ?? ''));
        for (let i = 0; i < count; i++) {
          const dist = forward ? i + 1 : -(count - i);                // steps from the source block
          const idx = forward ? src.length + i : -(count - i);
          const base = src[((idx % src.length) + src.length) % src.length];
          const pos = vertical ? (forward ? t.r0 + i : t.r0 + i) : (forward ? t.c0 + i : t.c0 + i);
          const r = vertical ? pos : s.r0 + line;
          const c = vertical ? s.c0 + line : pos;
          const fromR = vertical ? (s.r0 + ((idx % src.length) + src.length) % src.length) : s.r0 + line;
          const fromC = vertical ? s.c0 + line : s.c0 + (((idx % src.length) + src.length) % src.length);
          let v = base?.v;
          if (v !== undefined && v.trim().startsWith('=')) v = shiftFormula(v, c - fromC, r - fromR);
          else if (series) v = series(forward ? src.length + i : -(count - i));
          this.setCell(sheet, r, c, base || v !== undefined ? { v, s: base?.s } : undefined);
          void dist;
        }
      }
    }, sheet);
  }

  /** The distinct values of a column under a filter header, as displayed. */
  distinctValues(sheet: Sheet, col: number, fromRow: number, toRow: number): string[] {
    const seen = new Set<string>();
    for (let r = fromRow; r <= toRow; r++) seen.add(this.display(sheet, r, col).text);
    return [...seen].sort((a, b) => a.localeCompare(b, this.locale, { numeric: true }));
  }

  /** Turn a filter on for the columns of `range` (its first row is the header), or off. */
  setFilter(sheet: Sheet, range: Range | null): void {
    this.meta(sheet, 'filter', () => {
      const prev = sheet.filter;
      if (!range && prev) for (const r of [...sheet.hidden]) if (r > prev.row) sheet.hidden.delete(r);
      sheet.filter = range ? { row: normRange(range).r0, r1: normRange(range).r1, c0: normRange(range).c0, c1: normRange(range).c1, hide: {} } : null;
      this.refilter(sheet);
    });
  }

  /** Hide the rows whose value in `col` is one of `hidden` (empty list: show all). */
  setFilterValues(sheet: Sheet, col: number, hidden: string[]): void {
    this.meta(sheet, 'filter', () => {
      if (!sheet.filter) return;
      if (hidden.length) sheet.filter.hide[col] = hidden; else delete sheet.filter.hide[col];
      this.refilter(sheet);
    });
  }

  private refilter(sheet: Sheet) {
    const f = sheet.filter;
    // rows hidden by an earlier filter come back; rows hidden by hand are not told apart, so a filter owns every hidden row under its header
    if (f) for (const r of [...sheet.hidden]) if (r > f.row) sheet.hidden.delete(r);
    if (!f) return;
    for (let r = f.row + 1; r <= f.r1; r++) {
      for (const [c, values] of Object.entries(f.hide)) {
        if (values.includes(this.display(sheet, r, Number(c)).text)) { sheet.hidden.add(r); break; }
      }
    }
  }

  // ---- text in and out

  /**
   * The range as CSV. A text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return would be run as a formula when the file
   * is opened in Excel or Sheets (CSV injection), so such text gets a leading apostrophe; numbers are left alone. Pass
   * `{ safe: false }` for the raw cells (`values: false`) or when you know the reader.
   */
  toCSV(sheet: Sheet, range?: Range, o: { values?: boolean; separator?: string; safe?: boolean } = {}): string {
    const used = sheet.used();
    const n = range ? normRange(range) : { r0: 0, c0: 0, r1: Math.max(0, used.row), c1: Math.max(0, used.col) };
    const sep = o.separator ?? ',';
    const quote = (t: string) => (t.includes(sep) || /[\x22\n\r]/.test(t) || /^\s|\s$/.test(t) ? `"${t.replace(/\x22/g, '""')}"` : t);
    const lines: string[] = [];
    for (let r = n.r0; r <= n.r1; r++) {
      const row: string[] = [];
      for (let c = n.c0; c <= n.c1; c++) {
        if (o.values === false) { row.push(quote(this.raw(sheet, r, c))); continue; }
        const d = this.display(sheet, r, c);
        row.push(quote(o.safe !== false && !d.number && /^[=+\-@\t\r]/.test(d.text) ? `'${d.text}` : d.text));
      }
      lines.push(row.join(sep));
    }
    return lines.join('\n');
  }

  /** The cells of a range as tab-separated text (what goes on the clipboard). */
  toTSV(sheet: Sheet, range: Range): string {
    const n = normRange(range);
    const lines: string[] = [];
    for (let r = n.r0; r <= n.r1; r++) {
      const row: string[] = [];
      for (let c = n.c0; c <= n.c1; c++) { const t = this.display(sheet, r, c).text; row.push(/[\t\n\x22]/.test(t) ? `"${t.replace(/\x22/g, '""')}"` : t); }
      lines.push(row.join('\t'));
    }
    return lines.join('\n');
  }

  /** Put CSV text into a new sheet (or the given one, replacing what it holds). */
  /** What the last `importCSV` read: the rows it had, and whether rows or columns past the limits were left out. */
  lastImport = { rows: 0, truncated: false };

  importCSV(text: string, name = 'Imported', o: { separator?: string } = {}): Sheet {
    const grid = parseDelimited(text, o.separator ?? detectSeparator(text));
    this.lastImport = { rows: grid.length, truncated: grid.length > MAX_ROWS || grid.some((g) => g.length > MAX_COLS) };
    return this.transact('import', () => {
      const before = [...this.sheets]; const activeBefore = this.active;
      const names = new Set(this.sheets.map((s) => s.name));
      let nm = name; let n = 1;
      while (names.has(nm)) nm = `${name} ${++n}`;
      const s = new Sheet(nm.slice(0, 60), Math.max(100, Math.min(MAX_ROWS, grid.length + 20)), Math.max(26, Math.min(MAX_COLS, grid.reduce((m, g) => Math.max(m, g.length), 0) + 2)));
      grid.slice(0, MAX_ROWS).forEach((row, r) => row.slice(0, MAX_COLS).forEach((t, c) => {
        if (t === '') return;
        const p = this.parseInput(t, undefined);
        s.cells.set(key(r, c), cleanCell({ v: p.v, s: p.fmt ? { fmt: p.fmt } : undefined })!);
      }));
      this.sheets.push(s);
      this.active = this.sheets.length - 1;
      this.record({ k: 'sheets', before, after: [...this.sheets], activeBefore, activeAfter: this.active });
      return s;
    }, null);
  }

  /** The current sheet's first used column widths are guessed from the text (used by "autofit"). */
  autofitWidth(sheet: Sheet, c: number): number {
    let longest = 0;
    for (const k of sheet.cells.keys()) {
      const [r, cc] = unkey(k);
      if (cc !== c) continue;
      const s = sheet.cells.get(k)!.s;
      const t = this.display(sheet, r, c).text;
      const per = ((s?.size ?? 11) * 0.62) * (s?.b ? 1.08 : 1);
      longest = Math.max(longest, ...t.split('\n').map((line) => line.length * per));
    }
    return Math.max(40, Math.min(600, Math.round(longest + 18)));
  }

  /** Where Ctrl+arrow goes: to the end of the block of cells, or the next block, or the edge of the sheet. */
  jump(sheet: Sheet, r: number, c: number, dr: number, dc: number): { r: number; c: number } {
    const filled = (rr: number, cc: number) => this.raw(sheet, rr, cc) !== '';
    const inside = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr < sheet.rows && cc < sheet.cols;
    let rr = r + dr; let cc = c + dc;
    if (!inside(rr, cc)) return { r, c };
    if (filled(r, c) && filled(rr, cc)) { while (inside(rr + dr, cc + dc) && filled(rr + dr, cc + dc)) { rr += dr; cc += dc; } return { r: rr, c: cc }; }
    while (inside(rr, cc) && !filled(rr, cc)) { rr += dr; cc += dc; }
    if (!inside(rr, cc)) return { r: Math.max(0, Math.min(sheet.rows - 1, rr - dr)), c: Math.max(0, Math.min(sheet.cols - 1, cc - dc)) };
    return { r: rr, c: cc };
  }

  /** Sum, average and count of the numbers in a range (the status bar). */
  summary(sheet: Sheet, range: Range): { count: number; numbers: number; sum: number; min: number; max: number } {
    const n = normRange(range);
    let count = 0; let numbers = 0; let sum = 0; let min = Infinity; let max = -Infinity;
    for (const k of sheet.cells.keys()) {
      const [r, c] = unkey(k);
      if (r < n.r0 || r > n.r1 || c < n.c0 || c > n.c1 || this.raw(sheet, r, c) === '') continue;
      count++;
      const v = this.error(sheet, r, c) ? null : this.value(sheet, r, c);
      if (typeof v === 'number') { numbers++; sum += v; if (v < min) min = v; if (v > max) max = v; }
    }
    return { count, numbers, sum, min, max };
  }
}

// ---- helpers --------------------------------------------------------------------------------------------------------------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * A function that gives the value `i` steps after the first cell of a block (negative: before it), or null when the block is not a
 * series that goes on (then the block is repeated). Numbers need two or more cells to have a step; a list of names cycles; "Item 3"
 * counts up its number.
 */
export function seriesFor(vals: string[]): ((i: number) => string) | null {
  const first = vals[0] ?? '';
  if (vals.some((v) => v.trim().startsWith('='))) return null;
  const nums = vals.map((v) => (v.trim() !== '' && /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(v.trim()) ? Number(v) : NaN));
  if (vals.length >= 2 && nums.every((n) => !Number.isNaN(n))) {
    const step = nums[1] - nums[0];
    if (nums.every((n, i) => Math.abs(n - (nums[0] + step * i)) < 1e-9)) return (i) => String(Math.round((nums[0] + step * i) * 1e10) / 1e10);
    return null;
  }
  for (const list of [DAYS, DAYS_LONG, MONTHS, MONTHS_LONG]) {
    const idx = vals.map((v) => list.findIndex((x) => x.toLowerCase() === v.trim().toLowerCase()));
    if (idx.every((i) => i >= 0)) {
      const step = vals.length >= 2 ? (idx[1] - idx[0] + list.length) % list.length || 1 : 1;
      const style = (t: string) => (first === first.toUpperCase() && first.length > 1 ? t.toUpperCase() : first === first.toLowerCase() ? t.toLowerCase() : t);
      return (i) => style(list[(((idx[0] + step * i) % list.length) + list.length) % list.length]);
    }
  }
  const m = /^(.*?)(\d+)$/.exec(first);
  if (m && m[1] !== '' && vals.length === 1) { const w = m[2].length; return (i) => `${m[1]}${String(Math.max(0, Number(m[2]) + i)).padStart(w, '0')}`; }
  return null;
}

export function detectSeparator(text: string): string {
  const head = text.split('\n').slice(0, 5).join('\n');
  const count = (s: string) => (head.match(new RegExp(s === '\t' ? '\\t' : `\\${s}`, 'g')) ?? []).length;
  const c = { ',': count(','), ';': count(';'), '\t': count('\t') };
  return c['\t'] > 0 && c['\t'] >= c[','] && c['\t'] >= c[';'] ? '\t' : c[';'] > c[','] ? ';' : ',';
}

/** Split CSV / TSV text into rows of cells: quotes, doubled quotes and line breaks inside quotes are handled. */
export function parseDelimited(text: string, sep = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false; let i = 0;
  const src = text.replace(/^﻿/, '');
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i += 2; continue; } quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === sep) { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\n' || ch === '\r') { row.push(cell); rows.push(row); row = []; cell = ''; if (ch === '\r' && src[i + 1] === '\n') i++; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  if (rows.length && rows[rows.length - 1].every((c) => c === '') && rows.length > 1) rows.pop();
  return rows;
}

export { asValue, cellRef, colName, parseCellRef };
