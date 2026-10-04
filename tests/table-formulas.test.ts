import { describe, expect, it } from 'vitest';
import { TableFormulas, computeFormulasInHTML, createEditor, defaultPlugins, evaluateGrid } from '../src';

const v = (grid: string[][]) => evaluateGrid(grid);

describe('formulas', () => {
  it('does arithmetic with precedence, unary minus and percent', () => {
    expect(v([['=1+2*3', '=(1+2)*3', '=-2^2', '=50%', '=2^3^2']])[0]).toEqual([7, 9, 4, 0.5, 512]);
  });
  it('reads cells and ranges', () => {
    const g = v([['10', '20', '30'], ['=SUM(A1:C1)', '=AVERAGE(A1:C1)', '=MAX(A1:C1)-MIN(A1:C1)'], ['=B1*2', '=COUNT(A1:C2)', '=ROUND(10/3,2)']]);
    expect(g[1]).toEqual([60, 20, 20]);
    expect(g[2]).toEqual([40, 6, 3.33]);
  });
  it('supports IF, comparison, text and concat', () => {
    expect(v([['5', '=IF(A1>3,"big","small")', '="a"&"b"', '=CONCAT(A1,"x")']])[0].slice(1)).toEqual(['big', 'ab', '5x']);
  });
  it('reports errors instead of throwing', () => {
    const g = v([['=1/0', '=NOPE(1)', '=A9', '=1+', '=A5', 'text', '=F1+1', '=SQRT(-1)']])[0];
    expect(g).toEqual(['#DIV/0!', '#NAME?', '#REF!', '#ERR!', '#REF!', 'text', '#VALUE!', '#NUM!']);
  });
  it('detects cycles', () => {
    expect(v([['=B1', '=A1']])[0]).toEqual(['#CYCLE!', '#CYCLE!']);
  });
  it('never evaluates arbitrary code', () => {
    expect(v([['=alert(1)', '=constructor', '=1;2']])[0]).toEqual(['#NAME?', '#NAME?', '#ERR!']);
  });
  it('computes formulas in exported HTML', () => {
    const html = computeFormulasInHTML('<table><tr><td>2</td><td>3</td></tr><tr><td>=A1*B1</td><td>=SUM(A1:B1)</td></tr></table>');
    expect(html).toContain('<td>6</td>');
    expect(html).toContain('<td>5</td>');
  });
  it('shows computed values in the editor and keeps the formula text', () => {
    const ed = createEditor({ element: document.body.appendChild(document.createElement('div')), plugins: [...defaultPlugins, TableFormulas], content: '<table><tr><td><p>4</p></td><td><p>5</p></td></tr><tr><td><p>=A1+B1</p></td><td><p>x</p></td></tr></table>' });
    expect(ed.view.dom.querySelector('.wy-formula-value')?.textContent).toBe('9');
    expect(ed.getHTML()).toContain('=A1+B1');
    ed.destroy();
  });
});

describe('formula limits', () => {
  it('caps text so doubling chains cannot exhaust memory', () => {
    const row = ['="abcdefghij"'];
    for (let i = 0; i < 30; i++) row.push(`=${colLetter(i)}1&${colLetter(i)}1`);
    const out = v([row])[0];
    expect(out.some((x) => x === '#VALUE!')).toBe(true);
    expect(out.every((x) => typeof x !== 'string' || x.length <= 10000)).toBe(true);
  });
  it('rejects absurd ranges immediately', () => {
    const t = Date.now();
    expect(v([['1', '=SUM(A1:ZZ99999)']])[0][1]).toBe('#REF!');
    expect(Date.now() - t).toBeLessThan(200);
  });
});
const colLetter = (i: number) => String.fromCharCode(65 + i);
