import type { DOMOutputSpec, Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { openDialog } from '../dialog';
import type { Editor } from '../editor';
import { download } from '../export';
import {
  AGGREGATES, COLUMN_TYPES, MAX_COLUMNS, MAX_ROWS, PAGE_SIZES, aggregate, cleanSpec, coerceCell, formatCell, parseCSV, queryRows, specFromRows, toCSV, toPrintHTML, toXlsx,
  type Aggregate, type Cell, type ColumnType, type DataColumn, type DataTableSpec, type ViewState,
} from '../data-table';
import type { ContextMenuEntry, EditorPlugin } from '../types';

export type { Aggregate, ColumnType, DataColumn, DataTableSpec, Cell as DataCell };
export {
  cleanSpec as cleanDataTable, formatCell as formatDataCell, queryRows as queryDataRows, specFromRows as dataTableFromRows,
  toCSV as dataTableToCSV, toPrintHTML as dataTableToPrintHTML, toXlsx as dataTableToXlsx, parseCSV,
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
}

/** The API on `editor.extensions.dataTable`. */
export interface DataTableApi {
  addButton(button: DataTableButton): void;
  addRowAction(action: DataTableRowAction): void;
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
const asRecord = (spec: DataTableSpec, r: number): Record<string, Cell> => Object.fromEntries(spec.columns.map((c, i) => [c.key, spec.rows[r][i]]));

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
  private active = { row: 0, col: 0 };
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
    this.load(node);
    this.paintAll();
  }

  private get readOnly() { return this.host.editor.isReadOnly; }
  private get locale() { return this.host.options.locale; }

  private load(node: PMNode) {
    this.node = node;
    this.raw = String(node.attrs.spec);
    this.spec = cleanSpec(this.raw);
    if (!this.spec) return;
    const keys = new Set(this.spec.columns.map((c) => c.key));
    this.state.filters = Object.fromEntries(Object.entries(this.state.filters).filter(([k]) => keys.has(k)));
    this.state.sort = this.state.sort.filter((s) => keys.has(s.key));
    this.pageSize = this.spec.options.pageSize;
    this.selected = new Set([...this.selected].filter((r) => r < this.spec!.rows.length));
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
      this.paintAll();
    }
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent() { return true; } // the table handles its own mouse and keys
  ignoreMutation() { return true; }
  destroy() { this.host.views.delete(this.dom); if (this.host.last === this) this.host.last = null; }

  // ---- reading

  get data(): DataTableSpec | null { return this.spec; }
  visibleRows(): Record<string, Cell>[] { return this.spec ? this.index.map((r) => asRecord(this.spec!, r)) : []; }
  selectedRows(): Record<string, Cell>[] { return this.spec ? [...this.selected].sort((a, b) => a - b).map((r) => asRecord(this.spec!, r)) : []; }
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
    this.mutate((s) => {
      if (s.rows.length >= MAX_ROWS) return false;
      const row = s.columns.map((c) => coerceCell(c.type, null));
      s.rows.splice(after === undefined ? s.rows.length : after + 1, 0, row);
    });
    if (after === undefined && this.spec && this.pageSize) { this.page = Math.floor(this.index.length / this.pageSize); this.paintRows(); }
  }
  duplicateRow(r: number): void { this.mutate((s) => { if (s.rows.length >= MAX_ROWS) return false; s.rows.splice(r + 1, 0, [...s.rows[r]]); }); }
  deleteRows(rows: number[]): void {
    const drop = new Set(rows);
    this.selected = new Set();
    this.mutate((s) => { s.rows = s.rows.filter((_, i) => !drop.has(i)); });
  }
  setCell(r: number, c: number, raw: unknown): void {
    this.mutate((s) => { if (!s.rows[r] || c >= s.columns.length) return false; s.rows[r][c] = coerceCell(s.columns[c].type, raw); });
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
    this.paintRows();
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
    const total = el('select'); total.add(new Option('None', '')); for (const a of AGGREGATES) total.add(new Option(a[0].toUpperCase() + a.slice(1), a, false, col.total === a));
    row('Title', title); row('Type', type); const decRow = row('Decimals (empty = automatic)', decimals); const curRow = row('Currency code', currency); const optRow = row('Choices (one per line)', options); row('Align', align); const totRow = row('Total in footer', total);
    const sync = () => {
      const t = type.value as ColumnType;
      decRow.hidden = !(t === 'number' || t === 'currency');
      curRow.hidden = t !== 'currency';
      optRow.hidden = t !== 'select';
      totRow.hidden = !(t === 'number' || t === 'currency');
    };
    type.addEventListener('change', sync);
    sync();
    openDialog(this.host.editor.root, {
      title: i === null ? 'Add column' : 'Edit column',
      body: form,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', primary: true,
        onClick: () => this.mutate((s) => {
          const t = type.value as ColumnType;
          const next: DataColumn = { ...col, title: title.value.trim() || col.title, type: t };
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
        }),
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
    const [search, filters, striped, bordered, selectable] = [check(o.search), check(o.filters), check(o.striped), check(o.bordered), check(o.selectable)];
    row('Title', title); row('Rows per page', size); row('Row height', density); row('Scroll after this height in pixels (empty = grow)', height);
    row('Search box', search, true); row('Filter row under the headings', filters, true); row('Striped rows', striped, true); row('Cell borders', bordered, true); row('Tick boxes to select rows', selectable, true);
    openDialog(this.host.editor.root, {
      title: 'Table options',
      body: form,
      actions: [{ label: 'Cancel' }, {
        label: 'Save', primary: true,
        onClick: () => this.mutate((s) => {
          s.options = { ...s.options, title: title.value.trim(), pageSize: Number(size.value), density: density.value as typeof o.density, height: Number(height.value) || 0, search: search.checked, filters: filters.checked, striped: striped.checked, bordered: bordered.checked, selectable: selectable.checked };
        }),
      }],
    });
  }

  // ---- export

  exportAs(format: 'csv' | 'xlsx' | 'pdf', selectedOnly = this.selected.size > 0): void {
    const blob = format === 'pdf' ? null : this.exportBlob(format, selectedOnly);
    const name = slug(this.spec?.options.title || 'table');
    if (blob) download(blob, `${name}.${format}`);
    else if (format === 'pdf' && this.spec) void printPage(toPrintHTML(this.spec, { rows: this.exportRows(selectedOnly), locale: this.locale }));
  }
  private exportRows(selectedOnly: boolean): number[] { return selectedOnly && this.selected.size ? this.index.filter((r) => this.selected.has(r)) : this.index; }
  exportBlob(format: 'csv' | 'xlsx', selectedOnly = false): Blob | null {
    if (!this.spec) return null;
    const o = { rows: this.exportRows(selectedOnly), locale: this.locale };
    return format === 'csv' ? new Blob([toCSV(this.spec, o)], { type: 'text/csv;charset=utf-8' }) : new Blob([toXlsx(this.spec, o) as BlobPart], { type: MIME_XLSX });
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
    this.scroll.style.maxHeight = o.height ? `${o.height}px` : '';
    this.titleEl.textContent = o.title;
    this.titleEl.hidden = !o.title;
    this.paintBar();
    this.paintHead();
    this.paintRows();
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
      input.addEventListener('input', () => { this.state.search = input.value; this.page = 0; this.paintRows(); });
      this.bar.append(input);
    }
    this.bar.append(el('span', 'wy-dt-spacer'));
    this.customBtns = [];
    for (const def of this.host.options.buttons ?? []) {
      const b = button(def.label, 'wy-dt-btn', () => def.onClick(this.context()), def.title);
      b.disabled = !!def.needsSelection && !this.selected.size;
      this.customBtns.push({ b, def });
      this.bar.append(b);
    }
    if (!ro) {
      this.bar.append(button('Add row', 'wy-dt-btn', () => this.addRow()));
      this.deleteBtn = button('', 'wy-dt-btn is-danger', () => this.deleteRows([...this.selected]));
      this.bar.append(this.deleteBtn);
      const cols = button('Columns ▾', 'wy-dt-btn', (e) => popMenu(e.currentTarget as HTMLElement, this.dom, [
        ...spec.columns.map((c, i): MenuItem => ({ label: c.title || `Column ${i + 1}`, checked: !c.hidden, run: () => this.setHidden(i, !c.hidden) })),
        '-',
        { label: 'Add column…', disabled: spec.columns.length >= MAX_COLUMNS, run: () => this.editColumn(null) },
      ]));
      cols.setAttribute('aria-haspopup', 'menu');
      this.bar.append(cols);
    } else this.deleteBtn = null;
    const exp = button('Export ▾', 'wy-dt-btn', (e) => popMenu(e.currentTarget as HTMLElement, this.dom, [
      { label: 'CSV', run: () => this.exportAs('csv') },
      { label: 'Excel (.xlsx)', run: () => this.exportAs('xlsx') },
      { label: 'PDF (print)…', run: () => this.exportAs('pdf') },
    ]));
    exp.setAttribute('aria-haspopup', 'menu');
    this.bar.append(exp);
    if (!ro) this.bar.append(button('Options', 'wy-dt-btn', () => this.editOptions()));
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
    if (spec.options.selectable) {
      const th = el('th', 'wy-dt-sel');
      const all = el('input'); all.type = 'checkbox'; all.setAttribute('aria-label', 'Select all rows on this page'); all.dataset.role = 'select-page';
      th.append(all); tr.append(th);
    }
    for (const { c, i } of this.shownColumns()) {
      const th = el('th');
      th.dataset.col = String(i);
      th.style.textAlign = this.alignOf(c);
      if (c.width) th.style.width = `${c.width}px`;
      const at = this.state.sort.findIndex((s) => s.key === c.key);
      th.setAttribute('aria-sort', at < 0 ? 'none' : this.state.sort[at].dir === 'asc' ? 'ascending' : 'descending');
      const b = el('button', 'wy-dt-th');
      b.type = 'button';
      b.dataset.role = 'sort';
      b.append(el('span', undefined, c.title || `Column ${i + 1}`));
      if (at >= 0) b.append(el('span', 'wy-dt-arrow', `${this.state.sort[at].dir === 'asc' ? '▲' : '▼'}${this.state.sort.length > 1 ? at + 1 : ''}`));
      b.title = 'Sort (Shift+click adds a second column)';
      th.append(b);
      if (!ro) { const m = el('button', 'wy-dt-colmenu', '⋮'); m.type = 'button'; m.dataset.role = 'column-menu'; m.setAttribute('aria-label', `Column options for ${c.title}`); m.setAttribute('aria-haspopup', 'menu'); th.append(m); }
      tr.append(th);
    }
    if (this.host.options.rowActions?.length) tr.append(el('th', 'wy-dt-actions', 'Actions'));
    this.thead.replaceChildren(tr);
    if (spec.options.filters) {
      const f = el('tr', 'wy-dt-filters');
      if (spec.options.selectable) f.append(el('td'));
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
        input.addEventListener(input instanceof HTMLSelectElement ? 'change' : 'input', () => { this.state.filters[c.key] = input.value; this.page = 0; this.paintRows(); });
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
    this.index = queryRows(spec, this.state, this.locale);
    const total = this.index.length;
    const pages = this.pageSize ? Math.max(1, Math.ceil(total / this.pageSize)) : 1;
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const shown = this.pageSize ? this.index.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize) : this.index;
    const cols = this.shownColumns();
    const ro = this.readOnly;
    const actions = this.host.options.rowActions ?? [];
    this.active.row = Math.min(this.active.row, Math.max(0, shown.length - 1));
    this.active.col = Math.min(this.active.col, Math.max(0, cols.length - 1));
    const rows: HTMLElement[] = shown.map((r, n) => {
      const tr = el('tr');
      tr.dataset.row = String(r);
      tr.setAttribute('aria-selected', String(this.selected.has(r)));
      if (this.selected.has(r)) tr.classList.add('is-selected');
      if (spec.options.selectable) {
        const td = el('td', 'wy-dt-sel');
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = this.selected.has(r); cb.dataset.role = 'select-row'; cb.setAttribute('aria-label', 'Select row');
        td.append(cb); tr.append(td);
      }
      cols.forEach(({ c, i }, k) => {
        const td = el('td');
        td.dataset.col = String(i);
        td.style.textAlign = this.alignOf(c);
        td.tabIndex = n === this.active.row && k === this.active.col ? 0 : -1;
        td.setAttribute('role', 'gridcell');
        const v = spec.rows[r][i];
        if (c.type === 'boolean') {
          const cb = el('input'); cb.type = 'checkbox'; cb.checked = v === true; cb.disabled = ro; cb.dataset.role = 'toggle'; cb.setAttribute('aria-label', c.title);
          td.append(cb);
        } else td.textContent = formatCell(c, v, this.locale);
        tr.append(td);
      });
      if (actions.length) {
        const td = el('td', 'wy-dt-actions');
        actions.forEach((a, ai) => { const b = el('button', 'wy-dt-btn', a.label); b.type = 'button'; b.title = a.title ?? ''; b.dataset.role = 'row-action'; b.dataset.action = String(ai); td.append(b); });
        tr.append(td);
      }
      return tr;
    });
    if (!rows.length) {
      const tr = el('tr', 'wy-dt-empty');
      const td = el('td', undefined, spec.rows.length ? 'No rows match.' : 'No rows yet.');
      td.colSpan = cols.length + (spec.options.selectable ? 1 : 0) + (actions.length ? 1 : 0);
      tr.append(td); rows.push(tr);
    }
    this.tbody.replaceChildren(...rows);
    // footer with totals
    this.tfoot.replaceChildren();
    if (cols.some(({ c }) => c.total)) {
      const tr = el('tr');
      if (spec.options.selectable) tr.append(el('td'));
      cols.forEach(({ c, i }, k) => {
        const td = el('td');
        td.style.textAlign = this.alignOf(c);
        const t = c.total ? aggregate(c, c.total, spec.rows, this.index, i) : null;
        td.textContent = t === null ? (k === 0 ? 'Total' : '') : formatCell(c.total === 'count' ? { ...c, type: 'number', decimals: 0 } : c, t, this.locale);
        tr.append(td);
      });
      if (actions.length) tr.append(el('td'));
      this.tfoot.append(tr);
    }
    const sel = this.thead.querySelector<HTMLInputElement>('[data-role="select-page"]');
    if (sel) { sel.checked = shown.length > 0 && shown.every((r) => this.selected.has(r)); }
    this.paintFoot(total, pages);
    this.paintSelection();
  }

  private paintFoot(total: number, pages: number) {
    const spec = this.spec!;
    this.foot.replaceChildren();
    const from = total ? this.page * (this.pageSize || total) + 1 : 0;
    const to = this.pageSize ? Math.min(total, (this.page + 1) * this.pageSize) : total;
    const filtered = total !== spec.rows.length;
    const info = el('span', 'wy-dt-info', total ? `${from}–${to} of ${total}${filtered ? ` (filtered from ${spec.rows.length})` : ''}` : filtered ? `0 of ${spec.rows.length}` : '0 rows');
    info.setAttribute('aria-live', 'polite');
    this.foot.append(info, el('span', 'wy-dt-spacer'));
    if (this.pageSize === 0 && !spec.options.pageSize) return;
    const size = el('select', 'wy-dt-size');
    size.setAttribute('aria-label', 'Rows per page');
    const sizes = PAGE_SIZES.includes(this.pageSize) ? PAGE_SIZES : [...PAGE_SIZES, this.pageSize];
    for (const n of sizes) size.add(new Option(n ? `${n} / page` : 'All', String(n), false, n === this.pageSize));
    size.addEventListener('change', () => { this.pageSize = Number(size.value); this.page = 0; this.paintRows(); });
    const go = (label: string, aria: string, to: number, disabled: boolean) => { const b = button(label, 'wy-dt-btn wy-dt-page', () => { this.page = to; this.paintRows(); }); b.setAttribute('aria-label', aria); b.disabled = disabled; return b; };
    this.foot.append(size);
    if (this.pageSize) this.foot.append(go('«', 'First page', 0, this.page === 0), go('‹', 'Previous page', this.page - 1, this.page === 0), el('span', 'wy-dt-info', `Page ${this.page + 1} of ${pages}`), go('›', 'Next page', this.page + 1, this.page >= pages - 1), go('»', 'Last page', pages - 1, this.page >= pages - 1));
  }

  // ---- interaction

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
      this.tbody.querySelectorAll<HTMLElement>('tr[data-row]').forEach((tr) => { const r = Number(tr.dataset.row); if (on) this.selected.add(r); else this.selected.delete(r); });
      this.paintRows();
    } else if (role === 'row-action') {
      const r = Number(t.closest<HTMLElement>('tr')!.dataset.row);
      this.host.options.rowActions?.[Number((t.closest('[data-action]') as HTMLElement).dataset.action)]?.onClick(asRecord(this.spec!, r), r, this.context());
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
      if ((this.spec.rows[r][c] === true) !== t.checked) this.setCell(r, c, t.checked);
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
    const rows = [...this.tbody.querySelectorAll('tr')];
    this.active.row = Math.max(0, rows.indexOf(td.parentElement as HTMLTableRowElement));
    this.active.col = Math.max(0, [...td.parentElement!.querySelectorAll('td[data-col]')].indexOf(td));
  }

  private cellEl(row: number, col: number): HTMLElement | null {
    const tr = this.tbody.querySelectorAll('tr')[row];
    return (tr?.querySelectorAll<HTMLElement>('td[data-col]')[col]) ?? null;
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    if (this.editing && this.editing.td.contains(t)) return; // handled by the editor itself
    const td = t.closest<HTMLElement>('td[data-col]');
    if (!td || t !== td) return;
    const rows = this.tbody.querySelectorAll('tr[data-row]').length;
    const cols = this.shownColumns().length;
    let { row, col } = this.active;
    switch (e.key) {
      case 'ArrowDown': row = Math.min(rows - 1, row + 1); break;
      case 'ArrowUp': row = Math.max(0, row - 1); break;
      case 'ArrowRight': col = Math.min(cols - 1, col + 1); break;
      case 'ArrowLeft': col = Math.max(0, col - 1); break;
      case 'Home': col = 0; if (e.ctrlKey || e.metaKey) row = 0; break;
      case 'End': col = cols - 1; if (e.ctrlKey || e.metaKey) row = rows - 1; break;
      case 'PageDown': if (this.pageSize && this.page < Math.ceil(this.index.length / this.pageSize) - 1) { this.page++; this.paintRows(); this.cellEl(0, col)?.focus(); e.preventDefault(); } return;
      case 'PageUp': if (this.page > 0) { this.page--; this.paintRows(); this.cellEl(0, col)?.focus(); e.preventDefault(); } return;
      case 'Enter': case 'F2': e.preventDefault(); this.startEdit(td); return;
      case ' ': {
        const cb = td.querySelector<HTMLInputElement>('input[data-role="toggle"]');
        if (cb && !cb.disabled) { e.preventDefault(); const { r, c } = this.cellAt(td); this.setCell(r, c, !cb.checked); }
        return;
      }
      case 'Delete': case 'Backspace': {
        if (this.readOnly) return;
        e.preventDefault();
        const { r, c } = this.cellAt(td);
        this.setCell(r, c, null);
        return;
      }
      default: return;
    }
    e.preventDefault();
    this.active = { row, col };
    const next = this.cellEl(row, col);
    if (next) this.focusCell(next);
  }

  startEdit(td: HTMLElement) {
    if (this.readOnly || !this.spec) return;
    const { r, c } = this.cellAt(td);
    const col = this.spec.columns[c];
    if (col.type === 'boolean') return;
    this.finishEdit(true);
    const value = this.spec.rows[r][c];
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
        const rows = this.tbody.querySelectorAll('tr[data-row]').length;
        const row = Math.max(0, Math.min(rows - 1, this.active.row + dir[0]));
        const colN = Math.max(0, Math.min(this.shownColumns().length - 1, this.active.col + dir[1]));
        this.active = { row, col: colN };
        const next = this.cellEl(row, colN); if (next) this.focusCell(next);
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
      const before = this.spec.rows[ed.r]?.[ed.c];
      const after = coerceCell(col.type, raw);
      if (before !== after) { this.setCell(ed.r, ed.c, raw); return; } // the update repaints the row
    }
    if (this.spec && ed.td.isConnected) { const col = this.spec.columns[ed.c]; ed.td.textContent = formatCell(col, this.spec.rows[ed.r]?.[ed.c] ?? null, this.locale); }
  }
}

/** The data table node, its plugin and the commands around it. */
export function DataTable(options: DataTablePluginOptions = {}): EditorPlugin {
  const host: Host = { editor: undefined as unknown as Editor, options: { ...options, buttons: [...(options.buttons ?? [])], rowActions: [...(options.rowActions ?? [])] }, views: new Map(), last: null };

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
      editor.registerCommand('dataTableFromCSV', (e, text?: string) => {
        if (typeof text === 'string') return importText(e, text);
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values';
        input.addEventListener('change', async () => {
          const f = input.files?.[0];
          if (!f || f.size > 20 * 1024 * 1024) return;
          importText(e, await f.text());
        });
        input.click();
        return true;
      });
      editor.registerCommand('exportDataTable', (_e, format: 'csv' | 'xlsx' | 'pdf' = 'csv') => { const v = activeView(); if (!v?.data) return false; v.exportAs(format); return true; });
      editor.registerCommand('dataTableOptions', () => { const v = activeView(); if (!v) return false; v.editOptions(); return true; });
      editor.registerCommand('addDataTableRow', () => { const v = activeView(); if (!v) return false; v.addRow(); return true; });
      const api: DataTableApi = {
        addButton: (b) => { host.options.buttons!.push(b); },
        addRowAction: (a) => { host.options.rowActions!.push(a); },
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
        if (!readonly && td && row >= 0) {
          items.push(
            { label: 'Edit cell', run: () => v.startEdit(td) },
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
            { label: 'From a CSV file…', command: 'dataTableFromCSV' },
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
