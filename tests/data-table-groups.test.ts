import { describe, expect, it } from 'vitest';
import { cleanSpec, groupDisplay, normalizeRows, parseXlsx, queryRows, specFromRows, toXlsx, type DataTableSpec } from '../src/data-table';

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
// made by a real spreadsheet program (deflate-compressed, shared strings, a hidden first sheet)
const OPENPYXL = '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';

const fruit = (groupBy: string[] = ['kind']): DataTableSpec => cleanSpec({
  columns: [{ key: 'name', title: 'Name', type: 'text' }, { key: 'kind', title: 'Kind', type: 'select', options: ['a', 'b'] }, { key: 'qty', title: 'Qty', type: 'number', total: 'sum' }],
  rows: [['p', 'b', 1], ['q', 'a', 2], ['r', 'b', 3], ['s', 'a', 4], ['t', '', 5]],
  options: { groupBy },
})!;

describe('groups', () => {
  it('keeps only real columns, at most three, without repeats', () => {
    const s = cleanSpec({ columns: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], rows: [], options: { groupBy: ['a', 'a', 'zz', 'b', 7] } })!;
    expect(s.options.groupBy).toEqual(['a', 'b']);
  });
  it('sorts rows so each group is together, in the order the group column sorts', () => {
    const s = fruit();
    expect(queryRows(s, { search: '', filters: {}, sort: [] })).toEqual([1, 3, 0, 2, 4]); // a (q, s), b (p, r), empty last
  });
  it('sorts inside groups by the chosen column and can reverse the groups', () => {
    const s = fruit();
    expect(queryRows(s, { search: '', filters: {}, sort: [{ key: 'qty', dir: 'desc' }] })).toEqual([3, 1, 2, 0, 4]);
    expect(queryRows(s, { search: '', filters: {}, sort: [{ key: 'kind', dir: 'desc' }] })).toEqual([0, 2, 1, 3, 4]);
  });
  it('lists each row with the groups it is in, and counts every row of a group', () => {
    const s = fruit();
    const idx = queryRows(s, { search: '', filters: {}, sort: [] });
    const d = groupDisplay(s, idx);
    expect(d.map((x) => x.r)).toEqual([1, 3, 0, 2, 4]);
    expect(d[0].path[0].label).toBe('Kind: a');
    expect(d[0].path[0].rows).toEqual([1, 3]);
    expect(d[4].path[0].label).toBe('Kind: (empty)');
  });
  it('folds a group into one line and keeps the rest', () => {
    const s = fruit();
    const idx = queryRows(s, { search: '', filters: {}, sort: [] });
    const key = groupDisplay(s, idx)[0].path[0].key;
    const d = groupDisplay(s, idx, new Set([key]));
    expect(d.map((x) => x.r)).toEqual([-1, 0, 2, 4]);
    expect(d[0].path[0].rows.length).toBe(2);
  });
  it('nests groups', () => {
    const s = cleanSpec({ columns: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }], rows: [['x', '1'], ['y', '1'], ['x', '2'], ['x', '1']], options: { groupBy: ['a', 'b'] } })!;
    const d = groupDisplay(s, queryRows(s, { search: '', filters: {}, sort: [] }));
    expect(d.map((x) => x.path.map((g) => g.label.split(': ')[1]).join('/'))).toEqual(['x/1', 'x/1', 'x/2', 'y/1']);
    expect(d[0].path[0].rows.length).toBe(3);
  });
});

describe('remote rows', () => {
  it('are made to fit the columns, from arrays or from objects', () => {
    const cols = cleanSpec({ columns: [{ key: 'n', title: 'N', type: 'number' }, { key: 't', title: 'T' }], rows: [] })!.columns;
    expect(normalizeRows(cols, [[1, 'a'], { n: '2', t: 5 }, null, 'junk'])).toEqual([[1, 'a'], [2, '5'], [null, ''], [null, '']]);
    expect(normalizeRows(cols, 'nope')).toEqual([]);
  });
  it('remembers the source name, cleaned', () => {
    expect(cleanSpec({ columns: [{ title: 'A' }], rows: [], options: { source: 'orders<>' } })!.options.source).toBe('orders');
  });
});

describe('reading .xlsx', () => {
  it('reads a file made by a spreadsheet program: first visible sheet, text, numbers, dates, booleans', async () => {
    const { rows, sheet } = await parseXlsx(bytes(OPENPYXL));
    expect(sheet).toBe('Orders');
    expect(rows[0]).toEqual(['Item', 'Qty', 'Price', 'Due', 'Paid']);
    expect(rows[1]).toEqual(['Tea', 3, 4.5, '2026-03-05', true]);
    expect(rows[2]).toEqual(['Äpfel & "x"', 12, 0.25, '2026-01-20', false]);
    expect(rows[3][0]).toBe('Gap');
    const spec = specFromRows(rows);
    expect(spec.columns.map((c) => c.type)).toEqual(['text', 'number', 'number', 'date', 'boolean']);
  });
  it('reads back what toXlsx writes', async () => {
    const s = cleanSpec({ columns: [{ title: 'A', type: 'text' }, { title: 'N', type: 'number' }, { title: 'D', type: 'date' }, { title: 'B', type: 'boolean' }], rows: [['x', 1.5, '2026-03-05', true], ['y & <z>', null, null, false]] })!;
    const { rows } = await parseXlsx(toXlsx(s));
    expect(rows).toEqual([['A', 'N', 'D', 'B'], ['x', 1.5, '2026-03-05', true], ['y & <z>', '', '', false]]);
  });
  it('refuses something that is not a spreadsheet', async () => {
    await expect(parseXlsx(new TextEncoder().encode('just some text, long enough to look like a file'))).rejects.toThrow(/not a spreadsheet/);
    await expect(parseXlsx(new Uint8Array(10))).rejects.toThrow();
  });
});
