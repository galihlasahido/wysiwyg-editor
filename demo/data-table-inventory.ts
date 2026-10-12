// Stock control: groups, bars, low-stock highlights, saved views, bulk buttons on the ticked rows, and a button on every row.
import { codePanel } from './samples';
import { mountTable, pick } from './data-table-kit';

const items = ['Matcha powder', 'Oolong tea', 'Green tea', 'Chai blend', 'Cold brew', 'Espresso beans', 'Oat milk', 'Syrup', 'Cups 12oz', 'Lids', 'Stir sticks', 'Napkins', 'Tote bag', 'Mug', 'Tumbler'];
const cat = (i: number) => (i < 5 ? 'Tea' : i < 7 ? 'Coffee' : i < 8 ? 'Dairy' : i < 12 ? 'Supplies' : 'Merchandise');
const demo = mountTable({
  theme: 'light',
  table: {
    columns: [
      { key: 'sku', title: 'SKU', type: 'text', width: 90 },
      { key: 'name', title: 'Product', type: 'text' },
      { key: 'cat', title: 'Category', type: 'select', options: ['Tea', 'Coffee', 'Dairy', 'Supplies', 'Merchandise'] },
      { key: 'stock', title: 'In stock', type: 'number', decimals: 0, bar: true, total: 'sum' },
      { key: 'min', title: 'Reorder at', type: 'number', decimals: 0 },
      { key: 'cost', title: 'Unit cost', type: 'currency', currency: 'USD', decimals: 2 },
      { key: 'value', title: 'Stock value', type: 'currency', currency: 'USD', decimals: 2, formula: '[In stock] * [Unit cost]', total: 'sum' },
      { key: 'low', title: 'Low?', type: 'boolean', formula: '[In stock] < [Reorder at]' },
      { key: 'seen', title: 'Counted', type: 'date' },
    ],
    rows: items.map((n, i) => [`SKU-${100 + i}`, n, cat(i), (i * 37) % 120, 30 + (i % 4) * 10, 1.5 + (i % 6) * 2.25, null, null, `2025-0${1 + (i % 9)}-1${i % 9}`]),
    rules: [{ column: 'stock', test: '<20', look: 'red' }, { column: 'low', test: 'true', look: 'amber', row: true }],
    views: [
      { name: 'Needs ordering', search: '', filters: { low: 'true' }, sort: [{ key: 'stock', dir: 'asc' }], groupBy: [], hidden: ['seen'], pageSize: 0 },
      { name: 'By category', search: '', filters: {}, sort: [], groupBy: ['cat'], hidden: ['sku', 'seen'], pageSize: 0 },
    ],
    options: { title: 'Stock', pageSize: 0, search: true, filters: true, selectable: true, groupBy: [], striped: true },
  },
  buttons: [{ id: 'order', label: 'Order selected', needsSelection: true, title: 'Make a purchase order for the ticked products', onClick: ({ selected }) => demo.log(`Purchase order: ${selected.map((r) => `${r.name} × ${Math.max(0, Number(r.min) * 2 - Number(r.stock))}`).join(', ')}`) }],
  rowActions: [{ label: 'Count', title: 'Record a stock count', onClick: (row) => demo.log(`Count ${row.name}…`), when: (row) => Number(row.stock) < Number(row.min) }],
  crud: { access: { delete: ['manager'] }, user: { id: 'sam', roles: ['clerk'] } },
});
demo.app.on('change', () => demo.log('Saved a change. Use Views ▾ for "Needs ordering" or "By category".'));
void pick;

document.querySelector('#app')!.append(codePanel(`
buttons:    [{ id: 'order', label: 'Order selected', needsSelection: true, onClick: ({ selected }) => makeOrder(selected) }],
rowActions: [{ label: 'Count', when: (row) => row.stock < row.min, onClick: (row) => count(row) }],   // only on rows that need it
columns:    [{ key: 'low', type: 'boolean', formula: '[In stock] < [Reorder at]' }, { key: 'stock', bar: true, total: 'sum' } ],
views:      [{ name: 'Needs ordering', filters: { low: 'true' }, sort: [{ key: 'stock', dir: 'asc' }] }],
crud:       { access: { delete: ['manager'] }, user }          // a clerk can add and change rows, but not delete
`));
