import type { DOMOutputSpec, Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { Editor } from '../editor';
import {
  DataTableView, createFetchDataSource,
  type DataTableButton, type DataTableContext, type DataTableEnv, type DataTableRowAction, type DataTableViewHost, type DataTableViewOptions as DataTableOptions,
} from '../data-table-view';
import {
  cleanSpec, formatCell, parseCSV, parseXlsx, specFromRows,
  type Cell, type DataPage, type DataQuery, type DataTableSpec,
} from '../data-table';
import type { DataTableUser } from '../data-table-crud';
import type { ContextMenuEntry, EditorPlugin } from '../types';

export type { DataTableButton, DataTableContext, DataTableOptions, DataTableRowAction };
export { createFetchDataSource };
export { hasAccess as hasDataTableAccess } from '../data-table-crud';
export type { AccessRule as DataTableAccessRule, CrudAction as DataTableCrudAction, DataTableCrud, DataTableUser } from '../data-table-crud';
export type {
  Aggregate as DataTableAggregate, Cell as DataTableCell, ColumnType as DataTableColumnType, DataColumn as DataTableColumn, DataPage as DataTablePage,
  DataQuery as DataTableQuery, DataTableOptions as DataTableSettings, DataTableSpec, FormatRule as DataTableRule, Look as DataTableLook, SavedView as DataTableSavedView,
} from '../data-table';
export {
  cleanSpec as cleanDataTable, formatCell as formatDataTableCell, queryRows as queryDataTable, specFromRows as dataTableFromRows,
  withFormulas as dataTableWithFormulas, ruleLooks as dataTableRuleLooks, toCSV as dataTableToCSV, toPrintHTML as dataTableToPrintHTML, toXlsx as dataTableToXlsx, parseCSV, parseXlsx,
} from '../data-table';

/** The API on `editor.extensions.dataTable`. */
export interface DataTableApi {
  /** Who is using the tables (for the `crud` guard); redraws every table. */
  setUser(user: DataTableUser | null): void;
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

/** The bytes of a file picked by the user. */
const readBytes = (file: Blob) => new Promise<Uint8Array>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(new Uint8Array(r.result as ArrayBuffer)); r.onerror = () => bad(r.error); r.readAsArrayBuffer(file); });

interface Host extends DataTableViewHost {
  editor: Editor;
}

/** Shows a `data_table` node with the stand-alone table, and writes its changes back as undoable document steps. */
class DataTableNodeView implements NodeView {
  dom: HTMLElement;
  core: DataTableView;
  constructor(private node: PMNode, view: EditorView, getPos: () => number | undefined, host: Host) {
    const editor = host.editor;
    const env: DataTableEnv = {
      root: editor.root,
      readOnly: () => editor.isReadOnly,
      pos: getPos,
      commit: (spec) => {
        const pos = getPos();
        if (pos !== undefined) view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, spec }));
      },
      selectBlock: () => {
        const pos = getPos();
        if (pos === undefined) return;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        view.focus();
      },
      ...(editor.hasCommand('insertChart') ? {
        chart: (type, data) => {
          const pos = getPos();
          if (pos === undefined || editor.isReadOnly) return false;
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
          return editor.execute('insertChart', type, data);
        },
      } : {}),
    };
    this.core = new DataTableView(String(node.attrs.spec), env, host);
    this.dom = this.core.dom;
  }
  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.core.setRaw(String(node.attrs.spec));
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent() { return true; } // the table handles its own mouse and keys
  ignoreMutation() { return true; }
  destroy() { this.core.destroy(); }
}

/** The data table node, its plugin and the commands around it. */
export function DataTable(options: DataTableOptions = {}): EditorPlugin {
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
        parseDOM: [{ tag: 'figure[data-data-table]', getAttrs: (d) => { const raw = (d as HTMLElement).getAttribute('data-data-table'); const s = cleanSpec(raw); return s ? { spec: s.future ? raw : JSON.stringify(s) } : false; } }],
        // The stored data plus a plain table of every row, so the exported HTML still reads as a table anywhere.
        toDOM: (n: PMNode): DOMOutputSpec => {
          const s = cleanSpec(n.attrs.spec);
          if (!s) return ['figure', { 'data-data-table': '' }];
          const idx = s.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.hidden);
          const table = ['table', ['thead', ['tr', ...idx.map(({ c }) => ['th', c.title])]], ['tbody', ...s.rows.map((r) => ['tr', ...idx.map(({ c, i }) => ['td', formatCell(c, r[i])])])]];
          return ['figure', { class: 'wy-dt-static', 'data-data-table': s.future ? String(n.attrs.spec) : JSON.stringify(s) }, ...(s.options.title ? [['figcaption', s.options.title]] : []), table] as unknown as DOMOutputSpec;
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
        setUser: (user) => { if (host.options.crud) { host.options.crud = { ...host.options.crud, user }; for (const v of host.views.values()) v.repaint(); } },
        addButton: (b) => { host.options.buttons!.push(b); },
        addRowAction: (a) => { host.options.rowActions!.push(a); },
        addSource: (name, load) => { host.options.sources![name] = load; for (const v of host.views.values()) if (v.data?.options.source === name) v.refresh(); },
        refresh: () => { activeView()?.refresh(); },
        active: () => { const v = activeView(); return v?.data ? { spec: v.data, selected: () => v.selectedRows(), visible: () => v.visibleRows() } : null; },
        export: (format, o) => activeView()?.exportBlob(format, o?.selectedOnly) ?? null,
      };
      editor.extensions.dataTable = api;
      return [new Plugin({ props: { nodeViews: { data_table: (node, view, getPos) => new DataTableNodeView(node, view, getPos as () => number | undefined, host) } } })];
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
