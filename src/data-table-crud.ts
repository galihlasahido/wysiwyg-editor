import { openDialog } from './dialog';
import type { Cell, DataColumn } from './data-table';

/** What a signed-in person may do. Roles ("admin") and permissions ("orders.delete") are plain strings you choose. */
export interface DataTableUser {
  id?: string;
  roles?: string[];
  permissions?: string[];
}

export type CrudAction = 'create' | 'update' | 'delete';

/**
 * Who may do something.
 * - `true` / `false`: everyone / no one.
 * - a string or an array of strings: the person has one of them, as a role or as a permission (`'orders.*'` matches `orders.delete`; `'*'` matches anything the person has).
 * - `{ roles, permissions }`: has one of the `roles`, and has every one of the `permissions`.
 * - a function, given the person (or null when nobody is signed in) and, for a row, that row.
 */
export type AccessRule = boolean | string | string[] | { roles?: string[]; permissions?: string[] } | ((user: DataTableUser | null, row?: Record<string, Cell>) => boolean);

export interface DataTableCrud {
  /** Who is using the table: the person, or a function that returns them (called each time, so a change of login is seen). */
  user?: DataTableUser | null | (() => DataTableUser | null | undefined);
  /** The guard per action. An action without a rule is open to everyone. A button the person may not use is not shown. */
  access?: Partial<Record<CrudAction, AccessRule>>;
  /** `false` removes an action for everyone (default: all three are on). */
  create?: boolean;
  update?: boolean;
  delete?: boolean;
  /** Ask before deleting (default: true). */
  confirmDelete?: boolean;
  /**
   * Save to your server first. The change is shown only when the function finishes without error; throwing shows the message in the
   * dialog, returning `false` cancels quietly. `onCreate` and `onUpdate` may return the row as saved (for example with the id the
   * server made), which is then used instead. A table that loads its rows from a source reloads afterwards.
   */
  onCreate?: (row: Record<string, Cell>) => Promise<Record<string, Cell> | false | void> | Record<string, Cell> | false | void;
  onUpdate?: (row: Record<string, Cell>, previous: Record<string, Cell>, index: number) => Promise<Record<string, Cell> | false | void> | Record<string, Cell> | false | void;
  onDelete?: (rows: Record<string, Cell>[], indexes: number[]) => Promise<false | void> | false | void;
}

const hasAny = (have: string[] | undefined, want: string) => !!have?.some((h) => h === want || h === '*' || (want.endsWith('*') && h.startsWith(want.slice(0, -1))) || (h.endsWith('*') && want.startsWith(h.slice(0, -1))));

/** Whether `user` passes `rule` (for one row, if given). A rule that throws is treated as a refusal. */
export function hasAccess(rule: AccessRule | undefined, user: DataTableUser | null | undefined, row?: Record<string, Cell>): boolean {
  if (rule === undefined || rule === true) return true;
  if (rule === false) return false;
  try {
    if (typeof rule === 'function') return !!rule(user ?? null, row);
    if (!user) return false;
    const have = (w: string) => hasAny(user.roles, w) || hasAny(user.permissions, w);
    if (typeof rule === 'string') return have(rule);
    if (Array.isArray(rule)) return rule.some(have);
    const rolesOk = !rule.roles?.length || rule.roles.some((r) => hasAny(user.roles, r));
    const permsOk = !rule.permissions?.length || rule.permissions.every((p) => hasAny(user.permissions, p));
    return rolesOk && permsOk;
  } catch { return false; }
}

/** The person using the table right now. */
export const crudUser = (crud: DataTableCrud | undefined): DataTableUser | null => {
  const u = typeof crud?.user === 'function' ? crud.user() : crud?.user;
  return u ?? null;
};

/** May the person do `action` (on `row`)? Everything is allowed when no `crud` is set up. */
export function crudAllows(crud: DataTableCrud | undefined, action: CrudAction, row?: Record<string, Cell>): boolean {
  if (!crud) return true;
  if (crud[action] === false) return false;
  return hasAccess(crud.access?.[action], crudUser(crud), row);
}

const message = (err: unknown) => (err instanceof Error && err.message ? err.message : typeof err === 'string' && err ? err : 'The change was not saved.');

/**
 * A dialog that asks for a row (one field per column that is not calculated). `submit` may be async: the buttons wait, an error stays in
 * the dialog and the person can fix it or cancel.
 */
export function openRowForm(root: HTMLElement, o: {
  title: string;
  columns: DataColumn[];
  values: Record<string, Cell>;
  submitLabel: string;
  submit: (values: Record<string, Cell>) => Promise<unknown> | unknown;
}): void {
  const form = document.createElement('form');
  form.className = 'wy-dt-rowform';
  form.noValidate = true;
  const fields: { col: DataColumn; input: HTMLInputElement | HTMLSelectElement }[] = [];
  for (const col of o.columns) {
    if (col.formula) continue;
    const id = `wy-dt-f-${Math.random().toString(36).slice(2, 8)}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = col.title || col.key;
    let input: HTMLInputElement | HTMLSelectElement;
    const v = o.values[col.key] ?? null;
    if (col.type === 'select') {
      const s = document.createElement('select');
      s.add(new Option('', ''));
      const opts = [...(col.options ?? [])];
      if (typeof v === 'string' && v && !opts.includes(v)) opts.push(v);
      for (const opt of opts) s.add(new Option(opt, opt, false, opt === v));
      input = s;
    } else {
      const i = document.createElement('input');
      if (col.type === 'boolean') { i.type = 'checkbox'; i.checked = v === true; }
      else if (col.type === 'number' || col.type === 'currency') { i.type = 'number'; i.step = col.decimals ? String(10 ** -col.decimals) : 'any'; i.value = v === null ? '' : String(v); }
      else if (col.type === 'date') { i.type = 'date'; i.value = typeof v === 'string' ? v.slice(0, 10) : ''; }
      else { i.type = 'text'; i.value = v === null ? '' : String(v); }
      input = i;
    }
    input.id = id;
    input.className = col.type === 'boolean' ? 'wy-dt-rowform-check' : 'wy-dt-rowform-input';
    const row = document.createElement('div');
    row.className = col.type === 'boolean' ? 'wy-dt-rowform-row is-check' : 'wy-dt-rowform-row';
    row.append(label, input);
    form.append(row);
    fields.push({ col, input });
  }
  const error = document.createElement('p');
  error.className = 'wy-dt-rowform-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  form.append(error);

  const read = () => {
    const out: Record<string, Cell> = { ...o.values };
    for (const { col, input } of fields) {
      if (col.type === 'boolean') out[col.key] = (input as HTMLInputElement).checked;
      else if (col.type === 'number' || col.type === 'currency') { const n = input.value.trim() === '' ? null : Number(input.value); out[col.key] = n === null || !Number.isFinite(n) ? null : n; }
      else out[col.key] = input.value === '' ? null : input.value;
    }
    return out;
  };
  let busy = false;
  let close: () => void = () => {};
  const send = () => {
    if (busy) return;
    busy = true;
    error.hidden = true;
    for (const b of dialogButtons()) b.disabled = true;
    Promise.resolve().then(() => o.submit(read())).then(
      (r) => { if (r === false) { busy = false; for (const b of dialogButtons()) b.disabled = false; return; } close(); },
      (err) => { busy = false; error.textContent = message(err); error.hidden = false; for (const b of dialogButtons()) b.disabled = false; },
    );
  };
  const dialogButtons = () => [...(form.closest('.wy-dialog')?.querySelectorAll<HTMLButtonElement>('.wy-dialog-actions button') ?? [])];
  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  close = openDialog(root, { title: o.title, body: form, actions: [{ label: 'Cancel' }, { label: o.submitLabel, primary: true, onClick: () => { send(); return false; } }] });
  (form.querySelector('input, select') as HTMLElement | null)?.focus();
}

/** A dialog that asks before something is removed. `confirm` may be async; an error stays in the dialog. */
export function openConfirm(root: HTMLElement, o: { title: string; text: string; confirmLabel: string; confirm: () => Promise<unknown> | unknown }): void {
  const body = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = o.text;
  const error = document.createElement('p');
  error.className = 'wy-dt-rowform-error';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  body.append(p, error);
  let busy = false;
  let close: () => void = () => {};
  const buttons = () => [...(body.closest('.wy-dialog')?.querySelectorAll<HTMLButtonElement>('.wy-dialog-actions button') ?? [])];
  close = openDialog(root, {
    title: o.title,
    body,
    actions: [{ label: 'Cancel' }, {
      label: o.confirmLabel,
      primary: true,
      onClick: () => {
        if (busy) return false;
        busy = true;
        error.hidden = true;
        for (const b of buttons()) b.disabled = true;
        Promise.resolve().then(o.confirm).then(
          () => close(),
          (err) => { busy = false; error.textContent = message(err); error.hidden = false; for (const b of buttons()) b.disabled = false; },
        );
        return false;
      },
    }],
  });
}
