// A budget against actual spending: calculated columns, totals, highlight rules and a grouped view.
import { codePanel, button } from './samples';
import { mountTable } from './data-table-kit';

const lines: [string, string, number, number][] = [
  ['Marketing', 'Advertising', 42000, 47850], ['Marketing', 'Events', 18000, 15200], ['Marketing', 'Content', 12000, 12400],
  ['Engineering', 'Salaries', 310000, 310000], ['Engineering', 'Cloud hosting', 54000, 61300], ['Engineering', 'Tools', 9000, 7100],
  ['Sales', 'Commissions', 76000, 81200], ['Sales', 'Travel', 22000, 26700], ['Sales', 'Training', 8000, 3900],
  ['Operations', 'Rent', 96000, 96000], ['Operations', 'Utilities', 14000, 13100], ['Operations', 'Insurance', 11000, 11000],
];
const demo = mountTable({
  theme: 'light',
  table: {
    columns: [
      { key: 'dept', title: 'Department', type: 'text' },
      { key: 'item', title: 'Item', type: 'text' },
      { key: 'budget', title: 'Budget', type: 'currency', currency: 'USD', decimals: 0, total: 'sum' },
      { key: 'actual', title: 'Actual', type: 'currency', currency: 'USD', decimals: 0, total: 'sum' },
      { key: 'diff', title: 'Over / under', type: 'currency', currency: 'USD', decimals: 0, formula: '[Actual] - [Budget]', total: 'sum' },
      { key: 'pct', title: 'Used', type: 'number', decimals: 0, formula: 'ROUND([Actual] / [Budget] * 100)', bar: true },
      { key: 'state', title: 'State', type: 'text', formula: 'IF([Actual] > [Budget] * 1.05, "Over budget", IF([Actual] < [Budget] * 0.9, "Under", "On track"))' },
    ],
    rows: lines.map(([dept, item, budget, actual]) => [dept, item, budget, actual, null, null, null]),
    rules: [
      { column: 'state', test: 'Over budget', look: 'red', row: false },
      { column: 'state', test: 'Under', look: 'blue' },
      { column: 'state', test: 'On track', look: 'green' },
      { column: 'diff', test: '>5000', look: 'bold' },
    ],
    views: [{ name: 'Over budget only', search: '', filters: { state: 'Over budget' }, sort: [{ key: 'diff', dir: 'desc' }], groupBy: [], hidden: [], pageSize: 0 }],
    options: { title: 'Budget against actual, 2025', pageSize: 0, search: true, filters: true, groupBy: ['dept'] },
  },
});
demo.actions.prepend(button('Group by department', () => demo.app.setTable({ ...demo.app.getTable(), options: { ...demo.app.getTable().options, groupBy: ['dept'] } })), button('No grouping', () => demo.app.setTable({ ...demo.app.getTable(), options: { ...demo.app.getTable().options, groupBy: [] } })), button('Download .xlsx', () => demo.app.download('xlsx')));
demo.app.on('change', (t) => demo.log(`Edited. ${t.rows.length} lines; try changing an Actual amount: the difference, the bar and the state follow.`));

document.querySelector('#app')!.append(codePanel(`
columns: [
  { key: 'diff',  title: 'Over / under', type: 'currency', formula: '[Actual] - [Budget]', total: 'sum' },
  { key: 'pct',   title: 'Used', type: 'number', formula: 'ROUND([Actual] / [Budget] * 100)', bar: true },
  { key: 'state', title: 'State', formula: 'IF([Actual] > [Budget] * 1.05, "Over budget", IF([Actual] < [Budget] * 0.9, "Under", "On track"))' },
],
rules: [{ column: 'state', test: 'Over budget', look: 'red' }, { column: 'state', test: 'On track', look: 'green' }],
options: { groupBy: ['dept'], search: true, filters: true }
`));
