import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataTable, defineDataTableElement, type DataTableApp } from '../src';
import { createDataTable as createFromEntry } from '../src/data-table-app';

const apps: DataTableApp[] = [];
const host = () => document.body.appendChild(document.createElement('div'));
afterEach(() => { apps.splice(0).forEach((a) => a.destroy()); document.body.replaceChildren(); });
const make = (table: unknown, extra: Partial<Parameters<typeof createDataTable>[0]> = {}) => {
  const app = createDataTable({ element: host(), table, ...extra });
  apps.push(app);
  return app;
};
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const rows = (a: DataTableApp) => [...a.element.querySelectorAll<HTMLElement>('tbody tr[data-row]')];
const cell = (a: DataTableApp, r: number, c: number) => rows(a)[r].querySelector(`td[data-col="${c}"]`) as HTMLElement;
const edit = (a: DataTableApp, r: number, c: number, value: string) => {
  const td = cell(a, r, c);
  td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const input = td.querySelector('input') as HTMLInputElement;
  input.value = value;
  key(input, 'Enter');
};

const fruit = () => ({
  columns: [{ key: 'name', title: 'Name' }, { key: 'qty', title: 'Qty', type: 'number', total: 'sum' }, { key: 'ok', title: 'Done', type: 'boolean' }],
  rows: Array.from({ length: 25 }, (_, i) => [`Item ${String(i + 1).padStart(2, '0')}`, i + 1, i % 2 === 0]),
  options: { title: 'Stock', pageSize: 10, filters: true, selectable: true },
});

describe('a data table with no editor', () => {
  it('draws in the element, and needs neither an editor nor ProseMirror', () => {
    const a = make(fruit());
    expect(a.element.classList.contains('wy-dt-root')).toBe(true);
    expect(rows(a).length).toBe(10);
    expect(a.element.querySelector('.wy-dt-info')!.textContent).toBe('1–10 of 25');
    expect(a.element.querySelector('.wy-dt-handle')).toBeNull(); // there is no document to select it in
    expect(document.querySelector('.ProseMirror')).toBeNull();
    expect(createFromEntry).toBe(createDataTable);
  });

  it('refuses something that is not a table', () => {
    expect(() => createDataTable({ element: host(), table: { rows: [] } })).toThrow(/columns/);
    expect(() => createDataTable({ element: host(), table: 'nope' })).toThrow();
  });

  it('searches, sorts, filters and pages like the one in the editor', () => {
    const a = make(fruit());
    const search = a.element.querySelector('.wy-dt-search') as HTMLInputElement;
    search.value = 'item 07'; search.dispatchEvent(new Event('input'));
    expect(rows(a).length).toBe(1);
    search.value = ''; search.dispatchEvent(new Event('input'));
    (a.element.querySelector('th[data-col="1"] [data-role="sort"]') as HTMLElement).click();
    (a.element.querySelector('th[data-col="1"] [data-role="sort"]') as HTMLElement).click();
    expect(cell(a, 0, 1).textContent).toBe('25');
    (a.element.querySelector('[aria-label="Next page"]') as HTMLElement).click();
    expect(a.element.querySelector('.wy-dt-info')!.textContent).toContain('11–20');
    expect(a.visibleRows().length).toBe(25);
  });

  it('reports every change, and getTable() has the edit', () => {
    const onChange = vi.fn();
    const a = make(fruit(), { onChange });
    const heard = vi.fn();
    const off = a.on('change', heard);
    edit(a, 0, 0, 'Renamed');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].rows[0][0]).toBe('Renamed');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(a.getTable().rows[0][0]).toBe('Renamed');
    expect(a.getRows()[0]).toEqual({ name: 'Renamed', qty: 1, ok: true });
    off();
    edit(a, 1, 0, 'Again');
    expect(heard).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('undoes and redoes with the methods and the keyboard', () => {
    const a = make(fruit());
    expect(a.canUndo).toBe(false);
    edit(a, 0, 0, 'One');
    edit(a, 0, 0, 'Two');
    expect(a.canUndo).toBe(true);
    expect(a.undo()).toBe(true);
    expect(cell(a, 0, 0).textContent).toBe('One');
    key(cell(a, 0, 0), 'z', { ctrlKey: true });
    expect(cell(a, 0, 0).textContent).toBe('Item 01');
    expect(a.canUndo).toBe(false);
    expect(a.undo()).toBe(false);
    key(cell(a, 0, 0), 'y', { ctrlKey: true });
    expect(cell(a, 0, 0).textContent).toBe('One');
    key(cell(a, 0, 0), 'z', { metaKey: true, shiftKey: true });
    expect(cell(a, 0, 0).textContent).toBe('Two');
    expect(a.redo()).toBe(false);
  });

  it('leaves Ctrl+Z to a text box that is being typed in', () => {
    const a = make(fruit());
    edit(a, 0, 0, 'One');
    cell(a, 0, 0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = cell(a, 0, 0).querySelector('input') as HTMLInputElement;
    key(input, 'z', { ctrlKey: true });
    expect(a.canUndo).toBe(true); // nothing was undone
    key(input, 'Escape');
  });

  it('limits how much undo remembers', () => {
    const a = make(fruit(), { history: 2 });
    edit(a, 0, 0, 'a'); edit(a, 0, 0, 'b'); edit(a, 0, 0, 'c');
    expect(a.undo()).toBe(true); expect(a.undo()).toBe(true);
    expect(a.undo()).toBe(false);
    expect(cell(a, 0, 0).textContent).toBe('a');
  });

  it('read-only: nothing can be changed, everything can be looked at', () => {
    const a = make(fruit(), { readOnly: true });
    const labels = [...a.element.querySelectorAll('.wy-dt-bar button')].map((b) => b.textContent);
    expect(labels).not.toContain('Add row');
    expect(labels).toContain('Export ▾');
    cell(a, 0, 0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(cell(a, 0, 0).querySelector('input')).toBeNull();
    a.setReadOnly(false);
    expect([...a.element.querySelectorAll('.wy-dt-bar button')].map((b) => b.textContent)).toContain('Add row');
    expect(a.readOnly).toBe(false);
  });

  it('shows custom buttons and row actions, with no editor in what they are given', () => {
    const onClick = vi.fn();
    const onRow = vi.fn();
    const a = make(fruit(), { buttons: [{ id: 'x', label: 'Ship', needsSelection: true, onClick }], rowActions: [{ label: 'Open', onClick: onRow }] });
    (a.element.querySelectorAll('input[data-role="select-row"]')[2] as HTMLElement).click();
    ([...a.element.querySelectorAll('button')].find((b) => b.textContent === 'Ship') as HTMLElement).click();
    expect(onClick.mock.calls[0][0].editor).toBeNull();
    expect(onClick.mock.calls[0][0].selected).toEqual([{ name: 'Item 03', qty: 3, ok: true }]);
    (a.element.querySelector('[data-role="row-action"]') as HTMLElement).click();
    expect(onRow.mock.calls[0][0].name).toBe('Item 01');
    a.addButton({ id: 'late', label: 'Late', onClick: () => {} });
    expect([...a.element.querySelectorAll('.wy-dt-bar button')].map((b) => b.textContent)).toContain('Late');
  });

  it('exports what is shown', async () => {
    const a = make(fruit());
    const search = a.element.querySelector('.wy-dt-search') as HTMLInputElement;
    search.value = 'item 2'; search.dispatchEvent(new Event('input'));
    const csv = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(a.export('csv')!); });
    expect(csv.replace('﻿', '').trim().split('\r\n').length).toBe(7); // header + Item 02, 20-25
    expect(a.export('xlsx')!.type).toContain('spreadsheetml');
  });

  it('replaces the table with setTable and forgets undo, without calling onChange', () => {
    const onChange = vi.fn();
    const a = make(fruit(), { onChange });
    edit(a, 0, 0, 'x');
    onChange.mockClear();
    a.setTable({ columns: [{ title: 'Only' }], rows: [['a'], ['b']] });
    expect(rows(a).length).toBe(2);
    expect(a.canUndo).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(() => a.setTable({})).toThrow();
  });

  it('loads rows from a source, and a data source can be added later', async () => {
    const a = make({ columns: [{ key: 'n', title: 'N', type: 'number' }], rows: [], options: { source: 'late', pageSize: 5 } });
    await tick();
    expect(a.element.querySelector('.wy-dt-error')!.textContent).toContain('“late”');
    a.addSource('late', async () => ({ rows: [[1], [2], [3]], total: 3 }));
    await tick();
    expect(rows(a).length).toBe(3);
    expect(a.element.querySelector('.wy-dt-info')!.textContent).toBe('1–3 of 3');
  });

  it('has its own right-click menu (the editor is not there to provide one)', () => {
    const a = make(fruit());
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    cell(a, 0, 0).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    const labels = [...a.element.querySelectorAll('.wy-dt-menu-item')].map((b) => b.textContent);
    expect(labels).toEqual(expect.arrayContaining(['Edit cell', 'Insert row below', 'Delete row', 'Sort ascending', 'Export CSV']));
    ([...a.element.querySelectorAll<HTMLElement>('.wy-dt-menu-item')].find((b) => b.textContent === 'Delete row'))!.click();
    expect(a.getTable().rows.length).toBe(24);
    // a text box keeps the browser's menu
    const search = a.element.querySelector('.wy-dt-search')!;
    const own = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    search.dispatchEvent(own);
    expect(own.defaultPrevented).toBe(false);
  });

  it('read-only right-click menu has no editing items', () => {
    const a = make(fruit(), { readOnly: true });
    cell(a, 0, 0).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const labels = [...a.element.querySelectorAll('.wy-dt-menu-item')].map((b) => b.textContent);
    expect(labels).toContain('Sort ascending');
    expect(labels).not.toContain('Delete row');
    expect(labels).not.toContain('Table options…');
  });
});

describe('themes without the editor', () => {
  it('sets the mode and the colours on the table only', () => {
    const a = make(fruit(), { theme: 'midnight' });
    expect(a.element.dataset.theme).toBe('dark');
    expect(a.element.dataset.colorTheme).toBe('midnight');
    expect(a.element.style.getPropertyValue('--wy-page-bg')).not.toBe('');
    expect(document.documentElement.style.getPropertyValue('--wy-page-bg')).toBe('');
    a.setTheme('light');
    expect(a.element.dataset.theme).toBe('light');
    expect(a.element.style.getPropertyValue('--wy-page-bg')).toBe('');
    a.setTheme({ name: 'mine', label: 'Mine', palette: { mode: 'light', bg: '#fff', surface: '#eee', fg: '#000', muted: '#555', border: '#ddd', accent: '#f60', workspace: '#ccc', pageBg: '#fff', pageFg: '#000' } });
    expect(a.element.style.getPropertyValue('--wy-accent')).toBe('#f60');
  });
  it('knows extra themes by name, and an unknown name is just light', () => {
    const t = { name: 'brand', label: 'Brand', palette: { mode: 'dark' as const, bg: '#111', surface: '#000', fg: '#fff', muted: '#aaa', border: '#333', accent: '#0ff', workspace: '#000', pageBg: '#111', pageFg: '#fff' } };
    const a = make(fruit(), { theme: 'brand', themes: [t] });
    expect(a.element.dataset.theme).toBe('dark');
    a.setTheme('no-such-theme');
    expect(a.element.dataset.theme).toBe('light');
  });
});

describe('the custom element', () => {
  it('draws the JSON inside it, with the theme and read-only attributes, and says when it changes', async () => {
    defineDataTableElement('x-data-table');
    const el = document.body.appendChild(document.createElement('x-data-table')) as unknown as HTMLElement & { app: DataTableApp | null; table: unknown };
    document.body.removeChild(el);
    el.setAttribute('theme', 'nord');
    el.innerHTML = `<script type="application/json">${JSON.stringify({ columns: [{ title: 'A' }], rows: [['x'], ['y']] })}</script>`;
    const ready = vi.fn(); const changed = vi.fn();
    el.addEventListener('table-ready', ready); el.addEventListener('table-change', changed);
    document.body.append(el);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(el.querySelectorAll('tbody tr[data-row]').length).toBe(2);
    expect((el.querySelector('.wy-dt-root') as HTMLElement).dataset.theme).toBe('dark');
    el.app!.getTable();
    const td = el.querySelector('td[data-col="0"]') as HTMLElement;
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = td.querySelector('input') as HTMLInputElement; input.value = 'z';
    key(input, 'Enter');
    expect(changed).toHaveBeenCalledTimes(1);
    expect((changed.mock.calls[0][0] as CustomEvent).detail.table.rows[0][0]).toBe('z');
    el.setAttribute('readonly', '');
    expect(el.app!.readOnly).toBe(true);
    el.table = { columns: [{ title: 'B' }], rows: [['q']] };
    expect(el.querySelectorAll('tbody tr[data-row]').length).toBe(1);
    el.remove();
    expect(el.app).toBeNull();
  });
});
