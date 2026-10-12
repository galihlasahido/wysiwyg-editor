// Create, edit and delete in dialogs, guarded by the signed-in person's roles and permissions.
import { hasDataTableAccess, type DataTableUser } from '../src/data-table-app';
import { codePanel, el, button } from './samples';
import { mountTable, sleep, pick, day } from './data-table-kit';

const users: Record<string, { label: string; user: DataTableUser | null; note: string }> = {
  guest: { label: 'Guest', user: null, note: 'Not signed in: can look, nothing else.' },
  viewer: { label: 'Viewer', user: { id: 'vera', roles: ['viewer'] }, note: 'Can look; no buttons.' },
  eka: { label: 'Eka (editor)', user: { id: 'eka', roles: ['editor'] }, note: 'Can add tickets and change only her own.' },
  mira: { label: 'Mira (manager)', user: { id: 'mira', roles: ['manager'] }, note: 'Can add and change every ticket; cannot delete.' },
  adi: { label: 'Adi (admin)', user: { id: 'adi', roles: ['admin'] }, note: 'Can do everything; deleting asks first.' },
  intern: { label: 'Ian (permission only)', user: { id: 'ian', permissions: ['tickets.create', 'tickets.update'] }, note: 'No role at all: allowed by permissions "tickets.create" and "tickets.update".' },
};

const staff = ['eka', 'mira', 'adi', 'vera'];
const titles = ['Login fails on Safari', 'Export is slow', 'Typo on invoice', 'Dark mode contrast', 'Cannot reset password', 'Report totals differ', 'Email not delivered', 'Wrong time zone'];
const rows = Array.from({ length: 24 }, (_, i) => [1001 + i, pick(titles, i * 3), pick(['Open', 'In progress', 'Done'], i), pick(['Low', 'Normal', 'High', 'Critical'], i * 5), pick(staff, i * 7), day(i * 5), i % 5 === 0]);

const serverLog: string[] = [];
const say = (s: string) => { serverLog.unshift(`${new Date().toLocaleTimeString()}  ${s}`); demo.log(serverLog.slice(0, 6).join('\n')); };
let nextId = 2000;

// the guard: a rule is a role, a permission, a list of them, an object, or a function
const canManage = ['manager', 'admin'];
const demo = mountTable({
  theme: 'light',
  table: {
    columns: [
      { key: 'id', title: '#', type: 'number', decimals: 0, width: 70 },
      { key: 'title', title: 'Title', type: 'text' },
      { key: 'status', title: 'Status', type: 'select', options: ['Open', 'In progress', 'Done'] },
      { key: 'priority', title: 'Priority', type: 'select', options: ['Low', 'Normal', 'High', 'Critical'] },
      { key: 'assignee', title: 'Assignee', type: 'select', options: staff },
      { key: 'opened', title: 'Opened', type: 'date' },
      { key: 'blocked', title: 'Blocked', type: 'boolean' },
    ],
    rows,
    rules: [{ column: 'priority', test: '=Critical', look: 'red' }, { column: 'status', test: '=Done', look: 'green' }],
    options: { title: 'Support tickets', pageSize: 8, search: true, filters: true, selectable: true },
  },
  crud: {
    user: users.guest.user,
    access: {
      create: ['editor', 'manager', 'admin', 'tickets.create'],
      update: (user, row) => hasDataTableAccess(canManage, user) || hasDataTableAccess('tickets.update', user) || (hasDataTableAccess('editor', user) && (!row || row.assignee === user?.id)),
      delete: { roles: ['admin'] },
    },
    onCreate: async (row) => {
      await sleep(400);
      if (!String(row.title ?? '').trim()) throw new Error('A ticket needs a title.');
      say(`POST /tickets  “${row.title}”`);
      return { id: nextId++ };               // the server decides the number
    },
    onUpdate: async (row, before) => {
      await sleep(300);
      if (!String(row.title ?? '').trim()) throw new Error('A ticket needs a title.');
      say(`PUT /tickets/${before.id}`);
    },
    onDelete: async (rows) => {
      await sleep(300);
      if (rows.some((r) => r.priority === 'Critical')) throw new Error('Critical tickets cannot be deleted; close them instead.');
      say(`DELETE /tickets  ${rows.map((r) => r.id).join(', ')}`);
    },
  },
});

const who = el('p', { class: 'hint' });
const choose = (key: string) => { demo.app.setUser(users[key].user); who.textContent = `${users[key].label}: ${users[key].note}`; };
demo.actions.prepend(...Object.entries(users).map(([key, u]) => button(u.label, () => choose(key))));
demo.panel.before(who);
choose('guest');

document.querySelector('#app')!.append(codePanel(`
import { createDataTable, hasDataTableAccess } from 'wysiwygido/data-table';

const app = createDataTable({
  element, table,
  crud: {
    user: currentUser,                              // { id, roles: ['editor'], permissions: ['tickets.create'] } or a function
    access: {
      create: ['editor', 'manager', 'admin'],       // a role or a permission; 'tickets.*' also works
      update: (user, row) => hasDataTableAccess(['manager', 'admin'], user) || row?.assignee === user?.id,
      delete: { roles: ['admin'] },                 // roles: one of them; permissions: all of them
    },
    onCreate: async (row) => (await api.post('/tickets', row)).data,   // return the saved row (the id the server made)
    onUpdate: (row, before, index) => api.put('/tickets/' + before.id, row),
    onDelete: (rows) => api.delete('/tickets', rows.map((r) => r.id)),     // throw to refuse: the message shows in the dialog
  },
});
app.setUser(otherUser);   // after sign-in or sign-out: buttons appear and disappear

// This hides what a person may not do. It is not security: check the same rules on your server.
`));
