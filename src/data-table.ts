/**
 * The data behind a data table, and everything that can be done with it without a screen: validation, search, filter, sort, totals,
 * CSV, a small .xlsx writer and the HTML used for PDF. Pure functions, so they are easy to test and to use on the server.
 */

export type ColumnType = 'text' | 'number' | 'currency' | 'date' | 'boolean' | 'select';
export type Aggregate = 'sum' | 'avg' | 'count' | 'min' | 'max';
export type Cell = string | number | boolean | null;

export interface DataColumn {
  /** Stable id of the column (not shown). */
  key: string;
  title: string;
  type: ColumnType;
  width?: number;
  align?: 'left' | 'center' | 'right';
  /** Digits after the decimal point, for number and currency. */
  decimals?: number;
  /** ISO 4217 code for currency columns (USD, EUR, IDR…). */
  currency?: string;
  /** Allowed values of a select column. */
  options?: string[];
  /** Shown in the footer row. */
  total?: Aggregate;
  hidden?: boolean;
}

export interface DataTableOptions {
  title: string;
  /** Rows per page; 0 shows every row. */
  pageSize: number;
  search: boolean;
  filters: boolean;
  striped: boolean;
  bordered: boolean;
  selectable: boolean;
  density: 'compact' | 'normal' | 'comfortable';
  /** Height in pixels after which the table scrolls with a fixed header; 0 for none. */
  height: number;
}

export interface DataTableSpec {
  columns: DataColumn[];
  rows: Cell[][];
  options: DataTableOptions;
}

export const MAX_ROWS = 20000;
export const MAX_COLUMNS = 100;
export const MAX_TEXT = 5000;
export const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'currency', 'date', 'boolean', 'select'];
export const AGGREGATES: Aggregate[] = ['sum', 'avg', 'count', 'min', 'max'];
export const PAGE_SIZES = [10, 25, 50, 100, 0];

export const defaultOptions = (): DataTableOptions => ({ title: '', pageSize: 10, search: true, filters: false, striped: true, bordered: false, selectable: false, density: 'normal', height: 0 });

// ---- values

/** Reads "1,234.56", "1.234,56", "12%", "$5" and plain numbers. Returns null when there is no number in it. */
export function parseNumber(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input !== 'string') return null;
  let s = input.trim().replace(/[\s ]/g, '').replace(/^[^\d+\-.,]+|[^\d.,]+$/g, '');
  if (!/\d/.test(s)) return null;
  const dot = s.lastIndexOf('.');
  const comma = s.lastIndexOf(',');
  if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  else if (comma >= 0) s = /^[+-]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** An ISO date (YYYY-MM-DD) from an ISO string, D/M/YYYY, a Date or a timestamp. Null when it is not a real date. */
export function parseDate(input: unknown): string | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : `${pad(input.getUTCFullYear(), 4)}-${pad(input.getUTCMonth() + 1)}-${pad(input.getUTCDate())}`;
  if (typeof input !== 'string') return null;
  const s = input.trim();
  let y: number, m: number, d: number;
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T\s])/.exec(s);
  if (hit) [y, m, d] = [+hit[1], +hit[2], +hit[3]];
  else if ((hit = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))) [d, m, y] = [+hit[1], +hit[2], +hit[3]];
  else return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${pad(y, 4)}-${pad(m)}-${pad(d)}` : null;
}

const truthy = /^(true|yes|y|1|on|ya|✓|✔)$/i;
const falsy = /^(false|no|n|0|off|tidak|)$/i;

/** Makes any value fit a column of this type. Whatever cannot be read becomes empty (null) rather than wrong. */
export function coerceCell(type: ColumnType, v: unknown): Cell {
  if (v === null || v === undefined) return type === 'text' || type === 'select' ? '' : type === 'boolean' ? false : null;
  switch (type) {
    case 'number':
    case 'currency':
      return parseNumber(v);
    case 'date':
      return parseDate(v);
    case 'boolean':
      return typeof v === 'boolean' ? v : truthy.test(String(v).trim()) ? true : falsy.test(String(v).trim()) ? false : Boolean(v);
    default:
      return String(v).slice(0, MAX_TEXT);
  }
}

const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: string | undefined, o: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale ?? ''}|${JSON.stringify(o)}`;
  let f = NUMBER_FORMATS.get(key);
  if (!f) {
    try { f = new Intl.NumberFormat(locale, o); } catch { f = new Intl.NumberFormat(undefined, { ...o, style: 'decimal', currency: undefined }); }
    NUMBER_FORMATS.set(key, f);
  }
  return f;
}

/** The text shown for a value. */
export function formatCell(col: DataColumn, v: Cell, locale?: string): string {
  if (v === null || v === undefined || v === '') return '';
  switch (col.type) {
    case 'number':
      return typeof v === 'number' ? numberFormat(locale, col.decimals === undefined ? { maximumFractionDigits: 6 } : { minimumFractionDigits: col.decimals, maximumFractionDigits: col.decimals }).format(v) : String(v);
    case 'currency':
      return typeof v === 'number' ? numberFormat(locale, { style: 'currency', currency: col.currency || 'USD', ...(col.decimals === undefined ? {} : { minimumFractionDigits: col.decimals, maximumFractionDigits: col.decimals }) }).format(v) : String(v);
    case 'date': {
      const iso = parseDate(String(v));
      if (!iso) return String(v);
      return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
    }
    case 'boolean':
      return v ? 'Yes' : 'No';
    default:
      return String(v);
  }
}

// ---- validation

const cleanString = (v: unknown, max: number) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);

/** Accepts the stored JSON (string or object) and returns a spec that is safe to draw, or null when it is not a data table. */
export function cleanSpec(raw: unknown): DataTableSpec | null {
  let data: any = raw;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { return null; }
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.columns)) return null;
  const used = new Set<string>();
  const columns: DataColumn[] = [];
  for (const c of data.columns.slice(0, MAX_COLUMNS)) {
    if (!c || typeof c !== 'object') continue;
    let key = cleanString(c.key, 40).replace(/[^\w-]/g, '') || `c${columns.length + 1}`;
    while (used.has(key)) key += '_';
    used.add(key);
    const type = oneOf<ColumnType>(c.type, COLUMN_TYPES, 'text');
    const col: DataColumn = { key, title: cleanString(c.title, 200), type };
    const width = Math.round(Number(c.width));
    if (width >= 40 && width <= 1200) col.width = width;
    if (c.align === 'left' || c.align === 'center' || c.align === 'right') col.align = c.align;
    const decimals = Number(c.decimals);
    if (Number.isInteger(decimals) && decimals >= 0 && decimals <= 10 && (type === 'number' || type === 'currency')) col.decimals = decimals;
    if (type === 'currency') { const code = cleanString(c.currency, 3).toUpperCase(); col.currency = /^[A-Z]{3}$/.test(code) ? code : 'USD'; }
    if (type === 'select') col.options = (Array.isArray(c.options) ? c.options : []).map((o: unknown) => cleanString(o, 200)).filter(Boolean).slice(0, 200);
    if (AGGREGATES.includes(c.total) && (type === 'number' || type === 'currency' || c.total === 'count')) col.total = c.total;
    if (c.hidden === true) col.hidden = true;
    columns.push(col);
  }
  if (!columns.length) return null;
  const rows: Cell[][] = [];
  for (const r of (Array.isArray(data.rows) ? data.rows : []).slice(0, MAX_ROWS)) {
    const src: unknown[] = Array.isArray(r) ? r : [];
    rows.push(columns.map((c, i) => coerceCell(c.type, src[i])));
  }
  const o = data.options && typeof data.options === 'object' ? data.options : {};
  const d = defaultOptions();
  const pageSize = Math.round(Number(o.pageSize));
  const height = Math.round(Number(o.height));
  const options: DataTableOptions = {
    title: cleanString(o.title, 300),
    pageSize: Number.isFinite(pageSize) && pageSize >= 0 && pageSize <= 1000 ? pageSize : d.pageSize,
    search: o.search === undefined ? d.search : o.search === true,
    filters: o.filters === true,
    striped: o.striped === undefined ? d.striped : o.striped === true,
    bordered: o.bordered === true,
    selectable: o.selectable === true,
    density: oneOf(o.density, ['compact', 'normal', 'comfortable'] as const, 'normal'),
    height: Number.isFinite(height) && height >= 120 && height <= 4000 ? height : 0,
  };
  return { columns, rows, options };
}

/** A new spec from plain rows: the first row names the columns and each column's type is guessed from its values. */
export function specFromRows(rows: unknown[][], options: Partial<DataTableOptions> = {}): DataTableSpec {
  const head = (rows[0] ?? []).map((v) => cleanString(v, 200));
  const body = rows.slice(1);
  const width = Math.max(head.length, ...body.map((r) => r.length), 1);
  const columns: DataColumn[] = Array.from({ length: Math.min(width, MAX_COLUMNS) }, (_, i) => ({ key: `c${i + 1}`, title: head[i] || `Column ${i + 1}`, type: guessType(body.map((r) => r[i])) }));
  return cleanSpec({ columns, rows: body, options: { ...defaultOptions(), ...options } }) as DataTableSpec;
}

/** The type that fits every non-empty value in a column. Text when in doubt. */
export function guessType(values: unknown[]): ColumnType {
  const filled = values.map((v) => (typeof v === 'string' ? v.trim() : v)).filter((v) => v !== '' && v !== null && v !== undefined);
  if (!filled.length) return 'text';
  if (filled.every((v) => typeof v === 'boolean' || (typeof v === 'string' && /^(true|false|yes|no)$/i.test(v)))) return 'boolean';
  if (filled.every((v) => parseDate(v) !== null && typeof v !== 'number')) return 'date';
  // a number only when the text is nothing but a number (a phone or a code with letters stays text, and so does anything with a leading zero)
  if (filled.every((v) => (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && /^[-+]?(\d{1,3}([.,]\d{3})+|\d+)([.,]\d+)?$/.test(v) && !/^[-+]?0\d/.test(v)))) return 'number';
  return 'text';
}

// ---- view: search, filter, sort

export interface ViewState {
  search: string;
  filters: Record<string, string>;
  sort: { key: string; dir: 'asc' | 'desc' }[];
}

type Test = (v: Cell) => boolean;
const num = (col: DataColumn, s: string): number | null => (col.type === 'date' ? (parseDate(s) ? Date.parse(`${parseDate(s)}T00:00:00Z`) : null) : parseNumber(s));
const val = (col: DataColumn, v: Cell): number | null => (col.type === 'date' ? (typeof v === 'string' && parseDate(v) ? Date.parse(`${parseDate(v)}T00:00:00Z`) : null) : typeof v === 'number' ? v : null);

/** One filter box: text is "contains"; numbers and dates take `>5`, `>=5`, `<5`, `<=5`, `=5`, `!=5`, `5..10` or a plain value. */
export function filterTest(col: DataColumn, expr: string, locale?: string): Test | null {
  const e = expr.trim();
  if (!e) return null;
  if (col.type === 'boolean') return (v) => (truthy.test(e) ? v === true : falsy.test(e) ? v !== true : true);
  if (col.type === 'select') return (v) => String(v ?? '') === e;
  if (col.type === 'text') {
    const q = e.toLowerCase();
    return (v) => String(v ?? '').toLowerCase().includes(q);
  }
  const range = /^(.+?)\.\.(.+)$/.exec(e);
  if (range) {
    const [a, b] = [num(col, range[1]), num(col, range[2])];
    if (a === null || b === null) return () => false;
    return (v) => { const x = val(col, v); return x !== null && x >= Math.min(a, b) && x <= Math.max(a, b); };
  }
  const op = /^(>=|<=|!=|=|>|<)?\s*(.*)$/.exec(e)!;
  const target = num(col, op[2]);
  if (target === null) {
    // not a number: fall back to the shown text, so typing "Mar" still finds March dates
    const q = e.toLowerCase();
    return (v) => formatCell(col, v, locale).toLowerCase().includes(q);
  }
  return (v) => {
    const x = val(col, v);
    if (x === null) return op[1] === '!=';
    switch (op[1]) {
      case '>': return x > target;
      case '>=': return x >= target;
      case '<': return x < target;
      case '<=': return x <= target;
      case '!=': return x !== target;
      default: return x === target;
    }
  };
}

function compare(col: DataColumn, a: Cell, b: Cell): number {
  switch (col.type) {
    case 'number':
    case 'currency':
      return (a as number) - (b as number);
    case 'boolean':
      return Number(a) - Number(b);
    case 'date':
      return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
    default:
      return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }
}

const isEmpty = (c: DataColumn, v: Cell) => v === null || v === undefined || (v === '' && c.type !== 'boolean');

/** Indexes of the rows to show, in order: searched, filtered, then sorted (empty values always last). */
export function queryRows(spec: DataTableSpec, view: ViewState, locale?: string): number[] {
  const cols = spec.columns;
  const visible = cols.map((c, i) => (c.hidden ? -1 : i)).filter((i) => i >= 0);
  const tests: { i: number; t: Test }[] = [];
  cols.forEach((c, i) => { const t = filterTest(c, view.filters[c.key] ?? '', locale); if (t) tests.push({ i, t }); });
  const q = view.search.trim().toLowerCase();
  let out: number[] = [];
  spec.rows.forEach((row, r) => {
    if (tests.some(({ i, t }) => !t(row[i]))) return;
    if (q && !visible.some((i) => formatCell(cols[i], row[i], locale).toLowerCase().includes(q) || String(row[i] ?? '').toLowerCase().includes(q))) return;
    out.push(r);
  });
  const keys = view.sort.map((s) => ({ i: cols.findIndex((c) => c.key === s.key), dir: s.dir === 'desc' ? -1 : 1 })).filter((k) => k.i >= 0);
  if (keys.length) {
    out = out
      .map((r, n) => ({ r, n }))
      .sort((x, y) => {
        for (const k of keys) {
          const [a, b] = [spec.rows[x.r][k.i], spec.rows[y.r][k.i]];
          const [ea, eb] = [isEmpty(cols[k.i], a), isEmpty(cols[k.i], b)];
          if (ea || eb) { if (ea && eb) continue; return ea ? 1 : -1; }
          const d = compare(cols[k.i], a, b);
          if (d) return d * k.dir;
        }
        return x.n - y.n;
      })
      .map((x) => x.r);
  }
  return out;
}

/** A footer value over the given rows, or null when there is nothing to total. */
export function aggregate(col: DataColumn, kind: Aggregate, rows: Cell[][], index: number[], at: number): number | null {
  if (kind === 'count') return index.filter((r) => !isEmpty(col, rows[r][at])).length;
  const xs = index.map((r) => rows[r][at]).filter((v): v is number => typeof v === 'number');
  if (!xs.length) return null;
  switch (kind) {
    case 'sum': return xs.reduce((a, b) => a + b, 0);
    case 'avg': return xs.reduce((a, b) => a + b, 0) / xs.length;
    case 'min': return Math.min(...xs);
    default: return Math.max(...xs);
  }
}

// ---- export

export interface ExportOptions {
  /** Row indexes to export, in order. Default: every row. */
  rows?: number[];
  /** Include hidden columns. Default false. */
  hidden?: boolean;
  /** CSV: put the shown text (1,234.50) in the file instead of the plain value (1234.5). */
  formatted?: boolean;
  /** CSV delimiter. Default ",". */
  delimiter?: string;
  /** CSV: start the file with a byte-order mark so Excel reads it as UTF-8. Default true. */
  bom?: boolean;
  locale?: string;
  title?: string;
}

const exported = (spec: DataTableSpec, o: ExportOptions) => ({
  columns: spec.columns.map((c, i) => ({ c, i })).filter(({ c }) => o.hidden || !c.hidden),
  index: o.rows ?? spec.rows.map((_, r) => r),
});

function csvCell(col: DataColumn, v: Cell, o: ExportOptions, delim: string): string {
  let s: string;
  if (v === null || v === undefined) s = '';
  else if (o.formatted) s = formatCell(col, v, o.locale);
  else if (typeof v === 'boolean') s = v ? 'TRUE' : 'FALSE';
  else s = String(v);
  // A spreadsheet runs text that starts with these as a formula; the quote stops that. Numbers are written as they are.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s.includes(delim) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The table as CSV text (CRLF line ends, quotes doubled). */
export function toCSV(spec: DataTableSpec, o: ExportOptions = {}): string {
  const delim = o.delimiter ?? ',';
  const { columns, index } = exported(spec, o);
  const head = columns.map(({ c }) => csvCell({ ...c, type: 'text' }, c.title, { ...o, formatted: false }, delim));
  const body = index.map((r) => columns.map(({ c, i }) => csvCell(c, spec.rows[r][i], o, delim)).join(delim));
  return `${o.bom === false ? '' : '﻿'}${[head.join(delim), ...body].join('\r\n')}\r\n`;
}

/** Reads CSV or TSV text (quoted fields, doubled quotes, line breaks inside quotes). The delimiter is guessed from the first line. */
export function parseCSV(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const delim = delimiter ?? ([',', ';', '\t'].map((d) => ({ d, n: first.split(d).length })).sort((a, b) => b.n - a.n)[0].d);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '').slice(0, MAX_ROWS + 1);
}

// ---- .xlsx (a zip of XML files, written here with no library)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive with the files stored uncompressed. Same input, same bytes. */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: DataView, at: number, n: number) => v.setUint16(at, n, true);
  const u32 = (v: DataView, at: number, n: number) => v.setUint32(at, n >>> 0, true);
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50); u16(lv, 4, 20); u16(lv, 6, 0x0800); u16(lv, 8, 0); u16(lv, 10, 0); u16(lv, 12, 0x21);
    u32(lv, 14, crc); u32(lv, 18, f.data.length); u32(lv, 22, f.data.length); u16(lv, 26, name.length); u16(lv, 28, 0);
    local.set(name, 30);
    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    u32(dv, 0, 0x02014b50); u16(dv, 4, 20); u16(dv, 6, 20); u16(dv, 8, 0x0800); u16(dv, 10, 0); u16(dv, 12, 0); u16(dv, 14, 0x21);
    u32(dv, 16, crc); u32(dv, 20, f.data.length); u32(dv, 24, f.data.length); u16(dv, 28, name.length);
    u32(dv, 42, offset);
    dir.set(name, 46);
    parts.push(local, f.data);
    central.push(dir);
    offset += local.length + f.data.length;
  }
  const size = central.reduce((n, d) => n + d.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50); u16(ev, 8, files.length); u16(ev, 10, files.length); u32(ev, 12, size); u32(ev, 16, offset);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) { out.set(p, at); at += p.length; }
  return out;
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function columnName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const sheetName = (s: string) => s.replace(/[[\]:*?/\\]/g, ' ').replace(/^['\s]+|['\s]+$/g, '').slice(0, 31) || 'Sheet1';

/** Days since 1899-12-30, which is how a spreadsheet stores a date. */
const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000);

function currencySymbol(code: string): string {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  } catch { return code; }
}

/** The table as a real Excel workbook: one sheet, a bold header row that stays in view, number and date formats, filter buttons, column widths. */
export function toXlsx(spec: DataTableSpec, o: ExportOptions = {}): Uint8Array {
  const { columns, index } = exported(spec, o);
  const formats: string[] = []; // custom number formats, ids start at 164
  const fmtId = (code: string) => { let i = formats.indexOf(code); if (i < 0) i = formats.push(code) - 1; return 164 + i; };
  const styles: { numFmtId: number }[] = [];
  const style = (numFmtId: number) => { let i = styles.findIndex((s) => s.numFmtId === numFmtId); if (i < 0) i = styles.push({ numFmtId }) - 1; return i + 2; }; // 0 normal, 1 header
  const styleOf = (c: DataColumn): number => {
    if (c.type === 'date') return style(fmtId('yyyy-mm-dd'));
    if (c.type === 'number' || c.type === 'currency') {
      const dec = c.decimals ?? (c.type === 'currency' ? 2 : -1);
      const body = dec < 0 ? '#,##0.######' : dec === 0 ? '#,##0' : `#,##0.${'0'.repeat(dec)}`;
      return style(fmtId(c.type === 'currency' ? `"${currencySymbol(c.currency || 'USD').replace(/"/g, '')}"${body}` : body));
    }
    return 0;
  };
  const cellStyles = columns.map(({ c }) => styleOf(c));

  const rows: string[] = [];
  rows.push(`<row r="1">${columns.map(({ c }, k) => `<c r="${columnName(k)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xml(c.title)}</t></is></c>`).join('')}</row>`);
  index.forEach((r, n) => {
    const cells = columns.map(({ c, i }, k) => {
      const v = spec.rows[r][i];
      const ref = `${columnName(k)}${n + 2}`;
      if (v === null || v === undefined || (v === '' && c.type !== 'boolean')) return '';
      if (c.type === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
      if ((c.type === 'number' || c.type === 'currency') && typeof v === 'number') return `<c r="${ref}" s="${cellStyles[k]}"><v>${v}</v></c>`;
      if (c.type === 'date' && typeof v === 'string' && parseDate(v)) return `<c r="${ref}" s="${cellStyles[k]}"><v>${serial(parseDate(v)!)}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
    });
    rows.push(`<row r="${n + 2}">${cells.join('')}</row>`);
  });

  const widths = columns.map(({ c, i }) => {
    const longest = Math.max(c.title.length, ...index.slice(0, 200).map((r) => formatCell(c, spec.rows[r][i], o.locale).length));
    return Math.min(60, Math.max(8, Math.round(c.width ? c.width / 7 : longest + 2)));
  });
  const last = `${columnName(columns.length - 1)}${index.length + 1}`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, k) => `<col min="${k + 1}" max="${k + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${rows.join('')}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
  const numFmts = formats.length ? `<numFmts count="${formats.length}">${formats.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${xml(f)}"/>`).join('')}</numFmts>` : '';
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF3"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${2 + styles.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>${styles.map((s) => `<xf numFmtId="${s.numFmtId}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const name = sheetName(o.title || spec.options.title || 'Sheet1');
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const text = (s: string) => new TextEncoder().encode(s);
  return zipStore([
    { name: '[Content_Types].xml', data: text(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`) },
    { name: '_rels/.rels', data: text(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: text(`${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xml(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: text(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: text(stylesXml) },
    { name: 'xl/worksheets/sheet1.xml', data: text(sheet) },
  ]);
}

// ---- PDF (through the browser's print dialog, so every script and font works)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A standalone page with just the table, ready to print or save as PDF. Header row repeats on every page. */
export function toPrintHTML(spec: DataTableSpec, o: ExportOptions = {}): string {
  const { columns, index } = exported(spec, o);
  const align = (c: DataColumn) => c.align ?? (c.type === 'number' || c.type === 'currency' ? 'right' : 'left');
  const head = columns.map(({ c }) => `<th style="text-align:${align(c)}">${esc(c.title)}</th>`).join('');
  const body = index.map((r) => `<tr>${columns.map(({ c, i }) => `<td style="text-align:${align(c)}">${esc(formatCell(c, spec.rows[r][i], o.locale))}</td>`).join('')}</tr>`).join('');
  const totals = columns.some(({ c }) => c.total)
    ? `<tfoot><tr>${columns.map(({ c, i }, k) => { const t = c.total ? aggregate(c, c.total, spec.rows, index, i) : null; return `<td style="text-align:${align(c)}">${t === null ? (k === 0 ? 'Total' : '') : esc(formatCell(c.total === 'count' ? { ...c, type: 'number', decimals: 0 } : c, t, o.locale))}</td>`; }).join('')}</tr></tfoot>`
    : '';
  const title = o.title ?? spec.options.title;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'Table')}</title><style>@page{margin:14mm}body{font:12px/1.4 system-ui,sans-serif;color:#111;margin:0}h1{font-size:16px;margin:0 0 8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:4px 8px;vertical-align:top}th{background:#e7ecf3;font-weight:600}thead{display:table-header-group}tfoot{display:table-footer-group;font-weight:600}tr{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${title ? `<h1>${esc(title)}</h1>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${totals}</table></body></html>`;
}
