/**
 * The data table on its own: no editor, no ProseMirror. `createDataTable({ element, table })` draws the same table that the editor's
 * `DataTable` plugin puts in a document (search, filters, sort, paging, editing, groups, formulas, rules, views, export, remote data…),
 * keeps its own undo history, and tells you about changes. This file, `data-table-view.ts` and `data-table.ts` are the whole of it, so an
 * app that only needs a grid imports `wysiwygido/data-table` and ships none of the editor.
 */
import './styles.css';
import { cleanSpec, withFormulas, type Cell, type DataTableSpec } from './data-table';
import type { DataTableUser } from './data-table-crud';
import { DataTableView, createFetchDataSource, type DataTableButton, type DataTableContext, type DataTableEnv, type DataTableRowAction, type DataTableViewHost, type DataTableViewOptions } from './data-table-view';
import { defaultThemes, themeVars, type Theme } from './plugins/themes';

export { createFetchDataSource };
export { hasAccess as hasDataTableAccess } from './data-table-crud';
export type { AccessRule as DataTableAccessRule, CrudAction as DataTableCrudAction, DataTableCrud, DataTableUser } from './data-table-crud';
export type { DataTableButton, DataTableContext, DataTableRowAction };
export type {
  Aggregate as DataTableAggregate, Cell as DataTableCell, ColumnType as DataTableColumnType, DataColumn as DataTableColumn, DataPage as DataTablePage,
  DataQuery as DataTableQuery, DataTableOptions as DataTableSettings, DataTableSpec, FormatRule as DataTableRule, Look as DataTableLook, SavedView as DataTableSavedView,
} from './data-table';
export {
  cleanSpec as cleanDataTable, formatCell as formatDataTableCell, queryRows as queryDataTable, specFromRows as dataTableFromRows,
  withFormulas as dataTableWithFormulas, ruleLooks as dataTableRuleLooks, toCSV as dataTableToCSV, toPrintHTML as dataTableToPrintHTML, toXlsx as dataTableToXlsx, parseCSV, parseXlsx,
} from './data-table';
export { defaultThemes, themeVars };
export type { Theme };

export interface DataTableAppOptions extends DataTableViewOptions {
  /** Where the table goes. Its content is replaced. */
  element: HTMLElement;
  /** The table: `{ columns, rows, options?, rules?, views? }` (a `DataTableSpec`, or its JSON text). */
  table: unknown;
  /** Nothing can be changed; searching, sorting, filtering and export still work. */
  readOnly?: boolean;
  /** `'light'`, `'dark'`, `'auto'` (follow the system), the name of a colour theme (`'sepia'`, `'nord'`…) or a theme object. Default `'light'`. */
  theme?: 'light' | 'dark' | 'auto' | string | Theme;
  /** More colour themes, by name. */
  themes?: Theme[];
  /** Called after every change the user makes (an edit, a new row, a resized column…) with the table as it now is. */
  onChange?: (table: DataTableSpec) => void;
  /** How many steps undo remembers. Default 100. */
  history?: number;
}

export interface DataTableApp {
  /** The element the table is drawn in. */
  readonly element: HTMLElement;
  /** The table as it is now: columns, rows (formula columns not included, they are calculated) and options. */
  getTable(): DataTableSpec;
  /** Replaces the table. Clears undo. Does not call `onChange`. */
  setTable(table: unknown): void;
  /** Every row, as `{ columnKey: value }`, formula columns calculated. For a table that loads from a source: the page on screen. */
  getRows(): Record<string, Cell>[];
  /** Rows that pass the search and filters, in the order shown (all pages). */
  visibleRows(): Record<string, Cell>[];
  /** The rows that are ticked. */
  selectedRows(): Record<string, Cell>[];
  setReadOnly(readOnly: boolean): void;
  readonly readOnly: boolean;
  setTheme(theme: DataTableAppOptions['theme']): void;
  undo(): boolean;
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** Asks the data source again (a table that loads its rows) or redraws. */
  refresh(): void;
  /** The rows on screen as a file; a table that loads its rows gives the current page (use `download` to get all of them). */
  export(format: 'csv' | 'xlsx', options?: { selectedOnly?: boolean }): Blob | null;
  /** Downloads the table as a file; `'pdf'` opens the print dialog. */
  download(format: 'csv' | 'xlsx' | 'pdf'): void;
  /** Who is using the table (for the `crud` guard). Buttons the person may not use disappear. */
  setUser(user: DataTableUser | null): void;
  addButton(button: DataTableButton): void;
  addRowAction(action: DataTableRowAction): void;
  addSource(name: string, load: NonNullable<DataTableViewOptions['sources']>[string]): void;
  /** Listen for `'change'` (the table changed, with the new table) or `'error'`. Returns a function that stops listening. */
  on(event: 'change', listener: (table: DataTableSpec) => void): () => void;
  destroy(): void;
}

/** Puts a data table in `element`, with no editor around it. */
export function createDataTable(options: DataTableAppOptions): DataTableApp {
  const first = cleanSpec(options.table);
  if (!first) throw new Error('createDataTable: `table` needs a `columns` array.');
  const themes = [...defaultThemes, ...(options.themes ?? [])];
  const root = document.createElement('div');
  root.className = 'wy-dt-root wy-content';
  options.element.replaceChildren(root);

  let raw = JSON.stringify(first);
  let readOnly = !!options.readOnly;
  const undoStack: string[] = [];
  const redoStack: string[] = [];
  const keep = Math.max(1, options.history ?? 100);
  const listeners = new Set<(table: DataTableSpec) => void>();
  let system: MediaQueryList | null = null;
  let onSystem: (() => void) | null = null;
  let applied: string[] = [];

  const changed = () => {
    const table = cleanSpec(raw)!;
    options.onChange?.(table);
    for (const l of [...listeners]) { try { l(table); } catch (e) { console.error('A data table listener failed', e); } }
  };
  const env: DataTableEnv = {
    root,
    readOnly: () => readOnly,
    commit(next) {
      if (next === raw) return;
      undoStack.push(raw);
      if (undoStack.length > keep) undoStack.shift();
      redoStack.length = 0;
      raw = next;
      view.setRaw(raw);
      changed();
    },
  };
  const host: DataTableViewHost = {
    editor: null,
    options: { ...options, buttons: [...(options.buttons ?? [])], rowActions: [...(options.rowActions ?? [])], sources: { ...options.sources } },
    views: new Map(),
    last: null,
  };
  const view = new DataTableView(raw, env, host);
  root.append(view.dom);

  // ---- theme
  const clearTheme = () => { for (const k of applied) root.style.removeProperty(k); applied = []; };
  const setMode = (mode: 'light' | 'dark') => { root.dataset.theme = mode; root.dataset.page = mode; };
  const stopSystem = () => { if (system && onSystem) system.removeEventListener?.('change', onSystem); system = null; onSystem = null; };
  const setTheme = (theme: DataTableAppOptions['theme'] = 'light') => {
    stopSystem();
    clearTheme();
    if (theme === 'auto') {
      system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
      setMode(system?.matches ? 'dark' : 'light');
      if (system) { onSystem = () => setMode(system!.matches ? 'dark' : 'light'); system.addEventListener?.('change', onSystem); }
      return;
    }
    if (theme === 'light' || theme === 'dark') { setMode(theme); return; }
    const t = typeof theme === 'string' ? themes.find((x) => x.name === theme) : theme;
    if (!t) { setMode('light'); return; }
    setMode(t.palette.mode);
    const vars = { ...themeVars(t.palette), ...Object.fromEntries(Object.entries(t.vars ?? {}).map(([k, v]) => [k.startsWith('--') ? k : `--${k}`, v])) };
    for (const [k, v] of Object.entries(vars)) { root.style.setProperty(k, v); applied.push(k); }
    root.dataset.colorTheme = t.name;
  };
  setTheme(options.theme);

  // ---- undo and redo (keys work while focus is in the table but not in one of its text boxes)
  const go = (from: string[], to: string[]) => {
    const prev = from.pop();
    if (prev === undefined) return false;
    to.push(raw);
    raw = prev;
    view.setRaw(raw);
    changed();
    return true;
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || t.closest('input, textarea, select')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { if (go(undoStack, redoStack)) e.preventDefault(); }
    else if ((k === 'z' && e.shiftKey) || k === 'y') { if (go(redoStack, undoStack)) e.preventDefault(); }
  };
  root.addEventListener('keydown', onKey);

  const app: DataTableApp = {
    element: root,
    getTable: () => cleanSpec(raw)!,
    setTable(table) {
      const next = cleanSpec(table);
      if (!next) throw new Error('setTable: `table` needs a `columns` array.');
      raw = JSON.stringify(next);
      undoStack.length = 0;
      redoStack.length = 0;
      view.setRaw(raw);
    },
    getRows: () => { const s = withFormulas(cleanSpec(raw)!, view.currentRows()); return s.rows.map((_, r) => Object.fromEntries(s.columns.map((c, i) => [c.key, s.rows[r][i]]))); },
    visibleRows: () => view.visibleRows(),
    selectedRows: () => view.selectedRows(),
    setReadOnly(value) { readOnly = value; view.repaint(); },
    get readOnly() { return readOnly; },
    setTheme,
    undo: () => go(undoStack, redoStack),
    redo: () => go(redoStack, undoStack),
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    refresh: () => view.refresh(),
    export: (format, o) => view.exportBlob(format, o?.selectedOnly),
    download: (format) => view.exportAs(format),
    setUser(user) { if (host.options.crud) { host.options.crud = { ...host.options.crud, user }; view.repaint(); } },
    addButton(button) { host.options.buttons!.push(button); view.repaint(); },
    addRowAction(action) { host.options.rowActions!.push(action); view.repaint(); },
    addSource(name, load) { host.options.sources![name] = load; if (view.data?.options.source === name) view.refresh(); },
    on(event, listener) { if (event !== 'change') return () => {}; listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { stopSystem(); root.removeEventListener('keydown', onKey); view.destroy(); listeners.clear(); root.remove(); },
  };
  return app;
}

export interface DataTableElement extends HTMLElement {
  /** The table (get and set). A plain object, or its JSON text. */
  table: unknown;
  readOnly: boolean;
  /** More options for `createDataTable` (buttons, sources, locale…). Set before the element is connected. */
  config: Partial<DataTableAppOptions>;
  /** The table's controller, once the element is connected. */
  readonly app: DataTableApp | null;
}

/**
 * Registers the `<wysiwyg-data-table>` element (once). The table is given as JSON inside the element or as the `table` property:
 *
 *   <wysiwyg-data-table theme="nord"><script type="application/json">{"columns":[…],"rows":[…]}</script></wysiwyg-data-table>
 *
 * Attributes: `readonly`, `theme`. Events: `table-ready` and `table-change` (`detail.table`).
 */
export function defineDataTableElement(tag = 'wysiwyg-data-table'): void {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;
  class WysiwygDataTableElement extends HTMLElement implements DataTableElement {
    static get observedAttributes() { return ['readonly', 'theme']; }
    app: DataTableApp | null = null;
    config: Partial<DataTableAppOptions> = {};
    private current: unknown;
    get table(): unknown { return this.app ? this.app.getTable() : this.current; }
    set table(value: unknown) { this.current = value; if (this.app && value) this.app.setTable(value); }
    get readOnly() { return this.app ? this.app.readOnly : this.hasAttribute('readonly'); }
    set readOnly(v: boolean) { if (v) this.setAttribute('readonly', ''); else this.removeAttribute('readonly'); }
    connectedCallback() {
      if (this.app) return;
      let table = this.current;
      if (!table) {
        const script = this.querySelector('script[type="application/json"]');
        try { table = script ? JSON.parse(script.textContent ?? '') : undefined; } catch { table = undefined; }
      }
      if (!table) return;
      const host = document.createElement('div');
      this.replaceChildren(host);
      this.app = createDataTable({ ...this.config, element: host, table, readOnly: this.hasAttribute('readonly'), theme: this.getAttribute('theme') ?? this.config.theme });
      this.app.on('change', (t) => this.dispatchEvent(new CustomEvent('table-change', { detail: { table: t }, bubbles: true, composed: true })));
      this.dispatchEvent(new CustomEvent('table-ready', { detail: { app: this.app }, bubbles: true, composed: true }));
    }
    disconnectedCallback() { if (this.app) { this.current = this.app.getTable(); this.app.destroy(); this.app = null; } }
    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
      if (!this.app) return;
      if (name === 'readonly') this.app.setReadOnly(value !== null);
      else if (name === 'theme') this.app.setTheme(value ?? 'light');
    }
  }
  customElements.define(tag, WysiwygDataTableElement);
}
