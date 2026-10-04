import { mergeCells, splitCell, toggleHeaderRow, setCellAttr, addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, columnResizing, tableEditing, tableNodes } from 'prosemirror-tables';
import { TextSelection } from 'prosemirror-state';
import type { EditorPlugin } from '../types';
import { normalizeColor } from './colors';

export const Table: EditorPlugin = {
  name: 'table',
  nodes: tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {
      background: {
        default: null,
        getFromDOM: (dom) => normalizeColor(dom.style.backgroundColor) ?? null,
        setDOMAttr: (value, attrs) => {
          if (value) attrs.style = `${attrs.style ?? ''}background-color: ${value};`;
        },
      },
    } }),
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
    editor.registerCommand('addRow', wrap(addRowAfter));
    editor.registerCommand('addColumn', wrap(addColumnAfter));
    editor.registerCommand('deleteRow', wrap(deleteRow));
    editor.registerCommand('deleteColumn', wrap(deleteColumn));
    editor.registerCommand('deleteTable', wrap(deleteTable));
    editor.registerCommand('mergeCells', wrap(mergeCells));
    editor.registerCommand('splitCell', wrap(splitCell));
    editor.registerCommand('toggleHeaderRow', wrap(toggleHeaderRow));
    editor.registerCommand('cellColor', (e, value: string) => {
      const color = value ? normalizeColor(value) : null;
      if (value && !color) return false;
      return setCellAttr('background', color)(e.view.state, e.view.dispatch);
    });
    return [columnResizing(), tableEditing()];
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
