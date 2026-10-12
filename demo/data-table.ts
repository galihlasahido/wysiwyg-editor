import { createEditor, defaultPlugins, DataTable, download } from '../src';
import { $, button, codePanel, el } from './samples';

const names = ['Oolong tea', 'Green tea', 'Black tea', 'Espresso beans', 'Filter coffee', 'Matcha', 'Chai mix', 'Hot chocolate', 'Cold brew', 'Rooibos', 'Earl Grey', 'Jasmine pearls'];
const cats = ['Tea', 'Coffee', 'Other'];
const rows = Array.from({ length: 64 }, (_, i) => [
  `${names[i % names.length]} ${Math.floor(i / names.length) + 1}`,
  i % 12 === 4 || i % 12 === 3 || i % 12 === 8 ? 'Coffee' : i % 12 === 7 || i % 12 === 6 ? 'Other' : 'Tea',
  ((i * 7) % 40) + 3,
  Math.round((3 + ((i * 13) % 17) * 1.35) * 100) / 100,
  `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`,
  i % 3 !== 0,
]);
const spec = {
  columns: [
    { key: 'name', title: 'Product', type: 'text' },
    { key: 'cat', title: 'Category', type: 'select', options: cats },
    { key: 'stock', title: 'Stock', type: 'number', total: 'sum' },
    { key: 'price', title: 'Price', type: 'currency', currency: 'USD', total: 'avg' },
    { key: 'added', title: 'Added', type: 'date' },
    { key: 'active', title: 'Active', type: 'boolean' },
  ],
  rows,
  options: { title: 'Products', pageSize: 10, search: true, filters: true, striped: true, selectable: true },
};

const status = el('div', { class: 'demo-note' }, 'Search, click a heading to sort (Shift+click for a second sort), type in the filter row (for numbers try >10, 5..20), double-click or press Enter on a cell to edit.');

$('#app').append(
  status,
  el('div', { class: 'actions' },
    button('Convert to regular table', () => { select(); editor.execute('dataTableToTable'); }),
    button('Convert table back', () => editor.execute('tableToDataTable')),
    button('New data table', () => editor.execute('insertDataTable')),
    button('Import CSV…', () => editor.execute('dataTableFromCSV')),
    button('Download .xlsx', () => { const b = (editor.extensions.dataTable as { export(f: string): Blob | null }).export('xlsx'); if (b) download(b, 'products.xlsx'); }),
  ),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({
  element: $('#editor'),
  content: '<h2>Stock list</h2><p>This table lives in the document: edits are undoable, and it exports to Word.</p>',
  ribbon: true,
  plugins: [...defaultPlugins.filter((p) => p.name !== 'dataTable'), DataTable({
    locale: 'en-US',
    buttons: [
      { id: 'restock', label: 'Mark inactive', needsSelection: true, onClick: ({ selected }) => { status.textContent = `Would mark ${selected.length} product${selected.length === 1 ? '' : 's'} inactive.`; } },
      { id: 'count', label: 'How many?', onClick: ({ visible, spec: s }) => { status.textContent = `${visible.length} of ${s.rows.length} rows match right now.`; } },
    ],
    rowActions: [{ label: 'View', onClick: (row) => { status.textContent = `Open “${row.name}” (stock ${row.stock}).`; } }],
  })],
});
editor.execute('insertDataTable', spec);
function select() { editor.view.dom.querySelector<HTMLElement>('.wy-dt-handle')?.click(); }
(window as unknown as { editor: typeof editor }).editor = editor;
$('#app').append(codePanel(`
plugins: [...defaultPlugins, DataTable({
  buttons: [{ id: 'ship', label: 'Ship', needsSelection: true, onClick: ({ selected }) => api.ship(selected) }],
  rowActions: [{ label: 'View', onClick: (row, index) => open(row.id) }],
})],
editor.execute('insertDataTable', { columns: [...], rows: [...], options: { pageSize: 25, filters: true } });
editor.execute('tableToDataTable');           // the table at the cursor
editor.execute('dataTableToTable');           // the selected data table
editor.execute('exportDataTable', 'xlsx');    // 'csv' | 'xlsx' | 'pdf'
const csv = await editor.extensions.dataTable.export('csv')?.text();
`));
