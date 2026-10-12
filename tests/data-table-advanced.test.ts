import { describe, expect, it } from 'vitest';
import { checkFormula, runFormula, type FormulaValue } from '../src/data-table-formula';
import { cleanSpec, queryRows, ruleLooks, toCSV, toPrintHTML, toXlsx, withFormulas, aggregate, type DataTableSpec } from '../src/data-table';

const calc = (src: string, vars: Record<string, FormulaValue> = {}) => runFormula(src, (n) => (Object.hasOwn(vars, n.toLowerCase()) ? vars[n.toLowerCase()] : undefined));

describe('formulas', () => {
  it('calculate with the usual precedence', () => {
    expect(calc('1 + 2 * 3')).toBe(7);
    expect(calc('(1 + 2) * 3')).toBe(9);
    expect(calc('2 ^ 3 ^ 2')).toBe(512);
    expect(calc('-2 ^ 2')).toBe(4); // unary minus binds tighter, as in a spreadsheet
    expect(calc('10 % 4 + 7 / 2')).toBe(5.5);
  });
  it('read columns by [Title], {key} or a plain name', () => {
    const v = { price: 4.5, qty: 3, 'unit price': 2 };
    expect(calc('[Price] * [Qty]', v)).toBe(13.5);
    expect(calc('{qty} + price', v)).toBe(7.5);
    expect(calc('[Unit price] * 2', v)).toBe(4);
  });
  it('compare, join and test', () => {
    expect(calc('[a] > 5', { a: 7 })).toBe(true);
    expect(calc('"x" & [a] & 1', { a: 'y' })).toBe('xy1');
    expect(calc('IF([a] < 5, "low", "ok")', { a: 3 })).toBe('low');
    expect(calc('IF(FALSE, "never")')).toBe('');
    expect(calc('AND(1 < 2, 2 < 3) = TRUE')).toBe(true);
    expect(calc('"Apple" = "apple"')).toBe(true);
  });
  it('have text, number and date functions', () => {
    expect(calc('ROUND(2.345, 2)')).toBe(2.35);
    expect(calc('MAX([a], [b], 3)', { a: 1, b: 9 })).toBe(9);
    expect(calc('SUM([a], [b])', { a: 1, b: null })).toBe(1);
    expect(calc('UPPER(LEFT("hello", 2))')).toBe('HE');
    expect(calc('DAYS("2026-03-10", "2026-03-01")')).toBe(9);
    expect(calc('MONTH("2026-03-10")')).toBe(3);
    expect(calc('MOD(-1, 3)')).toBe(2);
  });
  it('report errors as codes instead of throwing', () => {
    expect(calc('1 / 0')).toBe('#DIV/0!');
    expect(calc('"a" * 2')).toBe('#VALUE!');
    expect(calc('[nope] + 1')).toBe('#REF!');
    expect(calc('FOO(1)')).toBe('#NAME?');
    expect(calc('1 +')).toBe('#SYNTAX!');
    expect(calc('"open')).toBe('#SYNTAX!');
    expect(calc('1 2')).toBe('#SYNTAX!');
  });
  it('are bounded: long, deeply nested or huge formulas are refused, not run', () => {
    expect(calc('1+'.repeat(300) + '1')).toBe('#SYNTAX!');
    expect(calc('('.repeat(100) + '1' + ')'.repeat(100))).toBe('#SYNTAX!');
    expect(calc('9 ^ 9 ^ 9 ^ 9')).toBe('#VALUE!');
    expect(String(calc('CONCAT(' + '"' + 'x'.repeat(400) + '",'.repeat(1) + '"y")')).length).toBeLessThanOrEqual(5000);
  });
  it('cannot reach anything but its own row', () => {
    for (const evil of ['constructor', 'window.alert(1)', 'this', '__proto__']) expect(calc(evil)).toMatch(/^#/);
  });
  it('explain a mistake before it is saved', () => {
    const names = ['Price', 'Qty'];
    expect(checkFormula('[Price] * [Qty]', names)).toBeNull();
    expect(checkFormula('[Price] *', names)).toMatch(/mistake/);
    expect(checkFormula('[Cost] * 2', names)).toMatch(/no column called “Cost”/);
    expect(checkFormula('FOO([Price])', names)).toMatch(/not a known function/);
  });
});

const sales = (): DataTableSpec => cleanSpec({
  columns: [
    { key: 'item', title: 'Item', type: 'text' },
    { key: 'price', title: 'Price', type: 'currency', currency: 'USD' },
    { key: 'qty', title: 'Qty', type: 'number' },
    { key: 'total', title: 'Total', type: 'currency', currency: 'USD', formula: '[Price] * [Qty]', total: 'sum' },
    { key: 'flag', title: 'Flag', type: 'text', formula: 'IF([Total] > 20, "big", "small")' },
  ],
  rows: [['a', 2, 3, null, null], ['b', 10, 5, null, null], ['c', 1, null, null, null]],
  rules: [{ column: 'total', test: '>20', look: 'green' }, { column: '', test: 'empty', look: 'gray' }, { column: 'item', test: 'c', look: 'red', row: true }],
  views: [{ name: 'Big', search: 'x', filters: { total: '>10', bogus: 'y' }, sort: [{ key: 'total', dir: 'desc' }, { key: 'zzz', dir: 'asc' }], groupBy: ['flag'], hidden: ['qty', 'nope'], pageSize: 25 }, { name: '  ' }],
})!;

describe('formula columns in a table', () => {
  it('are filled in, in a column that refers to another formula column too', () => {
    const s = withFormulas(sales());
    expect(s.rows.map((r) => r[3])).toEqual([6, 50, 0]);
    expect(s.rows.map((r) => r[4])).toEqual(['small', 'big', 'small']);
  });
  it('are remembered, and a table without formulas is returned as it is', () => {
    const s = sales();
    expect(withFormulas(s).rows).toBe(withFormulas(s).rows);
    const plain = cleanSpec({ columns: [{ title: 'A' }], rows: [['x']] })!;
    expect(withFormulas(plain)).toBe(plain);
  });
  it('show a cycle instead of hanging', () => {
    const s = cleanSpec({ columns: [{ key: 'a', title: 'A', type: 'text', formula: '[B]' }, { key: 'b', title: 'B', type: 'text', formula: '[A]' }], rows: [['', '']] })!;
    expect(withFormulas(s).rows[0]).toEqual(['#CYCLE!', '#CYCLE!']);
  });
  it('can be searched, filtered, sorted and totalled like any column', () => {
    const s = sales();
    expect(queryRows(s, { search: 'big', filters: {}, sort: [] })).toEqual([1]);
    expect(queryRows(s, { search: '', filters: { total: '>5' }, sort: [] })).toEqual([0, 1]);
    expect(queryRows(s, { search: '', filters: {}, sort: [{ key: 'total', dir: 'desc' }] })).toEqual([1, 0, 2]);
    const e = withFormulas(s);
    expect(aggregate(e.columns[3], 'sum', e.rows, [0, 1, 2], 3)).toBe(56);
  });
  it('are written to files as their results', () => {
    expect(toCSV(sales(), { bom: false })).toContain('b,10,5,50,big');
    expect(toPrintHTML(sales(), { locale: 'en-US' })).toContain('$50.00');
  });
  it('are kept off boolean and select columns', () => {
    const s = cleanSpec({ columns: [{ title: 'B', type: 'boolean', formula: '1' }, { title: 'S', type: 'select', formula: '1' }] })!;
    expect(s.columns.every((c) => c.formula === undefined)).toBe(true);
  });
});

describe('highlight rules', () => {
  it('colour a cell, or a whole row, by the first rule that matches', () => {
    const s = withFormulas(sales());
    const look = ruleLooks(s, 'en-US');
    expect(look(s.rows[1]).cells[3]).toBe('green');
    expect(look(s.rows[0]).cells[3]).toBeNull();
    expect(look(s.rows[2]).row).toBe('red');
    expect(look(s.rows[2]).cells[2]).toBe('gray'); // the empty quantity
  });
  it('are cleaned: unknown columns and empty conditions are dropped, looks are limited', () => {
    const s = cleanSpec({ columns: [{ key: 'a', title: 'A' }], rows: [], rules: [{ column: 'zz', test: 'x' }, { column: 'a', test: '' }, { column: 'a', test: 'x', look: 'neon', row: 1 }, { test: 'y', look: 'blue' }] })!;
    expect(s.rules).toEqual([{ column: 'a', test: 'x', look: 'amber', row: false }, { column: '', test: 'y', look: 'blue', row: false }]);
  });
  it('colour the cells in .xlsx and PDF files', () => {
    const files = new TextDecoder().decode(toXlsx(sales()));
    expect(files).toContain('FFD4EDDA'); // the green fill is defined
    expect(toPrintHTML(sales(), { locale: 'en-US' })).toContain('background:#D4EDDA');
    expect(toPrintHTML(sales(), { formatting: false })).not.toContain('background:#D4EDDA');
  });
});

describe('saved views', () => {
  it('keep only what refers to real columns', () => {
    const v = sales().views;
    expect(v.length).toBe(1);
    expect(v[0]).toEqual({ name: 'Big', search: 'x', filters: { total: '>10' }, sort: [{ key: 'total', dir: 'desc' }], groupBy: ['flag'], hidden: ['qty'], pageSize: 25 });
  });
});
