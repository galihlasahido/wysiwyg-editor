import { runFormula } from './data-table-formula';

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
  /** A formula over the other columns of the same row (`[Price] * [Qty]`). The cells of this column are calculated, never stored. */
  formula?: string;
  /** Draw a bar in each cell, as long as the value is compared with the largest one. Number and currency columns. */
  bar?: boolean;
}

export type Look = 'red' | 'green' | 'amber' | 'blue' | 'gray' | 'bold';
export const LOOKS: Look[] = ['red', 'green', 'amber', 'blue', 'gray', 'bold'];
/** Fill colours (RRGGBB) for files that cannot use the editor's theme colours. */
export const LOOK_FILL: Record<Look, string | null> = { red: 'F8D7DA', green: 'D4EDDA', amber: 'FFF3CD', blue: 'DCE9FB', gray: 'E5E7EB', bold: null };

/** Highlight cells (or the whole row) that match a condition, written like a filter box: `>100`, `5..10`, `Overdue`, `empty`. */
export interface FormatRule {
  /** Column key, or '' for any column. */
  column: string;
  test: string;
  look: Look;
  /** Colour the whole row, not just the cell. */
  row: boolean;
}

/** A named set of search, filters, sort, grouping and hidden columns. */
export interface SavedView {
  name: string;
  search: string;
  filters: Record<string, string>;
  sort: { key: string; dir: 'asc' | 'desc' }[];
  groupBy: string[];
  hidden: string[];
  pageSize: number;
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
  /** Column keys to group the rows by (up to three levels). */
  groupBy: string[];
  /** Rows can be opened to show their details. */
  detail: boolean;
  /** Rows can be dragged (or moved with Alt+Up and Alt+Down) to change their order. Only while no sort, search or filter is on. */
  reorder: boolean;
  /** Name of a data source given to the plugin: the rows are then loaded page by page instead of stored in the document. Empty = the rows are in the document. */
  source: string;
}

export interface DataTableSpec {
  columns: DataColumn[];
  rows: Cell[][];
  options: DataTableOptions;
  rules: FormatRule[];
  views: SavedView[];
}

export const MAX_ROWS = 20000;
export const MAX_COLUMNS = 100;
export const MAX_TEXT = 5000;
export const COLUMN_TYPES: ColumnType[] = ['text', 'number', 'currency', 'date', 'boolean', 'select'];
export const AGGREGATES: Aggregate[] = ['sum', 'avg', 'count', 'min', 'max'];
export const PAGE_SIZES = [10, 25, 50, 100, 0];

export const defaultOptions = (): DataTableOptions => ({ title: '', pageSize: 10, search: true, filters: false, striped: true, bordered: false, selectable: false, density: 'normal', height: 0, detail: false, reorder: false, groupBy: [], source: '' });

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
    const formula = cleanString(c.formula, 500).trim();
    if (formula && type !== 'boolean' && type !== 'select') col.formula = formula;
    if (c.bar === true && (type === 'number' || type === 'currency')) col.bar = true;
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
    detail: o.detail === true,
    reorder: o.reorder === true,
    groupBy: (Array.isArray(o.groupBy) ? o.groupBy : []).filter((k: unknown) => typeof k === 'string' && columns.some((c) => c.key === k)).filter((k: string, i: number, a: string[]) => a.indexOf(k) === i).slice(0, 3),
    source: cleanString(o.source, 60).replace(/[^\w.-]/g, ''),
  };
  const keys = new Set(columns.map((c) => c.key));
  const rules: FormatRule[] = (Array.isArray(data.rules) ? data.rules : []).slice(0, 30).flatMap((r: any): FormatRule[] => {
    const test = cleanString(r?.test, 100).trim();
    const column = typeof r?.column === 'string' && keys.has(r.column) ? r.column : '';
    return test && (r?.column === '' || r?.column === undefined || keys.has(r?.column)) ? [{ column, test, look: oneOf(r?.look, LOOKS, 'amber'), row: r?.row === true }] : [];
  });
  const views: SavedView[] = (Array.isArray(data.views) ? data.views : []).slice(0, 20).flatMap((v: any): SavedView[] => {
    const name = cleanString(v?.name, 60).trim();
    if (!name) return [];
    const size = Math.round(Number(v?.pageSize));
    return [{
      name,
      search: cleanString(v?.search, 200),
      filters: Object.fromEntries(Object.entries(v?.filters && typeof v.filters === 'object' ? v.filters : {}).filter(([k, x]) => keys.has(k) && typeof x === 'string' && x.trim()).map(([k, x]) => [k, (x as string).slice(0, 100)])),
      sort: (Array.isArray(v?.sort) ? v.sort : []).filter((x: any) => keys.has(x?.key)).slice(0, 4).map((x: any) => ({ key: x.key, dir: x.dir === 'desc' ? 'desc' : 'asc' })),
      groupBy: (Array.isArray(v?.groupBy) ? v.groupBy : []).filter((k: unknown) => typeof k === 'string' && keys.has(k)).slice(0, 3),
      hidden: (Array.isArray(v?.hidden) ? v.hidden : []).filter((k: unknown) => typeof k === 'string' && keys.has(k)),
      pageSize: Number.isFinite(size) && size >= 0 && size <= 1000 ? size : 10,
    }];
  });
  return { columns, rows, options, rules, views };
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

// ---- formula columns

const COMPUTED = new WeakMap<Cell[][], { columns: DataColumn[]; out: Cell[][] }>();

/** The same table with every formula column filled in. Without formula columns it is returned as it is. Results are remembered per rows array. */
export function withFormulas(spec: DataTableSpec, rows: Cell[][] = spec.rows): DataTableSpec {
  if (!spec.columns.some((c) => c.formula)) return rows === spec.rows ? spec : { ...spec, rows };
  const memo = COMPUTED.get(rows);
  if (memo && memo.columns === spec.columns) return { ...spec, rows: memo.out };
  const cols = spec.columns;
  const byName = new Map<string, number>();
  cols.forEach((c, i) => { byName.set(c.key.toLowerCase(), i); if (c.title) byName.set(c.title.toLowerCase(), byName.get(c.title.toLowerCase()) ?? i); });
  const out = rows.map((row) => {
    const done = new Map<number, Cell>();
    const busy = new Set<number>();
    const value = (i: number): Cell => {
      const col = cols[i];
      if (!col.formula) return row[i] ?? null;
      if (done.has(i)) return done.get(i)!;
      if (busy.has(i)) return '#CYCLE!';
      busy.add(i);
      const res = runFormula(col.formula, (name) => { const at = byName.get(name.toLowerCase()); return at === undefined ? undefined : (value(at) as number | string | boolean | null); });
      busy.delete(i);
      const cell: Cell = typeof res === 'string' && res.startsWith('#') ? res : coerceCell(col.type, res);
      done.set(i, cell);
      return cell;
    };
    return cols.map((_, i) => value(i));
  });
  COMPUTED.set(rows, { columns: spec.columns, out });
  return { ...spec, rows: out };
}

// ---- highlight rules

const isBlank = (v: Cell) => v === null || v === undefined || v === '';

/** What the highlight rules say about each row: a look for the whole row and one per cell (the first matching rule wins). */
export function ruleLooks(spec: DataTableSpec, locale?: string): (row: Cell[]) => { row: Look | null; cells: (Look | null)[] } {
  const keyAt = new Map(spec.columns.map((c, i) => [c.key, i]));
  const rules = spec.rules.map((r) => {
    const word = r.test.trim().toLowerCase();
    const tests = spec.columns.map((c, i): Test | null => (r.column && keyAt.get(r.column) !== i ? null : word === 'empty' || word === 'blank' ? isBlank : word === '!empty' || word === 'notempty' ? (v) => !isBlank(v) : filterTest(c, r.test, locale)));
    return { rule: r, tests };
  });
  return (row) => {
    const cells: (Look | null)[] = spec.columns.map(() => null);
    let whole: Look | null = null;
    for (const { rule, tests } of rules) {
      tests.forEach((t, i) => {
        if (!t || !t(row[i] ?? null)) return;
        if (rule.row) whole = whole ?? rule.look;
        else cells[i] = cells[i] ?? rule.look;
      });
    }
    return { row: whole, cells };
  };
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
export function queryRows(source: DataTableSpec, view: ViewState, locale?: string): number[] {
  const spec = withFormulas(source);
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
  // grouped rows keep each group together: the group columns sort first (in the direction chosen for them, else ascending)
  const groups = spec.options.groupBy.map((key) => view.sort.find((s) => s.key === key) ?? { key, dir: 'asc' as const });
  const effective = [...groups, ...view.sort.filter((s) => !spec.options.groupBy.includes(s.key))];
  const keys = effective.map((s) => ({ i: cols.findIndex((c) => c.key === s.key), dir: s.dir === 'desc' ? -1 : 1 })).filter((k) => k.i >= 0);
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

// ---- groups

export interface GroupInfo {
  /** Unique id of this group (path of column and value), used to remember which are collapsed. */
  key: string;
  depth: number;
  col: number;
  value: Cell;
  label: string;
  /** Every row of the group (not only those on the current page). */
  rows: number[];
}

/** One line of the table body: a data row with the groups it sits in, or (r = -1) a whole group that is folded away. */
export interface DisplayRow { r: number; path: GroupInfo[] }

/** Splits the ordered rows into groups (the order of `index` is kept) and drops the rows of folded groups. */
export function groupDisplay(spec: DataTableSpec, index: number[], collapsed: ReadonlySet<string> = new Set(), locale?: string, rows: Cell[][] = spec.rows): DisplayRow[] {
  const by = spec.options.groupBy.map((k) => spec.columns.findIndex((c) => c.key === k)).filter((i) => i >= 0);
  if (!by.length) return index.map((r) => ({ r, path: [] }));
  const groups = new Map<string, GroupInfo>();
  const paths = index.map((r) => {
    const path: GroupInfo[] = [];
    let id = '';
    by.forEach((col, depth) => {
      const v = rows[r][col];
      id += `${depth}:${spec.columns[col].key}=${JSON.stringify(v)}|`;
      let g = groups.get(id);
      if (!g) { g = { key: id, depth, col, value: v, label: `${spec.columns[col].title}: ${formatCell(spec.columns[col], v, locale) || '(empty)'}`, rows: [] }; groups.set(id, g); }
      g.rows.push(r);
      path.push(g);
    });
    return path;
  });
  const out: DisplayRow[] = [];
  let folded: string | null = null;
  index.forEach((r, n) => {
    const path = paths[n];
    const hit = path.find((g) => collapsed.has(g.key));
    if (hit) {
      if (folded === hit.key) return;
      folded = hit.key;
      out.push({ r: -1, path: path.slice(0, hit.depth + 1) });
      return;
    }
    folded = null;
    out.push({ r, path });
  });
  return out;
}

// ---- remote data

/** What a data source is asked for. Filters are the text typed in each column's filter box, by column key. */
export interface DataQuery {
  page: number;
  pageSize: number;
  search: string;
  filters: Record<string, string>;
  sort: { key: string; dir: 'asc' | 'desc' }[];
  groupBy: string[];
}

/** What a data source answers: one page of rows (arrays in column order, or objects by column key) and the total matching rows. */
export interface DataPage {
  rows: unknown[];
  total: number;
  /** Footer values by column key, over all matching rows (the page alone cannot give a sum). */
  totals?: Record<string, number | null>;
}

/** Turns a data source's rows into cells of the right type; rows from outside are never trusted. */
export function normalizeRows(columns: DataColumn[], rows: unknown): Cell[][] {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, MAX_ROWS).map((r) => {
    const get = (c: DataColumn, i: number) => (Array.isArray(r) ? r[i] : r && typeof r === 'object' ? (r as Record<string, unknown>)[c.key] : undefined);
    return columns.map((c, i) => coerceCell(c.type, get(c, i)));
  });
}

// ---- export

export interface ExportOptions {
  /** Row indexes to export, in order. Default: every row. */
  rows?: number[];
  /** Include hidden columns. Default false. */
  hidden?: boolean;
  /** CSV: put the shown text (1,234.50) in the file instead of the plain value (1234.5). */
  formatted?: boolean;
  /** .xlsx and PDF: colour the cells the highlight rules match. Default true. */
  formatting?: boolean;
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
export function toCSV(source: DataTableSpec, o: ExportOptions = {}): string {
  const spec = withFormulas(source);
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
export function toXlsx(source: DataTableSpec, o: ExportOptions = {}): Uint8Array {
  const spec = withFormulas(source);
  const { columns, index } = exported(spec, o);
  const formats: string[] = []; // custom number formats, ids start at 164
  const fmtId = (code: string) => { let i = formats.indexOf(code); if (i < 0) i = formats.push(code) - 1; return 164 + i; };
  const styles: { numFmtId: number; look: Look | null }[] = [];
  const style = (numFmtId: number, look: Look | null = null) => {
    if (!numFmtId && !look) return 0;
    let i = styles.findIndex((s) => s.numFmtId === numFmtId && s.look === look);
    if (i < 0) i = styles.push({ numFmtId, look }) - 1;
    return i + 2; // 0 normal, 1 header
  };
  const formatOf = (c: DataColumn): number => {
    if (c.type === 'date') return fmtId('yyyy-mm-dd');
    if (c.type === 'number' || c.type === 'currency') {
      const dec = c.decimals ?? (c.type === 'currency' ? 2 : -1);
      const body = dec < 0 ? '#,##0.######' : dec === 0 ? '#,##0' : `#,##0.${'0'.repeat(dec)}`;
      return fmtId(c.type === 'currency' ? `"${currencySymbol(c.currency || 'USD').replace(/"/g, '')}"${body}` : body);
    }
    return 0;
  };
  const numFmts0 = columns.map(({ c }) => formatOf(c));
  const looks = o.formatting === false || !spec.rules.length ? null : ruleLooks(spec, o.locale);

  const rows: string[] = [];
  rows.push(`<row r="1">${columns.map(({ c }, k) => `<c r="${columnName(k)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xml(c.title)}</t></is></c>`).join('')}</row>`);
  index.forEach((r, n) => {
    const lk = looks?.(spec.rows[r]);
    const cells = columns.map(({ c, i }, k) => {
      const v = spec.rows[r][i];
      const ref = `${columnName(k)}${n + 2}`;
      const look = lk ? lk.cells[i] ?? lk.row : null;
      const st = style(numFmts0[k], look);
      const sAttr = st ? ` s="${st}"` : '';
      if (v === null || v === undefined || (v === '' && c.type !== 'boolean')) return look ? `<c r="${ref}"${sAttr}/>` : '';
      if (c.type === 'boolean') return `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
      if ((c.type === 'number' || c.type === 'currency') && typeof v === 'number') return `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
      if (c.type === 'date' && typeof v === 'string' && parseDate(v)) return `<c r="${ref}"${sAttr}><v>${serial(parseDate(v)!)}</v></c>`;
      return `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
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
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="8"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF3"/><bgColor indexed="64"/></patternFill></fill>${(['red', 'green', 'amber', 'blue', 'gray'] as Look[]).map((l) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${LOOK_FILL[l]}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${2 + styles.length}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>${styles.map((s) => { const fill = s.look && s.look !== 'bold' ? 3 + ['red', 'green', 'amber', 'blue', 'gray'].indexOf(s.look) : 0; return `<xf numFmtId="${s.numFmtId}" fontId="${s.look === 'bold' ? 1 : 0}" fillId="${fill}" borderId="0" xfId="0" applyNumberFormat="1"${fill ? ' applyFill="1"' : ''}${s.look === 'bold' ? ' applyFont="1"' : ''}/>`; }).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
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
export function toPrintHTML(source: DataTableSpec, o: ExportOptions = {}): string {
  const spec = withFormulas(source);
  const { columns, index } = exported(spec, o);
  const looks = o.formatting === false || !spec.rules.length ? null : ruleLooks(spec, o.locale);
  const lookCss = (l: Look | null | undefined) => (!l ? '' : l === 'bold' ? ';font-weight:700' : `;background:#${LOOK_FILL[l]}`);
  const align = (c: DataColumn) => c.align ?? (c.type === 'number' || c.type === 'currency' ? 'right' : 'left');
  const head = columns.map(({ c }) => `<th style="text-align:${align(c)}">${esc(c.title)}</th>`).join('');
  const body = index.map((r) => { const lk = looks?.(spec.rows[r]); return `<tr>${columns.map(({ c, i }) => `<td style="text-align:${align(c)}${lookCss(lk ? lk.cells[i] ?? lk.row : null)}">${esc(formatCell(c, spec.rows[r][i], o.locale))}</td>`).join('')}</tr>`; }).join('');
  const totals = columns.some(({ c }) => c.total)
    ? `<tfoot><tr>${columns.map(({ c, i }, k) => { const t = c.total ? aggregate(c, c.total, spec.rows, index, i) : null; return `<td style="text-align:${align(c)}">${t === null ? (k === 0 ? 'Total' : '') : esc(formatCell(c.total === 'count' ? { ...c, type: 'number', decimals: 0 } : c, t, o.locale))}</td>`; }).join('')}</tr></tfoot>`
    : '';
  const title = o.title ?? spec.options.title;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title || 'Table')}</title><style>@page{margin:14mm}body{font:12px/1.4 system-ui,sans-serif;color:#111;margin:0}h1{font-size:16px;margin:0 0 8px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #888;padding:4px 8px;vertical-align:top}th{background:#e7ecf3;font-weight:600}thead{display:table-header-group}tfoot{display:table-footer-group;font-weight:600}tr{break-inside:avoid}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${title ? `<h1>${esc(title)}</h1>` : ''}<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody>${totals}</table></body></html>`;
}

// ---- reading .xlsx (also with no library: a zip reader, the browser's own inflate, and a few XML parts)

const MAX_UNZIPPED = 64 * 1024 * 1024;

async function inflateRaw(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack compressed files.');
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  writer.write(data as BufferSource).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('The file is too large to open.'); }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Reads the entries of a zip archive. Entries are unpacked on demand, and each one is size-checked. */
function openZip(bytes: Uint8Array): { names: string[]; read(name: string): Promise<string | null> } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('This is not a spreadsheet file.');
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const entries = new Map<string, { method: number; csize: number; usize: number; offset: number }>();
  let total = 0;
  for (let i = 0; i < count && at + 46 <= bytes.length; i++) {
    if (v.getUint32(at, true) !== 0x02014b50) break;
    const method = v.getUint16(at + 10, true), csize = v.getUint32(at + 20, true), usize = v.getUint32(at + 24, true);
    const nl = v.getUint16(at + 28, true), el = v.getUint16(at + 30, true), cl = v.getUint16(at + 32, true), offset = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nl));
    total += usize;
    if (usize > MAX_UNZIPPED || total > MAX_UNZIPPED * 2) throw new Error('The file is too large to open.');
    entries.set(name, { method, csize, usize, offset });
    at += 46 + nl + el + cl;
  }
  return {
    names: [...entries.keys()],
    async read(name) {
      const e = entries.get(name);
      if (!e) return null;
      const start = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
      const raw = bytes.subarray(start, start + e.csize);
      const data = e.method === 0 ? raw : e.method === 8 ? await inflateRaw(raw, Math.min(MAX_UNZIPPED, e.usize + 1024)) : null;
      if (!data) throw new Error('This spreadsheet uses a compression method that is not supported.');
      return new TextDecoder().decode(data);
    },
  };
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
const isDateFormat = (id: number, custom: Map<number, string>) => BUILTIN_DATE_FORMATS.has(id) || /[dmyhs]/i.test((custom.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, ''));
const colIndex = (ref: string) => { let n = 0; for (const ch of /^[A-Z]+/i.exec(ref)?.[0] ?? '') n = n * 26 + (ch.toUpperCase().charCodeAt(0) - 64); return n - 1; };
const fromSerial = (n: number) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);

/**
 * The first visible sheet of an .xlsx file as plain rows: text, numbers, true/false and dates (as YYYY-MM-DD). Formulas give their last
 * calculated value. Needs `DOMParser` and `DecompressionStream`, which every current browser has.
 */
export async function parseXlsx(input: ArrayBuffer | Uint8Array): Promise<{ rows: unknown[][]; sheet: string }> {
  const zip = openZip(input instanceof Uint8Array ? input : new Uint8Array(input));
  const parse = (xmlText: string | null) => {
    if (xmlText === null) return null;
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    return doc.getElementsByTagName('parsererror').length ? null : doc;
  };
  const all = (node: ParentNode, tag: string) => Array.from((node as Element).getElementsByTagName(tag));
  const book = parse(await zip.read('xl/workbook.xml'));
  if (!book) throw new Error('This is not a spreadsheet file.');
  const sheets = all(book, 'sheet').filter((s) => s.getAttribute('state') !== 'hidden' && s.getAttribute('state') !== 'veryHidden');
  const first = sheets[0];
  if (!first) throw new Error('The workbook has no sheets.');
  const rid = first.getAttribute('r:id') ?? first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
  const rels = parse(await zip.read('xl/_rels/workbook.xml.rels'));
  const target = rels && all(rels, 'Relationship').find((r) => r.getAttribute('Id') === rid)?.getAttribute('Target');
  const path = target ? (target.startsWith('/') ? target.slice(1) : `xl/${target}`) : 'xl/worksheets/sheet1.xml';
  const sheet = parse(await zip.read(path));
  if (!sheet) throw new Error('The first sheet could not be read.');

  const strings: string[] = [];
  const sst = parse(await zip.read('xl/sharedStrings.xml'));
  if (sst) for (const si of all(sst, 'si')) strings.push(all(si, 't').filter((t) => !t.closest('rPh')).map((t) => t.textContent ?? '').join(''));

  const custom = new Map<number, string>();
  const dateStyle: boolean[] = [];
  const styles = parse(await zip.read('xl/styles.xml'));
  if (styles) {
    for (const n of all(styles, 'numFmt')) custom.set(Number(n.getAttribute('numFmtId')), n.getAttribute('formatCode') ?? '');
    const xfs = all(styles, 'cellXfs')[0];
    if (xfs) for (const xf of Array.from(xfs.children)) dateStyle.push(isDateFormat(Number(xf.getAttribute('numFmtId')), custom));
  }

  const rows: unknown[][] = [];
  let next = 0;
  for (const row of all(sheet, 'row')) {
    const at = Number(row.getAttribute('r')) - 1;
    const r = Number.isInteger(at) && at >= 0 ? at : next;
    if (r > MAX_ROWS) break;
    while (rows.length < r) rows.push([]);
    const cells: unknown[] = [];
    let col = 0;
    for (const c of Array.from(row.children).filter((x) => x.tagName === 'c')) {
      const ref = c.getAttribute('r');
      col = ref ? colIndex(ref) : col;
      if (col >= MAX_COLUMNS) { col++; continue; }
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      const type = c.getAttribute('t');
      let value: unknown = '';
      if (type === 's') value = strings[Number(v)] ?? '';
      else if (type === 'str') value = v;
      else if (type === 'inlineStr') value = all(c, 't').map((t) => t.textContent ?? '').join('');
      else if (type === 'b') value = v === '1';
      else if (type === 'e') value = '';
      else if (type === 'd') value = parseDate(v) ?? v;
      else if (v !== '') { const n = Number(v); value = Number.isFinite(n) ? (dateStyle[Number(c.getAttribute('s'))] && n >= 1 && n < 2958466 ? fromSerial(n) : n) : v; }
      cells[col] = value;
      col++;
    }
    rows.push(Array.from(cells, (x) => x ?? ''));
    next = r + 1;
  }
  return { rows, sheet: first.getAttribute('name') ?? 'Sheet1' };
}
