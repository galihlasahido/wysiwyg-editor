import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, defaultPlugins, DataTable } from '../src';
import type { DataTablePage, DataTableQuery } from '../src';
import { toXlsx, cleanSpec } from '../src/data-table';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));

function make(opts: Parameters<typeof DataTable>[0] = {}, spec: unknown) {
  const element = document.body.appendChild(document.createElement('div'));
  roots.push(element);
  const editor = createEditor({ element, content: '<p>x</p>', plugins: [...defaultPlugins.filter((p) => p.name !== 'dataTable'), DataTable(opts)] });
  if (spec) editor.execute('insertDataTable', spec);
  return editor;
}
type E = ReturnType<typeof make>;
const dt = (e: E) => e.view.dom.querySelector('.wy-dt') as HTMLElement;
const lines = (e: E) => [...dt(e).querySelectorAll<HTMLElement>('tbody tr:not(.wy-dt-pad)')];
const dataRows = (e: E) => [...dt(e).querySelectorAll<HTMLElement>('tbody tr[data-row]')];
const text = (tr: HTMLElement) => tr.textContent;
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const typeInto = (input: HTMLInputElement, v: string) => { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); };

const grouped = () => ({
  columns: [{ key: 'name', title: 'Name', type: 'text' }, { key: 'kind', title: 'Kind', type: 'select', options: ['a', 'b'] }, { key: 'qty', title: 'Qty', type: 'number', total: 'sum' }],
  rows: [['p', 'b', 1], ['q', 'a', 2], ['r', 'b', 3], ['s', 'a', 4]],
  options: { groupBy: ['kind'], pageSize: 0 },
});

describe('grouped rows', () => {
  it('draw a heading per group with its count and total', () => {
    const e = make({}, grouped());
    const l = lines(e);
    expect(l.map((x) => x.classList.contains('wy-dt-group'))).toEqual([true, false, false, true, false, false]);
    expect(text(l[0])).toContain('Kind: a');
    expect(text(l[0])).toContain('2 rows');
    expect(text(l[0])).toContain('Qty: 6');
    expect(text(l[1])).toContain('q');
    e.destroy();
  });

  it('fold and unfold a group by clicking its heading, keeping the rest', () => {
    const e = make({}, grouped());
    (lines(e)[0].querySelector('[data-role="group-toggle"]') as HTMLElement).click();
    expect(lines(e).length).toBe(4); // folded a, then b with its two rows
    expect(lines(e)[0].querySelector('[aria-expanded]')!.getAttribute('aria-expanded')).toBe('false');
    expect(dataRows(e).map((r) => r.dataset.row)).toEqual(['0', '2']);
    (lines(e)[0].querySelector('[data-role="group-toggle"]') as HTMLElement).click();
    expect(dataRows(e).length).toBe(4);
    e.destroy();
  });

  it('are set from the heading menu and cleared again', () => {
    const e = make({}, { ...grouped(), options: { pageSize: 0 } });
    expect(dt(e).querySelector('.wy-dt-group')).toBeNull();
    (dt(e).querySelector('th[data-col="1"] [data-role="column-menu"]') as HTMLElement).click();
    const item = [...dt(e).querySelectorAll<HTMLElement>('.wy-dt-menu-item')].find((b) => b.textContent === 'Group by this column')!;
    item.click();
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).options.groupBy).toEqual(['kind']);
    expect(dt(e).querySelectorAll('.wy-dt-group').length).toBe(2);
    e.destroy();
  });

  it('repeat the heading at the top of each page, so a page says where it is', () => {
    const rows = Array.from({ length: 6 }, (_, i) => [`n${i}`, 'a', i]);
    const e = make({}, { ...grouped(), rows, options: { groupBy: ['kind'], pageSize: 4 } });
    expect(lines(e).length).toBe(5);
    (dt(e).querySelector('[aria-label="Next page"]') as HTMLElement).click();
    expect(lines(e)[0].classList.contains('wy-dt-group')).toBe(true);
    expect(dataRows(e).length).toBe(2);
    e.destroy();
  });

  it('keep the arrow keys on data rows only', () => {
    const e = make({}, grouped());
    const first = dataRows(e)[0].querySelector('td[data-col="0"]') as HTMLElement;
    first.click();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect((document.activeElement as HTMLElement).parentElement!.dataset.row).toBe('3'); // 'a' group: q, s
    e.destroy();
  });
});

describe('long tables without paging', () => {
  const big = (n: number) => ({ columns: [{ key: 'n', title: 'N', type: 'number' }, { key: 't', title: 'T' }], rows: Array.from({ length: n }, (_, i) => [i, `row ${i}`]), options: { pageSize: 0 } });

  it('draw only the rows in view', () => {
    const e = make({}, big(5000));
    expect(dt(e).classList.contains('is-virtual')).toBe(true);
    expect(dataRows(e).length).toBeLessThan(120);
    expect(dt(e).querySelector('.wy-dt-info')!.textContent).toBe('1–5000 of 5000');
    expect(dt(e).querySelector('tbody')!.firstElementChild!.classList.contains('wy-dt-pad')).toBe(false); // at the top there is nothing above
    e.destroy();
  });

  it('are still searchable, and a short result is drawn whole', () => {
    const e = make({}, big(5000));
    typeInto(dt(e).querySelector('.wy-dt-search') as HTMLInputElement, 'row 4999');
    expect(dataRows(e).length).toBe(1);
    expect(dt(e).classList.contains('is-virtual')).toBe(false);
    e.destroy();
  });

  it('a modest table is drawn whole', () => {
    const e = make({}, big(150));
    expect(dt(e).classList.contains('is-virtual')).toBe(false);
    expect(dataRows(e).length).toBe(150);
    e.destroy();
  });

  it('select-all ticks every row, not just those drawn', () => {
    const e = make({}, { ...big(1000), options: { pageSize: 0, selectable: true } });
    (dt(e).querySelector('[data-role="select-page"]') as HTMLInputElement).click();
    const del = [...dt(e).querySelectorAll('button')].find((b) => /^Delete 1000 rows$/.test(b.textContent ?? ''));
    expect(del).toBeTruthy();
    e.destroy();
  });

  it('reach a row far down with the keyboard (End)', () => {
    const e = make({}, big(1000));
    const first = dataRows(e)[0].querySelector('td[data-col="0"]') as HTMLElement;
    first.click();
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', ctrlKey: true, bubbles: true }));
    expect((document.activeElement as HTMLElement).parentElement!.dataset.row).toBe('999');
    e.destroy();
  });
});

describe('a table that loads its rows', () => {
  const columns = [{ key: 'id', title: 'Id', type: 'number' }, { key: 'name', title: 'Name', type: 'text' }, { key: 'amount', title: 'Amount', type: 'number', total: 'sum' }];
  const all = Array.from({ length: 95 }, (_, i) => ({ id: i + 1, name: `Order ${i + 1}`, amount: (i + 1) * 2 }));
  const makeSource = () => vi.fn(async (q: DataTableQuery): Promise<DataTablePage> => {
    let rows = all.filter((r) => !q.search || r.name.toLowerCase().includes(q.search.toLowerCase()));
    if (q.filters.amount) rows = rows.filter((r) => r.amount > Number(q.filters.amount.replace('>', '')));
    if (q.sort[0]) { const { key, dir } = q.sort[0]; rows = [...rows].sort((a, b) => ((a as never)[key] > (b as never)[key] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
    return { rows: rows.slice(q.page * q.pageSize, (q.page + 1) * q.pageSize), total: rows.length, totals: { amount: rows.reduce((n, r) => n + r.amount, 0) } };
  });
  const spec = { columns, rows: [], options: { source: 'orders', pageSize: 10, filters: true, selectable: true, title: 'Orders' } };

  it('asks the source for the first page and draws it, with the total from the source', async () => {
    const load = makeSource();
    const e = make({ sources: { orders: load } }, spec);
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0][0]).toMatchObject({ page: 0, pageSize: 10, search: '', filters: {}, sort: [], groupBy: [] });
    expect(dataRows(e).length).toBe(10);
    expect(dt(e).querySelector('.wy-dt-info')!.textContent).toBe('1–10 of 95');
    expect(dt(e).querySelector('tfoot')!.textContent).toMatch(/9,?120/); // sum of 2..190
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows).toEqual([]); // nothing stored in the document
    e.destroy();
  });

  it('pages, sorts, searches and filters through the source', async () => {
    const load = makeSource();
    const e = make({ sources: { orders: load } }, spec);
    await tick();
    (dt(e).querySelector('[aria-label="Next page"]') as HTMLElement).click();
    await tick();
    expect(load.mock.lastCall![0].page).toBe(1);
    expect(dt(e).querySelector('.wy-dt-info')!.textContent).toContain('11–20 of 95');
    (dt(e).querySelector('th[data-col="2"] [data-role="sort"]') as HTMLElement).click();
    (dt(e).querySelector('th[data-col="2"] [data-role="sort"]') as HTMLElement).click();
    await tick();
    expect(load.mock.lastCall![0]).toMatchObject({ page: 0, sort: [{ key: 'amount', dir: 'desc' }] });
    expect(dataRows(e)[0].textContent).toContain('Order 95');
    typeInto(dt(e).querySelector('.wy-dt-search') as HTMLInputElement, 'order 7');
    expect(load.mock.calls.length).toBe(4); // typing waits a moment before asking
    await tick(350);
    expect(load.mock.lastCall![0].search).toBe('order 7');
    expect(dt(e).querySelector('.wy-dt-info')!.textContent).toContain('of 11');
    typeInto(dt(e).querySelector('input[aria-label="Filter Amount"]') as HTMLInputElement, '>100');
    await tick(350);
    expect(load.mock.lastCall![0].filters).toEqual({ amount: '>100' });
    e.destroy();
  });

  it('shows the latest answer even when an earlier request finishes last', async () => {
    let n = 0;
    const load = vi.fn(async (): Promise<DataTablePage> => { const mine = ++n; await tick(mine === 1 ? 60 : 5); return { rows: [[mine, `answer ${mine}`, 0]], total: 1 }; });
    const e = make({ sources: { orders: load } }, spec);
    (dt(e).querySelector('.wy-dt-search') as HTMLInputElement).dispatchEvent(new Event('input'));
    e.execute('refreshDataTable');
    await tick(120);
    expect(dataRows(e).length).toBe(1);
    expect(dataRows(e)[0].textContent).toContain('answer 2');
    e.destroy();
  });

  it('says so when the source fails, and tries again on request', async () => {
    let fail = true;
    const load = vi.fn(async (): Promise<DataTablePage> => { if (fail) throw new Error('Server said no'); return { rows: [[1, 'ok', 1]], total: 1 }; });
    const e = make({ sources: { orders: load } }, spec);
    await tick();
    expect(dt(e).querySelector('.wy-dt-error')!.textContent).toBe('Server said no');
    fail = false;
    ([...dt(e).querySelectorAll('button')].find((b) => b.textContent === 'Try again') as HTMLElement).click();
    await tick();
    expect(dataRows(e).length).toBe(1);
    expect(dt(e).querySelector('.wy-dt-error')).toBeNull();
    e.destroy();
  });

  it('names a missing source instead of failing silently', async () => {
    const e = make({}, spec);
    await tick();
    expect(dt(e).querySelector('.wy-dt-error')!.textContent).toContain('“orders”');
    e.destroy();
  });

  it('is read-only unless an edit handler is given, and reloads after an edit', async () => {
    const load = makeSource();
    const e = make({ sources: { orders: load } }, spec);
    await tick();
    const td = () => dataRows(e)[0].querySelector('td[data-col="1"]') as HTMLElement;
    td().dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(td().querySelector('input')).toBeNull();
    e.destroy();

    const onEdit = vi.fn();
    const e2 = make({ sources: { orders: load }, onEdit }, spec);
    await tick();
    const td2 = dataRows(e2)[0].querySelector('td[data-col="1"]') as HTMLElement;
    td2.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = td2.querySelector('input') as HTMLInputElement;
    input.value = 'Changed';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await tick();
    expect(onEdit).toHaveBeenCalledWith({ source: 'orders', key: 'name', value: 'Changed', row: { id: 1, name: 'Order 1', amount: 2 }, index: 0 });
    expect(load.mock.calls.length).toBeGreaterThanOrEqual(3); // initial two + reload
    e2.destroy();
  });

  it('has no add or delete row buttons, and a refresh button', async () => {
    const e = make({ sources: { orders: makeSource() } }, spec);
    await tick();
    const labels = [...dt(e).querySelectorAll('.wy-dt-bar button')].map((b) => b.textContent);
    expect(labels).toContain('Refresh');
    expect(labels).not.toContain('Add row');
    e.destroy();
  });

  it('gives custom buttons the rows on screen and the ticked ones', async () => {
    const onClick = vi.fn();
    const e = make({ sources: { orders: makeSource() }, buttons: [{ id: 'x', label: 'Act', onClick }] }, spec);
    await tick();
    (dt(e).querySelectorAll('input[data-role="select-row"]')[1] as HTMLElement).click();
    ([...dt(e).querySelectorAll('button')].find((b) => b.textContent === 'Act') as HTMLElement).click();
    expect(onClick.mock.calls[0][0].selected).toEqual([{ id: 2, name: 'Order 2', amount: 4 }]);
    expect(onClick.mock.calls[0][0].visible.length).toBe(10);
    e.destroy();
  });

  it('never trusts what the source sends', async () => {
    const e = make({ sources: { orders: async () => ({ rows: [{ id: 'x', name: '<img src=x onerror=1>', amount: 'NaN' }, null, 'junk'], total: 'many' as never }) } }, spec);
    await tick();
    expect(dt(e).querySelector('img')).toBeNull();
    expect(dataRows(e).length).toBe(3);
    expect(dataRows(e)[0].textContent).toContain('<img');
    e.destroy();
  });
});

describe('importing files', () => {
  const insertFrom = async (e: E, file: File) => { e.execute('dataTableFromFile', file); await tick(30); };

  it('reads an Excel file into a data table with guessed types and the file name as the title', async () => {
    const e = make({}, null);
    const bytes = toXlsx(cleanSpec({ columns: [{ title: 'Item' }, { title: 'Qty', type: 'number' }, { title: 'Due', type: 'date' }], rows: [['Tea', 3, '2026-03-05'], ['Cake', 4, '2026-04-01']] })!);
    await insertFrom(e, new File([bytes as BlobPart], 'Stock list.xlsx'));
    const spec = JSON.parse(e.view.state.doc.child(1).attrs.spec);
    expect(spec.options.title).toBe('Stock list');
    expect(spec.columns.map((c: { type: string }) => c.type)).toEqual(['text', 'number', 'date']);
    expect(spec.rows).toEqual([['Tea', 3, '2026-03-05'], ['Cake', 4, '2026-04-01']]);
    e.destroy();
  });

  it('reads CSV by the same command', async () => {
    const e = make({}, null);
    await insertFrom(e, new File(['a;b\n1;x\n2;y'], 'plain.csv'));
    expect(JSON.parse(e.view.state.doc.child(1).attrs.spec).rows).toEqual([[1, 'x'], [2, 'y']]);
    e.destroy();
  });

  it('reports a file that is not a spreadsheet and leaves the document alone', async () => {
    const e = make({}, null);
    const seen: unknown[] = [];
    e.on('dataTableError', (p) => seen.push(p));
    await insertFrom(e, new File([new Uint8Array([0x50, 0x4b, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])], 'broken.xlsx'));
    expect(seen.length).toBe(1);
    expect(e.view.state.doc.childCount).toBe(1);
    e.destroy();
  });
});
