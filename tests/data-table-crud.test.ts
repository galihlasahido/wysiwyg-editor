import { afterEach, describe, expect, it } from 'vitest';
import { createDataTable, hasDataTableAccess, type DataTableApp, type DataTableCrud, type DataTableUser } from '../src';

const apps: DataTableApp[] = [];
afterEach(() => { apps.splice(0).forEach((a) => a.destroy()); document.body.replaceChildren(); });
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const table = () => ({
  columns: [{ key: 'id', title: 'Id', type: 'number' }, { key: 'name', title: 'Name' }, { key: 'owner', title: 'Owner' }, { key: 'ok', title: 'Done', type: 'boolean' }],
  rows: [[1, 'Alpha', 'eka', false], [2, 'Beta', 'mira', true], [3, 'Gamma', 'eka', false]],
  options: { selectable: true },
});
const make = (crud: DataTableCrud) => {
  const app = createDataTable({ element: document.body.appendChild(document.createElement('div')), table: table(), crud });
  apps.push(app);
  return app;
};
const names = (a: DataTableApp) => a.getRows().map((r) => r.name);
const btn = (a: DataTableApp, text: string) => [...a.element.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === text);
const dialog = () => document.querySelector('.wy-dialog') as HTMLElement | null;
const dlgBtn = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('.wy-dialog-actions button')].find((b) => b.textContent === text)!;
const rowBtn = (a: DataTableApp, row: number, text: string) => a.element.querySelectorAll<HTMLElement>('tbody tr[data-row]')[row]?.querySelector<HTMLButtonElement>(`button[data-role="row-action"][title^="${text}"]`) ?? null;

describe('hasDataTableAccess', () => {
  const admin: DataTableUser = { roles: ['admin'], permissions: ['orders.read', 'orders.delete'] };
  it('reads roles, permissions, lists, wildcards, objects and functions', () => {
    expect(hasDataTableAccess(undefined, null)).toBe(true);
    expect(hasDataTableAccess(false, admin)).toBe(false);
    expect(hasDataTableAccess('admin', admin)).toBe(true);
    expect(hasDataTableAccess('orders.delete', admin)).toBe(true);
    expect(hasDataTableAccess('orders.*', admin)).toBe(true);
    expect(hasDataTableAccess(['editor', 'admin'], admin)).toBe(true);
    expect(hasDataTableAccess(['editor'], admin)).toBe(false);
    expect(hasDataTableAccess({ roles: ['admin'], permissions: ['orders.read', 'orders.delete'] }, admin)).toBe(true);
    expect(hasDataTableAccess({ roles: ['admin'], permissions: ['orders.read', 'orders.write'] }, admin)).toBe(false);
    expect(hasDataTableAccess((u, row) => u?.roles?.includes('admin') === true && row?.id === 1, admin, { id: 1 })).toBe(true);
    expect(hasDataTableAccess('admin', null)).toBe(false);
    expect(hasDataTableAccess(['x'], {})).toBe(false);
  });
  it('treats a rule that throws as a refusal', () => {
    expect(hasDataTableAccess(() => { throw new Error('x'); }, admin)).toBe(false);
  });
});

describe('CRUD buttons and dialogs', () => {
  it('adds New, Edit and Delete buttons by itself', () => {
    const a = make({});
    expect(btn(a, 'New…')).toBeTruthy();
    expect(rowBtn(a, 0, 'Edit')).toBeTruthy();
    expect(rowBtn(a, 0, 'Delete')).toBeTruthy();
  });

  it('inserts through a dialog, with a field for every column', async () => {
    const a = make({});
    btn(a, 'New…')!.click();
    expect(dialog()!.querySelectorAll('input').length).toBe(4);
    const inputs = dialog()!.querySelectorAll<HTMLInputElement>('input');
    inputs[0].value = '9'; inputs[1].value = 'Delta'; inputs[2].value = 'adi'; inputs[3].checked = true;
    dlgBtn('Add').click();
    await tick(5);
    expect(dialog()).toBeNull();
    expect(a.getRows()[3]).toEqual({ id: 9, name: 'Delta', owner: 'adi', ok: true });
  });

  it('updates through a dialog that starts with the row', async () => {
    const a = make({});
    rowBtn(a, 1, 'Edit')!.click();
    const inputs = dialog()!.querySelectorAll<HTMLInputElement>('input');
    expect(inputs[1].value).toBe('Beta');
    inputs[1].value = 'Beta 2';
    dlgBtn('Save').click();
    await tick(5);
    expect(names(a)).toEqual(['Alpha', 'Beta 2', 'Gamma']);
  });

  it('asks before deleting, and Cancel keeps the row', async () => {
    const a = make({});
    rowBtn(a, 0, 'Delete')!.click();
    expect(dialog()!.textContent).toContain('Alpha');
    dlgBtn('Cancel').click();
    expect(names(a).length).toBe(3);
    rowBtn(a, 0, 'Delete')!.click();
    dlgBtn('Delete').click();
    await tick(5);
    expect(names(a)).toEqual(['Beta', 'Gamma']);
    expect(dialog()).toBeNull();
  });

  it('deletes the ticked rows together', async () => {
    const a = make({});
    const boxes = a.element.querySelectorAll<HTMLInputElement>('tbody input[data-role="select-row"]');
    boxes[0].click(); boxes[2].click();
    const del = [...a.element.querySelectorAll<HTMLButtonElement>('.is-danger')].find((b) => !b.hidden)!;
    expect(del.textContent).toBe('Delete 2 rows');
    del.click();
    expect(dialog()!.textContent).toContain('2 rows');
    dlgBtn('Delete').click();
    await tick(5);
    expect(names(a)).toEqual(['Beta']);
  });

  it('can skip the question', async () => {
    const a = make({ confirmDelete: false });
    rowBtn(a, 0, 'Delete')!.click();
    await tick(5);
    expect(dialog()).toBeNull();
    expect(names(a)).toEqual(['Beta', 'Gamma']);
  });

  it('shows the server error in the dialog and keeps everything as it was', async () => {
    const a = make({
      onCreate: async () => { throw new Error('Name already taken'); },
      onUpdate: async () => { throw new Error('Conflict'); },
      onDelete: async () => { throw new Error('Not today'); },
    });
    btn(a, 'New…')!.click();
    dlgBtn('Add').click();
    await tick(5);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe('Name already taken');
    expect(dlgBtn('Add').disabled).toBe(false);
    dlgBtn('Cancel').click();
    rowBtn(a, 0, 'Edit')!.click();
    dlgBtn('Save').click();
    await tick(5);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe('Conflict');
    dlgBtn('Cancel').click();
    rowBtn(a, 0, 'Delete')!.click();
    dlgBtn('Delete').click();
    await tick(5);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toBe('Not today');
    dlgBtn('Cancel').click();
    expect(a.getRows().length).toBe(3);
  });

  it('uses the row the server saved, and waits for it', async () => {
    const calls: string[] = [];
    const a = make({ onCreate: async (row) => { calls.push(String(row.name)); await tick(10); return { id: 77 }; } });
    btn(a, 'New…')!.click();
    dialog()!.querySelectorAll<HTMLInputElement>('input')[1].value = 'Server made';
    dlgBtn('Add').click();
    expect(a.getRows().length).toBe(3); // not yet
    await tick(30);
    expect(calls).toEqual(['Server made']);
    expect(a.getRows()[3]).toMatchObject({ id: 77, name: 'Server made' });
  });

  it('a hook that returns false cancels quietly', async () => {
    const a = make({ onDelete: () => false });
    rowBtn(a, 0, 'Delete')!.click();
    dlgBtn('Delete').click();
    await tick(5);
    expect(a.getRows().length).toBe(3);
  });
});

describe('the guard', () => {
  const eka: DataTableUser = { id: 'eka', roles: ['editor'] };
  const crud = (user: DataTableUser | null): DataTableCrud => ({
    user,
    access: {
      create: ['editor', 'admin'],
      update: (u, row) => hasDataTableAccess('admin', u) || (hasDataTableAccess('editor', u) && (!row || row.owner === u?.id)),
      delete: { roles: ['admin'] },
    },
  });

  it('shows no button to a person who may do nothing', () => {
    const a = make(crud(null));
    expect(btn(a, 'New…')).toBeUndefined();
    expect(rowBtn(a, 0, 'Edit')).toBeNull();
    expect(rowBtn(a, 0, 'Delete')).toBeNull();
    expect(a.element.querySelector('th.wy-dt-actions')).toBeNull();
  });

  it('follows the person, row by row', () => {
    const a = make(crud(eka));
    expect(btn(a, 'New…')).toBeTruthy();
    expect(rowBtn(a, 0, 'Edit')).toBeTruthy();    // her own
    expect(rowBtn(a, 1, 'Edit')).toBeNull();      // Mira's
    expect(rowBtn(a, 0, 'Delete')).toBeNull();
    a.setUser({ id: 'adi', roles: ['admin'] });
    expect(rowBtn(a, 1, 'Edit')).toBeTruthy();
    expect(rowBtn(a, 1, 'Delete')).toBeTruthy();
    a.setUser(null);
    expect(btn(a, 'New…')).toBeUndefined();
  });

  it('also blocks the other ways in: typing in a cell, the keyboard and the API', async () => {
    const a = make(crud(eka));
    const cellOf = (r: number, c: number) => a.element.querySelectorAll<HTMLElement>('tbody tr[data-row]')[r].querySelector(`td[data-col="${c}"]`) as HTMLElement;
    const type = (r: number, v: string) => {
      const td = cellOf(r, 1);
      td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const input = td.querySelector('input') as HTMLInputElement | null;
      if (!input) return;
      input.value = v;
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    };
    type(1, 'Hacked');                           // Mira's row
    expect(names(a)[1]).toBe('Beta');
    type(0, 'Mine');                             // her own
    expect(names(a)[0]).toBe('Mine');
  });

  it('refuses a change that was allowed when the dialog opened but is not any more', async () => {
    let who: DataTableUser | null = eka;
    const a = make({ user: () => who, access: { update: ['editor'] } });
    rowBtn(a, 0, 'Edit')!.click();
    who = { id: 'x', roles: ['viewer'] };
    dlgBtn('Save').click();
    await tick(5);
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toMatch(/not allowed/);
    dlgBtn('Cancel').click();
  });

  it('turns an action off for everyone', () => {
    const a = make({ create: false, delete: false });
    expect(btn(a, 'New…')).toBeUndefined();
    expect(rowBtn(a, 0, 'Edit')).toBeTruthy();
    expect(rowBtn(a, 0, 'Delete')).toBeNull();
  });

  it('keeps a read-only table read-only', () => {
    const a = make({});
    a.setReadOnly(true);
    expect(btn(a, 'New…')).toBeUndefined();
    expect(rowBtn(a, 0, 'Edit')).toBeNull();
  });

  it('can be wrapped around a table that loads its rows', async () => {
    const saved: unknown[] = [];
    const app = createDataTable({
      element: document.body.appendChild(document.createElement('div')),
      table: { columns: [{ key: 'id', title: 'Id', type: 'number' }, { key: 'name', title: 'Name' }], rows: [], options: { source: 'p', pageSize: 5 } },
      sources: { p: () => ({ rows: [[1, 'A'], [2, 'B']], total: 2 }) },
      crud: { onUpdate: (row) => { saved.push(row); }, onDelete: (rows) => { saved.push(rows.length); } },
    });
    apps.push(app);
    await tick(20);
    expect(btn(app, 'New…')).toBeUndefined();          // no onCreate: nothing could save it
    rowBtn(app, 0, 'Edit')!.click();
    dialog()!.querySelectorAll<HTMLInputElement>('input')[1].value = 'A2';
    dlgBtn('Save').click();
    await tick(20);
    rowBtn(app, 1, 'Delete')!.click();
    dlgBtn('Delete').click();
    await tick(20);
    expect(saved).toEqual([{ id: 1, name: 'A2' }, 1]);
  });
});
