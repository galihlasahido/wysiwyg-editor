import { addColumnAfter, addRowAfter, deleteColumn, deleteRow, deleteTable, columnResizing, tableEditing, tableNodes } from 'prosemirror-tables';
import type { EditorPlugin } from '../types';

export const Table: EditorPlugin = {
  name: 'table',
  nodes: tableNodes({ tableGroup: 'block', cellContent: 'block+', cellAttributes: {} }),
  setup(editor) {
    const { table, table_row, table_cell } = editor.schema.nodes;
    editor.registerCommand('insertTable', (e, rows = 3, cols = 3) => {
      const { state, dispatch } = e.view;
      const makeRow = () => table_row.create(null, Array.from({ length: cols }, () => table_cell.createAndFill()!));
      const node = table.create(null, Array.from({ length: rows }, makeRow));
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
      return true;
    });
    const wrap = (cmd: typeof addRowAfter) => (e: typeof editor) => cmd(e.view.state, e.view.dispatch);
    editor.registerCommand('addRow', wrap(addRowAfter));
    editor.registerCommand('addColumn', wrap(addColumnAfter));
    editor.registerCommand('deleteRow', wrap(deleteRow));
    editor.registerCommand('deleteColumn', wrap(deleteColumn));
    editor.registerCommand('deleteTable', wrap(deleteTable));
    return [columnResizing(), tableEditing()];
  },
  toolbar: [
    { name: 'insertTable', label: 'Insert table', icon: '▦', command: 'insertTable' },
    { name: 'addRow', label: 'Add row below', icon: '+row', command: 'addRow' },
    { name: 'addColumn', label: 'Add column right', icon: '+col', command: 'addColumn' },
    { name: 'deleteRow', label: 'Delete row', icon: '−row', command: 'deleteRow' },
    { name: 'deleteColumn', label: 'Delete column', icon: '−col', command: 'deleteColumn' },
    { name: 'deleteTable', label: 'Delete table', icon: '🗑', command: 'deleteTable' },
  ],
};
