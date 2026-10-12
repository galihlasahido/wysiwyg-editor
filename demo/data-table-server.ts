// A table of 5,000 orders that lives on a "server" (an array here): the table asks for one page at a time, and new, edited and deleted rows go through the same server.
import { queryDataTable, type DataTableSpec } from '../src/data-table-app';
import { codePanel } from './samples';
import { mountTable, sleep, pick, day } from './data-table-kit';

const columns = [
  { key: 'id', title: 'Order', type: 'number' as const, decimals: 0, width: 90 },
  { key: 'customer', title: 'Customer', type: 'text' as const },
  { key: 'status', title: 'Status', type: 'select' as const, options: ['New', 'Paid', 'Shipped', 'Returned'] },
  { key: 'placed', title: 'Placed', type: 'date' as const },
  { key: 'amount', title: 'Amount', type: 'currency' as const, currency: 'USD', decimals: 2, total: 'sum' as const },
];
const names = ['Ada', 'Budi', 'Chen', 'Dewi', 'Eko', 'Farah', 'Gita', 'Hana', 'Ivan', 'Joko'];
const db: (string | number | boolean | null)[][] = Array.from({ length: 5000 }, (_, i) => [i + 1, `${pick(names, i * 7)} ${String.fromCharCode(65 + ((i * 11) % 26))}.`, pick(['New', 'Paid', 'Shipped', 'Returned'], i * 3), day(i * 3), 10 + ((i * 37) % 900) + 0.99]);
let calls = 0;

const demo = mountTable({
  theme: 'light',
  table: { columns, rows: [], options: { title: 'Orders (loaded from a server)', source: 'orders', pageSize: 20, search: true, filters: true, selectable: true } },
  sources: {
    orders: async (q) => {
      await sleep(250);                    // a real request would be here
      const spec = { v: 1, columns, rows: db, options: { groupBy: [] }, rules: [], views: [] } as unknown as DataTableSpec;
      const hits = queryDataTable(spec, { search: q.search, filters: q.filters, sort: q.sort } as never);
      const rows = hits.slice(q.page * q.pageSize, (q.page + 1) * q.pageSize).map((r) => db[r]);
      demo.log(`Request ${++calls}: page ${q.page + 1}, search “${q.search}”, ${hits.length} match, ${rows.length} sent.`);
      return { rows, total: hits.length, totals: { amount: Math.round(hits.reduce((s, r) => s + (db[r][4] as number), 0) * 100) / 100 } };
    },
  },
  crud: {
    access: { delete: ['admin'] },
    user: { id: 'adi', roles: ['admin'] },
    onCreate: async (row) => { await sleep(300); const id = db.length + 1; db.unshift([id, row.customer, row.status, row.placed, row.amount]); return { id }; },
    onUpdate: async (row, before) => { await sleep(300); const at = db.findIndex((r) => r[0] === before.id); if (at < 0) throw new Error('That order no longer exists.'); db[at] = [before.id as number, row.customer, row.status, row.placed, row.amount]; },
    onDelete: async (rows) => { await sleep(300); for (const r of rows) { const at = db.findIndex((x) => x[0] === r.id); if (at >= 0) db.splice(at, 1); } },
  },
});
void demo;

document.querySelector('#app')!.append(codePanel(`
createDataTable({
  element,
  table: { columns, rows: [], options: { source: 'orders', pageSize: 20, search: true, filters: true } },
  sources: { orders: ({ page, pageSize, search, filters, sort }) => fetchPage(...) },   // { rows, total, totals }
  crud: {
    access: { delete: ['admin'] }, user,
    onCreate: (row) => api.post('/orders', row),      // the table reloads the page afterwards
    onUpdate: (row, before) => api.put('/orders/' + before.id, row),
    onDelete: (rows) => api.delete('/orders', rows.map((r) => r.id)),
  },
});
`));
