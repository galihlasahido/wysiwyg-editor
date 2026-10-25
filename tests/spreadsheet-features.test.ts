import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/spreadsheet-model';
import { adjustRange, chartSpecFrom, cleanChartDef, cleanRule } from '../src/spreadsheet-features';

const book = (cells: Record<string, string> = {}) => {
  const wb = new Workbook({ sheets: [{ name: 'S', rows: 50, cols: 12, cells: Object.fromEntries(Object.entries(cells).map(([k, v]) => [k, { v }])) }] });
  return { wb, s: wb.sheet };
};
const R = (r0: number, c0: number, r1: number, c1: number) => ({ r0, c0, r1, c1 });

describe('merged cells', () => {
  it('keeps the top left value, empties the rest and undoes', () => {
    const { wb, s } = book({ A1: 'keep', B1: 'gone', A2: 'gone too' });
    expect(wb.mergeCells(s, R(0, 0, 1, 1))).toBe(true);
    expect(s.merges).toEqual([R(0, 0, 1, 1)]);
    expect(wb.raw(s, 0, 0)).toBe('keep');
    expect(wb.raw(s, 0, 1)).toBe('');
    expect(s.mergeAt(1, 1)).toEqual(R(0, 0, 1, 1));
    wb.undo();
    expect(s.merges).toEqual([]);
    expect(wb.raw(s, 0, 1)).toBe('gone');
    wb.redo();
    expect(s.merges).toHaveLength(1);
  });
  it('a selection grows to take in the merged cells it touches', () => {
    const { wb, s } = book();
    wb.mergeCells(s, R(1, 1, 2, 2));
    expect(wb.expandToMerges(s, R(0, 0, 1, 1))).toEqual(R(0, 0, 2, 2));
    expect(wb.expandToMerges(s, R(5, 5, 6, 6))).toEqual(R(5, 5, 6, 6));
  });
  it('merging over an existing merge replaces it; one cell is not a merge; unmerge splits', () => {
    const { wb, s } = book();
    wb.mergeCells(s, R(0, 0, 0, 1));
    wb.mergeCells(s, R(0, 1, 1, 2));
    expect(s.merges).toEqual([R(0, 0, 1, 2)]);
    expect(wb.mergeCells(s, R(4, 4, 4, 4))).toBe(false);
    expect(wb.unmergeCells(s, R(0, 0, 0, 0))).toBe(true);
    expect(s.merges).toEqual([]);
  });
  it('follow inserted and deleted rows and columns', () => {
    const { wb, s } = book();
    wb.mergeCells(s, R(2, 2, 3, 3));
    wb.insertRows(s, 0, 2);
    expect(s.merges).toEqual([R(4, 2, 5, 3)]);
    wb.insertCols(s, 3, 1);                       // inside the merge: it grows
    expect(s.merges).toEqual([R(4, 2, 5, 4)]);
    wb.deleteRows(s, 4, 1);
    expect(s.merges).toEqual([R(4, 2, 4, 4)]);
    wb.deleteRows(s, 4, 1);                        // nothing is left of it
    expect(s.merges).toEqual([]);
  });
  it('are saved, and hostile ones are dropped', () => {
    const { wb, s } = book();
    wb.mergeCells(s, R(0, 0, 1, 1));
    const back = new Workbook(JSON.parse(JSON.stringify(wb.toJSON())));
    expect(back.sheet.merges).toEqual([R(0, 0, 1, 1)]);
    const bad = new Workbook({ sheets: [{ name: 'S', rows: 10, cols: 10, cells: {}, merges: ['A1:B2', 'B2:C3', 'A1', 'Z99:ZZ999', 'not a range', 'C3:D4'] as never }] });
    expect(bad.sheet.merges).toEqual([R(0, 0, 1, 1), R(2, 2, 3, 3)]);
    const many = new Workbook({ sheets: [{ name: 'S', rows: 5000, cols: 4, cells: {}, merges: Array.from({ length: 5000 }, (_, i) => `A${i + 1}:B${i + 1}`) }] });
    expect(many.sheet.merges.length).toBeLessThanOrEqual(2000);
  });
});

describe('conditional formats', () => {
  const data = { A1: '5', A2: '50', A3: '500', A4: '', A5: 'apple', A6: '50', B1: 'x', B2: 'yy', B3: 'x' };
  it('compares values, text and blanks', () => {
    const { wb, s } = book(data);
    wb.addRule(s, { type: 'cell', op: '>', a: '40', range: R(0, 0, 5, 0), style: { bg: '#ff0000' } });
    wb.addRule(s, { type: 'text', op: 'begins', text: 'AP', range: R(0, 0, 5, 0), style: { color: '#00ff00' } });
    wb.addRule(s, { type: 'blank', range: R(0, 0, 5, 0), style: { bg: '#cccccc' } });
    expect(wb.condFor(s, 0, 0)).toBeNull();
    expect(wb.condFor(s, 1, 0)?.style.bg).toBe('#ff0000');
    expect(wb.condFor(s, 4, 0)?.style.color).toBe('#00ff00');
    expect(wb.condFor(s, 3, 0)?.style.bg).toBe('#cccccc');
  });
  it('finds duplicates, top values and averages', () => {
    const { wb, s } = book(data);
    wb.addRule(s, { type: 'duplicate', range: R(0, 0, 5, 0), style: { bg: '#fecaca' } });
    expect(wb.condFor(s, 1, 0)?.style.bg).toBe('#fecaca');
    expect(wb.condFor(s, 5, 0)?.style.bg).toBe('#fecaca');
    expect(wb.condFor(s, 2, 0)).toBeNull();
    wb.addRule(s, { type: 'rank', n: 1, range: R(0, 0, 5, 0), style: { b: 1 } });
    expect(wb.condFor(s, 2, 0)?.style.b).toBe(1);
    expect(wb.condFor(s, 1, 0)?.style.b).toBeUndefined();
    wb.addRule(s, { type: 'average', above: 0, range: R(0, 0, 5, 0), style: { color: '#0000ff' } });
    expect(wb.condFor(s, 0, 0)?.style.color).toBe('#0000ff');
  });
  it('colour scales and data bars', () => {
    const { wb, s } = book({ A1: '0', A2: '5', A3: '10' });
    wb.addRule(s, { type: 'scale', colors: ['#000000', '#ffffff'], range: R(0, 0, 2, 0) });
    expect(wb.condFor(s, 0, 0)?.style.bg).toBe('#000000');
    expect(wb.condFor(s, 1, 0)?.style.bg).toBe('#808080');
    expect(wb.condFor(s, 2, 0)?.style.bg).toBe('#ffffff');
    wb.addRule(s, { type: 'bar', color: '#123456', range: R(0, 0, 2, 0) });
    expect(wb.condFor(s, 1, 0)?.bar?.pct).toBeCloseTo(0.5);
  });
  it('a formula rule is written for the top left cell and moves with each cell', () => {
    const { wb, s } = book({ A1: '1', B1: '5', A2: '9', B2: '5' });
    wb.addRule(s, { type: 'formula', formula: '=$A1>$B1', range: R(0, 0, 1, 1), style: { bg: '#ffff00' } });
    expect(wb.condFor(s, 0, 0)).toBeNull();
    expect(wb.condFor(s, 1, 1)?.style.bg).toBe('#ffff00');
    expect(wb.condFor(s, 1, 0)?.style.bg).toBe('#ffff00');
  });
  it('updates when a value changes, follows inserted rows and can be cleared', () => {
    const { wb, s } = book({ A1: '1', A2: '2' });
    wb.addRule(s, { type: 'cell', op: '>', a: '10', range: R(0, 0, 1, 0), style: { bg: '#ff0000' } });
    expect(wb.condFor(s, 0, 0)).toBeNull();
    wb.input(s, 0, 0, '99');
    expect(wb.condFor(s, 0, 0)?.style.bg).toBe('#ff0000');
    wb.insertRows(s, 0, 1);
    expect(s.cf[0].range).toEqual(R(1, 0, 2, 0));
    wb.undo();
    expect(s.cf[0].range).toEqual(R(0, 0, 1, 0));
    wb.clearRules(s);
    expect(s.cf).toEqual([]);
    wb.undo();
    expect(s.cf).toHaveLength(1);
  });
  it('refuses rules with bad colours, ranges or formulas', () => {
    expect(cleanRule({ type: 'cell', op: '>', a: '1', range: R(0, 0, 1, 1), style: { bg: 'url(javascript:1)', color: 'red; x:y' } }, 10, 10)).toEqual({ type: 'cell', op: '>', a: '1', range: R(0, 0, 1, 1), style: {} });
    expect(cleanRule({ type: 'cell', op: '>', a: '1', range: R(0, 0, 99, 1), style: {} }, 10, 10)?.range).toEqual(R(0, 0, 9, 1));   // cut to the sheet
    expect(cleanRule({ type: 'cell', op: '>', a: '1', range: { r0: 'x', c0: 0, r1: 1, c1: 1 }, style: {} }, 10, 10)).toBeNull();
    expect(cleanRule({ type: 'scale', colors: ['#fff'], range: R(0, 0, 1, 1) }, 10, 10)).toBeNull();
    expect(cleanRule({ type: 'eval', range: R(0, 0, 1, 1) }, 10, 10)).toBeNull();
    expect(cleanRule({ type: 'formula', formula: '', range: R(0, 0, 1, 1), style: {} }, 10, 10)).toBeNull();
    const { wb, s } = book();
    for (let i = 0; i < 150; i++) wb.addRule(s, { type: 'blank', range: R(0, 0, 1, 1), style: {} });
    expect(s.cf.length).toBe(100);
  });
});

describe('charts', () => {
  const data = { A1: 'Month', B1: 'Rent', C1: 'Food', A2: 'Jan', B2: '10', C2: '4', A3: 'Feb', B3: '12', C3: '5' };
  it('read their cells as text, labels and series', () => {
    const { wb, s } = book(data);
    const c = wb.addChart(s, { range: R(0, 0, 2, 2), type: 'bar', title: 'T', x: 10, y: 20 })!;
    const spec = wb.chartSpec(s, c)!;
    expect(spec.labels).toEqual(['Jan', 'Feb']);
    expect(spec.series.map((x) => x.name)).toEqual(['Rent', 'Food']);
    expect(spec.series[0].values).toEqual([10, 12]);
    wb.input(s, 1, 1, '99');
    expect(wb.chartSpec(s, c)!.series[0].values).toEqual([99, 12]);
  });
  it('can be moved, resized, retitled, deleted and undone', () => {
    const { wb, s } = book(data);
    const c = wb.addChart(s, { range: R(0, 0, 2, 2), x: 10, y: 20 })!;
    wb.updateChart(s, c.id, { x: 50, y: 60 });
    wb.updateChart(s, c.id, { w: 10, h: 10 });           // too small: kept at the minimum
    expect([s.charts[0].x, s.charts[0].y, s.charts[0].w, s.charts[0].h]).toEqual([50, 60, 160, 120]);
    wb.updateChart(s, c.id, { type: 'pie', title: 'Pie' });
    expect(s.charts[0].type).toBe('pie');
    wb.removeChart(s, c.id);
    expect(s.charts).toEqual([]);
    wb.undo();
    expect(s.charts).toHaveLength(1);
  });
  it('their data follows inserted rows, and a chart whose data is deleted goes', () => {
    const { wb, s } = book(data);
    wb.addChart(s, { range: R(0, 0, 2, 2), x: 0, y: 0 });
    wb.insertRows(s, 1, 1);
    expect(s.charts[0].range).toEqual(R(0, 0, 3, 2));
    wb.deleteCols(s, 0, 3);
    expect(s.charts).toEqual([]);
  });
  it('one column of numbers is one series; no numbers is no chart; hostile definitions are cleaned', () => {
    expect(chartSpecFrom([['1'], ['2'], ['3']], 'line', '')!.series[0].values).toEqual([1, 2, 3]);
    expect(chartSpecFrom([['a', 'b'], ['c', 'd']], 'bar', '')).toBeNull();
    const c = cleanChartDef({ id: '../x', type: 'scatter-plot', range: R(0, 0, 1, 1), title: 'a\u0000b'.repeat(100), x: -5, y: 1e12, w: 1e9, h: NaN }, 10, 10)!;
    expect(c.id).toMatch(/^ch/);
    expect(c.type).toBe('bar');
    expect(c.title.length).toBeLessThanOrEqual(120);
    expect(c.title).not.toContain('\u0000');
    expect([c.x, c.w, c.h]).toEqual([0, 2000, 300]);
    expect(c.y).toBe(2_000_000);
    expect(cleanChartDef({ range: R(0, 0, 99, 1) }, 10, 10)?.range).toEqual(R(0, 0, 9, 1));
    expect(cleanChartDef({ range: 'A1:B2' }, 10, 10)).toBeNull();
    const many = new Workbook({ sheets: [{ name: 'S', rows: 10, cols: 10, cells: {}, charts: Array.from({ length: 200 }, (_, i) => ({ id: `c${i}`, range: R(0, 0, 1, 1), type: 'bar', title: '', x: 0, y: 0, w: 200, h: 200 })) as never }] });
    expect(many.sheet.charts.length).toBeLessThanOrEqual(50);
  });
});

describe('ranges that follow rows and columns', () => {
  it('insert and delete', () => {
    expect(adjustRange(R(2, 0, 4, 0), 'row', 'insert', 3, 2)).toEqual(R(2, 0, 6, 0));
    expect(adjustRange(R(2, 0, 4, 0), 'row', 'insert', 0, 1)).toEqual(R(3, 0, 5, 0));
    expect(adjustRange(R(2, 0, 4, 0), 'row', 'delete', 3, 5)).toEqual(R(2, 0, 2, 0));
    expect(adjustRange(R(2, 0, 4, 0), 'row', 'delete', 0, 10)).toBeNull();
  });
});
