import { Charts, cleanDataTable, createFetchDataSource, createEditor, defaultPlugins, DataTable, download, queryDataRows, type DataPage, type DataQuery } from '../src';
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
    { key: 'stock', title: 'Stock', type: 'number', total: 'sum', bar: true },
    { key: 'price', title: 'Price', type: 'currency', currency: 'USD', total: 'avg' },
    { key: 'added', title: 'Added', type: 'date' },
    { key: 'active', title: 'Active', type: 'boolean' },
    { key: 'value', title: 'Stock value', type: 'currency', currency: 'USD', formula: '[Stock] * [Price]', total: 'sum' },
  ],
  rows,
  rules: [
    { column: 'stock', test: '<10', look: 'red' },
    { column: 'active', test: 'false', look: 'gray', row: true },
  ],
  views: [
    { name: 'Low stock', search: '', filters: { stock: '<15' }, sort: [{ key: 'stock', dir: 'asc' }], groupBy: [], hidden: [], pageSize: 10 },
    { name: 'Coffee by value', search: '', filters: { cat: 'Coffee' }, sort: [{ key: 'value', dir: 'desc' }], groupBy: [], hidden: ['added'], pageSize: 10 },
  ],
  options: { title: 'Products', pageSize: 10, search: true, filters: true, striped: true, selectable: true, detail: true, reorder: true },
};

// A pretend server: 5,000 orders, answering after a short delay, with real searching, filtering, sorting and paging.
const orderColumns = [
  { key: 'id', title: 'Order', type: 'number' },
  { key: 'customer', title: 'Customer', type: 'text' },
  { key: 'region', title: 'Region', type: 'select', options: ['North', 'South', 'East', 'West'] },
  { key: 'amount', title: 'Amount', type: 'currency', currency: 'USD', total: 'sum' },
  { key: 'placed', title: 'Placed', type: 'date' },
  { key: 'paid', title: 'Paid', type: 'boolean' },
];
const people = ['Ada', 'Budi', 'Chen', 'Dewi', 'Eko', 'Farah', 'Gita', 'Hana', 'Ilham', 'Joko'];
const orders = cleanDataTable({
  columns: orderColumns,
  rows: Array.from({ length: 5000 }, (_, i) => [i + 1, `${people[i % 10]} ${String.fromCharCode(65 + (i % 26))}.`, ['North', 'South', 'East', 'West'][i % 4], 20 + ((i * 37) % 900) + (i % 7) / 10, `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, i % 3 === 0]),
})!;
async function loadOrders(q: DataQuery): Promise<DataPage> {
  await new Promise((r) => setTimeout(r, 300));
  const hits = queryDataRows(orders, { search: q.search, filters: q.filters, sort: q.sort }, 'en-US');
  const page = hits.slice(q.page * q.pageSize, (q.page + 1) * q.pageSize);
  return { rows: page.map((r) => orders.rows[r]), total: hits.length, totals: { amount: hits.reduce((n, r) => n + (orders.rows[r][3] as number), 0) } };
}

const status = el('div', { class: 'demo-note' }, 'Search, click a heading to sort (Shift+click for a second sort), type in the filter row (for numbers try >10, 5..20), double-click or press Enter on a cell to edit. Drag a column edge to resize, drag the ⠿ handle (or Alt+Up/Down) to reorder, open ▸ for details, and try Views ▾ and Options ▾ (highlight rules, charts).');

$('#app').append(
  status,
  el('div', { class: 'actions' },
    button('Convert to regular table', () => { select(); editor.execute('dataTableToTable'); }),
    button('Convert table back', () => editor.execute('tableToDataTable')),
    button('New data table', () => editor.execute('insertDataTable')),
    button('Import CSV or Excel…', () => editor.execute('dataTableFromFile')),
    button('Group by category', () => editor.execute('insertDataTable', { ...spec, options: { ...spec.options, title: 'Products by category', groupBy: ['cat'], pageSize: 0, filters: false } })),
    button('20,000 rows (scrolls)', () => editor.execute('insertDataTable', {
      columns: [{ key: 'n', title: '#', type: 'number' }, { key: 'code', title: 'Code', type: 'text' }, { key: 'v', title: 'Value', type: 'number', decimals: 2, total: 'sum' }, { key: 'd', title: 'Date', type: 'date' }],
      rows: Array.from({ length: 20000 }, (_, i) => [i + 1, `ITEM-${String(i * 7919 % 100000).padStart(5, '0')}`, (i * 31) % 1000 / 7, `2026-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`]),
      options: { title: '20,000 rows, only the visible ones are drawn', pageSize: 0, filters: true, height: 360 },
    })),
    button('Load from a server', () => editor.execute('insertDataTable', { columns: orderColumns, rows: [], options: { title: 'Orders (loaded 25 at a time)', source: 'orders', pageSize: 25, filters: true, selectable: true } })),
    button('Download .xlsx', () => { const b = (editor.extensions.dataTable as { export(f: string): Blob | null }).export('xlsx'); if (b) download(b, 'products.xlsx'); }),
  ),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({
  element: $('#editor'),
  content: '<h2>Stock list</h2><p>This table lives in the document: edits are undoable, and it exports to Word.</p>',
  ribbon: true,
  plugins: [...defaultPlugins.filter((p) => p.name !== 'dataTable'), Charts(), DataTable({
    locale: 'en-US',
    // `?endpoint=http://127.0.0.1:8788/api/orders` (pnpm server:examples) uses the example server instead of the pretend one above
    sources: { orders: new URLSearchParams(location.search).get('endpoint') ? createFetchDataSource(new URLSearchParams(location.search).get('endpoint')!) : loadOrders },
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
editor.execute('insertDataTable', { columns: [...], rows: [...], options: { pageSize: 25, filters: true, groupBy: ['category'] } });
// rows from a server instead of the document: options.source names a function you give the plugin
DataTable({ sources: { orders: async ({ page, pageSize, search, filters, sort }) => ({ rows, total, totals: { amount } }) } })
editor.execute('tableToDataTable');           // the table at the cursor
editor.execute('dataTableToTable');           // the selected data table
editor.execute('exportDataTable', 'xlsx');    // 'csv' | 'xlsx' | 'pdf'
const csv = await editor.extensions.dataTable.export('csv')?.text();
`));
