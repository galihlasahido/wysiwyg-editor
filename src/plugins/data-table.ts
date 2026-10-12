import type { DOMOutputSpec, Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { openDialog } from '../dialog';
import { checkFormula, FORMULA_FUNCTIONS } from '../data-table-formula';
import type { Editor } from '../editor';
import { download } from '../export';
import {
  AGGREGATES, COLUMN_TYPES, LOOKS, MAX_COLUMNS, MAX_ROWS, PAGE_SIZES, aggregate, cleanSpec, coerceCell, formatCell, groupDisplay, normalizeRows, parseCSV, parseXlsx, queryRows, ruleLooks, specFromRows, toCSV, toPrintHTML, toXlsx, withFormulas,
  type Aggregate, type Cell, type ColumnType, type DataColumn, type DataPage, type DataQuery, type DataTableSpec, type DisplayRow, type FormatRule, type GroupInfo, type Look, type SavedView, type ViewState,
} from '../data-table';
import type { ContextMenuEntry, EditorPlugin } from '../types';

export type { Aggregate, ColumnType, DataColumn, DataPage, DataQuery, DataTableSpec, FormatRule, Look, SavedView, Cell as DataCell };
export {
  cleanSpec as cleanDataTable, formatCell as formatDataCell, queryRows as queryDataRows, specFromRows as dataTableFromRows,
  withFormulas as dataTableWithFormulas, ruleLooks as dataTableRuleLooks, toCSV as dataTableToCSV, toPrintHTML as dataTableToPrintHTML, toXlsx as dataTableToXlsx, parseCSV, parseXlsx,
};

/** What a custom button or row action is given. */
export interface DataTableContext {
  editor: Editor;
  spec: DataTableSpec;
  /** The rows that are ticked, as `{ columnKey: value }`. */
  selected: Record<string, Cell>[];
  /** Every row that passes the current search and filters, in the current order (all pages). */
  visible: Record<string, Cell>[];
}

export interface DataTableButton {
  id: string;
  label: string;
  title?: string;
  /** Only enabled while at least one row is ticked. */
  needsSelection?: boolean;
  onClick(ctx: DataTableContext): void;
}

export interface DataTableRowAction {
  label: string;
  title?: string;
  onClick(row: Record<string, Cell>, index: number, ctx: DataTableContext): void;
}

export interface DataTablePluginOptions {
  /** Buttons added to the table's toolbar. */
  buttons?: DataTableButton[];
  /** A button at the end of every row. */
  rowActions?: DataTableRowAction[];
  /** Language for numbers and dates (default: the browser's). */
  locale?: string;
  /**
   * Data sources for tables that load their rows page by page (`options.source` names one). The function is given what to show (page,
   * search, filters, sort) and answers with that page and the total number of matching rows. The rows are not stored in the document.
   */
  sources?: Record<string, (query: DataQuery) => Promise<DataPage> | DataPage>;
  /**
   * What to show when a row is opened (for tables with `options.detail`): an element, or text. May be async. Without it the row's
   * fields are listed, including the hidden columns.
   */
  detail?: (row: Record<string, Cell>, index: number, ctx: DataTableContext) => Node | string | Promise<Node | string>;
  /** Called when a cell of a loaded table is edited. Without it, loaded tables cannot be edited. The table reloads afterwards. */
  onEdit?: (change: { source: string; key: string; value: Cell; row: Record<string, Cell>; index: number }) => Promise<unknown> | unknown;
}

/** The API on `editor.extensions.dataTable`. */
export interface DataTableApi {
  addButton(button: DataTableButton): void;
  addRowAction(action: DataTableRowAction): void;
  /** Register or replace a data source for loaded tables. */
  addSource(name: string, load: (query: DataQuery) => Promise<DataPage> | DataPage): void;
  /** Reload the active table from its source. */
  refresh(): void;
  /** The table that commands act on: the selected one, the one last used, or the only one in the document. */
  active(): { spec: DataTableSpec; selected(): Record<string, Cell>[]; visible(): Record<string, Cell>[] } | null;
  export(format: 'csv' | 'xlsx', options?: { selectedOnly?: boolean }): Blob | null;
}

interface Host {
  editor: Editor;
  options: DataTablePluginOptions;
  views: Map<HTMLElement, DataTableView>;
  last: DataTableView | null;
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (label: string, cls: string, onClick: (e: MouseEvent) => void, title?: string) => {
  const b = el('button', cls, label);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table';
const asRecord = (spec: DataTableSpec, rows: Cell[][], r: number): Record<string, Cell> => Object.fromEntries(spec.columns.map((c, i) => [c.key, rows[r]?.[i] ?? null]));

/** One line of the body: a group heading or a data row. */
type Line = { kind: 'row'; r: number } | { kind: 'group'; g: GroupInfo; folded: boolean } | { kind: 'detail'; r: number };

/** The lines to draw for these rows: a heading wherever the group changes (and at the top, so a page always says where it is). */
function buildLines(rows: DisplayRow[], expanded: ReadonlySet<number> = new Set()): Line[] {
  const out: Line[] = [];
  let prev: GroupInfo[] = [];
  for (const d of rows) {
    let common = 0;
    while (common < d.path.length && common < prev.length && prev[common].key === d.path[common].key) common++;
    for (let k = common; k < d.path.length; k++) out.push({ kind: 'group', g: d.path[k], folded: d.r === -1 && k === d.path.length - 1 });
    if (d.r !== -1) { out.push({ kind: 'row', r: d.r }); if (expanded.has(d.r)) out.push({ kind: 'detail', r: d.r }); }
    prev = d.path;
  }
  return out;
}

/** Above this many lines with paging off, only the lines in view are drawn. */
const VIRTUAL_MIN = 200;
const OVERSCAN = 20;
const ROW_HEIGHT = { compact: 30, normal: 38, comfortable: 48 } as const;
const REMOTE_PAGE = 25;

interface MenuItem { label: string; checked?: boolean; disabled?: boolean; run(): void }

/** A small menu under a button. Arrow keys move, Enter or click chooses, Escape or a click elsewhere closes. */
function popMenu(anchor: HTMLElement, host: HTMLElement, items: (MenuItem | '-')[]): void {
  host.querySelectorAll('.wy-dt-menu').forEach((m) => m.remove());
  const menu = el('div', 'wy-dt-menu');
  menu.setAttribute('role', 'menu');
  const buttons: HTMLButtonElement[] = [];
  const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); anchor.focus?.(); };
  const outside = (e: MouseEvent) => { if (!menu.contains(e.target as Node) && e.target !== anchor) { menu.remove(); document.removeEventListener('mousedown', outside, true); } };
  for (const it of items) {
    if (it === '-') { const s = el('div', 'wy-dt-menu-sep'); s.setAttribute('role', 'separator'); menu.append(s); continue; }
    const b = el('button', 'wy-dt-menu-item', it.label);
    b.type = 'button';
    b.disabled = !!it.disabled;
    b.setAttribute('role', it.checked === undefined ? 'menuitem' : 'menuitemcheckbox');
    if (it.checked !== undefined) b.setAttribute('aria-checked', String(it.checked));
    b.addEventListener('click', () => { close(); it.run(); });
    buttons.push(b);
    menu.append(b);
  }
  menu.addEventListener('keydown', (e) => {
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(at + 1) % buttons.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(at - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === 'Tab') close();
  });
  host.append(menu);
  const a = anchor.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(a.left - h.left, h.width - 200))}px`;
  menu.style.top = `${a.bottom - h.top + 2}px`;
  document.addEventListener('mousedown', outside, true);
  buttons.find((b) => !b.disabled)?.focus();
}

/** Prints a standalone page in a hidden frame; in the print dialog choose "Save as PDF". */
async function printPage(html: string): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Print';
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  const loaded = new Promise<void>((ok) => frame.addEventListener('load', () => ok(), { once: true }));
  frame.srcdoc = html;
  document.body.append(frame);
  await loaded;
  const win = frame.contentWindow!;
  const cleanup = () => frame.remove();
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 5 * 60 * 1000);
  win.focus();
  win.print();
}

/** The bytes of a file picked by the user. */
const readBytes = (file: Blob) => new Promise<Uint8Array>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer)); r.onerror = () => bad(r.error); r.readAsArrayBuffer(file); });

const defaultColumnTitle = (spec: DataTableSpec) => `Column ${spec.columns.length + 1}`;

class DataTableView implements NodeView {
  dom: HTMLElement;
  private spec: DataTableSpec | null = null;
  private raw = '';
  private state: ViewState = { search: '', filters: {}, sort: [] };
  private page = 0;
  private pageSize = 10;
  private selected = new Set<number>();
  private index: number[] = [];
  /** The cell with the keyboard focus: `row` counts data rows only (group headings are skipped). */
  private active = { row: 0, col: 0 };
  private collapsed = new Set<string>();
  private expanded = new Set<number>();
  private eff: DataTableSpec | null = null;
  private barMax: number[] = [];
  private dragRow = -1;
  private display: DisplayRow[] = [];
  private lines: Line[] = [];
  private rowLines: number[] = [];
  private virtual = false;
  private rowH = 38;
  private rendered = { from: 0, to: 0 };
  private scrollFrame = 0;
  private remoteRows: Cell[][] = [];
  private remoteTotal = 0;
  private remoteTotals: Record<string, number | null> | null = null;
  private remoteLoaded = false;
  private loadError = '';
  private seq = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private destroyed = false;
  private editing: { td: HTMLElement; r: number; c: number; cancelled: boolean } | null = null;
  private paintedReadOnly = false;
  private titleEl = el('div', 'wy-dt-title');
  private bar = el('div', 'wy-dt-bar');
  private scroll = el('div', 'wy-dt-scroll');
  private table = el('table', 'wy-dt-table');
  private thead = el('thead');
  private tbody = el('tbody');
  private tfoot = el('tfoot');
  private foot = el('div', 'wy-dt-foot');
  private handle = el('button', 'wy-dt-handle', '⠿');
  private deleteBtn: HTMLButtonElement | null = null;
  private customBtns: { b: HTMLButtonElement; def: DataTableButton }[] = [];

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private host: Host) {
    this.dom = el('figure', 'wy-dt');
    this.dom.contentEditable = 'false';
    this.table.setAttribute('role', 'grid');
    this.table.append(this.thead, this.tbody, this.tfoot);
    this.scroll.append(this.table);
    this.dom.append(this.titleEl, this.bar, this.scroll, this.foot);
    this.handle.type = 'button';
    this.handle.title = 'Select the data table (then Delete removes it)';
    this.handle.setAttribute('aria-label', 'Select the data table');
    this.handle.addEventListener('click', () => {
      const pos = this.getPos();
      if (pos === undefined) return;
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      this.view.focus();
    });
    host.views.set(this.dom, this);
    this.dom.addEventListener('pointerenter', () => { if (this.readOnly !== this.paintedReadOnly) this.paintAll(); });
    this.dom.addEventListener('focusin', () => { host.last = this; });
    this.dom.addEventListener('pointerdown', () => { host.last = this; });
    this.dom.addEventListener('click', (e) => this.onClick(e));
    this.dom.addEventListener('dblclick', (e) => { const td = (e.target as HTMLElement).closest<HTMLElement>('td[data-col]'); if (td) this.startEdit(td); });
    this.dom.addEventListener('keydown', (e) => this.onKey(e));
    this.dom.addEventListener('change', (e) => this.onChange(e));
    this.scroll.addEventListener('scroll', () => this.onScroll());
    this.dom.addEventListener('pointerdown', (e) => this.onResizeStart(e));
    this.dom.addEventListener('dblclick', (e) => { const g = (e.target as HTMLElement).closest<HTMLElement>('[data-role="resize"]'); if (g) this.setWidth(Number(g.dataset.col), null); });
    this.dom.addEventListener('dragstart', (e) => this.onDragStart(e));
    this.dom.addEventListener('dragover', (e) => this.onDragOver(e));
    this.dom.addEventListener('drop', (e) => this.onDrop(e));
    this.dom.addEventListener('dragend', () => this.endDrag());
    this.load(node);
    this.paintAll();
  }

  private get readOnly() { return this.host.editor.isReadOnly; }
  private get locale() { return this.host.options.locale; }
  private get isRemote() { return !!this.spec?.options.source; }
  /** The rows that are being shown from: the document's, or the page the data source sent. */
  private get rows(): Cell[][] { return this.eff?.rows ?? []; }
  get canEditCells() { return !this.readOnly && (!this.isRemote || !!this.host.options.onEdit); }
  get canEditRows() { return !this.readOnly && !this.isRemote; }

  private load(node: PMNode) {
    this.node = node;
    this.raw = String(node.attrs.spec);
    this.spec = cleanSpec(this.raw);
    this.eff = this.spec ? withFormulas(this.spec) : null;
    if (!this.spec) return;
    const keys = new Set(this.spec.columns.map((c) => c.key));
    this.state.filters = Object.fromEntries(Object.entries(this.state.filters).filter(([k]) => keys.has(k)));
    this.state.sort = this.state.sort.filter((s) => keys.has(s.key));
    this.pageSize = this.spec.options.source ? this.spec.options.pageSize || REMOTE_PAGE : this.spec.options.pageSize;
    this.selected = new Set([...this.selected].filter((r) => r < this.rows.length));
  }

  // ---- node view protocol

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    const changed = String(node.attrs.spec) !== this.raw;
    this.node = node;
    if (changed) {
      const sizeBefore = this.spec?.options.pageSize;
      this.load(node);
      if (this.spec && this.spec.options.pageSize !== sizeBefore) this.page = 0;
      this.remoteLoaded = false;
      this.paintAll();
    }
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent() { return true; } // the table handles its own mouse and keys
  ignoreMutation() { return true; }
  destroy() { this.destroyed = true; clearTimeout(this.timer); cancelAnimationFrame(this.scrollFrame); this.host.views.delete(this.dom); if (this.host.last === this) this.host.last = null; }

  // ---- reading

  get data(): DataTableSpec | null { return this.spec; }
  visibleRows(): Record<string, Cell>[] { return this.spec ? this.index.map((r) => asRecord(this.spec!, this.rows, r)) : []; }
  selectedRows(): Record<string, Cell>[] { return this.spec ? [...this.selected].sort((a, b) => a - b).map((r) => asRecord(this.spec!, this.rows, r)) : []; }
  private context(): DataTableContext { return { editor: this.host.editor, spec: this.spec!, selected: this.selectedRows(), visible: this.visibleRows() }; }
  get nodePos(): number | undefined { return this.getPos(); }

  // ---- writing

  /** Changes the data inside a copy, checks it, and stores it as one undoable step. */
  mutate(fn: (s: DataTableSpec) => boolean | void): void {
    if (!this.spec || this.readOnly) return;
    const next = JSON.parse(JSON.stringify(this.spec)) as DataTableSpec;
    if (fn(next) === false) return;
    const clean = cleanSpec(next);
    const pos = this.getPos();
    if (!clean || pos === undefined) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, spec: JSON.stringify(clean) }));
  }

  addRow(after?: number): void {
    if (!this.canEditRows) return;
    if (after !== undefined) this.expanded.clear();
    this.mutate((s) => {
      if (s.rows.length >= MAX_ROWS) return false;
      const row = s.columns.map((c) => coerceCell(c.type, null));
      s.rows.splice(after === undefined ? s.rows.length : after + 1, 0, row);
    });
    if (after === undefined && this.spec && this.pageSize) { this.page = Math.floor(this.index.length / this.pageSize); this.paintRows(); }
  }
  duplicateRow(r: number): void { if (!this.canEditRows) return; this.expanded.clear(); this.mutate((s) => { if (s.rows.length >= MAX_ROWS) return false; s.rows.splice(r + 1, 0, [...s.rows[r]]); }); }
  deleteRows(rows: number[]): void {
    if (!this.canEditRows) return;
    const drop = new Set(rows);
    this.selected = new Set();
    this.expanded.clear();
    this.mutate((s) => { s.rows = s.rows.filter((_, i) => !drop.has(i)); });
  }
  setCell(r: number, c: number, raw: unknown): void {
    if (this.spec?.columns[c]?.formula) return; // calculated, not typed
    if (this.isRemote) {
      const spec = this.spec;
      const onEdit = this.host.options.onEdit;
      if (!spec || !onEdit || this.readOnly || !spec.columns[c]) return;
      const col = spec.columns[c];
      const change = { source: spec.options.source, key: col.key, value: coerceCell(col.type, raw), row: asRecord(spec, this.rows, r), index: r };
      Promise.resolve().then(() => onEdit(change)).then(() => this.refresh(), (err) => { this.loadError = err instanceof Error ? err.message : 'The change was not saved.'; this.paintRows(); });
      return;
    }
    this.mutate((s) => { if (!s.rows[r] || c >= s.columns.length) return false; s.rows[r][c] = coerceCell(s.columns[c].type, raw); });
  }
  /** Moves a row so it ends up before row `to` (a row index; `rows.length` puts it last). */
  moveRow(from: number, to: number): void {
    if (!this.canReorder) return;
    this.selected = new Set();
    this.expanded.clear();
    this.mutate((s) => {
      if (from < 0 || from >= s.rows.length) return false;
      let at = Math.max(0, Math.min(s.rows.length, to));
      if (at > from) at--;
      if (at === from) return false;
      const [row] = s.rows.splice(from, 1);
      s.rows.splice(at, 0, row);
    });
  }
  setWidth(i: number, width: number | null): void {
    this.mutate((s) => { if (!s.columns[i]) return false; if (width === null) delete s.columns[i].width; else s.columns[i].width = Math.max(40, Math.min(1200, Math.round(width))); });
  }
  moveColumn(i: number, dir: -1 | 1): void {
    this.mutate((s) => {
      const j = i + dir;
      if (j < 0 || j >= s.columns.length) return false;
      [s.columns[i], s.columns[j]] = [s.columns[j], s.columns[i]];
      for (const r of s.rows) [r[i], r[j]] = [r[j], r[i]];
    });
  }
  deleteColumn(i: number): void {
    this.mutate((s) => {
      if (s.columns.length <= 1) return false;
      s.columns.splice(i, 1);
      for (const r of s.rows) r.splice(i, 1);
    });
  }
  setHidden(i: number, hidden: boolean): void {
    this.mutate((s) => {
      if (hidden && s.columns.filter((c) => !c.hidden).length <= 1) return false; // never hide the last one
      if (hidden) s.columns[i].hidden = true; else delete s.columns[i].hidden;
    });
  }
  sortBy(key: string, dir: 'asc' | 'desc' | null, add = false): void {
    const rest = add ? this.state.sort.filter((s) => s.key !== key) : [];
    this.state.sort = dir ? [...rest, { key, dir }] : rest;
    this.page = 0;
    this.paintHead();
    this.refresh();
  }
  /** Group by this column (or add it as a sub-group); `null` stops grouping. */
  groupBy(key: string | null, add = false): void {
    this.collapsed.clear();
    this.mutate((s) => { s.options.groupBy = key === null ? [] : add ? [...s.options.groupBy.filter((k) => k !== key), key] : [key]; });
  }

  // ---- data from a source

  /** Reload now (a loaded table asks its source again; a stored one just redraws). */
  refresh(): void {
    clearTimeout(this.timer);
    if (this.isRemote) void this.loadRemote(); else this.paintRows();
  }
  /** Reload soon: a box being typed in does not ask the source on every key. */
  private changed(): void {
    if (!this.isRemote) { this.paintRows(); return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.loadRemote(), 300);
  }
  private query(page = this.page, size = this.pageSize): DataQuery {
    return { page, pageSize: size, search: this.state.search.trim(), filters: Object.fromEntries(Object.entries(this.state.filters).filter(([, v]) => v.trim())), sort: this.state.sort.map((s) => ({ ...s })), groupBy: [...this.spec!.options.groupBy] };
  }
  private async loadRemote(): Promise<void> {
    const spec = this.spec;
    if (!spec) return;
    this.remoteLoaded = true;
    const load = this.host.options.sources?.[spec.options.source];
    if (!load) { this.remoteRows = []; this.eff = withFormulas(spec, []); this.remoteTotal = 0; this.remoteTotals = null; this.loadError = `There is no data source named “${spec.options.source}”.`; this.paintRows(); return; }
    const seq = ++this.seq;
    this.dom.setAttribute('aria-busy', 'true');
    this.dom.classList.add('is-loading');
    try {
      const res = await load(this.query());
      if (this.destroyed || seq !== this.seq) return;
      this.remoteRows = normalizeRows(spec.columns, res?.rows);
      this.eff = withFormulas(spec, this.remoteRows);
      this.remoteTotal = Math.max(0, Math.floor(Number(res?.total)) || this.remoteRows.length);
      this.remoteTotals = res?.totals && typeof res.totals === 'object' ? res.totals : null;
      this.loadError = '';
    } catch (err) {
      if (this.destroyed || seq !== this.seq) return;
      this.remoteRows = []; this.eff = withFormulas(spec, []); this.remoteTotal = 0; this.remoteTotals = null;
      this.loadError = err instanceof Error && err.message ? err.message : 'The data could not be loaded.';
    }
    this.dom.removeAttribute('aria-busy');
    this.dom.classList.remove('is-loading');
    this.selected.clear();
    this.expanded.clear();
    this.paintRows();
  }
  /** Every row that passes the search and filters, for export. A loaded table asks its source for all of them, a page at a time. */
  private async everything(): Promise<{ spec: DataTableSpec; rows: number[] } | null> {
    const spec = this.spec;
    if (!spec) return null;
    if (!this.isRemote) return { spec: this.eff ?? spec, rows: this.index };
    const load = this.host.options.sources?.[spec.options.source];
    if (!load) return null;
    const all: Cell[][] = [];
    const size = 500;
    for (let page = 0; all.length < MAX_ROWS; page++) {
      const res = await load(this.query(page, size));
      const got = normalizeRows(spec.columns, res?.rows);
      all.push(...got);
      if (!got.length || all.length >= Number(res?.total)) break;
    }
    return { spec: withFormulas(spec, all), rows: all.map((_, i) => i) };
  }

  // ---- dialogs

  editColumn(i: number | null, after?: number): void {
    if (!this.spec || this.readOnly) return;
    const spec = this.spec;
    if (i === null && spec.columns.length >= MAX_COLUMNS) return;
    const col: DataColumn = i === null ? { key: '', title: defaultColumnTitle(spec), type: 'text' } : { ...spec.columns[i] };
    const form = el('div', 'wy-dt-form');
    const row = (label: string, input: HTMLElement) => { const l = el('label', 'wy-dt-field'); l.append(el('span', undefined, label), input); form.append(l); return l; };
    const title = el('input'); title.value = col.title; title.maxLength = 200;
    const type = el('select'); for (const t of COLUMN_TYPES) type.add(new Option(t[0].toUpperCase() + t.slice(1), t, false, t === col.type));
    const align = el('select'); for (const [v, l] of [['', 'Automatic'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']]) align.add(new Option(l, v, false, (col.align ?? '') === v));
    const decimals = el('input'); decimals.type = 'number'; decimals.min = '0'; decimals.max = '10'; decimals.value = col.decimals === undefined ? '' : String(col.decimals);
    const currency = el('input'); currency.maxLength = 3; currency.value = col.currency ?? 'USD';
    const options = el('textarea'); options.rows = 3; options.value = (col.options ?? []).join('\n');
    const formula = el('textarea'); formula.rows = 2; formula.value = col.formula ?? ''; formula.placeholder = '[Price] * [Qty]'; formula.maxLength = 500; formula.spellcheck = false;
    const bar = el('input'); bar.type = 'checkbox'; bar.checked = !!col.bar;
    const problem = el('p', 'wy-dt-error'); problem.hidden = true; problem.setAttribute('role', 'alert');
    const total = el('select'); total.add(new Option('None', '')); for (const a of AGGREGATES) total.add(new Option(a[0].toUpperCase() + a.slice(1), a, false, col.total === a));
    row('Title', title); row('Type', type); const decRow = row('Decimals (empty = automatic)', decimals); const curRow = row('Currency code', currency); const optRow = row('Choices (one per line)', options); row('Align', align); const totRow = row('Total in footer', total);
    const forRow = row('Formula (calculated from the other columns; leave empty to type values)', formula);
    const barRow = el('label', 'wy-dt-field wy-dt-check'); barRow.append(bar, el('span', undefined, 'Bar in each cell')); form.append(barRow);
    form.append(el('p', 'wy-dt-hint', `Functions: ${FORMULA_FUNCTIONS.join(', ')}. Columns as [Title].`), problem);
    const sync = () => {
      const t = type.value as ColumnType;
      decRow.hidden = !(t === 'number' || t === 'currency');
      curRow.hidden = t !== 'currency';
      optRow.hidden = t !== 'select';
      totRow.hidden = !(t === 'number' || t === 'currency');
      forRow.hidden = t === 'boolean' || t === 'select';
      barRow.hidden = !(t === 'number' || t === 'currency');
    };
    type.addEventListener('change', sync);
    sync();
    openDialog(this.host.editor.root, {
      title: i === null ? 'Add column' : 'Edit column',
      body: form,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', primary: true,
        onClick: () => {
          const f = formula.value.trim();
          if (f && !forRow.hidden) {
            const names = spec.columns.flatMap((c, k) => (k === i ? [] : [c.title, c.key]));
            const why = checkFormula(f, names);
            if (why) { problem.textContent = why; problem.hidden = false; formula.focus(); return false; }
          }
          return this.mutate((s) => {
          const t = type.value as ColumnType;
          const next: DataColumn = { ...col, title: title.value.trim() || col.title, type: t };
          if (f && !forRow.hidden) next.formula = f; else delete next.formula;
          if (bar.checked && (t === 'number' || t === 'currency')) next.bar = true; else delete next.bar;
          if (align.value) next.align = align.value as DataColumn['align']; else delete next.align;
          if (decimals.value !== '' && (t === 'number' || t === 'currency')) next.decimals = Number(decimals.value); else delete next.decimals;
          if (t === 'currency') next.currency = currency.value.trim().toUpperCase(); else delete next.currency;
          if (t === 'select') next.options = options.value.split('\n').map((x) => x.trim()).filter(Boolean); else delete next.options;
          if (total.value && (t === 'number' || t === 'currency' || total.value === 'count')) next.total = total.value as Aggregate; else delete next.total;
          if (i === null) {
            next.key = `c${Date.now().toString(36)}`;
            const at = after === undefined ? s.columns.length : after + 1;
            s.columns.splice(at, 0, next);
            for (const r of s.rows) r.splice(at, 0, coerceCell(t, null));
          } else {
            s.columns[i] = next;
            if (next.type !== col.type) for (const r of s.rows) r[i] = coerceCell(next.type, r[i]);
          }
          });
        },
      }],
    });
  }

  editOptions(): void {
    if (!this.spec || this.readOnly) return;
    const o = this.spec.options;
    const form = el('div', 'wy-dt-form');
    const row = (label: string, input: HTMLElement, check = false) => { const l = el('label', check ? 'wy-dt-field wy-dt-check' : 'wy-dt-field'); if (check) l.append(input, el('span', undefined, label)); else l.append(el('span', undefined, label), input); form.append(l); };
    const title = el('input'); title.value = o.title; title.maxLength = 300;
    const size = el('select'); for (const n of PAGE_SIZES) size.add(new Option(n ? `${n} rows` : 'All rows (no paging)', String(n), false, n === o.pageSize)); if (!PAGE_SIZES.includes(o.pageSize)) size.add(new Option(`${o.pageSize} rows`, String(o.pageSize), true, true));
    const density = el('select'); for (const d of ['compact', 'normal', 'comfortable']) density.add(new Option(d[0].toUpperCase() + d.slice(1), d, false, d === o.density));
    const height = el('input'); height.type = 'number'; height.min = '0'; height.step = '10'; height.value = o.height ? String(o.height) : '';
    const check = (v: boolean) => { const c = el('input'); c.type = 'checkbox'; c.checked = v; return c; };
    const [search, filters, striped, bordered, selectable, detail, reorder] = [check(o.search), check(o.filters), check(o.striped), check(o.bordered), check(o.selectable), check(o.detail), check(o.reorder)];
    row('Title', title); row('Rows per page', size); row('Row height', density); row('Scroll after this height in pixels (empty = grow)', height);
    row('Search box', search, true); row('Filter row under the headings', filters, true); row('Striped rows', striped, true); row('Cell borders', bordered, true); row('Tick boxes to select rows', selectable, true); row('Rows open to show their details', detail, true); row('Rows can be dragged into a new order', reorder, true);
    openDialog(this.host.editor.root, {
      title: 'Table options',
      body: form,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', primary: true,
        onClick: () => this.mutate((s) => {
          s.options = { ...s.options, title: title.value.trim(), pageSize: Number(size.value), density: density.value as typeof o.density, height: Number(height.value) || 0, search: search.checked, filters: filters.checked, striped: striped.checked, bordered: bordered.checked, selectable: selectable.checked, detail: detail.checked, reorder: reorder.checked };
        }),
      }],
    });
  }

  // ---- export

  exportAs(format: 'csv' | 'xlsx' | 'pdf', selectedOnly = this.selected.size > 0): void {
    void this.exportNow(format, selectedOnly);
  }
  private async exportNow(format: 'csv' | 'xlsx' | 'pdf', selectedOnly: boolean): Promise<void> {
    // a selection is made of rows on screen; without one a loaded table fetches everything that matches
    const source = selectedOnly && this.selected.size ? { spec: this.spec!, rows: this.exportRows(true) } : await this.everything().catch(() => null);
    if (!source) return;
    const name = slug(source.spec.options.title || 'table');
    const o = { rows: source.rows, locale: this.locale };
    if (format === 'pdf') await printPage(toPrintHTML(source.spec, o));
    else if (format === 'csv') download(new Blob([toCSV(source.spec, o)], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    else download(new Blob([toXlsx(source.spec, o) as BlobPart], { type: MIME_XLSX }), `${name}.xlsx`);
  }
  private exportRows(selectedOnly: boolean): number[] { return selectedOnly && this.selected.size ? this.index.filter((r) => this.selected.has(r)) : this.index; }
  /** The rows on screen as a file (a loaded table: this page only; use `exportAs` to get all of them). */
  exportBlob(format: 'csv' | 'xlsx', selectedOnly = false): Blob | null {
    if (!this.spec) return null;
    const spec = this.eff ?? this.spec;
    const o = { rows: this.exportRows(selectedOnly), locale: this.locale };
    return format === 'csv' ? new Blob([toCSV(spec, o)], { type: 'text/csv;charset=utf-8' }) : new Blob([toXlsx(spec, o) as BlobPart], { type: MIME_XLSX });
  }

  // ---- painting

  private paintAll() {
    this.paintedReadOnly = this.readOnly;
    const spec = this.spec;
    this.dom.className = 'wy-dt';
    if (!spec) { this.dom.classList.add('is-broken'); this.titleEl.textContent = ''; this.bar.replaceChildren(); this.thead.replaceChildren(); this.tbody.replaceChildren(); this.tfoot.replaceChildren(); this.foot.textContent = 'This data table has no data.'; return; }
    const o = spec.options;
    this.dom.classList.toggle('is-striped', o.striped);
    this.dom.classList.toggle('is-bordered', o.bordered);
    this.dom.classList.add(`is-${o.density}`);
    this.titleEl.textContent = o.title;
    this.titleEl.hidden = !o.title;
    this.paintBar();
    this.paintHead();
    if (this.isRemote && !this.remoteLoaded) void this.loadRemote(); else this.paintRows();
  }

  private paintBar() {
    const spec = this.spec!;
    this.bar.replaceChildren();
    this.bar.setAttribute('role', 'toolbar');
    this.bar.setAttribute('aria-label', spec.options.title || 'Table tools');
    const ro = this.readOnly;
    this.bar.append(this.handle);
    if (spec.options.search) {
      const input = el('input', 'wy-dt-search');
      input.type = 'search';
      input.placeholder = 'Search…';
      input.setAttribute('aria-label', 'Search the table');
      input.value = this.state.search;
      input.addEventListener('input', () => { this.state.search = input.value; this.page = 0; this.changed(); });
      this.bar.append(input);
    }
    this.bar.append(el('span', 'wy-dt-spacer'));
    this.customBtns = [];
    if (this.isRemote) this.bar.append(button('Refresh', 'wy-dt-btn', () => this.refresh()));
    for (const def of this.host.options.buttons ?? []) {
      const b = button(def.label, 'wy-dt-btn', () => def.onClick(this.context()), def.title);
      b.disabled = !!def.needsSelection && !this.selected.size;
      this.customBtns.push({ b, def });
      this.bar.append(b);
    }
    this.deleteBtn = null;
    if (!ro) {
      if (!this.isRemote) {
        this.bar.append(button('Add row', 'wy-dt-btn', () => this.addRow()));
        this.deleteBtn = button('', 'wy-dt-btn is-danger', () => this.deleteRows([...this.selected]));
        this.bar.append(this.deleteBtn);
      }
      const cols = button('Columns ▾', 'wy-dt-btn', (e) => popMenu(e.currentTarget as HTMLElement, this.dom, [
        ...spec.columns.map((c, i): MenuItem => ({ label: c.title || `Column ${i + 1}`, checked: !c.hidden, run: () => this.setHidden(i, !c.hidden) })),
        '-',
        { label: 'Add column…', disabled: spec.columns.length >= MAX_COLUMNS, run: () => this.editColumn(null) },
        ...(spec.options.groupBy.length ? ['-' as const, { label: 'Stop grouping', run: () => this.groupBy(null) }] : []),
      ]));
      cols.setAttribute('aria-haspopup', 'menu');
      this.bar.append(cols);
    }
    if (!ro || spec.views.length) {
      const views = button('Views ▾', 'wy-dt-btn', (e) => popMenu(e.currentTarget as HTMLElement, this.dom, [
        { label: 'Everything (clear search, filters and sort)', run: () => this.applyView(null) },
        ...spec.views.map((v): MenuItem => ({ label: v.name, run: () => this.applyView(v) })),
        ...(ro ? [] : ['-' as const, { label: 'Save current view…', disabled: spec.views.length >= 20, run: () => this.saveView() }, ...spec.views.map((v): MenuItem => ({ label: `Delete “${v.name}”`, run: () => this.deleteView(v.name) }))]),
      ]));
      views.setAttribute('aria-haspopup', 'menu');
      this.bar.append(views);
    }
    const exp = button('Export ▾', 'wy-dt-btn', (e) => popMenu(e.currentTarget as HTMLElement, this.dom, [
      { label: 'CSV', run: () => this.exportAs('csv') },
      { label: 'Excel (.xlsx)', run: () => this.exportAs('xlsx') },
      { label: 'PDF (print)…', run: () => this.exportAs('pdf') },
    ]));
    exp.setAttribute('aria-haspopup', 'menu');
    this.bar.append(exp);
    if (!ro) {
      const charts = this.host.editor.hasCommand('insertChart') ? (['bar', 'line', 'pie'] as const).map((t): MenuItem => ({ label: `Chart of these rows: ${t}`, run: () => { this.chart(t); } })) : [];
      const opt = button('Options ▾', 'wy-dt-btn', (e) => popMenu(e.currentTarget as HTMLElement, this.dom, [
        { label: 'Table options…', run: () => this.editOptions() },
        { label: 'Highlight rules…', run: () => this.editRules() },
        ...(charts.length ? ['-' as const, ...charts] : []),
      ]));
      opt.setAttribute('aria-haspopup', 'menu');
      this.bar.append(opt);
    }
    this.paintSelection();
  }

  private paintSelection() {
    const n = this.selected.size;
    if (this.deleteBtn) { this.deleteBtn.hidden = !n; this.deleteBtn.textContent = `Delete ${n} row${n === 1 ? '' : 's'}`; }
    for (const { b, def } of this.customBtns) b.disabled = !!def.needsSelection && !n;
  }

  private shownColumns() { return this.spec!.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.hidden); }
  private alignOf(c: DataColumn) { return c.align ?? (c.type === 'number' || c.type === 'currency' ? 'right' : c.type === 'boolean' ? 'center' : 'left'); }

  private paintHead() {
    const spec = this.spec!;
    const ro = this.readOnly;
    const tr = el('tr');
    for (const lead of this.leads()) {
      if (lead === 'sel') {
        const th = el('th', 'wy-dt-sel');
        const all = el('input'); all.type = 'checkbox'; all.setAttribute('aria-label', 'Select all rows on this page'); all.dataset.role = 'select-page';
        th.append(all); tr.append(th);
      } else tr.append(el('th', 'wy-dt-lead', lead === 'exp' ? 'Details' : 'Order'));
    }
    for (const { c, i } of this.shownColumns()) {
      const th = el('th');
      th.dataset.col = String(i);
      th.style.textAlign = this.alignOf(c);
      if (c.width) { th.style.width = `${c.width}px`; th.style.minWidth = `${c.width}px`; }
      const at = this.state.sort.findIndex((s) => s.key === c.key);
      th.setAttribute('aria-sort', at < 0 ? 'none' : this.state.sort[at].dir === 'asc' ? 'ascending' : 'descending');
      const b = el('button', 'wy-dt-th');
      b.type = 'button';
      b.dataset.role = 'sort';
      b.append(el('span', undefined, c.title || `Column ${i + 1}`));
      if (at >= 0) b.append(el('span', 'wy-dt-arrow', `${this.state.sort[at].dir === 'asc' ? '▲' : '▼'}${this.state.sort.length > 1 ? at + 1 : ''}`));
      b.title = 'Sort (Shift+click adds a second column)';
      th.append(b);
      if (!ro) {
        const m = el('button', 'wy-dt-colmenu', '⋮'); m.type = 'button'; m.dataset.role = 'column-menu'; m.setAttribute('aria-label', `Column options for ${c.title}`); m.setAttribute('aria-haspopup', 'menu'); th.append(m);
        const grip = el('span', 'wy-dt-resize');
        grip.dataset.role = 'resize'; grip.dataset.col = String(i);
        grip.setAttribute('role', 'separator'); grip.setAttribute('aria-orientation', 'vertical'); grip.tabIndex = 0; grip.setAttribute('aria-valuemin', '40'); grip.setAttribute('aria-valuemax', '1200'); grip.setAttribute('aria-valuenow', String(c.width ?? 120));
        grip.setAttribute('aria-label', `Resize column ${c.title} (arrow keys; double-click resets)`);
        th.append(grip);
      }
      tr.append(th);
    }
    if (this.host.options.rowActions?.length) tr.append(el('th', 'wy-dt-actions', 'Actions'));
    this.thead.replaceChildren(tr);
    if (spec.options.filters) {
      const f = el('tr', 'wy-dt-filters');
      for (let n = this.leads().length; n > 0; n--) f.append(el('td'));
      for (const { c } of this.shownColumns()) {
        const th = el('td');
        let input: HTMLInputElement | HTMLSelectElement;
        if (c.type === 'boolean' || c.type === 'select') {
          const s = el('select'); s.add(new Option('All', ''));
          if (c.type === 'boolean') { s.add(new Option('Yes', 'true')); s.add(new Option('No', 'false')); } else for (const o of c.options ?? []) s.add(new Option(o, o));
          input = s;
        } else {
          input = el('input');
          input.placeholder = c.type === 'text' ? 'Contains…' : c.type === 'date' ? '>2026-01-01' : '>5, 1..9';
        }
        input.value = this.state.filters[c.key] ?? '';
        input.setAttribute('aria-label', `Filter ${c.title}`);
        input.addEventListener(input instanceof HTMLSelectElement ? 'change' : 'input', () => { this.state.filters[c.key] = input.value; this.page = 0; this.changed(); });
        th.append(input); f.append(th);
      }
      if (this.host.options.rowActions?.length) f.append(el('td'));
      this.thead.append(f);
    }
  }

  private paintRows() {
    const spec = this.spec;
    if (!spec) return;
    this.finishEdit(false);
    const remote = this.isRemote;
    const rows = this.rows;
    this.index = remote ? rows.map((_, i) => i) : queryRows(spec, this.state, this.locale);
    this.display = groupDisplay(spec, this.index, this.collapsed, this.locale, rows);
    const total = remote ? this.remoteTotal : this.index.length;
    const size = this.pageSize;
    const pages = size ? Math.max(1, Math.ceil(total / size)) : 1;
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    // a loaded table was already given just this page; a stored one is cut here
    const shown = remote || !size ? this.display : this.display.slice(this.page * size, (this.page + 1) * size);
    this.virtual = !remote && !size && this.display.length > VIRTUAL_MIN;
    // in a long table every line has the same fixed height, so any line can be placed without drawing the ones above it
    this.rowH = ROW_HEIGHT[spec.options.density];
    this.table.style.setProperty('--wy-dt-row', `${this.rowH}px`);
    this.lines = buildLines(shown, spec.options.detail && !this.virtual ? this.expanded : new Set());
    this.barMax = this.shownColumns().map(({ c, i }) => { if (!c.bar) return 0; let m = 0; for (const r of this.index) { const v = this.rows[r]?.[i]; if (typeof v === 'number' && v > m) m = v; } return m; });
    this.rowLines = [];
    this.lines.forEach((l, i) => { if (l.kind === 'row') this.rowLines.push(i); });
    const cols = this.shownColumns();
    this.active.row = Math.min(this.active.row, Math.max(0, this.rowLines.length - 1));
    this.active.col = Math.min(this.active.col, Math.max(0, cols.length - 1));
    this.dom.classList.toggle('is-virtual', this.virtual);
    this.scroll.style.maxHeight = this.virtual ? `${spec.options.height || 480}px` : spec.options.height ? `${spec.options.height}px` : '';
    if (this.virtual) this.scroll.scrollTop = Math.min(this.scroll.scrollTop, Math.max(0, this.lines.length * this.rowH));
    this.rendered = { from: -1, to: -1 };
    this.renderLines();
    this.paintTotals();
    const sel = this.thead.querySelector<HTMLInputElement>('[data-role="select-page"]');
    if (sel) { const ids = this.lines.filter((l): l is Extract<Line, { kind: 'row' }> => l.kind === 'row').map((l) => l.r); sel.checked = ids.length > 0 && ids.every((r) => this.selected.has(r)); }
    this.paintFoot(total, pages);
    this.paintSelection();
  }

  /** The narrow cells before the data: a drag handle, an open/close button, a tick box. */
  private leads(): ('drag' | 'exp' | 'sel')[] {
    const o = this.spec!.options;
    const out: ('drag' | 'exp' | 'sel')[] = [];
    if (this.canReorder) out.push('drag');
    if (o.detail && !this.virtual) out.push('exp');
    if (o.selectable) out.push('sel');
    return out;
  }
  /** Rows can be put in a new order only while the order on screen is the order stored. */
  get canReorder(): boolean {
    const s = this.spec;
    return !!s?.options.reorder && this.canEditRows && !this.state.search.trim() && !this.state.sort.length && !s.options.groupBy.length && !Object.values(this.state.filters).some((v) => v.trim());
  }
  private colspan() { return this.shownColumns().length + this.leads().length + (this.host.options.rowActions?.length ? 1 : 0); }

  /** Draws the lines (all of them, or only those in view when the table is long and not paged). */
  private renderLines() {
    const spec = this.spec!;
    const lines = this.lines;
    const cols = this.shownColumns();
    const ro = this.readOnly;
    const actions = this.host.options.rowActions ?? [];
    let from = 0;
    let to = lines.length;
    if (this.virtual) {
      const h = this.rowH;
      const top = this.scroll.scrollTop;
      from = Math.max(0, Math.floor(top / h) - OVERSCAN);
      to = Math.min(lines.length, Math.ceil((top + (this.scroll.clientHeight || 480)) / h) + OVERSCAN);
    }
    this.rendered = { from, to };
    const activeLine = this.rowLines[this.active.row];
    const looks = spec.rules.length && this.eff ? ruleLooks(this.eff, this.locale) : null;
    const leads = this.leads();
    const orderable = this.canReorder;
    const out: HTMLElement[] = [];
    const pad = (n: number) => { const tr = el('tr', 'wy-dt-pad'); tr.setAttribute('aria-hidden', 'true'); const td = el('td'); td.colSpan = this.colspan(); td.style.height = `${n}px`; td.style.padding = '0'; td.style.border = '0'; tr.append(td); return tr; };
    if (this.virtual && from > 0) out.push(pad(from * this.rowH));
    for (let k = from; k < to; k++) {
      const line = lines[k];
      if (line.kind === 'group') { out.push(this.groupRow(line, k, cols)); continue; }
      if (line.kind === 'detail') { out.push(this.detailRow(line.r, k)); continue; }
      const r = line.r;
      const tr = el('tr');
      tr.dataset.row = String(r);
      tr.dataset.line = String(k);
      tr.setAttribute('aria-selected', String(this.selected.has(r)));
      if (this.selected.has(r)) tr.classList.add('is-selected');
      const look = looks?.(this.rows[r] ?? []);
      if (look?.row) tr.dataset.look = look.row;
      for (const lead of leads) {
        if (lead === 'sel') {
          const td = el('td', 'wy-dt-sel');
          const cb = el('input'); cb.type = 'checkbox'; cb.checked = this.selected.has(r); cb.dataset.role = 'select-row'; cb.setAttribute('aria-label', 'Select row');
          td.append(cb); tr.append(td);
        } else if (lead === 'exp') {
          const td = el('td', 'wy-dt-lead');
          const b = el('button', 'wy-dt-expand', this.expanded.has(r) ? '▾' : '▸'); b.type = 'button'; b.dataset.role = 'detail-toggle';
          b.setAttribute('aria-expanded', String(this.expanded.has(r))); b.setAttribute('aria-label', 'Show details');
          td.append(b); tr.append(td);
        } else {
          const td = el('td', 'wy-dt-lead wy-dt-drag');
          td.draggable = orderable; td.dataset.role = 'drag'; td.title = 'Drag to move this row (Alt+Up and Alt+Down also work)'; td.textContent = '⠿';
          tr.append(td);
        }
      }
      cols.forEach(({ c, i }, n) => {
        const td = el('td');
        td.dataset.col = String(i);
        td.style.textAlign = this.alignOf(c);
        const cl = look?.cells[i];
        if (cl) td.dataset.look = cl;
        if (c.bar && this.barMax[n] > 0) {
          const val = this.rows[r]?.[i];
          if (typeof val === 'number' && val > 0) { td.classList.add('wy-dt-barcell'); td.style.setProperty('--bar', `${Math.min(100, (val / this.barMax[n]) * 100).toFixed(1)}%`); }
        }
        td.tabIndex = k === activeLine && n === this.active.col ? 0 : -1;
        td.setAttribute('role', 'gridcell');
        const v = this.rows[r]?.[i] ?? null;
        if (c.type === 'boolean') {
          const cb = el('input'); cb.type = 'checkbox'; cb.checked = v === true; cb.disabled = ro || !this.canEditCells; cb.dataset.role = 'toggle'; cb.setAttribute('aria-label', c.title);
          td.append(cb);
        } else td.textContent = formatCell(c, v, this.locale);
        tr.append(td);
      });
      if (actions.length) {
        const td = el('td', 'wy-dt-actions');
        actions.forEach((a, ai) => { const b = el('button', 'wy-dt-btn', a.label); b.type = 'button'; b.title = a.title ?? ''; b.dataset.role = 'row-action'; b.dataset.action = String(ai); td.append(b); });
        tr.append(td);
      }
      out.push(tr);
    }
    if (this.virtual && to < lines.length) out.push(pad((lines.length - to) * this.rowH));
    if (!lines.length) {
      const tr = el('tr', 'wy-dt-empty');
      const td = el('td');
      td.colSpan = this.colspan();
      if (this.loadError) {
        td.append(el('span', 'wy-dt-error', this.loadError), ' ', button('Try again', 'wy-dt-btn', () => this.refresh()));
        td.setAttribute('role', 'alert');
      } else td.textContent = this.isRemote && !this.remoteLoaded ? 'Loading…' : this.rows.length || (this.isRemote && this.remoteTotal) ? 'No rows match.' : 'No rows yet.';
      tr.append(td); out.push(tr);
    }
    this.tbody.replaceChildren(...out);
    if (!this.tbody.querySelector('td[tabindex="0"]')) this.tbody.querySelector<HTMLElement>('tr[data-row] td[data-col]')?.setAttribute('tabindex', '0');
  }

  private groupRow(line: Extract<Line, { kind: 'group' }>, k: number, cols: { c: DataColumn; i: number }[]): HTMLElement {
    const { g, folded } = line;
    const tr = el('tr', 'wy-dt-group');
    tr.dataset.line = String(k);
    tr.dataset.group = g.key;
    const td = el('td');
    td.colSpan = this.colspan();
    td.style.paddingLeft = `${10 + g.depth * 18}px`;
    const toggle = el('button', 'wy-dt-gtoggle', `${folded ? '▸' : '▾'} ${g.label}`);
    toggle.type = 'button';
    toggle.dataset.role = 'group-toggle';
    toggle.setAttribute('aria-expanded', String(!folded));
    const parts = [`${g.rows.length} row${g.rows.length === 1 ? '' : 's'}`];
    for (const { c, i } of cols) {
      if (!c.total) continue;
      const t = aggregate(c, c.total, this.rows, g.rows, i);
      if (t !== null) parts.push(`${c.title}: ${formatCell(c.total === 'count' ? { ...c, type: 'number', decimals: 0 } : c, t, this.locale)}`);
    }
    td.append(toggle, el('span', 'wy-dt-gmeta', parts.join(' · ')));
    tr.append(td);
    return tr;
  }

  private detailRow(r: number, k: number): HTMLElement {
    const tr = el('tr', 'wy-dt-detail');
    tr.dataset.line = String(k);
    tr.dataset.detailOf = String(r);
    const td = el('td');
    td.colSpan = this.colspan();
    const box = el('div', 'wy-dt-detail-box');
    td.append(box);
    tr.append(td);
    const spec = this.spec!;
    const record = asRecord(spec, this.rows, r);
    const custom = this.host.options.detail;
    const fill = (content: Node | string) => { box.replaceChildren(typeof content === 'string' ? document.createTextNode(content) : content); };
    if (custom) {
      box.textContent = 'Loading…';
      Promise.resolve().then(() => custom(record, r, this.context())).then((c) => { if (box.isConnected || this.dom.isConnected) fill(c); }, () => { box.textContent = 'The details could not be shown.'; });
    } else {
      const dl = el('dl', 'wy-dt-fields');
      spec.columns.forEach((c, i) => { dl.append(el('dt', undefined, c.title || `Column ${i + 1}`), el('dd', undefined, formatCell(c, this.rows[r]?.[i] ?? null, this.locale) || '—')); });
      fill(dl);
    }
    return tr;
  }

  private paintTotals() {
    const cols = this.shownColumns();
    const actions = this.host.options.rowActions ?? [];
    this.tfoot.replaceChildren();
    if (!cols.some(({ c }) => c.total)) return;
    if (this.isRemote && !this.remoteTotals) return; // the page alone cannot give a total
    const tr = el('tr');
    for (let n = this.leads().length; n > 0; n--) tr.append(el('td'));
    cols.forEach(({ c, i }, k) => {
      const td = el('td');
      td.style.textAlign = this.alignOf(c);
      const t = !c.total ? null : this.isRemote ? this.remoteTotals![c.key] ?? null : aggregate(c, c.total, this.rows, this.index, i);
      td.textContent = t === null ? (k === 0 ? 'Total' : '') : formatCell(c.total === 'count' ? { ...c, type: 'number', decimals: 0 } : c, t, this.locale);
      tr.append(td);
    });
    if (actions.length) tr.append(el('td'));
    this.tfoot.append(tr);
  }

  private paintFoot(total: number, pages: number) {
    const spec = this.spec!;
    const remote = this.isRemote;
    this.foot.replaceChildren();
    const size = this.pageSize;
    const from = total ? this.page * (size || total) + 1 : 0;
    const to = size ? Math.min(total, (this.page + 1) * size) : total;
    const stored = spec.rows.length;
    const filtered = !remote && total !== stored;
    const text = this.loadError && !total ? 'Not loaded' : total ? `${from}–${to} of ${total}${filtered ? ` (filtered from ${stored})` : ''}` : filtered ? `0 of ${stored}` : '0 rows';
    const info = el('span', 'wy-dt-info', text);
    info.setAttribute('aria-live', 'polite');
    this.foot.append(info, el('span', 'wy-dt-spacer'));
    if (!size && !spec.options.pageSize && !remote) return;
    const sel = el('select', 'wy-dt-size');
    sel.setAttribute('aria-label', 'Rows per page');
    const sizes = (remote ? PAGE_SIZES.filter(Boolean) : PAGE_SIZES);
    for (const n of sizes.includes(size) ? sizes : [...sizes, size]) sel.add(new Option(n ? `${n} / page` : 'All', String(n), false, n === size));
    sel.addEventListener('change', () => { this.pageSize = Number(sel.value); this.page = 0; this.refresh(); });
    const go = (label: string, aria: string, to: number, disabled: boolean) => { const b = button(label, 'wy-dt-btn wy-dt-page', () => { this.page = to; this.refresh(); }); b.setAttribute('aria-label', aria); b.disabled = disabled; return b; };
    this.foot.append(sel);
    if (size) this.foot.append(go('«', 'First page', 0, this.page === 0), go('‹', 'Previous page', this.page - 1, this.page === 0), el('span', 'wy-dt-info', `Page ${this.page + 1} of ${pages}`), go('›', 'Next page', this.page + 1, this.page >= pages - 1), go('»', 'Last page', pages - 1, this.page >= pages - 1));
  }

  private onScroll() {
    if (!this.virtual || this.scrollFrame) return;
    this.scrollFrame = requestAnimationFrame(() => {
      this.scrollFrame = 0;
      if (this.destroyed || !this.virtual) return;
      const h = this.rowH || 36;
      const first = Math.floor(this.scroll.scrollTop / h);
      const last = Math.ceil((this.scroll.scrollTop + (this.scroll.clientHeight || 480)) / h);
      // only draw again when the view is about to run past what is drawn
      if (first < this.rendered.from + 4 && this.rendered.from > 0 || last > this.rendered.to - 4 && this.rendered.to < this.lines.length) this.renderLines();
    });
  }

  // ---- interaction

  private onDragStart(e: DragEvent) {
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-role="drag"]');
    if (!handle || !this.canReorder) return;
    const tr = handle.closest<HTMLElement>('tr')!;
    this.dragRow = Number(tr.dataset.row);
    tr.classList.add('is-dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', ''); }
  }
  private dropTarget(e: DragEvent): { r: number; below: boolean; tr: HTMLElement } | null {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-row]');
    if (!tr || this.dragRow < 0) return null;
    const box = tr.getBoundingClientRect();
    return { r: Number(tr.dataset.row), below: e.clientY > box.top + box.height / 2, tr };
  }
  private onDragOver(e: DragEvent) {
    const t = this.dropTarget(e);
    if (!t) return;
    e.preventDefault();
    this.tbody.querySelectorAll('.drop-above, .drop-below').forEach((x) => x.classList.remove('drop-above', 'drop-below'));
    t.tr.classList.add(t.below ? 'drop-below' : 'drop-above');
  }
  private onDrop(e: DragEvent) {
    const t = this.dropTarget(e);
    if (!t) return;
    e.preventDefault();
    const from = this.dragRow;
    this.endDrag();
    this.moveRow(from, t.below ? t.r + 1 : t.r);
  }
  private endDrag() {
    this.dragRow = -1;
    this.tbody.querySelectorAll('.is-dragging, .drop-above, .drop-below').forEach((x) => x.classList.remove('is-dragging', 'drop-above', 'drop-below'));
  }

  private onResizeStart(e: PointerEvent) {
    const grip = (e.target as HTMLElement).closest<HTMLElement>('[data-role="resize"]');
    if (!grip || this.readOnly || e.button > 0) return;
    e.preventDefault();
    const th = grip.closest<HTMLElement>('th')!;
    const col = Number(grip.dataset.col);
    const start = e.clientX;
    const from = th.getBoundingClientRect().width;
    const sign = getComputedStyle(this.dom).direction === 'rtl' ? -1 : 1;
    const width = (ev: PointerEvent) => Math.max(40, Math.min(1200, from + sign * (ev.clientX - start)));
    const move = (ev: PointerEvent) => { const w = width(ev); th.style.width = `${w}px`; th.style.minWidth = `${w}px`; };
    const up = (ev: PointerEvent) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
      this.dom.classList.remove('is-resizing');
      this.setWidth(col, width(ev));
    };
    this.dom.classList.add('is-resizing');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', up);
  }
  private onResizeKey(e: KeyboardEvent, grip: HTMLElement) {
    if (this.readOnly) return;
    const col = Number(grip.dataset.col);
    const now = this.spec?.columns[col]?.width ?? (grip.closest('th') as HTMLElement | null)?.offsetWidth ?? 0;
    const step = (e.shiftKey ? 40 : 10) * (getComputedStyle(this.dom).direction === 'rtl' ? -1 : 1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      this.setWidth(col, (now || 120) + (e.key === 'ArrowRight' ? step : -step));
      this.thead.querySelector<HTMLElement>(`[data-role="resize"][data-col="${col}"]`)?.focus();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      this.setWidth(col, null);
      this.thead.querySelector<HTMLElement>(`[data-role="resize"][data-col="${col}"]`)?.focus();
    }
  }

  // ---- views

  /** The current search, filters, sort, grouping and hidden columns, as a named view. */
  currentView(name: string): SavedView {
    const s = this.spec!;
    return {
      name,
      search: this.state.search,
      filters: Object.fromEntries(Object.entries(this.state.filters).filter(([, v]) => v.trim())),
      sort: this.state.sort.map((x) => ({ ...x })),
      groupBy: [...s.options.groupBy],
      hidden: s.columns.filter((c) => c.hidden).map((c) => c.key),
      pageSize: s.options.pageSize,
    };
  }
  applyView(v: SavedView | null): void {
    const spec = this.spec;
    if (!spec) return;
    this.state = v ? { search: v.search, filters: { ...v.filters }, sort: v.sort.map((x) => ({ ...x })) } : { search: '', filters: {}, sort: [] };
    this.page = 0;
    this.collapsed.clear();
    // grouping, hidden columns and rows per page live in the document; a reader who cannot edit still gets the search, filters and sort
    const differs = !!v && !this.readOnly && (v.groupBy.join() !== spec.options.groupBy.join() || v.pageSize !== spec.options.pageSize || spec.columns.some((c) => !!c.hidden !== v.hidden.includes(c.key)) && spec.columns.some((c) => !v.hidden.includes(c.key)));
    if (differs && v) {
      this.mutate((s) => {
        s.options.groupBy = [...v.groupBy];
        s.options.pageSize = v.pageSize;
        if (s.columns.some((c) => !v.hidden.includes(c.key))) for (const c of s.columns) { if (v.hidden.includes(c.key)) c.hidden = true; else delete c.hidden; }
      });
      return;
    }
    this.paintBar();
    this.paintHead();
    this.refresh();
  }
  saveView(): void {
    if (this.readOnly || !this.spec) return;
    const form = el('div', 'wy-dt-form');
    const label = el('label', 'wy-dt-field');
    const name = el('input'); name.maxLength = 60; name.placeholder = 'For example: Overdue, by region';
    label.append(el('span', undefined, 'Name of the view'), name);
    form.append(label, el('p', 'wy-dt-hint', 'Remembers the search, filters, sort, grouping, hidden columns and rows per page. Saving under an existing name replaces it.'));
    openDialog(this.host.editor.root, {
      title: 'Save view',
      body: form,
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => {
        const n = name.value.trim();
        if (!n) { name.focus(); return false; }
        const view = this.currentView(n);
        this.mutate((s) => { s.views = [...s.views.filter((x) => x.name !== n), view].slice(-20); });
      } }],
    });
    name.focus();
  }
  deleteView(name: string): void { this.mutate((s) => { s.views = s.views.filter((v) => v.name !== name); }); }

  // ---- highlight rules

  editRules(): void {
    if (!this.spec || this.readOnly) return;
    const spec = this.spec;
    const rules: FormatRule[] = spec.rules.map((r) => ({ ...r }));
    const body = el('div', 'wy-dt-form wy-dt-rules');
    body.append(el('p', 'wy-dt-hint', 'Write each condition as in a filter box: >100, 5..10, Overdue, empty. The first rule that matches a cell decides its colour.'));
    const list = el('div', 'wy-dt-rule-list');
    const draw = () => {
      list.replaceChildren();
      rules.forEach((r, n) => {
        const row = el('div', 'wy-dt-rule');
        const col = el('select'); col.setAttribute('aria-label', 'Column'); col.add(new Option('Any column', '', false, r.column === '')); for (const c of spec.columns) col.add(new Option(c.title, c.key, false, c.key === r.column));
        const test = el('input'); test.value = r.test; test.maxLength = 100; test.placeholder = '>100'; test.setAttribute('aria-label', 'Condition');
        const look = el('select'); look.setAttribute('aria-label', 'Colour'); for (const l of LOOKS) look.add(new Option(l === 'bold' ? 'Bold' : l[0].toUpperCase() + l.slice(1), l, false, l === r.look));
        const whole = el('input'); whole.type = 'checkbox'; whole.checked = r.row;
        const wl = el('label', 'wy-dt-check'); wl.append(whole, el('span', undefined, 'Whole row'));
        const rm = button('Remove', 'wy-dt-btn', () => { rules.splice(n, 1); draw(); });
        col.addEventListener('change', () => { r.column = col.value; });
        test.addEventListener('input', () => { r.test = test.value; });
        look.addEventListener('change', () => { r.look = look.value as Look; });
        whole.addEventListener('change', () => { r.row = whole.checked; });
        row.append(col, test, look, wl, rm);
        list.append(row);
      });
      if (!rules.length) list.append(el('p', 'wy-dt-hint', 'No rules yet.'));
    };
    draw();
    body.append(list, button('Add rule', 'wy-dt-btn', () => { if (rules.length < 30) { rules.push({ column: '', test: '', look: 'amber', row: false }); draw(); list.querySelector<HTMLElement>('.wy-dt-rule:last-child input')?.focus(); } }));
    openDialog(this.host.editor.root, {
      title: 'Highlight rules',
      body,
      wide: true,
      actions: [{ label: 'Cancel' }, { label: 'Save', primary: true, onClick: () => this.mutate((s) => { s.rules = rules.filter((r) => r.test.trim()); }) }],
    });
  }

  // ---- charts

  /** A chart of the rows on screen, put right after the table: the first text or date column names the bars, every number column is a series. */
  chart(type: 'bar' | 'line' | 'pie'): boolean {
    const spec = this.eff;
    const pos = this.getPos();
    if (!spec || pos === undefined || this.readOnly || !this.host.editor.hasCommand('insertChart')) return false;
    const cols = spec.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.hidden);
    const label = cols.find(({ c }) => c.type === 'text' || c.type === 'select' || c.type === 'date');
    const series = cols.filter(({ c }) => c.type === 'number' || c.type === 'currency').slice(0, 8);
    const used = this.index.slice(0, 50);
    if (!series.length || !used.length) return false;
    const data = {
      title: spec.options.title,
      labels: used.map((r, n) => (label ? formatCell(label.c, spec.rows[r][label.i], this.locale) : String(n + 1))),
      series: series.map(({ c, i }) => ({ name: c.title, values: used.map((r) => (typeof spec.rows[r][i] === 'number' ? spec.rows[r][i] : 0)) })),
    };
    this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
    return this.host.editor.execute('insertChart', type, data);
  }

  private cellAt(td: HTMLElement) { const r = Number((td.parentElement as HTMLElement).dataset.row); const c = Number(td.dataset.col); return { r, c }; }

  private onClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    const role = t.closest<HTMLElement>('[data-role]')?.dataset.role;
    if (role === 'sort') {
      const th = t.closest<HTMLElement>('th')!;
      const col = this.spec!.columns[Number(th.dataset.col)];
      const cur = this.state.sort.find((s) => s.key === col.key)?.dir;
      this.sortBy(col.key, cur === 'asc' ? 'desc' : cur === 'desc' ? null : 'asc', e.shiftKey);
    } else if (role === 'column-menu') {
      const i = Number(t.closest<HTMLElement>('th')!.dataset.col);
      popMenu(t.closest('button')!, this.dom, this.columnMenu(i));
    } else if (role === 'select-row') {
      const r = Number(t.closest<HTMLElement>('tr')!.dataset.row);
      if ((t as HTMLInputElement).checked) this.selected.add(r); else this.selected.delete(r);
      t.closest('tr')!.classList.toggle('is-selected', this.selected.has(r));
      this.paintSelection();
    } else if (role === 'select-page') {
      const on = (t as HTMLInputElement).checked;
      for (const l of this.lines) if (l.kind === 'row') { if (on) this.selected.add(l.r); else this.selected.delete(l.r); }
      this.paintRows();
    } else if (role === 'group-toggle') {
      const key = t.closest<HTMLElement>('tr')!.dataset.group!;
      if (this.collapsed.has(key)) this.collapsed.delete(key); else this.collapsed.add(key);
      this.paintRows();
    } else if (role === 'retry') {
      this.refresh();
    } else if (role === 'detail-toggle') {
      const r = Number(t.closest<HTMLElement>('tr')!.dataset.row);
      if (this.expanded.has(r)) this.expanded.delete(r); else this.expanded.add(r);
      this.paintRows();
      this.tbody.querySelector<HTMLElement>(`tr[data-row="${r}"] [data-role="detail-toggle"]`)?.focus();
    } else if (role === 'row-action') {
      const r = Number(t.closest<HTMLElement>('tr')!.dataset.row);
      this.host.options.rowActions?.[Number((t.closest('[data-action]') as HTMLElement).dataset.action)]?.onClick(asRecord(this.spec!, this.rows, r), r, this.context());
    } else if (role === 'toggle') {
      const { r, c } = this.cellAt(t.closest('td')!);
      this.setCell(r, c, (t as HTMLInputElement).checked);
    } else {
      const td = t.closest<HTMLElement>('td[data-col]');
      if (td && !this.editing) this.focusCell(td);
    }
  }

  private onChange(e: Event) {
    // A checkbox can also be changed with the keyboard; the click handler already covers the mouse, so only act when it differs.
    const t = e.target as HTMLInputElement;
    if (t.dataset?.role === 'toggle' && this.spec) {
      const { r, c } = this.cellAt(t.closest('td')!);
      if ((this.rows[r]?.[c] === true) !== t.checked) this.setCell(r, c, t.checked);
    }
  }

  columnMenu(i: number): (MenuItem | '-')[] {
    const spec = this.spec!;
    const col = spec.columns[i];
    return [
      { label: 'Sort ascending', run: () => this.sortBy(col.key, 'asc') },
      { label: 'Sort descending', run: () => this.sortBy(col.key, 'desc') },
      { label: 'Clear sort', disabled: !this.state.sort.length, run: () => this.sortBy(col.key, null) },
      '-',
      { label: col.key && spec.options.groupBy[0] === col.key && spec.options.groupBy.length === 1 ? 'Stop grouping' : 'Group by this column', run: () => this.groupBy(spec.options.groupBy[0] === col.key && spec.options.groupBy.length === 1 ? null : col.key) },
      { label: 'Then group by this column', disabled: !spec.options.groupBy.length || spec.options.groupBy.includes(col.key) || spec.options.groupBy.length >= 3, run: () => this.groupBy(col.key, true) },
      '-',
      { label: 'Edit column…', run: () => this.editColumn(i) },
      { label: 'Insert column after…', run: () => this.editColumn(null, i) },
      { label: 'Move left', disabled: i === 0, run: () => this.moveColumn(i, -1) },
      { label: 'Move right', disabled: i === spec.columns.length - 1, run: () => this.moveColumn(i, 1) },
      { label: 'Hide column', disabled: spec.columns.filter((c) => !c.hidden).length <= 1, run: () => this.setHidden(i, true) },
      { label: 'Delete column', disabled: spec.columns.length <= 1, run: () => this.deleteColumn(i) },
    ];
  }

  private focusCell(td: HTMLElement) {
    this.tbody.querySelectorAll<HTMLElement>('td[tabindex="0"]').forEach((x) => { x.tabIndex = -1; });
    td.tabIndex = 0;
    td.focus({ preventScroll: false });
    const line = Number((td.parentElement as HTMLElement).dataset.line);
    this.active.row = Math.max(0, this.rowLines.indexOf(line));
    this.active.col = Math.max(0, [...td.parentElement!.querySelectorAll('td[data-col]')].indexOf(td));
  }

  /** The cell at this data row (counting rows only) and column, drawing it first if the table is long and it is out of view. */
  private cellEl(row: number, col: number): HTMLElement | null {
    const line = this.rowLines[row];
    if (line === undefined) return null;
    if (this.virtual && (line < this.rendered.from || line >= this.rendered.to)) {
      const h = this.rowH || 36;
      this.scroll.scrollTop = Math.max(0, line * h - (this.scroll.clientHeight || 480) / 2);
      this.renderLines();
    }
    return this.tbody.querySelector<HTMLElement>(`tr[data-line="${line}"]`)?.querySelectorAll<HTMLElement>('td[data-col]')[col] ?? null;
  }

  private moveTo(row: number, col: number) {
    this.active = { row, col };
    const next = this.cellEl(row, col);
    if (next) this.focusCell(next);
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (t.dataset?.role === 'resize') { this.onResizeKey(e, t); return; }
    if (this.editing && this.editing.td.contains(t)) return; // handled by the editor itself
    const td = t.closest<HTMLElement>('td[data-col]');
    if (!td || t !== td) return;
    const rows = this.rowLines.length;
    const cols = this.shownColumns().length;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && this.canReorder) {
      const dir = e.key === 'ArrowUp' ? -1 : 1;
      const { r } = this.cellAt(td);
      const at = this.active.row + dir;
      if (at < 0 || at >= rows) return;
      e.preventDefault();
      this.moveRow(r, dir < 0 ? r - 1 : r + 2);
      this.moveTo(at, this.active.col);
      return;
    }
    let { row, col } = this.active;
    const jump = this.virtual ? Math.max(1, Math.floor((this.scroll.clientHeight || 480) / this.rowH) - 1) : 0;
    switch (e.key) {
      case 'ArrowDown': row = Math.min(rows - 1, row + 1); break;
      case 'ArrowUp': row = Math.max(0, row - 1); break;
      case 'ArrowRight': col = Math.min(cols - 1, col + 1); break;
      case 'ArrowLeft': col = Math.max(0, col - 1); break;
      case 'Home': col = 0; if (e.ctrlKey || e.metaKey) row = 0; break;
      case 'End': col = cols - 1; if (e.ctrlKey || e.metaKey) row = rows - 1; break;
      case 'PageDown':
        if (jump) { row = Math.min(rows - 1, row + jump); break; }
        if (this.pageSize && this.page < Math.ceil((this.isRemote ? this.remoteTotal : this.index.length) / this.pageSize) - 1) { this.page++; this.refresh(); this.cellEl(0, col)?.focus(); e.preventDefault(); }
        return;
      case 'PageUp':
        if (jump) { row = Math.max(0, row - jump); break; }
        if (this.page > 0) { this.page--; this.refresh(); this.cellEl(0, col)?.focus(); e.preventDefault(); }
        return;
      case 'Enter': case 'F2': e.preventDefault(); this.startEdit(td); return;
      case ' ': {
        const cb = td.querySelector<HTMLInputElement>('input[data-role="toggle"]');
        if (cb && !cb.disabled) { e.preventDefault(); const { r, c } = this.cellAt(td); this.setCell(r, c, !cb.checked); }
        return;
      }
      case 'Delete': case 'Backspace': {
        if (!this.canEditCells) return;
        e.preventDefault();
        const { r, c } = this.cellAt(td);
        this.setCell(r, c, null);
        return;
      }
      default: return;
    }
    e.preventDefault();
    this.moveTo(row, col);
  }

  startEdit(td: HTMLElement) {
    if (!this.canEditCells || !this.spec) return;
    const { r, c } = this.cellAt(td);
    const col = this.spec.columns[c];
    if (col.type === 'boolean' || col.formula) return;
    this.finishEdit(true);
    const value = this.rows[r]?.[c] ?? null;
    let input: HTMLInputElement | HTMLSelectElement;
    if (col.type === 'select') {
      const s = el('select');
      s.add(new Option('', ''));
      const opts = [...(col.options ?? [])]; if (typeof value === 'string' && value && !opts.includes(value)) opts.push(value);
      for (const o of opts) s.add(new Option(o, o, false, o === value));
      input = s;
    } else {
      const i = el('input');
      if (col.type === 'date') { i.type = 'date'; i.value = typeof value === 'string' ? value : ''; }
      else { i.value = value === null ? '' : String(value); if (col.type !== 'text') i.inputMode = 'decimal'; }
      input = i;
    }
    input.className = 'wy-dt-edit';
    input.setAttribute('aria-label', col.title);
    this.editing = { td, r, c, cancelled: false };
    td.replaceChildren(input);
    input.focus();
    if (input instanceof HTMLInputElement && input.type !== 'date') input.select();
    (input as HTMLElement).addEventListener('keydown', (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); this.finishEdit(false); this.cellEl(this.active.row, this.active.col)?.focus(); }
      else if (k.key === 'Enter' || k.key === 'Tab') {
        k.preventDefault(); k.stopPropagation();
        const dir = k.key === 'Tab' ? (k.shiftKey ? [0, -1] : [0, 1]) : [k.shiftKey ? -1 : 1, 0];
        this.finishEdit(true);
        const row = Math.max(0, Math.min(this.rowLines.length - 1, this.active.row + dir[0]));
        const colN = Math.max(0, Math.min(this.shownColumns().length - 1, this.active.col + dir[1]));
        this.moveTo(row, colN);
      }
    });
    input.addEventListener('blur', () => this.finishEdit(true));
  }

  /** Closes the cell editor, saving what was typed unless `save` is false. */
  private finishEdit(save: boolean) {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const input = ed.td.querySelector<HTMLInputElement | HTMLSelectElement>('.wy-dt-edit');
    const raw = input?.value;
    if (save && raw !== undefined && this.spec) {
      const col = this.spec.columns[ed.c];
      const before = this.rows[ed.r]?.[ed.c];
      const after = coerceCell(col.type, raw);
      if (before !== after) { this.setCell(ed.r, ed.c, raw); return; } // the update repaints the row
    }
    if (this.spec && ed.td.isConnected) { const col = this.spec.columns[ed.c]; ed.td.textContent = formatCell(col, this.rows[ed.r]?.[ed.c] ?? null, this.locale); }
  }
}

/** The data table node, its plugin and the commands around it. */
export function DataTable(options: DataTablePluginOptions = {}): EditorPlugin {
  const host: Host = { editor: undefined as unknown as Editor, options: { ...options, buttons: [...(options.buttons ?? [])], rowActions: [...(options.rowActions ?? [])], sources: { ...options.sources } }, views: new Map(), last: null };

  const activeView = (): DataTableView | null => {
    const { view } = host.editor;
    const sel = view.state.selection;
    if (sel instanceof NodeSelection && sel.node.type.name === 'data_table') {
      const dom = view.nodeDOM(sel.from) as HTMLElement | null;
      const v = dom && host.views.get(dom);
      if (v) return v;
    }
    if (host.last?.dom.isConnected) return host.last;
    const all = [...host.views.values()].filter((v) => v.dom.isConnected);
    return all.length === 1 ? all[0] : null;
  };

  /** Where a new block goes: after the top-level block holding the cursor. */
  const insertAt = (e: Editor) => { const { $from } = e.view.state.selection; return $from.depth >= 1 ? $from.after(1) : $from.pos; };

  return {
    name: 'dataTable',
    nodes: {
      data_table: {
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { spec: { default: '' } },
        leafText: (n: PMNode) => { const s = cleanSpec(n.attrs.spec); return s ? [s.options.title, ...s.columns.map((c) => c.title)].filter(Boolean).join(' ') : ''; },
        parseDOM: [{ tag: 'figure[data-data-table]', getAttrs: (d) => { const s = cleanSpec((d as HTMLElement).getAttribute('data-data-table')); return s ? { spec: JSON.stringify(s) } : false; } }],
        // The stored data plus a plain table of every row, so the exported HTML still reads as a table anywhere.
        toDOM: (n: PMNode): DOMOutputSpec => {
          const s = cleanSpec(n.attrs.spec);
          if (!s) return ['figure', { 'data-data-table': '' }];
          const idx = s.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.hidden);
          const table = ['table', ['thead', ['tr', ...idx.map(({ c }) => ['th', c.title])]], ['tbody', ...s.rows.map((r) => ['tr', ...idx.map(({ c, i }) => ['td', formatCell(c, r[i])])])]];
          return ['figure', { class: 'wy-dt-static', 'data-data-table': JSON.stringify(s) }, ...(s.options.title ? [['figcaption', s.options.title]] : []), table] as unknown as DOMOutputSpec;
        },
      },
    },
    setup(editor: Editor) {
      host.editor = editor;
      const makeBlank = (): DataTableSpec => cleanSpec({
        columns: [{ key: 'name', title: 'Name', type: 'text' }, { key: 'amount', title: 'Amount', type: 'number', decimals: 2, total: 'sum' }, { key: 'date', title: 'Date', type: 'date' }],
        rows: [['', null, null], ['', null, null], ['', null, null]],
        options: { pageSize: 10, search: true, striped: true },
      })!;
      const put = (e: Editor, spec: DataTableSpec, replace?: { from: number; to: number }) => {
        const { state, dispatch } = e.view;
        const node = state.schema.nodes.data_table.create({ spec: JSON.stringify(spec) });
        const tr = replace ? state.tr.replaceWith(replace.from, replace.to, node) : state.tr.insert(insertAt(e), node);
        dispatch(tr.scrollIntoView());
        return true;
      };
      editor.registerCommand('insertDataTable', (e, spec?: unknown) => { const s = spec ? cleanSpec(spec) : makeBlank(); return s ? put(e, s) : false; });
      editor.registerCommand('tableToDataTable', (e) => {
        const { $from } = e.view.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const t = $from.node(d);
          if (t.type.name !== 'table') continue;
          const rows: string[][] = [];
          t.forEach((r) => { const cells: string[] = []; r.forEach((c) => cells.push(c.textContent)); rows.push(cells); });
          const spec = specFromRows(rows);
          return put(e, spec, { from: $from.before(d), to: $from.after(d) });
        }
        return false;
      });
      editor.registerCommand('dataTableToTable', (e) => {
        const { state } = e.view;
        const { table, table_row, table_cell, table_header, paragraph } = state.schema.nodes;
        const sel = state.selection;
        if (!table || !(sel instanceof NodeSelection) || sel.node.type.name !== 'data_table') return false;
        const spec = cleanSpec(sel.node.attrs.spec);
        if (!spec) return false;
        const cols = spec.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.hidden);
        const cell = (type: typeof table_cell, text: string) => type.create(null, paragraph.create(null, text ? state.schema.text(text) : undefined));
        const head = table_row.create(null, cols.map(({ c }) => cell(table_header ?? table_cell, c.title)));
        const body = spec.rows.map((r) => table_row.create(null, cols.map(({ c, i }) => cell(table_cell, formatCell(c, r[i], host.options.locale)))));
        e.view.dispatch(state.tr.replaceWith(sel.from, sel.to, table.create(null, [head, ...body])).scrollIntoView());
        return true;
      });
      const importText = (e: Editor, text: string) => {
        const rows = parseCSV(text);
        if (rows.length < 1) return false;
        return put(e, specFromRows(rows));
      };
      const fail = (message: string) => { editor.emit('dataTableError', { message }); };
      /** Opens a CSV, TSV or Excel file (or reads one that is handed over) and inserts it as a data table. */
      const importFile = async (e: Editor, file: File | Blob, name = (file as File).name ?? '') => {
        if (file.size > 30 * 1024 * 1024) return fail('That file is too large to import.');
        try {
          const bytes = await readBytes(file);
          const isXlsx = /\.xlsx$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
          const rows = isXlsx ? (await parseXlsx(bytes)).rows : parseCSV(new TextDecoder().decode(bytes));
          if (!rows.length) return fail('There is nothing to import in that file.');
          const spec = specFromRows(rows);
          if (name) spec.options.title = name.replace(/\.[^.]+$/, '');
          put(e, spec);
        } catch (err) { fail(err instanceof Error ? err.message : 'That file could not be read.'); }
      };
      const pick = (e: Editor, accept: string) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void importFile(e, f); });
        input.click();
      };
      editor.registerCommand('dataTableFromCSV', (e, text?: string) => {
        if (typeof text === 'string') return importText(e, text);
        pick(e, '.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values');
        return true;
      });
      editor.registerCommand('dataTableFromExcel', (e, file?: File | Blob) => {
        if (file) { void importFile(e, file); return true; }
        pick(e, '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return true;
      });
      editor.registerCommand('dataTableFromFile', (e, file?: File | Blob) => {
        if (file) { void importFile(e, file); return true; }
        pick(e, '.csv,.tsv,.txt,.xlsx,text/csv,text/plain,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        return true;
      });
      editor.registerCommand('chartFromDataTable', (_e, type: 'bar' | 'line' | 'pie' = 'bar') => activeView()?.chart(type) ?? false);
      editor.registerCommand('refreshDataTable', () => { const v = activeView(); if (!v) return false; v.refresh(); return true; });
      editor.registerCommand('exportDataTable', (_e, format: 'csv' | 'xlsx' | 'pdf' = 'csv') => { const v = activeView(); if (!v?.data) return false; v.exportAs(format); return true; });
      editor.registerCommand('dataTableOptions', () => { const v = activeView(); if (!v) return false; v.editOptions(); return true; });
      editor.registerCommand('addDataTableRow', () => { const v = activeView(); if (!v) return false; v.addRow(); return true; });
      const api: DataTableApi = {
        addButton: (b) => { host.options.buttons!.push(b); },
        addRowAction: (a) => { host.options.rowActions!.push(a); },
        addSource: (name, load) => { host.options.sources![name] = load; for (const v of host.views.values()) if (v.data?.options.source === name) v.refresh(); },
        refresh: () => { activeView()?.refresh(); },
        active: () => { const v = activeView(); return v?.data ? { spec: v.data, selected: () => v.selectedRows(), visible: () => v.visibleRows() } : null; },
        export: (format, o) => activeView()?.exportBlob(format, o?.selectedOnly) ?? null,
      };
      editor.extensions.dataTable = api;
      return [new Plugin({ props: { nodeViews: { data_table: (node, view, getPos) => new DataTableView(node, view, getPos as () => number | undefined, host) } } })];
    },
    contextMenuOrder: 30,
    contextMenu({ editor, event, state, readonly, closest }) {
      const target = event?.target instanceof HTMLElement ? event.target : null;
      const dom = target?.closest<HTMLElement>('.wy-dt');
      const v = dom ? host.views.get(dom) : undefined;
      const items: ContextMenuEntry[] = [];
      if (v?.data) {
        host.last = v;
        const td = target!.closest<HTMLElement>('td[data-col]');
        const th = target!.closest<HTMLElement>('th[data-col]');
        const col = td ? Number(td.dataset.col) : th ? Number(th.dataset.col) : -1;
        const row = td ? Number((td.parentElement as HTMLElement).dataset.row) : -1;
        if (td && row >= 0 && v.canEditCells) items.push({ label: 'Edit cell', run: () => v.startEdit(td) });
        if (td && row >= 0 && v.canEditRows) {
          items.push(
            { label: 'Insert row below', run: () => v.addRow(row) },
            { label: 'Duplicate row', run: () => v.duplicateRow(row) },
            { label: 'Delete row', danger: true, run: () => v.deleteRows([row]) },
            '-',
          );
        }
        if (col >= 0) items.push({ label: 'Column', items: v.columnMenu(col).map((m): ContextMenuEntry => (m === '-' ? '-' : { label: m.label, disabled: m.disabled, run: () => m.run() })), readOnly: false });
        items.push({ label: 'Export', items: [{ label: 'CSV', readOnly: true, run: () => v.exportAs('csv') }, { label: 'Excel (.xlsx)', readOnly: true, run: () => v.exportAs('xlsx') }, { label: 'PDF (print)…', readOnly: true, run: () => v.exportAs('pdf') }], readOnly: true });
        if (!readonly) items.push({ label: 'Table options…', run: () => v.editOptions() }, '-', { label: 'Convert to regular table', run: (e) => { const pos = v.nodePos; if (pos === undefined) return; e.view.dispatch(e.view.state.tr.setSelection(NodeSelection.create(e.view.state.doc, pos))); e.execute('dataTableToTable'); } });
        return items;
      }
      const sel = state.selection;
      if (sel instanceof NodeSelection && sel.node.type.name === 'data_table' && !readonly) {
        return [
          { label: 'Convert to regular table', command: 'dataTableToTable' },
          { label: 'Table options…', command: 'dataTableOptions' },
          '-',
          { label: 'Delete data table', danger: true, run: (e) => { e.view.dispatch(e.view.state.tr.deleteSelection()); } },
        ];
      }
      if (!readonly && closest('table') && editor.hasCommand('tableToDataTable')) return [{ label: 'Convert to data table', command: 'tableToDataTable' }];
      return [];
    },
    ribbon: [{
      tab: 'insert',
      after: 'tables',
      group: {
        id: 'dataTable',
        label: 'Data table',
        controls: [{
          kind: 'menu' as const, id: 'dataTable', label: 'Data Table', icon: 'insertTable', need: 'insertDataTable', size: 'large' as const,
          entries: () => [
            { label: 'New data table', command: 'insertDataTable' },
            { label: 'Convert table to data table', command: 'tableToDataTable' },
            { label: 'Convert data table to table', command: 'dataTableToTable' },
            { label: 'From a CSV or Excel file…', command: 'dataTableFromFile' },
            { label: 'Export', heading: true },
            { label: 'CSV', command: 'exportDataTable', args: ['csv'] },
            { label: 'Excel (.xlsx)', command: 'exportDataTable', args: ['xlsx'] },
            { label: 'PDF (print)…', command: 'exportDataTable', args: ['pdf'] },
          ],
        }],
      },
    }],
  };
}
