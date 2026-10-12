// A staff directory: row details, filters, dates and flags, a read-only viewer and a link on every row.
import { codePanel, button } from './samples';
import { mountTable, pick } from './data-table-kit';

const first = ['Ana', 'Budi', 'Citra', 'Dimas', 'Eka', 'Fajar', 'Gita', 'Hendra', 'Indah', 'Joko', 'Kiki', 'Lina'];
const demo = mountTable({
  theme: 'light',
  table: {
    columns: [
      { key: 'name', title: 'Name', type: 'text' },
      { key: 'team', title: 'Team', type: 'select', options: ['Design', 'Engineering', 'Finance', 'People', 'Sales'] },
      { key: 'title', title: 'Role', type: 'text' },
      { key: 'city', title: 'Office', type: 'select', options: ['Jakarta', 'Bandung', 'Surabaya', 'Remote'] },
      { key: 'start', title: 'Started', type: 'date' },
      { key: 'salary', title: 'Salary', type: 'currency', currency: 'IDR', decimals: 0, hidden: true },
      { key: 'remote', title: 'Remote', type: 'boolean' },
      { key: 'email', title: 'Email', type: 'text', hidden: true },
    ],
    rows: first.flatMap((n, i) => [0, 1, 2].map((k) => {
      const team = pick(['Design', 'Engineering', 'Finance', 'People', 'Sales'], i + k);
      return [`${n} ${pick(['Santoso', 'Wijaya', 'Lestari', 'Pratama'], i + k * 2)}`, team, pick(['Lead', 'Specialist', 'Manager', 'Associate'], i * 2 + k), pick(['Jakarta', 'Bandung', 'Surabaya', 'Remote'], i + k), `20${18 + ((i + k) % 8)}-0${1 + ((i + k) % 9)}-1${(i + k) % 9}`, 8000000 + ((i * 13 + k * 7) % 20) * 1000000, (i + k) % 4 === 3, `${n.toLowerCase()}.${k}@example.com`];
    })),
    options: { title: 'Staff directory', pageSize: 10, search: true, filters: true, detail: true, striped: true },
  },
  detail: (row) => {
    const box = document.createElement('div');
    box.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = `${row.name} works in ${row.team} as ${row.role ?? row.title}, based in ${row.city}. Reach them at ${row.email}.`;
    box.append(p);
    return box;
  },
  rowActions: [{ label: 'Email', title: 'Write to this person', onClick: (row) => demo.log(`mailto:${row.email}`) }],
});
demo.actions.prepend(button('Read-only (directory view)', () => { demo.app.setReadOnly(!demo.app.readOnly); demo.log(demo.app.readOnly ? 'Read-only: nothing can be changed.' : 'Editable again.'); }));

document.querySelector('#app')!.append(codePanel(`
options: { detail: true }                                    // a ▸ on every row opens its details, hidden columns included
detail:  (row) => elementOrText,                             // or build your own panel (may be async)
columns: [{ key: 'salary', hidden: true }, ...]              // shown in the details and in the Columns ▾ menu, not in the grid
app.setReadOnly(true)                                        // a directory people can search but not change
`));
