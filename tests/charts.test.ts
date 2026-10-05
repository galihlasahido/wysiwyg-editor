import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Charts, chartSVG, cleanChart, createEditor, defaultPlugins, specFromRows } from '../src';
import { parseNumber } from '../src/chart';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const TABLE = '<table><tr><th>Quarter</th><th>2025</th><th>2026</th></tr><tr><td>Q1</td><td>1,200</td><td>$1,500</td></tr><tr><td>Q2</td><td>900</td><td>12%</td></tr></table><p>after</p>';
const make = (content: string) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Charts()] });
};

describe('chart data', () => {
  it('parses numbers with separators, currency and percent', () => {
    expect([parseNumber('1,200'), parseNumber('$1,500.5'), parseNumber('12%'), parseNumber('-3')]).toEqual([1200, 1500.5, 12, -3]);
    expect(parseNumber('abc')).toBeNaN();
  });
  it('builds a spec from table rows', () => {
    const s = specFromRows([['Q', 'A', 'B'], ['Q1', '1', '2'], ['Q2', '3', 'x']], 'line')!;
    expect(s).toMatchObject({ type: 'line', labels: ['Q1', 'Q2'], series: [{ name: 'A', values: [1, 3] }, { name: 'B', values: [2, 0] }] });
    expect(specFromRows([['Q', 'A'], ['Q1', 'x']])).toBeNull(); // nothing numeric
  });
  it('cleans hostile input: unknown type, giant arrays, non-numbers, markup in text', () => {
    const s = cleanChart({ type: 'evil', labels: Array(500).fill('<b>'), series: Array(20).fill({ name: '<img onerror=1>', values: ['NaN', 5, Infinity] }) })!;
    expect(s.type).toBe('bar');
    expect(s.labels).toHaveLength(50);
    expect(s.series).toHaveLength(8);
    expect(s.series[0].values.slice(0, 3)).toEqual([0, 5, 0]);
    expect(cleanChart('not json')).toBeNull();
    expect(cleanChart({ labels: [], series: [] })).toBeNull();
  });
  it('draws escaped SVG for each type', () => {
    for (const type of ['bar', 'line', 'pie'] as const) {
      const svg = chartSVG(cleanChart({ type, title: '<script>alert(1)</script>', labels: ['a<b', 'c'], series: [{ name: 'S"1', values: [1, 2] }] })!);
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toContain('<script');
      expect(svg).not.toMatch(/<b>|onerror/);
    }
  });
});

describe('Charts plugin', () => {
  it('builds a chart from the table at the cursor and puts it after the table', () => {
    const ed = make(TABLE);
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 6)));
    expect(ed.execute('insertChart', 'bar')).toBe(true);
    expect(ed.view.state.doc.child(1).type.name).toBe('chart');
    expect(ed.view.dom.querySelectorAll('.wy-chart rect').length).toBeGreaterThanOrEqual(4);
    ed.destroy();
  });
  it('refuses when the cursor is not in a table; setChart switches type', () => {
    const ed = make(TABLE);
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    expect(ed.execute('insertChart', 'bar')).toBe(false);
    expect(ed.execute('insertChart', 'bar', { labels: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }] })).toBe(true);
    let pos = -1;
    ed.view.state.doc.descendants((n, p) => { if (n.type.name === 'chart') pos = p; });
    ed.view.dispatch(ed.view.state.tr.setSelection(NodeSelection.create(ed.view.state.doc, pos)));
    expect(ed.execute('setChart', { type: 'line', title: 'Trend' })).toBe(true);
    expect(ed.view.dom.querySelector('.wy-chart polyline')).not.toBeNull();
    expect(ed.view.dom.querySelector('.wy-chart svg')!.getAttribute('aria-label')).toBe('Trend');
    ed.destroy();
  });
  it('round-trips through saved HTML (data only) and ignores tampered markup', () => {
    const ed = make('<figure data-chart=\'{"type":"pie","labels":["a","b"],"series":[{"name":"S","values":[1,3]}]}\'><svg onload="alert(1)"><script>1</script></svg></figure><figure data-chart="garbage"></figure>');
    expect(ed.view.dom.querySelectorAll('.wy-chart')).toHaveLength(1);
    expect(ed.view.dom.querySelector('.wy-chart script, .wy-chart [onload]')).toBeNull();
    expect(ed.getHTML()).toContain('data-chart');
    expect(ed.getHTML()).not.toMatch(/onload|<script/);
    ed.destroy();
  });
  it('exports a Markdown table', () => {
    const ed = make('<figure data-chart=\'{"type":"bar","labels":["Q1"],"series":[{"name":"A","values":[5]}]}\'></figure>');
    expect(ed.getMarkdown()).toContain('| Q1 | 5 |');
    ed.destroy();
  });
});
