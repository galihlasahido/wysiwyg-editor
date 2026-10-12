import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeHistory } from 'prosemirror-history';
import { NodeSelection } from 'prosemirror-state';
import { createEditor, defaultPlugins, DataTable } from '../src';
import type { DataTableApi } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));

const data = (n = 25) => ({
  columns: [{ key: 'name', title: 'Name', type: 'text' }, { key: 'qty', title: 'Qty', type: 'number', total: 'sum' }, { key: 'ok', title: 'Done', type: 'boolean' }],
  rows: Array.from({ length: n }, (_, i) => [`Item ${String(i + 1).padStart(2, '0')}`, i + 1, i % 2 === 0]),
  options: { pageSize: 10, search: true, filters: true, selectable: true, title: 'Stock' },
});

function make(extra: Parameters<typeof DataTable>[0] = {}, content = '<p>before</p>', spec: unknown = data()) {
  const element = document.body.appendChild(document.createElement('div'));
  roots.push(element);
  const editor = createEditor({ element, content, plugins: [...defaultPlugins.filter((p) => p.name !== 'dataTable'), DataTable(extra)] });
  if (spec) { editor.execute('insertDataTable', spec); editor.view.dispatch(closeHistory(editor.view.state.tr)); }
  return editor;
}
const table = (e: ReturnType<typeof make>) => e.view.dom.querySelector('.wy-dt') as HTMLElement;
const bodyRows = (e: ReturnType<typeof make>) => [...table(e).querySelectorAll<HTMLElement>('tbody tr[data-row]')];
const cellText = (tr: HTMLElement) => [...tr.querySelectorAll('td[data-col]')].map((td) => td.textContent);
const typeInto = (input: HTMLInputElement, value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
const read = (b: Blob) => new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsText(b); });
const key = (el: Element, k: string, init: KeyboardEventInit = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));

describe('data table', () => {
  it('is inserted as a block after the paragraph and draws a page of rows', () => {
    const e = make();
    expect(e.view.state.doc.child(1).type.name).toBe('data_table');
    expect(bodyRows(e).length).toBe(10);
    expect(table(e).querySelector('.wy-dt-title')!.textContent).toBe('Stock');
    expect(table(e).querySelector('.wy-dt-info')!.textContent).toBe('1–10 of 25');
    expect(table(e).querySelector('tfoot')!.textContent).toContain('325'); // 1+2+…+25
    e.destroy();
  });

  it('inserts a blank starter table', () => {
    const e = make({}, '<p>x</p>', null);
    expect(e.execute('insertDataTable')).toBe(true);
    expect(bodyRows(e).length).toBe(3);
    e.destroy();
  });

  it('pages forward and changes the page size', () => {
    const e = make();
    (table(e).querySelector('[aria-label="Next page"]') as HTMLButtonElement).click();
    expect(cellText(bodyRows(e)[0])[0]).toBe('Item 11');
    expect(table(e).querySelector('.wy-dt-info')!.textContent).toBe('11–20 of 25');
    const size = table(e).querySelector('.wy-dt-size') as HTMLSelectElement;
    size.value = '0'; size.dispatchEvent(new Event('change'));
    expect(bodyRows(e).length).toBe(25);
    e.destroy();
  });

  it('searches and says how many matched', () => {
    const e = make();
    typeInto(table(e).querySelector('.wy-dt-search') as HTMLInputElement, 'item 07');
    expect(bodyRows(e).map(cellText)).toEqual([['Item 07', '7', '']]);
    expect(table(e).querySelector('.wy-dt-info')!.textContent).toContain('1–1 of 1 (filtered from 25)');
    expect(table(e).querySelector('tfoot')!.textContent).toContain('7');
    typeInto(table(e).querySelector('.wy-dt-search') as HTMLInputElement, 'nothing');
    expect(table(e).querySelector('.wy-dt-empty')!.textContent).toBe('No rows match.');
    e.destroy();
  });

  it('filters by column with an expression', () => {
    const e = make();
    const box = table(e).querySelector('input[aria-label="Filter Qty"]') as HTMLInputElement;
    typeInto(box, '>=23');
    expect(bodyRows(e).map((r) => cellText(r)[1])).toEqual(['23', '24', '25']);
    e.destroy();
  });

  it('sorts when a heading is clicked, with the direction shown to assistive tech', () => {
    const e = make();
    const th = () => table(e).querySelector('thead th[data-col="1"]') as HTMLElement;
    (th().querySelector('[data-role="sort"]') as HTMLElement).click();
    (th().querySelector('[data-role="sort"]') as HTMLElement).click(); // descending
    expect(th().getAttribute('aria-sort')).toBe('descending');
    expect(cellText(bodyRows(e)[0])[1]).toBe('25');
    (th().querySelector('[data-role="sort"]') as HTMLElement).click(); // cleared
    expect(th().getAttribute('aria-sort')).toBe('none');
    expect(cellText(bodyRows(e)[0])[1]).toBe('1');
    e.destroy();
  });

  it('edits a cell by double-click and saves it into the document, undoably', () => {
    const e = make();
    const td = bodyRows(e)[0].querySelector('td[data-col="0"]') as HTMLElement;
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = td.querySelector('input') as HTMLInputElement;
    input.value = 'Renamed';
    key(input, 'Enter');
    expect(cellText(bodyRows(e)[0])[0]).toBe('Renamed');
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows[0][0]).toBe('Renamed');
    e.execute('undo');
    expect(cellText(bodyRows(e)[0])[0]).toBe('Item 01');
    e.destroy();
  });

  it('Escape throws the edit away', () => {
    const e = make();
    const td = bodyRows(e)[0].querySelector('td[data-col="0"]') as HTMLElement;
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = td.querySelector('input') as HTMLInputElement;
    input.value = 'nope';
    key(input, 'Escape');
    expect(cellText(bodyRows(e)[0])[0]).toBe('Item 01');
    e.destroy();
  });

  it('numbers are read as numbers, and text in a number cell becomes empty rather than wrong', () => {
    const e = make();
    const td = bodyRows(e)[0].querySelector('td[data-col="1"]') as HTMLElement;
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    (td.querySelector('input') as HTMLInputElement).value = '1,234.5';
    key(td.querySelector('input')!, 'Enter');
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows[0][1]).toBe(1234.5);
    const td2 = bodyRows(e)[0].querySelector('td[data-col="1"]') as HTMLElement;
    td2.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    (td2.querySelector('input') as HTMLInputElement).value = 'abc';
    key(td2.querySelector('input')!, 'Enter');
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows[0][1]).toBeNull();
    e.destroy();
  });

  it('toggles a yes/no cell with its checkbox', () => {
    const e = make();
    const cb = bodyRows(e)[1].querySelector('input[data-role="toggle"]') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    cb.click();
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows[1][2]).toBe(true);
    e.destroy();
  });

  it('adds a row at the end and shows the last page', () => {
    const e = make();
    (table(e).querySelector('.wy-dt-bar') as HTMLElement).querySelectorAll('button').forEach((b) => b.textContent === 'Add row' && b.click());
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows.length).toBe(26);
    e.destroy();
  });

  it('selects rows with the tick boxes and deletes them in one undo step', () => {
    const e = make();
    const ticks = () => [...table(e).querySelectorAll<HTMLInputElement>('input[data-role="select-row"]')];
    ticks()[0].click(); ticks()[2].click();
    const del = [...table(e).querySelectorAll('button')].find((b) => /^Delete 2 rows$/.test(b.textContent ?? '')) as HTMLButtonElement;
    expect(del.hidden).toBe(false);
    del.click();
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows.length).toBe(23);
    e.execute('undo');
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows.length).toBe(25);
    e.destroy();
  });

  it('moves between cells with the arrow keys and starts editing with Enter', () => {
    const e = make();
    const first = bodyRows(e)[0].querySelector('td[data-col="0"]') as HTMLElement;
    first.click();
    key(first, 'ArrowDown');
    expect(document.activeElement).toBe(bodyRows(e)[1].querySelector('td[data-col="0"]'));
    key(document.activeElement!, 'ArrowRight');
    expect((document.activeElement as HTMLElement).dataset.col).toBe('1');
    key(document.activeElement!, 'Enter');
    expect(document.activeElement!.tagName).toBe('INPUT');
    e.destroy();
  });

  it('runs custom buttons and row actions with the right rows', () => {
    const onClick = vi.fn();
    const onRow = vi.fn();
    const e = make({ buttons: [{ id: 'go', label: 'Ship', needsSelection: true, onClick }], rowActions: [{ label: 'Open', onClick: onRow }] });
    const ship = [...table(e).querySelectorAll('button')].find((b) => b.textContent === 'Ship') as HTMLButtonElement;
    expect(ship.disabled).toBe(true);
    (table(e).querySelectorAll('input[data-role="select-row"]')[3] as HTMLInputElement).click();
    expect(ship.disabled).toBe(false);
    ship.click();
    expect(onClick.mock.calls[0][0].selected).toEqual([{ name: 'Item 04', qty: 4, ok: false }]);
    expect(onClick.mock.calls[0][0].visible.length).toBe(25);
    (table(e).querySelector('[data-role="row-action"]') as HTMLButtonElement).click();
    expect(onRow.mock.calls[0][0]).toEqual({ name: 'Item 01', qty: 1, ok: true });
    expect(onRow.mock.calls[0][1]).toBe(0);
    e.destroy();
  });

  it('exports the filtered, sorted rows only, and the ticked rows when some are ticked', async () => {
    const e = make();
    const api = e.extensions.dataTable as DataTableApi;
    typeInto(table(e).querySelector('input[aria-label="Filter Qty"]') as HTMLInputElement, '>=24');
    const csv = await read(api.export('csv')!);
    expect(csv.replace('﻿', '').trim().split('\r\n')).toEqual(['Name,Qty,Done', 'Item 24,24,FALSE', 'Item 25,25,TRUE']);
    (table(e).querySelectorAll('input[data-role="select-row"]')[1] as HTMLInputElement).click();
    expect((await read(api.export('csv', { selectedOnly: true })!)).trim().split('\r\n').length).toBe(2);
    const x = api.export('xlsx')!;
    expect(x.type).toContain('spreadsheetml');
    expect(x.size).toBeGreaterThan(500);
    e.destroy();
  });

  it('converts a regular table both ways', () => {
    const e = make({}, '<table><tr><th>Item</th><th>Price</th></tr><tr><td>Tea</td><td>4.5</td></tr><tr><td>Cake</td><td>6</td></tr></table>', null);
    const pos = 1;
    e.view.dispatch(e.view.state.tr.setSelection(require_text(e.view.state)));
    expect(e.execute('tableToDataTable')).toBe(true);
    const node = e.view.state.doc.firstChild!;
    expect(node.type.name).toBe('data_table');
    const spec = JSON.parse(node.attrs.spec);
    expect(spec.columns.map((c: { title: string; type: string }) => [c.title, c.type])).toEqual([['Item', 'text'], ['Price', 'number']]);
    expect(spec.rows).toEqual([['Tea', 4.5], ['Cake', 6]]);
    e.view.dispatch(e.view.state.tr.setSelection(NodeSelection.create(e.view.state.doc, 0)));
    expect(e.execute('dataTableToTable')).toBe(true);
    const back = e.view.state.doc.firstChild!;
    expect(back.type.name).toBe('table');
    expect(back.childCount).toBe(3);
    expect(back.child(0).child(0).type.name).toBe('table_header');
    expect(back.child(2).textContent).toBe('Cake6');
    void pos;
    e.destroy();
  });

  it('survives an HTML round trip, with a plain table inside for other readers', () => {
    const e = make();
    const html = e.getHTML();
    expect(html).toContain('data-data-table');
    expect(html).toContain('<th>Name</th>');
    expect(html).toContain('<td>Item 25</td>');
    e.setHTML(html);
    expect(e.view.state.doc.child(1).type.name).toBe('data_table');
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows.length).toBe(25);
    e.destroy();
  });

  it('writes Markdown as a table', () => {
    const e = make({}, '<p>x</p>', { columns: [{ title: 'A|B', type: 'text' }, { title: 'N', type: 'number' }], rows: [['p', 1], ['q', 2]] });
    expect(e.getMarkdown()).toContain('| A\\|B | N |\n| --- | --- |\n| p | 1 |\n| q | 2 |');
    e.destroy();
  });

  it('refuses a damaged or hostile saved spec without breaking the document', () => {
    const e = make({}, '<p>x</p>', null);
    e.setHTML('<figure data-data-table="{not json"></figure><p>after</p>');
    expect(e.view.state.doc.childCount).toBe(1);
    e.setHTML(`<figure data-data-table='${JSON.stringify({ columns: [{ title: '<img src=x onerror=alert(1)>', key: '"><script>' }], rows: [['<b>x</b>']] })}'></figure>`);
    expect(table(e).querySelector('img, script, b')).toBeNull();
    expect(table(e).querySelector('th')!.textContent).toContain('<img');
    e.destroy();
  });

  it('read-only: no editing controls, but searching and export still work', () => {
    const e = make();
    e.setReadOnly(true);
    table(e).dispatchEvent(new Event('pointerenter'));
    const labels = [...table(e).querySelectorAll('.wy-dt-bar button')].map((b) => b.textContent);
    expect(labels).not.toContain('Add row');
    expect(labels).toContain('Export ▾');
    const td = bodyRows(e)[0].querySelector('td[data-col="0"]') as HTMLElement;
    td.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(td.querySelector('input')).toBeNull();
    typeInto(table(e).querySelector('.wy-dt-search') as HTMLInputElement, '12');
    expect(bodyRows(e).length).toBe(1);
    e.destroy();
  });

  it('the handle selects the whole table so it can be deleted', () => {
    const e = make();
    (table(e).querySelector('.wy-dt-handle') as HTMLElement).click();
    expect(e.view.state.selection instanceof NodeSelection && e.view.state.selection.node.type.name).toBe('data_table');
    e.view.dispatch(e.view.state.tr.deleteSelection());
    expect(table(e)).toBeNull();
    e.destroy();
  });
});

import type { EditorState } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
function require_text(state: EditorState) {
  let at = 0;
  state.doc.descendants((n, pos) => { if (n.isText && !at) at = pos; });
  return TextSelection.create(state.doc, at);
}
