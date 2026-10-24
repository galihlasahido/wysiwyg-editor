import { describe, expect, it } from 'vitest';
import { Workbook, parseDelimited, seriesFor, type Range } from '../src/spreadsheet-model';
import { mapFormulaRefs, shiftFormula, createEvaluator } from '../src/grid-formulas';

const r = (r0: number, c0: number, r1 = r0, c1 = c0): Range => ({ r0, c0, r1, c1 });
const make = (cells: Record<string, string> = {}) => {
  const wb = new Workbook({ sheets: [{ name: 'S', rows: 50, cols: 10, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { v }])) }] });
  return wb;
};
const val = (wb: Workbook, ref: string) => { const m = /^([A-Z]+)(\d+)$/.exec(ref)!; const c = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1; return wb.value(wb.sheet, Number(m[2]) - 1, c); };

describe('formula references', () => {
  it('shifts relative references and keeps $ ones', () => {
    expect(shiftFormula('=A1+$B$2+C$3+$D4', 1, 1)).toBe('=B2+$B$2+D$3+$D5');
    expect(shiftFormula('=SUM(A1:B2)', 0, 2)).toBe('=SUM(A3:B4)');
    expect(shiftFormula('=LOG10(A1)&"B2"', 1, 0)).toBe('=LOG10(B1)&"B2"');
  });
  it('a reference that moves off the sheet becomes #REF!', () => {
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
  });
  it('maps ranges as one piece when asked', () => {
    expect(mapFormulaRefs('=SUM(A1:A5)+A9', (c, rw) => ({ col: c, row: rw + 1 }), (a, b) => [{ col: a.col, row: a.row }, { col: b.col, row: b.row + 10 }])).toBe('=SUM(A1:A15)+A10');
  });
  it('$A$1 and ranges evaluate', () => {
    const ev = createEvaluator((c, rw) => ({ '0,0': '5', '0,1': '=$A$1*2', '0,2': '=SUM(A1:A2)' } as Record<string, string>)[`${c},${rw}`] ?? '', [3, 3]);
    expect(ev.value(0, 1)).toBe(10);
    expect(ev.value(0, 2)).toBe(15);
  });
  it('has the extra functions', () => {
    const ev = createEvaluator((c, rw) => ({ '0,0': '3', '1,0': '4', '2,0': '=MEDIAN(A1:B1)', '3,0': '=COUNTIF(A1:B1,">3")', '4,0': '=UPPER("ab")&LEN("abc")', '5,0': '=SUMIF(A1:B1,">3")', '6,0': '=AND(1,0)', '7,0': '=MOD(-1,3)' } as Record<string, string>)[`${c},${rw}`] ?? '', [8, 1]);
    expect(ev.value(2, 0)).toBe(3.5);
    expect(ev.value(3, 0)).toBe(1);
    expect(ev.value(4, 0)).toBe('AB3');
    expect(ev.value(5, 0)).toBe(4);
    expect(ev.value(6, 0)).toBe(false);
    expect(ev.value(7, 0)).toBe(2);
  });
});

describe('workbook cells', () => {
  it('stores typed text and computes formulas', () => {
    const wb = make();
    wb.input(wb.sheet, 0, 0, '2'); wb.input(wb.sheet, 1, 0, '3'); wb.input(wb.sheet, 2, 0, '=A1*A2');
    expect(val(wb, 'A3')).toBe(6);
    wb.input(wb.sheet, 0, 0, '10');
    expect(val(wb, 'A3')).toBe(30);
  });
  it('reads percent and currency typed by a person', () => {
    const wb = make();
    wb.input(wb.sheet, 0, 0, '12%'); wb.input(wb.sheet, 1, 0, '$1,200.50'); wb.input(wb.sheet, 2, 0, '1,000');
    expect(wb.raw(wb.sheet, 0, 0)).toBe('0.12');
    expect(wb.style(wb.sheet, 0, 0).fmt).toBe('percent');
    expect(wb.display(wb.sheet, 0, 0).text).toBe('12%');
    expect(wb.raw(wb.sheet, 1, 0)).toBe('1200.50');
    expect(wb.style(wb.sheet, 1, 0).fmt).toBe('currency');
    expect(wb.display(wb.sheet, 1, 0).text).toContain('1,200.50');
    expect(wb.raw(wb.sheet, 2, 0)).toBe('1000');
  });
  it('shows errors as errors and text that looks like one as text', () => {
    const wb = make({ A1: '=1/0', A2: '#tag', A3: '=A1+1' });
    expect(wb.display(wb.sheet, 0, 0)).toMatchObject({ text: '#DIV/0!', error: true });
    expect(wb.display(wb.sheet, 1, 0)).toMatchObject({ text: '#tag', error: false });
    expect(wb.display(wb.sheet, 2, 0).error).toBe(true);
  });
  it('a formula cycle is an error, not a hang', () => {
    const wb = make({ A1: '=B1', B1: '=A1' });
    expect(wb.display(wb.sheet, 0, 0).text).toBe('#CYCLE!');
  });
  it('undo and redo restore text and style, as one step per action', () => {
    const wb = make();
    wb.input(wb.sheet, 0, 0, 'a');
    wb.patchStyle(wb.sheet, r(0, 0, 1, 1), { b: 1 });
    expect(wb.style(wb.sheet, 1, 1).b).toBe(1);
    wb.undo();
    expect(wb.style(wb.sheet, 1, 1).b).toBeUndefined();
    expect(wb.raw(wb.sheet, 0, 0)).toBe('a');
    wb.undo();
    expect(wb.raw(wb.sheet, 0, 0)).toBe('');
    wb.redo(); wb.redo();
    expect(wb.style(wb.sheet, 0, 0).b).toBe(1);
    expect(wb.canRedo).toBe(false);
  });
  it('transact groups several edits into one undo step', () => {
    const wb = make();
    wb.transact('x', () => { wb.input(wb.sheet, 0, 0, '1'); wb.input(wb.sheet, 1, 0, '2'); });
    wb.undo();
    expect(wb.raw(wb.sheet, 0, 0)).toBe('');
    expect(wb.raw(wb.sheet, 1, 0)).toBe('');
  });
  it('clean-up: colours and fields from outside are checked', () => {
    const wb = new Workbook({ sheets: [{ name: 'S', rows: 5, cols: 5, cells: { A1: { v: 'x', s: { color: 'url(javascript:1)', bg: '#fff', fmt: 'evil' as never, size: 5000, font: 'a;b' } } } }] });
    expect(wb.style(wb.sheet, 0, 0)).toEqual({ bg: '#fff' });
  });
  it('grows when something is typed beyond the sheet', () => {
    const wb = make();
    wb.input(wb.sheet, 70, 12, 'x');
    expect(wb.sheet.rows).toBeGreaterThanOrEqual(71);
    expect(wb.sheet.cols).toBeGreaterThanOrEqual(13);
    wb.undo();
    expect(wb.sheet.rows).toBe(50);
  });
});

describe('rows and columns', () => {
  it('inserting a row moves cells and formulas follow', () => {
    const wb = make({ A1: '1', A2: '2', A3: '=SUM(A1:A2)', B1: '=A3' });
    wb.insertRows(wb.sheet, 1);
    expect(wb.raw(wb.sheet, 3, 0)).toBe('=SUM(A1:A3)');
    expect(wb.raw(wb.sheet, 0, 1)).toBe('=A4');
    expect(val(wb, 'A4')).toBe(3);
    wb.undo();
    expect(wb.raw(wb.sheet, 2, 0)).toBe('=SUM(A1:A2)');
  });
  it('deleting a row shrinks ranges and breaks single references', () => {
    const wb = make({ A1: '1', A2: '2', A3: '4', A4: '=SUM(A1:A3)', B1: '=A2', B2: '=A3' });
    wb.deleteRows(wb.sheet, 2);               // row 3
    expect(wb.raw(wb.sheet, 2, 0)).toBe('=SUM(A1:A2)');
    expect(val(wb, 'A3')).toBe(3);
    expect(wb.raw(wb.sheet, 1, 1)).toBe('=#REF!');
    expect(wb.raw(wb.sheet, 0, 1)).toBe('=A2');
  });
  it('inserting and deleting columns moves the formulas too', () => {
    const wb = make({ A1: '1', B1: '2', C1: '=A1+B1' });
    wb.insertCols(wb.sheet, 0);
    expect(wb.raw(wb.sheet, 0, 3)).toBe('=B1+C1');
    wb.deleteCols(wb.sheet, 0);
    expect(wb.raw(wb.sheet, 0, 2)).toBe('=A1+B1');
    expect(val(wb, 'C1')).toBe(3);
  });
  it('column widths follow their columns', () => {
    const wb = make({ A1: 'x' });
    wb.setColWidth(wb.sheet, 2, 200);
    wb.insertCols(wb.sheet, 0);
    expect(wb.sheet.colWidth(3)).toBe(200);
    expect(wb.sheet.colWidth(2)).toBe(100);
  });
});

describe('sort, fill, filter', () => {
  it('sorts numbers before text, blanks last, keeping a header', () => {
    const wb = make({ A1: 'Name', B1: 'N', A2: 'b', B2: '3', A3: 'a', B3: '10', A4: 'c', B4: '2', A5: 'z' });
    wb.sortRange(wb.sheet, r(0, 0, 4, 1), 1, true, true);
    expect([1, 2, 3, 4].map((i) => wb.raw(wb.sheet, i, 0))).toEqual(['c', 'b', 'a', 'z']);
    expect(wb.raw(wb.sheet, 0, 0)).toBe('Name');
    wb.sortRange(wb.sheet, r(0, 0, 4, 1), 1, false, true);
    expect([1, 2, 3].map((i) => wb.raw(wb.sheet, i, 1))).toEqual(['10', '3', '2']);
    expect(wb.raw(wb.sheet, 4, 0)).toBe('z');       // blank stays last
  });
  it('sorting moves formulas with their rows', () => {
    const wb = make({ A1: '3', B1: '=A1*2', A2: '1', B2: '=A2*2' });
    wb.sortRange(wb.sheet, r(0, 0, 1, 1), 0, true);
    expect(wb.raw(wb.sheet, 0, 1)).toBe('=A1*2');
    expect(val(wb, 'B1')).toBe(2);
    expect(val(wb, 'B2')).toBe(6);
  });
  it('fill: series, days, text with a number, copies and formulas', () => {
    const wb = make({ A1: '1', A2: '2', B1: 'Mon', C1: 'Item 1', D1: '=A1+1', E1: '7' });
    wb.fill(wb.sheet, r(0, 0, 1, 0), r(2, 0, 4, 0));
    expect([2, 3, 4].map((i) => wb.raw(wb.sheet, i, 0))).toEqual(['3', '4', '5']);
    wb.fill(wb.sheet, r(0, 1), r(1, 1, 2, 1));
    expect([1, 2].map((i) => wb.raw(wb.sheet, i, 1))).toEqual(['Tue', 'Wed']);
    wb.fill(wb.sheet, r(0, 2), r(1, 2, 2, 2));
    expect([1, 2].map((i) => wb.raw(wb.sheet, i, 2))).toEqual(['Item 2', 'Item 3']);
    wb.fill(wb.sheet, r(0, 3), r(1, 3, 2, 3));
    expect(wb.raw(wb.sheet, 2, 3)).toBe('=A3+1');
    wb.fill(wb.sheet, r(0, 4), r(1, 4, 2, 4));
    expect(wb.raw(wb.sheet, 2, 4)).toBe('7');
  });
  it('fill to the right and upwards', () => {
    const wb = make({ C3: '10', C4: '20' });
    wb.fill(wb.sheet, r(2, 2, 3, 2), r(0, 2, 1, 2));
    expect([0, 1].map((i) => wb.raw(wb.sheet, i, 2))).toEqual(['-10', '0']);
    const w2 = make({ A1: '1', B1: '2' });
    w2.fill(w2.sheet, r(0, 0, 0, 1), r(0, 2, 0, 4));
    expect([2, 3, 4].map((i) => w2.raw(w2.sheet, 0, i))).toEqual(['3', '4', '5']);
  });
  it('seriesFor', () => {
    expect(seriesFor(['1', '3'])!(2)).toBe('5');
    expect(seriesFor(['Jan'])!(11)).toBe('Dec');
    expect(seriesFor(['jan'])!(1)).toBe('feb');
    expect(seriesFor(['5'])).toBeNull();
    expect(seriesFor(['a', 'b'])).toBeNull();
  });
  it('a filter hides rows by value and shows them again', () => {
    const wb = make({ A1: 'Kind', A2: 'x', A3: 'y', A4: 'x', A5: 'z' });
    wb.setFilter(wb.sheet, r(0, 0, 4, 0));
    expect(wb.distinctValues(wb.sheet, 0, 1, 4)).toEqual(['x', 'y', 'z']);
    wb.setFilterValues(wb.sheet, 0, ['x']);
    expect([...wb.sheet.hidden].sort()).toEqual([1, 3]);
    expect(wb.sheet.rowHeight(1)).toBe(0);
    wb.setFilterValues(wb.sheet, 0, []);
    expect(wb.sheet.hidden.size).toBe(0);
    wb.setFilterValues(wb.sheet, 0, ['y']);
    wb.setFilter(wb.sheet, null);
    expect(wb.sheet.hidden.size).toBe(0);
    wb.undo();
    expect(wb.sheet.filter).not.toBeNull();
  });
});

describe('sheets, text and data', () => {
  it('adds, renames, duplicates and deletes sheets, with undo', () => {
    const wb = make({ A1: '1' });
    wb.addSheet();
    expect(wb.sheets.map((s) => s.name)).toEqual(['S', 'Sheet2']);
    expect(wb.renameSheet(wb.sheet, 'S')).toBe(false);
    expect(wb.renameSheet(wb.sheet, 'Two')).toBe(true);
    wb.duplicateSheet(wb.sheets[0]);
    expect(wb.sheets.map((s) => s.name)).toEqual(['S', 'S (2)', 'Two']);
    expect(wb.raw(wb.sheet, 0, 0)).toBe('1');
    wb.deleteSheet(wb.sheets[2]);
    expect(wb.sheets).toHaveLength(2);
    wb.undo();
    expect(wb.sheets).toHaveLength(3);
    const only = make();
    expect(only.deleteSheet(only.sheet)).toBe(false);
  });
  it('round-trips through JSON, keeping widths, freeze and styles', () => {
    const wb = make({ A1: 'x' });
    wb.patchStyle(wb.sheet, r(0, 0), { b: 1, color: '#ff0000' });
    wb.setColWidth(wb.sheet, 1, 150); wb.setFreeze(wb.sheet, 1, 1);
    const copy = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
    expect(copy.style(copy.sheet, 0, 0)).toEqual({ b: 1, color: '#ff0000' });
    expect(copy.sheet.colWidth(1)).toBe(150);
    expect(copy.sheet.freezeRows).toBe(1);
  });
  it('parses CSV with quotes, line breaks and semicolons', () => {
    expect(parseDelimited('a,"b,c","d ""q"""\n1,2,3\n')).toEqual([['a', 'b,c', 'd "q"'], ['1', '2', '3']]);
    expect(parseDelimited('"x\ny",z\r\n1,2')).toEqual([['x\ny', 'z'], ['1', '2']]);
    const wb = make();
    wb.importCSV('n;v\na;1,5\nb;2', 'Data');
    expect(wb.sheet.name).toBe('Data');
    expect(wb.raw(wb.sheet, 1, 0)).toBe('a');
  });
  it('writes CSV with quoting, values or formulas', () => {
    const wb = make({ A1: 'a,b', B1: '=1+1', A2: 'say "hi"' });
    expect(wb.toCSV(wb.sheet)).toBe('"a,b",2\n"say ""hi""",');
    expect(wb.toCSV(wb.sheet, undefined, { values: false })).toContain('=1+1');
    expect(wb.toTSV(wb.sheet, r(0, 0, 0, 1))).toBe('a,b\t2');
  });
  it('copy and paste cells move formulas and keep formats; cut keeps the source until pasted', () => {
    const wb = make({ A1: '1', B1: '=A1*2' });
    wb.patchStyle(wb.sheet, r(0, 1), { b: 1 });
    const cells = wb.copyCells(wb.sheet, r(0, 0, 0, 1));
    wb.pasteCells(wb.sheet, 1, 0, cells, { r: 0, c: 0 });
    expect(wb.raw(wb.sheet, 1, 1)).toBe('=A2*2');
    expect(wb.style(wb.sheet, 1, 1).b).toBe(1);
    wb.pasteCells(wb.sheet, 2, 0, cells, { r: 0, c: 0 }, 'values');
    expect(wb.style(wb.sheet, 2, 1).b).toBeUndefined();
  });
  it('Ctrl+arrow jumps over blocks', () => {
    const wb = make({ A1: 'x', A2: 'x', A3: 'x', A6: 'y' });
    expect(wb.jump(wb.sheet, 0, 0, 1, 0)).toEqual({ r: 2, c: 0 });
    expect(wb.jump(wb.sheet, 2, 0, 1, 0)).toEqual({ r: 5, c: 0 });
    expect(wb.jump(wb.sheet, 5, 0, 1, 0)).toEqual({ r: 49, c: 0 });
  });
  it('summary of a range', () => {
    const wb = make({ A1: '1', A2: '2', A3: 'x', A4: '=A1+A2' });
    expect(wb.summary(wb.sheet, r(0, 0, 3, 0))).toMatchObject({ count: 4, numbers: 3, sum: 6, min: 1, max: 3 });
  });
});
