import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { NodeView } from 'prosemirror-view';
import { CHART_COLORS, chartSVG, cleanChart, specFromRows, type ChartSpec, type ChartType } from '../chart';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

export { chartSVG, cleanChart, specFromRows };
export type { ChartSpec, ChartType };

/** Everything the chart is drawn from is stored as data; the picture is rebuilt on load, so saved markup cannot smuggle anything in. */
class ChartView implements NodeView {
  dom: HTMLElement;
  constructor(private node: PMNode) {
    this.dom = document.createElement('figure');
    this.dom.className = 'wy-chart';
    this.dom.contentEditable = 'false';
    this.paint();
  }
  private paint() {
    const spec = cleanChart(this.node.attrs.spec);
    this.dom.replaceChildren();
    if (!spec) { this.dom.textContent = 'This chart has no data.'; return; }
    const holder = document.createElement('div');
    holder.innerHTML = chartSVG(spec); // generated here from validated data and escaped text
    this.dom.append(...holder.childNodes);
  }
  update(node: PMNode) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  ignoreMutation() { return true; }
}

/**
 * Charts (bar, line, pie) drawn as SVG from data. `insertChart` with a table selected builds the chart from it (first row = series,
 * first column = labels); `setChart` changes the type or title of the selected chart. Word export writes the chart as a picture.
 */
export function Charts(): EditorPlugin {
  return {
    name: 'charts',
    nodes: {
      chart: {
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { spec: { default: '' } },
        leafText: (n: PMNode) => cleanChart(n.attrs.spec)?.title ?? '',
        parseDOM: [{ tag: 'figure[data-chart]', getAttrs: (d) => { const s = cleanChart((d as HTMLElement).getAttribute('data-chart')); return s ? { spec: JSON.stringify(s) } : false; } }],
        toDOM: (n: PMNode) => {
          const s = cleanChart(n.attrs.spec);
          return ['figure', { class: 'wy-chart', 'data-chart': n.attrs.spec, role: 'img', 'aria-label': s?.title || 'Chart' }, s ? `${s.title || 'Chart'}: ${s.labels.map((l, i) => `${l} ${s.series.map((x) => x.values[i]).join('/')}`).join(', ')}` : ''];
        },
      },
    },
    setup(editor: Editor) {
      const tableRows = (): string[][] | null => {
        const { $from } = editor.view.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const t = $from.node(d);
          if (t.type.name === 'table') { const rows: string[][] = []; t.forEach((r) => { const cells: string[] = []; r.forEach((c) => cells.push(c.textContent)); rows.push(cells); }); return rows; }
        }
        return null;
      };
      editor.registerCommand('insertChart', (e, type: ChartType = 'bar', data?: unknown) => {
        const spec = data ? cleanChart({ type, ...(data as object) }) : (() => { const rows = tableRows(); return rows ? specFromRows(rows, type) : null; })();
        if (!spec) return false;
        const { state, dispatch } = e.view;
        const { $from } = state.selection;
        let at = state.selection.to;
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') at = $from.after(d); // the chart goes right after its table
        dispatch(state.tr.insert(at, state.schema.nodes.chart.create({ spec: JSON.stringify(spec) })).scrollIntoView());
        return true;
      });
      editor.registerCommand('setChart', (e, patch: { type?: ChartType; title?: string }) => {
        const sel = e.view.state.selection;
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'chart') return false;
        const spec = cleanChart(sel.node.attrs.spec);
        if (!spec) return false;
        const next = cleanChart({ ...spec, ...(patch.type ? { type: patch.type } : {}), ...(patch.title !== undefined ? { title: patch.title } : {}) });
        if (!next) return false;
        e.view.dispatch(e.view.state.tr.setNodeMarkup(sel.from, undefined, { spec: JSON.stringify(next) }));
        return true;
      });
      editor.extensions.charts = { render: (spec: unknown) => { const s = cleanChart(spec); return s ? chartSVG(s) : null; }, colors: CHART_COLORS };
      return [new Plugin({ props: { nodeViews: { chart: (node: PMNode) => new ChartView(node) } } })];
    },
    toolbar: [
      { name: 'chartBar', label: 'Bar chart from table', icon: '📊', command: 'insertChart', args: ['bar'] },
      { name: 'chartLine', label: 'Line chart from table', icon: '📈', command: 'insertChart', args: ['line'] },
      { name: 'chartPie', label: 'Pie chart from table', icon: '🥧', command: 'insertChart', args: ['pie'] },
    ],
  };
}
