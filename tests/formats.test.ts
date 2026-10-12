import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, defaultPlugins, Charts } from '../src';
import { DATA_TABLE_VERSION, cleanSpec } from '../src/data-table';

/**
 * Golden files for what is stored in documents. These strings are what earlier versions wrote; every later version must keep reading
 * them to the same result (a change here means a stored format changed, which needs a new version number and a migration).
 */
const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (html: string, plugins = defaultPlugins) => {
  const element = document.body.appendChild(document.createElement('div'));
  roots.push(element);
  return createEditor({ element, content: html, plugins });
};

const V1 = JSON.stringify({
  v: 1,
  columns: [
    { key: 'item', title: 'Item', type: 'text', width: 180 },
    { key: 'kind', title: 'Kind', type: 'select', options: ['a', 'b'] },
    { key: 'price', title: 'Price', type: 'currency', currency: 'EUR', decimals: 2, align: 'right' },
    { key: 'qty', title: 'Qty', type: 'number', total: 'sum', bar: true },
    { key: 'total', title: 'Total', type: 'currency', currency: 'EUR', formula: '[Price] * [Qty]', total: 'sum' },
    { key: 'due', title: 'Due', type: 'date', hidden: true },
    { key: 'ok', title: 'Done', type: 'boolean' },
  ],
  rows: [['Tea', 'a', 4.5, 3, null, '2026-03-05', true], ['Cake', 'b', 6, null, null, null, false]],
  options: { title: 'Menu', pageSize: 25, search: true, filters: true, striped: true, bordered: false, selectable: true, density: 'compact', height: 300, detail: true, reorder: true, groupBy: ['kind'], source: '' },
  rules: [{ column: 'total', test: '>20', look: 'green', row: false }],
  views: [{ name: 'Tea only', search: 'tea', filters: { kind: 'a' }, sort: [{ key: 'price', dir: 'desc' }], groupBy: [], hidden: ['due'], pageSize: 10 }],
});

describe('data table, stored format version 1', () => {
  it('has a version number that only ever goes up', () => {
    expect(DATA_TABLE_VERSION).toBe(1);
  });

  it('reads the golden table to exactly this', () => {
    const s = cleanSpec(V1)!;
    expect(s).toEqual({
      v: 1,
      columns: [
        { key: 'item', title: 'Item', type: 'text', width: 180 },
        { key: 'kind', title: 'Kind', type: 'select', options: ['a', 'b'] },
        { key: 'price', title: 'Price', type: 'currency', currency: 'EUR', decimals: 2, align: 'right' },
        { key: 'qty', title: 'Qty', type: 'number', total: 'sum', bar: true },
        { key: 'total', title: 'Total', type: 'currency', currency: 'EUR', formula: '[Price] * [Qty]', total: 'sum' },
        { key: 'due', title: 'Due', type: 'date', hidden: true },
        { key: 'ok', title: 'Done', type: 'boolean' },
      ],
      rows: [['Tea', 'a', 4.5, 3, null, '2026-03-05', true], ['Cake', 'b', 6, null, null, null, false]],
      options: { title: 'Menu', pageSize: 25, search: true, filters: true, striped: true, bordered: false, selectable: true, density: 'compact', height: 300, detail: true, reorder: true, groupBy: ['kind'], source: '' },
      rules: [{ column: 'total', test: '>20', look: 'green', row: false }],
      views: [{ name: 'Tea only', search: 'tea', filters: { kind: 'a' }, sort: [{ key: 'price', dir: 'desc' }], groupBy: [], hidden: ['due'], pageSize: 10 }],
    });
  });

  it('writing it again changes nothing', () => {
    const once = cleanSpec(V1)!;
    expect(cleanSpec(JSON.stringify(once))).toEqual(once);
  });

  it('a table saved before versions existed is version 1', () => {
    const old = JSON.parse(V1); delete old.v;
    expect(cleanSpec(old)!.v).toBe(1);
  });

  it('a minimal table gets every default', () => {
    expect(cleanSpec({ columns: [{ title: 'A' }] })).toEqual({
      v: 1,
      columns: [{ key: 'c1', title: 'A', type: 'text' }],
      rows: [],
      options: { title: '', pageSize: 10, search: true, filters: false, striped: true, bordered: false, selectable: false, density: 'normal', height: 0, detail: false, reorder: false, groupBy: [], source: '' },
      rules: [],
      views: [],
    });
  });

  it('lives in the document as a data_table node with a `spec` text, and in HTML as figure[data-data-table]', () => {
    const e = make(`<p>x</p><figure data-data-table='${V1}'></figure>`);
    const json = e.view.state.doc.toJSON();
    expect(json.content[1].type).toBe('data_table');
    expect(Object.keys(json.content[1].attrs)).toEqual(['spec']);
    expect(JSON.parse(json.content[1].attrs.spec).v).toBe(1);
    const html = e.getHTML();
    expect(html).toMatch(/<figure[^>]* data-data-table="/);
    expect(html).toContain('<th>Item</th>');
    e.destroy();
  });

  it('a table from a newer version is shown, kept as it was, and not editable', () => {
    const newer = JSON.stringify({ ...JSON.parse(V1), v: 2, somethingNew: { x: 1 } });
    const e = make(`<p>x</p><figure data-data-table='${newer}'></figure>`);
    const node = e.view.state.doc.child(1);
    expect(JSON.parse(node.attrs.spec).somethingNew).toEqual({ x: 1 }); // nothing was dropped
    expect(e.getHTML()).toContain('somethingNew');
    const dom = e.view.dom.querySelector('.wy-dt')!;
    expect(dom.querySelector('.wy-dt-note')!.textContent).toMatch(/newer version/);
    expect([...dom.querySelectorAll('.wy-dt-bar button')].map((b) => b.textContent)).not.toContain('Add row');
    dom.querySelector('td[data-col="0"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(dom.querySelector('.wy-dt-edit')).toBeNull();
    // and a round trip through HTML keeps it too
    e.setHTML(e.getHTML());
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).somethingNew).toEqual({ x: 1 });
    e.destroy();
  });
});

describe('other stored formats', () => {
  it('chart: figure[data-chart] with {type, title, labels, series}', () => {
    const spec = { type: 'bar', title: 'T', labels: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }] };
    const e = make(`<figure data-chart='${JSON.stringify(spec)}'></figure>`, [...defaultPlugins, Charts()]);
    const node = e.view.state.doc.firstChild!;
    expect(node.type.name).toBe('chart');
    expect(JSON.parse(node.attrs.spec)).toEqual(spec);
    e.destroy();
  });

  it('cover page: div[data-cover-page] holding the picture', () => {
    const e = make('<div data-cover-page><img src="https://example.com/c.png" alt="Cover"></div><p>text</p>');
    const node = e.view.state.doc.firstChild!;
    expect(node.type.name).toBe('cover_page');
    expect(node.attrs).toEqual({ src: 'https://example.com/c.png', alt: 'Cover' });
    e.destroy();
  });
});
