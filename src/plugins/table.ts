import { CellSelection, addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, columnIsHeader, columnResizing, deleteColumn, deleteRow, deleteTable, isInTable, mergeCells, rowIsHeader, selectedRect, selectionCell, setCellAttr, splitCell, tableEditing, tableNodes, toggleHeaderColumn, toggleHeaderRow } from 'prosemirror-tables';
import { keymap } from 'prosemirror-keymap';
import { TextSelection, type EditorState } from 'prosemirror-state';
import type { ContextMenuEntry, EditorPlugin } from '../types';
import { normalizeColor } from './colors';

const clampSpan = (n: unknown) => Math.max(1, Math.min(100, Math.round(Number(n)) || 1));
/** prosemirror-tables reads colspan/rowspan with no upper bound, so `colspan="1000000000"` would hang the tab while the table map is built. */
function clampedTableNodes(spec: ReturnType<typeof tableNodes>) {
  for (const key of ['table_cell', 'table_header'] as const) {
    for (const rule of (spec[key].parseDOM ?? []) as unknown as { getAttrs?: (dom: HTMLElement) => Record<string, unknown> | false }[]) {
      const original = rule.getAttrs;
      if (!original) continue;
      rule.getAttrs = (dom) => {
        const attrs = original(dom);
        if (attrs) { attrs.colspan = clampSpan(attrs.colspan); attrs.rowspan = clampSpan(attrs.rowspan); }
        return attrs;
      };
    }
  }
  return spec;
}

/** Every cell of the table is selected. */
function wholeTableSelected(state: EditorState): boolean {
  if (!(state.selection instanceof CellSelection)) return false;
  const r = selectedRect(state);
  return r.top === 0 && r.left === 0 && r.bottom === r.map.height && r.right === r.map.width;
}

/** The table is a single cell and that cell has nothing in it (what is left after deleting everything else, or a table just inserted by mistake). */
function singleEmptyCell(state: EditorState): boolean {
  if (!isInTable(state) || !state.selection.empty) return false;
  const r = selectedRect(state);
  if (r.map.width !== 1 || r.map.height !== 1) return false;
  const cell = r.table.nodeAt(r.map.map[0]);
  return !!cell && cell.childCount === 1 && !!cell.firstChild?.isTextblock && cell.firstChild.content.size === 0;
}

export const Table: EditorPlugin = {
  name: 'table',
  nodes: clampedTableNodes(tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {
      background: {
        default: null,
        getFromDOM: (dom) => normalizeColor(dom.style.backgroundColor) ?? null,
        setDOMAttr: (value, attrs) => {
          const c = value ? normalizeColor(String(value)) : null;   // re-checked: collaborators skip the parser
          if (c) attrs.style = `${attrs.style ?? ''}background-color: ${c};`;
        },
      },
    } })),
  setup(editor) {
    const { table, table_row, table_cell } = editor.schema.nodes;
    editor.registerCommand('insertTable', (e, rows = 3, cols = 3) => {
      const { state, dispatch } = e.view;
      const makeRow = () => table_row.create(null, Array.from({ length: cols }, () => table_cell.createAndFill()!));
      const node = table.create(null, Array.from({ length: rows }, makeRow));
      const from = state.selection.from;
      const tr = state.tr.replaceSelectionWith(node);
      // Like a word processor: the cursor goes into the first cell, so the table tools are ready to use.
      let start = -1;
      tr.doc.nodesBetween(Math.max(0, from - 1), Math.min(tr.doc.content.size, tr.mapping.map(from) + 1), (n, pos) => {
        if (start < 0 && n.type === table) start = pos;
      });
      if (start >= 0) tr.setSelection(TextSelection.near(tr.doc.resolve(start + 4)));
      dispatch(tr.scrollIntoView());
      return true;
    });
    const wrap = (cmd: typeof addRowAfter) => (e: typeof editor) => cmd(e.view.state, e.view.dispatch);
    /** prosemirror-tables refuses to delete the only row or column, which left a one-row or one-column table with no way to remove it: deleting everything removes the table. */
    const dropOrTable = (cmd: typeof deleteRow, whole: (r: ReturnType<typeof selectedRect>) => boolean) => (e: typeof editor) => {
      const { state, dispatch } = e.view;
      if (!isInTable(state)) return false;
      // without a dispatch these commands answer "possible" even for the last row/column; only a real run refuses
      if (cmd(state, dispatch)) return true;
      return whole(selectedRect(state)) ? deleteTable(state, dispatch) : false;
    };
    editor.registerCommand('addRow', wrap(addRowAfter));
    editor.registerCommand('addRowBefore', wrap(addRowBefore));
    editor.registerCommand('addColumn', wrap(addColumnAfter));
    editor.registerCommand('addColumnBefore', wrap(addColumnBefore));
    editor.registerCommand('deleteRow', dropOrTable(deleteRow, (r) => r.top === 0 && r.bottom === r.map.height));
    editor.registerCommand('deleteColumn', dropOrTable(deleteColumn, (r) => r.left === 0 && r.right === r.map.width));
    editor.registerCommand('deleteTable', wrap(deleteTable));
    editor.registerCommand('toggleHeaderColumn', wrap(toggleHeaderColumn));
    editor.registerCommand('selectTable', (e) => {
      const { state, dispatch } = e.view;
      if (!isInTable(state)) return false;
      const r = selectedRect(state);
      const cells = r.map.map;
      dispatch(state.tr.setSelection(CellSelection.create(state.doc, r.tableStart + cells[0], r.tableStart + cells[cells.length - 1])));
      return true;
    });
    editor.registerCommand('selectRow', (e) => {
      const { state, dispatch } = e.view;
      if (!isInTable(state)) return false;
      dispatch(state.tr.setSelection(CellSelection.rowSelection(selectionCell(state))));
      return true;
    });
    editor.registerCommand('selectColumn', (e) => {
      const { state, dispatch } = e.view;
      if (!isInTable(state)) return false;
      dispatch(state.tr.setSelection(CellSelection.colSelection(selectionCell(state))));
      return true;
    });
    /** Give every column the same width again (forget widths set by dragging). */
    editor.registerCommand('distributeColumns', (e) => {
      const { state, dispatch } = e.view;
      if (!isInTable(state)) return false;
      const r = selectedRect(state);
      const tr = state.tr;
      r.table.descendants((n, pos) => {
        if ((n.type.name === 'table_cell' || n.type.name === 'table_header') && n.attrs.colwidth) tr.setNodeMarkup(r.tableStart + pos, undefined, { ...n.attrs, colwidth: null });
      });
      if (!tr.docChanged) return false;
      dispatch(tr);
      return true;
    });
    editor.registerCommand('mergeCells', wrap(mergeCells));
    editor.registerCommand('splitCell', wrap(splitCell));
    editor.registerCommand('toggleHeaderRow', wrap(toggleHeaderRow));
    editor.registerCommand('cellColor', (e, value: string) => {
      const color = value ? normalizeColor(value) : null;
      if (value && !color) return false;
      return setCellAttr('background', color)(e.view.state, e.view.dispatch);
    });
    // Backspace or Delete removes a table that is only one empty cell, and Backspace removes a table whose every cell is selected
    // (Word does the same). Anything else falls through to the usual handling. These run before tableEditing's own keys.
    const removeWhole = (e: typeof editor, key: 'Backspace' | 'Delete') => {
      const { state, dispatch } = e.view;
      if (singleEmptyCell(state) || (key === 'Backspace' && wholeTableSelected(state))) return deleteTable(state, dispatch);
      return false;
    };
    return [keymap({ Backspace: () => removeWhole(editor, 'Backspace'), Delete: () => removeWhole(editor, 'Delete') }), columnResizing(), tableEditing()];
  },
  contextMenuOrder: 20,
  contextMenu({ state, closest, readonly }) {
    if (readonly || !closest('table')) return [];
    const colors = ['#fff3bf', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#e5e7eb'];
    const span = isInTable(state) ? selectedRect(state) : null;
    const items: ContextMenuEntry[] = [
      { label: 'Insert row above', command: 'addRowBefore', icon: '↑' },
      { label: 'Insert row below', command: 'addRow', icon: '↓' },
      { label: 'Insert column left', command: 'addColumnBefore', icon: '←' },
      { label: 'Insert column right', command: 'addColumn', icon: '→' },
      '-',
      { label: 'Delete row', command: 'deleteRow', danger: true },
      { label: 'Delete column', command: 'deleteColumn', danger: true },
      { label: 'Delete table', command: 'deleteTable', danger: true, icon: '🗑' },
      '-',
      { label: 'Merge cells', command: 'mergeCells', disabled: !mergeCells(state) },
      { label: 'Split cell', command: 'splitCell', disabled: !splitCell(state) },
      '-',
      { label: 'Header row', command: 'toggleHeaderRow', checked: !!span && rowIsHeader(span.map, span.table, 0) },
      { label: 'Header column', command: 'toggleHeaderColumn', checked: !!span && columnIsHeader(span.map, span.table, 0) },
      '-',
      { label: 'Cell color', items: [...colors.map((c) => ({ label: c, icon: '▇', command: 'cellColor', args: [c] })), { label: 'No color', command: 'cellColor', args: [''] }] },
      { label: 'Select', items: [{ label: 'Row', command: 'selectRow' }, { label: 'Column', command: 'selectColumn' }, { label: 'Table', command: 'selectTable' }] },
      { label: 'Distribute columns evenly', command: 'distributeColumns' },
    ];
    return items;
  },
  toolbar: [
    { name: 'insertTable', label: 'Insert table', icon: '▦', command: 'insertTable' },
    { name: 'addRow', label: 'Add row below', icon: '+row', command: 'addRow' },
    { name: 'addColumn', label: 'Add column right', icon: '+col', command: 'addColumn' },
    { name: 'deleteRow', label: 'Delete row', icon: '−row', command: 'deleteRow' },
    { name: 'deleteColumn', label: 'Delete column', icon: '−col', command: 'deleteColumn' },
    { name: 'mergeCells', label: 'Merge selected cells', icon: '⊞', command: 'mergeCells' },
    { name: 'splitCell', label: 'Split cell', icon: '⊟', command: 'splitCell' },
    { name: 'toggleHeaderRow', label: 'Toggle header row', icon: 'H', command: 'toggleHeaderRow' },
    {
      type: 'select',
      name: 'cellColor',
      label: 'Cell color',
      command: 'cellColor',
      options: [{ label: 'Cell', value: '' }, ...['#fff3bf', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#e5e7eb'].map((c) => ({ label: `▇ ${c}`, value: c }))],
      getValue: () => '',
    },
    { name: 'deleteTable', label: 'Delete table', icon: '🗑', command: 'deleteTable' },
  ],
};
