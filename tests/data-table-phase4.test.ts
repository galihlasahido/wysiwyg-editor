import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, defaultPlugins, DataTable, Charts } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => { roots.splice(0).forEach((r) => r.remove()); document.querySelectorAll('.wy-dialog-backdrop').forEach((d) => d.remove()); });

function make(opts: Parameters<typeof DataTable>[0] = {}, spec: unknown, extraPlugins: Parameters<typeof createEditor>[0]['plugins'] = []) {
  const element = document.body.appendChild(document.createElement('div'));
  roots.push(element);
  const editor = createEditor({ element, content: '<p>x</p>', plugins: [...defaultPlugins.filter((p) => p.name !== 'dataTable'), DataTable(opts), ...(extraPlugins ?? [])] });
  if (spec) editor.execute('insertDataTable', spec);
  return editor;
}
type E = ReturnType<typeof make>;
const dt = (e: E) => e.view.dom.querySelector('.wy-dt') as HTMLElement;
const rowsOf = (e: E) => [...dt(e).querySelectorAll<HTMLElement>('tbody tr[data-row]')];
const cell = (e: E, r: number, c: number) => rowsOf(e)[r].querySelector(`td[data-col="${c}"]`) as HTMLElement;
const stored = (e: E) => JSON.parse(e.view.state.doc.child(1).attrs.spec);
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
const menuItem = (label: string | RegExp) => [...document.querySelectorAll<HTMLElement>('.wy-dt-menu-item')].find((b) => (typeof label === 'string' ? b.textContent === label : label.test(b.textContent ?? '')))!;
const barButton = (e: E, label: string) => [...dt(e).querySelectorAll<HTMLElement>('.wy-dt-bar button')].find((b) => b.textContent === label)!;
const dialog = () => document.querySelector('.wy-dialog') as HTMLElement;
const dialogButton = (label: string) => [...dialog().querySelectorAll<HTMLElement>('button')].find((b) => b.textContent === label)!;

const sales = () => ({
  columns: [
    { key: 'item', title: 'Item', type: 'text' },
    { key: 'price', title: 'Price', type: 'number', decimals: 2 },
    { key: 'qty', title: 'Qty', type: 'number', bar: true },
    { key: 'total', title: 'Total', type: 'number', decimals: 2, formula: '[Price] * [Qty]', total: 'sum' },
  ],
  rows: [['a', 2, 3, null], ['b', 10, 5, null], ['c', 1, null, null]],
  rules: [{ column: 'total', test: '>20', look: 'green' }, { column: 'item', test: 'c', look: 'red', row: true }],
  options: { pageSize: 0, filters: true },
});

describe('formula columns', () => {
  it('show the calculated values and the total, and are not stored', () => {
    const e = make({}, sales());
    expect([0, 1, 2].map((r) => cell(e, r, 3).textContent)).toEqual(['6.00', '50.00', '0.00']);
    expect(dt(e).querySelector('tfoot')!.textContent).toContain('56.00');
    expect(stored(e).rows[0][3]).toBeNull();
    e.destroy();
  });
  it('cannot be typed into', () => {
    const e = make({}, sales());
    cell(e, 0, 3).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(cell(e, 0, 3).querySelector('input')).toBeNull();
    key(cell(e, 0, 3), 'Delete');
    expect(cell(e, 0, 3).textContent).toBe('6.00');
    e.destroy();
  });
  it('follow an edit of the cells they use', () => {
    const e = make({}, sales());
    cell(e, 0, 2).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = cell(e, 0, 2).querySelector('input') as HTMLInputElement;
    input.value = '10';
    key(input, 'Enter');
    expect(cell(e, 0, 3).textContent).toBe('20.00');
    e.destroy();
  });
  it('are filtered on their results', () => {
    const e = make({}, sales());
    const box = dt(e).querySelector('input[aria-label="Filter Total"]') as HTMLInputElement;
    box.value = '>10'; box.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rowsOf(e).length).toBe(1);
    e.destroy();
  });
  it('are set in the column dialog, and a mistake keeps the dialog open with the reason', () => {
    const e = make({}, { columns: [{ key: 'a', title: 'A', type: 'number' }, { key: 'b', title: 'B', type: 'number' }], rows: [[2, 3]], options: { pageSize: 0 } });
    (dt(e).querySelector('th[data-col="1"] [data-role="column-menu"]') as HTMLElement).click();
    menuItem('Edit column…').click();
    const f = dialog().querySelector('textarea[placeholder="[Price] * [Qty]"]') as HTMLTextAreaElement;
    f.value = '[A] * [Zed]';
    dialogButton('Save').click();
    expect(dialog()).not.toBeNull();
    expect(dialog().querySelector('.wy-dt-error')!.textContent).toContain('no column called “Zed”');
    f.value = '[A] * 10';
    dialogButton('Save').click();
    expect(document.querySelector('.wy-dialog')).toBeNull();
    expect(stored(e).columns[1].formula).toBe('[A] * 10');
    expect(cell(e, 0, 1).textContent).toBe('20');
    e.destroy();
  });
});

describe('highlight rules and bars', () => {
  it('colour a cell, a whole row, and draw bars', () => {
    const e = make({}, sales());
    expect(cell(e, 1, 3).dataset.look).toBe('green');
    expect(cell(e, 0, 3).dataset.look).toBeUndefined();
    expect(rowsOf(e)[2].dataset.look).toBe('red');
    expect(cell(e, 1, 2).style.getPropertyValue('--bar')).toBe('100.0%');
    expect(cell(e, 0, 2).style.getPropertyValue('--bar')).toBe('60.0%');
    e.destroy();
  });
  it('are edited in a dialog: add, change, remove, save', () => {
    const e = make({}, sales());
    barButton(e, 'Options ▾').click();
    menuItem('Highlight rules…').click();
    expect(dialog().querySelectorAll('.wy-dt-rule').length).toBe(2);
    dialogButton('Add rule').click();
    const last = dialog().querySelector('.wy-dt-rule:last-child') as HTMLElement;
    const test = last.querySelector('input:not([type="checkbox"])') as HTMLInputElement;
    test.value = 'b'; test.dispatchEvent(new Event('input'));
    const look = last.querySelectorAll('select')[1] as HTMLSelectElement;
    look.value = 'blue'; look.dispatchEvent(new Event('change'));
    (dialog().querySelector('.wy-dt-rule button') as HTMLElement).click(); // remove the first rule
    dialogButton('Save').click();
    expect(stored(e).rules).toEqual([{ column: 'item', test: 'c', look: 'red', row: true }, { column: '', test: 'b', look: 'blue', row: false }]);
    expect(cell(e, 1, 0).dataset.look).toBe('blue');
    expect(cell(e, 1, 3).dataset.look).toBeUndefined(); // the green rule is gone
    e.destroy();
  });
});

describe('saved views', () => {
  it('remember the search, filters, sort and grouping, and bring them back', () => {
    const e = make({}, { ...sales(), options: { pageSize: 0, filters: true, search: true } });
    const search = dt(e).querySelector('.wy-dt-search') as HTMLInputElement;
    search.value = 'b'; search.dispatchEvent(new Event('input'));
    (dt(e).querySelector('th[data-col="2"] [data-role="sort"]') as HTMLElement).click();
    barButton(e, 'Views ▾').click();
    menuItem('Save current view…').click();
    (dialog().querySelector('input') as HTMLInputElement).value = 'Just b';
    dialogButton('Save').click();
    expect(stored(e).views).toEqual([{ name: 'Just b', search: 'b', filters: {}, sort: [{ key: 'qty', dir: 'asc' }], groupBy: [], hidden: [], pageSize: 0 }]);
    barButton(e, 'Views ▾').click();
    menuItem(/^Everything/).click();
    expect(rowsOf(e).length).toBe(3);
    barButton(e, 'Views ▾').click();
    menuItem('Just b').click();
    expect(rowsOf(e).length).toBe(1);
    expect((dt(e).querySelector('.wy-dt-search') as HTMLInputElement).value).toBe('b');
    barButton(e, 'Views ▾').click();
    menuItem('Delete “Just b”').click();
    expect(stored(e).views).toEqual([]);
    e.destroy();
  });
  it('keep a name needed: an empty name is refused', () => {
    const e = make({}, sales());
    barButton(e, 'Views ▾').click();
    menuItem('Save current view…').click();
    dialogButton('Save').click();
    expect(dialog()).not.toBeNull();
    e.destroy();
  });
  it('apply grouping and hidden columns from a view, and give a reader the search and filters', () => {
    const spec = { ...sales(), views: [{ name: 'Grouped', search: '', filters: {}, sort: [], groupBy: ['item'], hidden: ['price'], pageSize: 0 }] };
    const e = make({}, spec);
    barButton(e, 'Views ▾').click();
    menuItem('Grouped').click();
    expect(stored(e).options.groupBy).toEqual(['item']);
    expect(stored(e).columns[1].hidden).toBe(true);
    e.destroy();
    const e2 = make({}, { ...spec, views: [{ ...spec.views[0], search: 'a' }] });
    e2.setReadOnly(true);
    dt(e2).dispatchEvent(new Event('pointerenter'));
    barButton(e2, 'Views ▾').click();
    menuItem('Grouped').click();
    expect(rowsOf(e2).length).toBe(1); // searched
    expect(JSON.parse(e2.view.state.doc.child(1).attrs.spec).options.groupBy).toEqual([]); // the document is untouched
    e2.destroy();
  });
});

describe('opening a row', () => {
  const spec = { columns: [{ key: 'a', title: 'A', type: 'text' }, { key: 'b', title: 'Hidden B', type: 'number', hidden: true }], rows: [['x', 5], ['y', 6]], options: { detail: true, pageSize: 0 } };
  it('lists every field, including hidden columns, and closes again', () => {
    const e = make({}, spec);
    const toggle = rowsOf(e)[0].querySelector('[data-role="detail-toggle"]') as HTMLElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    const d = dt(e).querySelector('.wy-dt-detail')!;
    expect(d.textContent).toContain('Hidden B');
    expect(d.textContent).toContain('5');
    expect(rowsOf(e).length).toBe(2);
    (rowsOf(e)[0].querySelector('[data-role="detail-toggle"]') as HTMLElement).click();
    expect(dt(e).querySelector('.wy-dt-detail')).toBeNull();
    e.destroy();
  });
  it('shows what the host page builds, even asynchronously, and treats text as text', async () => {
    const e = make({ detail: async (row) => { await tick(5); return `<b>${row.a}</b>`; } }, spec);
    (rowsOf(e)[1].querySelector('[data-role="detail-toggle"]') as HTMLElement).click();
    expect(dt(e).querySelector('.wy-dt-detail')!.textContent).toContain('Loading');
    for (let i = 0; i < 50 && dt(e).querySelector('.wy-dt-detail')!.textContent === 'Loading…'; i++) await tick(10);
    expect(dt(e).querySelector('.wy-dt-detail b')).toBeNull();
    expect(dt(e).querySelector('.wy-dt-detail')!.textContent).toBe('<b>y</b>');
    const el = document.createElement('em'); el.textContent = 'node';
    const e2 = make({ detail: () => el }, spec);
    (rowsOf(e2)[0].querySelector('[data-role="detail-toggle"]') as HTMLElement).click();
    for (let i = 0; i < 50 && !dt(e2).querySelector('.wy-dt-detail em'); i++) await tick(10);
    expect(dt(e2).querySelector('.wy-dt-detail em')!.textContent).toBe('node');
    e.destroy(); e2.destroy();
  });
  it('has no toggle in a long table that is drawn in part', () => {
    const e = make({}, { ...spec, rows: Array.from({ length: 300 }, (_, i) => [`r${i}`, i]) });
    expect(dt(e).querySelector('[data-role="detail-toggle"]')).toBeNull();
    e.destroy();
  });
});

describe('column width', () => {
  const spec = { columns: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], rows: [['x', 'y']], options: { pageSize: 0 } };
  const grip = (e: E, c: number) => dt(e).querySelector(`[data-role="resize"][data-col="${c}"]`) as HTMLElement;
  it('is set with the arrow keys, and reset with Delete or a double-click', () => {
    const e = make({}, spec);
    key(grip(e, 0), 'ArrowRight');
    expect(stored(e).columns[0].width).toBe(130);
    key(grip(e, 0), 'ArrowRight', { shiftKey: true });
    expect(stored(e).columns[0].width).toBe(170);
    key(grip(e, 0), 'ArrowLeft');
    expect(stored(e).columns[0].width).toBe(160);
    expect((dt(e).querySelector('th[data-col="0"]') as HTMLElement).style.width).toBe('160px');
    grip(e, 0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(stored(e).columns[0].width).toBeUndefined();
    key(grip(e, 1), 'ArrowLeft');
    key(grip(e, 1), 'Delete');
    expect(stored(e).columns[1].width).toBeUndefined();
    e.destroy();
  });
  it('is never smaller than 40 pixels', () => {
    const e = make({}, { ...spec, columns: [{ key: 'a', title: 'A', width: 45 }, { key: 'b', title: 'B' }] });
    key(grip(e, 0), 'ArrowLeft'); key(grip(e, 0), 'ArrowLeft'); key(grip(e, 0), 'ArrowLeft');
    expect(stored(e).columns[0].width).toBe(40);
    e.destroy();
  });
  it('follows the mouse while dragging and is saved when it is released', () => {
    const e = make({}, spec);
    const th = dt(e).querySelector('th[data-col="0"]') as HTMLElement;
    th.getBoundingClientRect = () => ({ width: 100, height: 20, top: 0, left: 0, right: 100, bottom: 20, x: 0, y: 0, toJSON() {} }) as DOMRect;
    grip(e, 0).dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 100, button: 0 }));
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 160 }));
    expect(th.style.width).toBe('160px');
    document.dispatchEvent(new MouseEvent('pointerup', { clientX: 180 }));
    expect(stored(e).columns[0].width).toBe(180);
    e.destroy();
  });
  it('cannot be changed by a reader', () => {
    const e = make({}, spec);
    e.setReadOnly(true);
    dt(e).dispatchEvent(new Event('pointerenter'));
    expect(dt(e).querySelector('[data-role="resize"]')).toBeNull();
    e.destroy();
  });
});

describe('row order', () => {
  const spec = { columns: [{ key: 'a', title: 'A' }], rows: [['one'], ['two'], ['three']], options: { reorder: true, pageSize: 0, search: true } };
  const order = (e: E) => stored(e).rows.map((r: string[]) => r[0]);
  it('changes with Alt+Down and Alt+Up, keeping the cursor on the moved row', () => {
    const e = make({}, spec);
    const first = cell(e, 0, 0);
    first.click();
    key(first, 'ArrowDown', { altKey: true });
    expect(order(e)).toEqual(['two', 'one', 'three']);
    expect((document.activeElement as HTMLElement).textContent).toBe('one');
    key(document.activeElement!, 'ArrowUp', { altKey: true });
    expect(order(e)).toEqual(['one', 'two', 'three']);
    key(document.activeElement!, 'ArrowUp', { altKey: true }); // already first
    expect(order(e)).toEqual(['one', 'two', 'three']);
    e.destroy();
  });
  it('changes by dragging a handle above or below another row', () => {
    const e = make({}, spec);
    const handle = rowsOf(e)[0].querySelector('[data-role="drag"]') as HTMLElement;
    expect(handle.draggable).toBe(true);
    handle.dispatchEvent(new Event('dragstart', { bubbles: true }));
    const target = rowsOf(e)[2];
    target.getBoundingClientRect = () => ({ top: 100, height: 20, left: 0, right: 10, bottom: 120, width: 10, x: 0, y: 100, toJSON() {} }) as DOMRect;
    const over = new MouseEvent('dragover', { bubbles: true, cancelable: true, clientY: 118 });
    target.querySelector('td[data-col]')!.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(target.classList.contains('drop-below')).toBe(true);
    target.querySelector('td[data-col]')!.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientY: 118 }));
    expect(order(e)).toEqual(['two', 'three', 'one']);
    e.destroy();
  });
  it('is switched off while a search, sort or filter makes the order on screen different', () => {
    const e = make({}, spec);
    const search = dt(e).querySelector('.wy-dt-search') as HTMLInputElement;
    search.value = 't'; search.dispatchEvent(new Event('input'));
    // the handle column is gone, and Alt+Down does nothing
    expect(dt(e).querySelector('[data-role="drag"]')).toBeNull();
    const c = cell(e, 0, 0);
    c.click();
    key(c, 'ArrowDown', { altKey: true });
    expect(order(e)).toEqual(['one', 'two', 'three']);
    e.destroy();
  });
});

describe('chart from a data table', () => {
  it('puts a chart of the rows on screen right after the table', () => {
    const e = make({}, { columns: [{ key: 'm', title: 'Month' }, { key: 'v', title: 'Sales', type: 'number' }, { key: 'w', title: 'Cost', type: 'number' }], rows: [['Jan', 3, 1], ['Feb', 5, 2], ['Mar', 4, 2]], options: { pageSize: 0, title: 'Sales' } }, [Charts()]);
    barButton(e, 'Options ▾').click();
    menuItem('Chart of these rows: bar').click();
    const doc = e.view.state.doc;
    expect(doc.child(2).type.name).toBe('chart');
    const spec = JSON.parse(doc.child(2).attrs.spec);
    expect(spec.labels).toEqual(['Jan', 'Feb', 'Mar']);
    expect(spec.series.map((s: { name: string }) => s.name)).toEqual(['Sales', 'Cost']);
    expect(spec.series[0].values).toEqual([3, 5, 4]);
    e.destroy();
  });
  it('offers no chart without the charts plugin', () => {
    const e = make({}, { columns: [{ key: 'v', title: 'V', type: 'number' }], rows: [[1]] });
    barButton(e, 'Options ▾').click();
    expect(menuItem(/^Chart/)).toBeUndefined();
    e.destroy();
  });
});
