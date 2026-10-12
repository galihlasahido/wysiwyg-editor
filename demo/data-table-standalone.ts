// Only the stand-alone entry is used here: no editor, no ProseMirror.
import { createDataTable, defaultThemes, defineDataTableElement } from '../src/data-table-app';
import { $, button, codePanel, el } from './samples';

const people = ['Ada', 'Budi', 'Chen', 'Dewi', 'Eko', 'Farah', 'Gita', 'Hana'];
const table = {
  columns: [
    { key: 'name', title: 'Customer', type: 'text' },
    { key: 'region', title: 'Region', type: 'select', options: ['North', 'South', 'East', 'West'] },
    { key: 'qty', title: 'Orders', type: 'number', bar: true, total: 'sum' },
    { key: 'avg', title: 'Average', type: 'currency', currency: 'USD', decimals: 2 },
    { key: 'total', title: 'Revenue', type: 'currency', currency: 'USD', formula: '[Orders] * [Average]', total: 'sum' },
    { key: 'since', title: 'Customer since', type: 'date' },
    { key: 'vip', title: 'VIP', type: 'boolean' },
  ],
  rows: Array.from({ length: 120 }, (_, i) => [`${people[i % 8]} ${String.fromCharCode(65 + (i % 26))}.`, ['North', 'South', 'East', 'West'][i % 4], 1 + ((i * 7) % 40), 20 + ((i * 13) % 90) + 0.5, null, `20${15 + (i % 11)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, i % 9 === 0]),
  rules: [{ column: 'qty', test: '>30', look: 'green' }, { column: 'vip', test: 'true', look: 'bold', row: true }],
  views: [{ name: 'Big accounts', search: '', filters: { qty: '>25' }, sort: [{ key: 'total', dir: 'desc' }], groupBy: [], hidden: ['since'], pageSize: 10 }],
  options: { title: 'Customers', pageSize: 10, search: true, filters: true, selectable: true, detail: true, reorder: true },
};

$('#app').append(el('div', { class: 'panel', id: 'table' }));
const log = el('pre', { class: 'demo-log', 'aria-live': 'polite' }, 'Changes appear here.');
let count = 0;
const app = createDataTable({
  element: $('#table'),
  table,
  theme: 'light',
  locale: 'en-US',
  buttons: [{ id: 'email', label: 'Email selected', needsSelection: true, onClick: ({ selected }) => { log.textContent = `Would email ${selected.length} customer${selected.length === 1 ? '' : 's'}.`; } }],
  rowActions: [{ label: 'Open', onClick: (row) => { log.textContent = `Open ${row.name}`; } }],
  onChange: (t) => { log.textContent = `Change ${++count}: ${t.rows.length} rows, ${t.columns.length} columns.`; },
});
(window as unknown as { app: typeof app }).app = app;

const undo = button('Undo', () => app.undo());
const redo = button('Redo', () => app.redo());
const sync = () => { (undo as HTMLButtonElement).disabled = !app.canUndo; (redo as HTMLButtonElement).disabled = !app.canRedo; };
app.on('change', sync);
sync();

$('#app').prepend(
  el('div', { class: 'actions' },
    undo, redo,
    button('Read-only', () => { app.setReadOnly(!app.readOnly); }),
    ...['light', 'dark', ...defaultThemes.filter((t) => !['light', 'dark'].includes(t.name)).map((t) => t.name)].map((name) => button(name, () => app.setTheme(name))),
    button('Download .xlsx', () => app.download('xlsx')),
  ),
);
$('#app').append(log);

// the same thing as a custom element
defineDataTableElement();
const element = document.createElement('wysiwyg-data-table');
element.setAttribute('theme', 'nord');
element.innerHTML = `<script type="application/json">${JSON.stringify({ columns: [{ title: 'Language' }, { title: 'Year', type: 'number', decimals: 0 }], rows: [['Fortran', 1957], ['C', 1972], ['TypeScript', 2012]], options: { title: 'As a custom element', pageSize: 0, search: false } })}</script>`;
$('#app').append(el('h2', {}, 'As a custom element'), el('div', { class: 'panel' }, element));

$('#app').append(codePanel(`
import { createDataTable } from 'wysiwygido/data-table';   // no editor, no ProseMirror
import 'wysiwygido/style.css';

const app = createDataTable({
  element: document.querySelector('#grid'),
  table: { columns: [...], rows: [...], options: { pageSize: 25, filters: true } },
  theme: 'nord',
  onChange: (table) => save(table),
  buttons: [{ id: 'email', label: 'Email', needsSelection: true, onClick: ({ selected }) => email(selected) }],
});
app.getRows(); app.undo(); app.setTheme('dark'); app.download('xlsx'); app.destroy();

// or:  <wysiwyg-data-table theme="nord"><script type="application/json">{ "columns": [...], "rows": [...] }</script></wysiwyg-data-table>
`));
