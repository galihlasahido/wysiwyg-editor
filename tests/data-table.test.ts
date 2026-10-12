import { describe, expect, it } from 'vitest';
import { aggregate, cleanSpec, coerceCell, crc32, filterTest, formatCell, guessType, parseCSV, parseDate, parseNumber, queryRows, specFromRows, toCSV, toPrintHTML, toXlsx, zipStore, type DataTableSpec, type ViewState } from '../src/data-table';

const spec = (): DataTableSpec => cleanSpec({
  columns: [{ key: 'name', title: 'Name', type: 'text' }, { key: 'qty', title: 'Qty', type: 'number', total: 'sum' }, { key: 'price', title: 'Price', type: 'currency', currency: 'USD' }, { key: 'due', title: 'Due', type: 'date' }, { key: 'ok', title: 'Done', type: 'boolean' }],
  rows: [['Pear', 3, 1.5, '2026-03-05', true], ['apple', 12, 0.25, '2026-01-20', false], ['Fig', null, 9, null, true], ['Kiwi', 7, 2, '2026-02-11', false]],
})!;
const view = (v: Partial<ViewState> = {}): ViewState => ({ search: '', filters: {}, sort: [], ...v });

describe('values', () => {
  it('reads numbers in several notations', () => {
    expect(parseNumber('1,234.56')).toBe(1234.56);
    expect(parseNumber('1.234,56')).toBe(1234.56);
    expect(parseNumber('1,234')).toBe(1234);
    expect(parseNumber('12,5')).toBe(12.5);
    expect(parseNumber('$5')).toBe(5);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });
  it('reads dates and refuses impossible ones', () => {
    expect(parseDate('2026-3-5')).toBe('2026-03-05');
    expect(parseDate('05/03/2026')).toBe('2026-03-05');
    expect(parseDate('2026-02-30')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
  it('coerces to the column type', () => {
    expect(coerceCell('number', '4')).toBe(4);
    expect(coerceCell('boolean', 'yes')).toBe(true);
    expect(coerceCell('boolean', 'no')).toBe(false);
    expect(coerceCell('text', 5)).toBe('5');
    expect(coerceCell('date', 'x')).toBeNull();
  });
  it('guesses column types', () => {
    expect(guessType(['1', '2.5', ''])).toBe('number');
    expect(guessType(['007', '12'])).toBe('text');
    expect(guessType(['2026-01-01', '2026-02-02'])).toBe('date');
    expect(guessType(['yes', 'no'])).toBe('boolean');
    expect(guessType(['a', '1'])).toBe('text');
  });
  it('formats for display', () => {
    const s = spec();
    expect(formatCell(s.columns[2], 1.5, 'en-US')).toBe('$1.50');
    expect(formatCell(s.columns[1], 1234, 'en-US')).toBe('1,234');
    expect(formatCell(s.columns[3], '2026-03-05', 'en-US')).toBe('Mar 5, 2026');
    expect(formatCell(s.columns[4], true)).toBe('Yes');
  });
});

describe('cleanSpec', () => {
  it('rejects things that are not a table', () => {
    expect(cleanSpec('nope')).toBeNull();
    expect(cleanSpec({ columns: [] })).toBeNull();
    expect(cleanSpec(null)).toBeNull();
  });
  it('fills in, pads and limits', () => {
    const s = cleanSpec({ columns: [{ title: 'A', type: 'weird' }, { title: 'B', key: 'x', type: 'number' }, { title: 'C', key: 'x' }], rows: [['1'], ['a', 'b', 'c', 'extra']], options: { pageSize: -4, height: 5 } })!;
    expect(s.columns.map((c) => c.type)).toEqual(['text', 'number', 'text']);
    expect(new Set(s.columns.map((c) => c.key)).size).toBe(3);
    expect(s.rows[0]).toEqual(['1', null, '']);
    expect(s.rows[1].length).toBe(3);
    expect(s.options.pageSize).toBe(10);
    expect(s.options.height).toBe(0);
  });
  it('accepts the JSON string and drops hostile keys', () => {
    const s = cleanSpec(JSON.stringify({ columns: [{ key: '"><img onerror=1>', title: 'T' }], rows: [] }))!;
    expect(s.columns[0].key).toMatch(/^[\w-]+$/);
  });
  it('builds a spec from rows with guessed types', () => {
    const s = specFromRows([['Item', 'Qty'], ['a', '3'], ['b', '4']]);
    expect(s.columns.map((c) => c.type)).toEqual(['text', 'number']);
    expect(s.rows[1][1]).toBe(4);
  });
});

describe('search, filter, sort', () => {
  it('searches every shown column', () => {
    expect(queryRows(spec(), view({ search: 'fig' }))).toEqual([2]);
    expect(queryRows(spec(), view({ search: '12' }))).toEqual([1]);
  });
  it('does not search hidden columns', () => {
    const s = spec(); s.columns[0].hidden = true;
    expect(queryRows(s, view({ search: 'fig' }))).toEqual([]);
  });
  it('filters text, numbers, dates and booleans', () => {
    const s = spec();
    expect(queryRows(s, view({ filters: { name: 'I' } }))).toEqual([2, 3]);
    expect(queryRows(s, view({ filters: { qty: '>=7' } }))).toEqual([1, 3]);
    expect(queryRows(s, view({ filters: { qty: '3..7' } }))).toEqual([0, 3]);
    expect(queryRows(s, view({ filters: { qty: '!=3' } }))).toEqual([1, 2, 3]);
    expect(queryRows(s, view({ filters: { due: '<2026-03-01' } }))).toEqual([1, 3]);
    expect(queryRows(s, view({ filters: { ok: 'true' } }))).toEqual([0, 2]);
    expect(queryRows(s, view({ filters: { qty: '>2', ok: 'false' } }))).toEqual([1, 3]);
  });
  it('sorts with empty values last in both directions', () => {
    const s = spec();
    expect(queryRows(s, view({ sort: [{ key: 'qty', dir: 'asc' }] }))).toEqual([0, 3, 1, 2]);
    expect(queryRows(s, view({ sort: [{ key: 'qty', dir: 'desc' }] }))).toEqual([1, 3, 0, 2]);
  });
  it('sorts text without caring about case, and by several columns', () => {
    const s = spec();
    expect(queryRows(s, view({ sort: [{ key: 'name', dir: 'asc' }] })).map((r) => s.rows[r][0])).toEqual(['apple', 'Fig', 'Kiwi', 'Pear']);
    expect(queryRows(s, view({ sort: [{ key: 'ok', dir: 'asc' }, { key: 'name', dir: 'desc' }] }))).toEqual([3, 1, 0, 2]);
  });
  it('falls back to the shown text for a non-numeric date filter', () => {
    expect(filterTest(spec().columns[3], 'Mar', 'en-US')!('2026-03-05')).toBe(true);
  });
});

describe('totals', () => {
  it('sums, averages, counts and finds extremes over the given rows', () => {
    const s = spec();
    const all = [0, 1, 2, 3];
    expect(aggregate(s.columns[1], 'sum', s.rows, all, 1)).toBe(22);
    expect(aggregate(s.columns[1], 'avg', s.rows, all, 1)).toBeCloseTo(22 / 3);
    expect(aggregate(s.columns[1], 'count', s.rows, all, 1)).toBe(3);
    expect(aggregate(s.columns[1], 'min', s.rows, [0, 1], 1)).toBe(3);
    expect(aggregate(s.columns[1], 'max', s.rows, [0, 1], 1)).toBe(12);
    expect(aggregate(s.columns[1], 'sum', s.rows, [2], 1)).toBeNull();
  });
});

describe('CSV', () => {
  it('writes plain values with quotes where needed', () => {
    const s = cleanSpec({ columns: [{ title: 'A, B', type: 'text' }, { title: 'N', type: 'number' }], rows: [['say "hi"', 1.5], ['two\nlines', null]] })!;
    expect(toCSV(s, { bom: false })).toBe('"A, B",N\r\n"say ""hi""",1.5\r\n"two\nlines",\r\n');
  });
  it('starts with a byte-order mark unless told not to', () => {
    expect(toCSV(spec()).charCodeAt(0)).toBe(0xfeff);
  });
  it('keeps spreadsheets from running text as a formula', () => {
    const s = cleanSpec({ columns: [{ title: 'A', type: 'text' }, { title: 'N', type: 'number' }], rows: [['=HYPERLINK("x")', -5], ['+1', 2]] })!;
    const csv = toCSV(s, { bom: false });
    expect(csv).toContain("\"'=HYPERLINK(\"\"x\"\")\",-5");
    expect(csv).toContain("'+1,2");
  });
  it('exports only the given rows and visible columns', () => {
    const s = spec(); s.columns[2].hidden = true;
    const out = toCSV(s, { bom: false, rows: [3, 1] }).trim().split('\r\n');
    expect(out).toEqual(['Name,Qty,Due,Done', 'Kiwi,7,2026-02-11,FALSE', 'apple,12,2026-01-20,FALSE']);
  });
  it('can write the shown text', () => {
    expect(toCSV(spec(), { bom: false, formatted: true, locale: 'en-US', rows: [0] })).toContain('Pear,3,$1.50,"Mar 5, 2026",Yes');
  });
  it('reads quoted CSV, TSV and semicolons', () => {
    expect(parseCSV('a,b\r\n"x, y","say ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseCSV('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCSV('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCSV('a,b\n"line\nbreak",2')[1][0]).toBe('line\nbreak');
    expect(parseCSV('﻿a,b\n1,2')[0][0]).toBe('a');
  });
  it('round-trips', () => {
    const s = spec();
    const back = specFromRows(parseCSV(toCSV(s)));
    expect(back.rows.length).toBe(s.rows.length);
    expect(back.columns.map((c) => c.title)).toEqual(s.columns.map((c) => c.title));
  });
});

/** Reads the archive back: every entry's size and checksum must match, and the directory must point at the local headers. */
function readZip(bytes: Uint8Array) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(v.getUint32(end, true)).toBe(0x06054b50);
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const crc = v.getUint32(at + 16, true), size = v.getUint32(at + 20, true), nl = v.getUint16(at + 28, true), off = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nl));
    expect(v.getUint32(off, true)).toBe(0x04034b50);
    const start = off + 30 + v.getUint16(off + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(crc32(data)).toBe(crc);
    out[name] = new TextDecoder().decode(data);
    at += 46 + nl;
  }
  return out;
}

describe('xlsx', () => {
  it('knows the standard CRC-32 of "123456789"', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });
  it('writes a valid archive with the parts Excel needs', () => {
    const files = readZip(toXlsx(spec(), { title: 'Fruit' }));
    expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
    expect(files['xl/workbook.xml']).toContain('name="Fruit"');
  });
  it('stores numbers, dates, booleans and text with the right types', () => {
    const sheet = readZip(toXlsx(spec()))['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sheet).toContain('<c r="B2" s="2"><v>3</v></c>');
    expect(sheet).toContain('<v>46086</v>'); // 2026-03-05
    expect(sheet).toContain('<c r="E2" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">apple</t>');
    expect(sheet).not.toContain('r="B4"'); // an empty cell is left out
    expect(sheet).toContain('<autoFilter ref="A1:E5"/>');
  });
  it('escapes markup and drops control characters', () => {
    const s = cleanSpec({ columns: [{ title: 'A<b>', type: 'text' }], rows: [['x & <y> \u0001"z"']] })!;
    const sheet = readZip(toXlsx(s))['xl/worksheets/sheet1.xml'];
    expect(sheet).toContain('A&lt;b&gt;');
    expect(sheet).toContain('x &amp; &lt;y&gt; &quot;z&quot;');
    expect(sheet).not.toContain('\u0001');
  });
  it('cleans the sheet name', () => {
    expect(readZip(toXlsx(spec(), { title: "a/b[c]:d*e?'" }))['xl/workbook.xml']).toMatch(/name="a b c  d e"/);
  });
  it('is the same bytes every time', () => {
    expect(Array.from(toXlsx(spec()))).toEqual(Array.from(toXlsx(spec())));
  });
  it('zips', () => {
    const z = readZip(zipStore([{ name: 'a.txt', data: new TextEncoder().encode('hello') }]));
    expect(z['a.txt']).toBe('hello');
  });
});

describe('print html', () => {
  it('repeats the header, aligns numbers and totals the columns', () => {
    const html = toPrintHTML(spec(), { locale: 'en-US', title: 'Fruit <1>' });
    expect(html).toContain('<thead>');
    expect(html).toContain('Fruit &lt;1&gt;');
    expect(html).toContain('<td style="text-align:right">22</td>');
    expect(html).toContain('Total');
  });
});
