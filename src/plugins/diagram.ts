import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { EditorPlugin } from '../types';

export type ShapeType = 'rect' | 'ellipse' | 'diamond' | 'text';
export interface Shape { id: string; type: ShapeType; x: number; y: number; w: number; h: number; text: string; fill: string }
export interface Arrow { from: string; to: string }
export interface DiagramModel { w: number; h: number; shapes: Shape[]; arrows: Arrow[] }

const SVG = 'http://www.w3.org/2000/svg';
const MAX_SHAPES = 200;
const num = (v: unknown, min: number, max: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : d);
const color = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);
export const EMPTY_DIAGRAM: DiagramModel = { w: 520, h: 280, shapes: [], arrows: [] };

/** Parse and clamp untrusted diagram JSON. Anything unexpected is dropped, never thrown. */
export function parseDiagram(json: unknown): DiagramModel {
  let raw: any;
  try { raw = typeof json === 'string' ? JSON.parse(json) : json; } catch { return { ...EMPTY_DIAGRAM, shapes: [], arrows: [] }; }
  if (!raw || typeof raw !== 'object') return { ...EMPTY_DIAGRAM, shapes: [], arrows: [] };
  const w = num(raw.w, 120, 1600, 520);
  const h = num(raw.h, 80, 1200, 280);
  const seen = new Set<string>();
  const shapes: Shape[] = [];
  for (const s of Array.isArray(raw.shapes) ? raw.shapes.slice(0, MAX_SHAPES) : []) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || !/^[\w-]{1,20}$/.test(s.id) || seen.has(s.id)) continue;
    const type: ShapeType = ['rect', 'ellipse', 'diamond', 'text'].includes(s.type) ? s.type : 'rect';
    seen.add(s.id);
    shapes.push({ id: s.id, type, x: num(s.x, -2000, 4000, 0), y: num(s.y, -2000, 4000, 0), w: num(s.w, 20, 800, 120), h: num(s.h, 20, 600, 60), text: typeof s.text === 'string' ? s.text.slice(0, 200) : '', fill: color(s.fill, '#dbeafe') });
  }
  const arrows: Arrow[] = (Array.isArray(raw.arrows) ? raw.arrows.slice(0, MAX_SHAPES) : []).filter((a: any) => a && seen.has(a.from) && seen.has(a.to) && a.from !== a.to).map((a: any) => ({ from: a.from, to: a.to }));
  return { w, h, shapes, arrows };
}

const center = (s: Shape): [number, number] => [s.x + s.w / 2, s.y + s.h / 2];
/** Point where the line from the centre of `s` towards (tx,ty) leaves the shape's bounding box. */
function edgePoint(s: Shape, tx: number, ty: number): [number, number] {
  const [cx, cy] = center(s);
  const dx = tx - cx;
  const dy = ty - cy;
  if (!dx && !dy) return [cx, cy];
  const k = Math.min(s.w / 2 / Math.abs(dx || 1e-9), s.h / 2 / Math.abs(dy || 1e-9));
  return [cx + dx * k, cy + dy * k];
}

let uid = 0;
const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Build the SVG for a model. All text goes through textContent, so labels can never become markup. */
export function renderDiagram(model: DiagramModel, selected?: string | null): SVGSVGElement {
  const id = `wyd${++uid}`;
  const svg = svgEl('svg', { viewBox: `0 0 ${model.w} ${model.h}`, width: model.w, height: model.h, class: 'wy-diagram-svg', role: 'img' });
  const defs = svgEl('defs');
  const marker = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
  marker.append(svgEl('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'currentColor' }));
  defs.append(marker);
  svg.append(defs);
  const byId = new Map(model.shapes.map((s) => [s.id, s]));
  for (const a of model.arrows) {
    const f = byId.get(a.from)!;
    const t = byId.get(a.to)!;
    const [p1x, p1y] = edgePoint(f, ...center(t));
    const [p2x, p2y] = edgePoint(t, ...center(f));
    svg.append(svgEl('line', { x1: p1x, y1: p1y, x2: p2x, y2: p2y, stroke: 'currentColor', 'stroke-width': 2, 'marker-end': `url(#${id})`, class: 'wy-d-arrow' }));
  }
  for (const s of model.shapes) {
    const g = svgEl('g', { 'data-id': s.id, class: `wy-d-shape${s.id === selected ? ' is-selected' : ''}` });
    const stroke = s.type === 'text' ? 'none' : 'currentColor';
    const fill = s.type === 'text' ? 'none' : s.fill;
    if (s.type === 'ellipse') g.append(svgEl('ellipse', { cx: s.x + s.w / 2, cy: s.y + s.h / 2, rx: s.w / 2, ry: s.h / 2, fill, stroke, 'stroke-width': 2 }));
    else if (s.type === 'diamond') g.append(svgEl('polygon', { points: `${s.x + s.w / 2},${s.y} ${s.x + s.w},${s.y + s.h / 2} ${s.x + s.w / 2},${s.y + s.h} ${s.x},${s.y + s.h / 2}`, fill, stroke, 'stroke-width': 2 }));
    else g.append(svgEl('rect', { x: s.x, y: s.y, width: s.w, height: s.h, rx: s.type === 'rect' ? 8 : 0, fill: s.type === 'text' ? 'transparent' : fill, stroke, 'stroke-width': 2 }));
    const label = svgEl('text', { x: s.x + s.w / 2, y: s.y + s.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'central', class: 'wy-d-label' });
    s.text.split('\n').slice(0, 4).forEach((line, i, all) => label.append(svgEl('tspan', { x: s.x + s.w / 2, dy: i === 0 ? `${-(all.length - 1) * 0.6}em` : '1.2em' }, line)));
    g.append(label);
    svg.append(g);
  }
  if (!model.shapes.length) svg.append(svgEl('text', { x: model.w / 2, y: model.h / 2, 'text-anchor': 'middle', class: 'wy-d-empty' }, 'Empty diagram'));
  return svg;
}

class DiagramView implements NodeView {
  dom: HTMLElement;
  private canvas: HTMLElement;
  private bar: HTMLElement;
  private model: DiagramModel;
  private selected: string | null = null;
  private editing = false;
  private tool: 'select' | 'arrow' = 'select';
  private arrowFrom: string | null = null;
  private drag: { id: string; dx: number; dy: number; moved: boolean } | null = null;
  private svgRoot!: SVGSVGElement;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.model = parseDiagram(node.attrs.data);
    this.dom = document.createElement('figure');
    this.dom.className = 'wy-diagram';
    this.dom.setAttribute('data-diagram', node.attrs.data);
    this.bar = document.createElement('div');
    this.bar.className = 'wy-diagram-bar';
    this.bar.hidden = true;
    this.canvas = document.createElement('div');
    this.canvas.className = 'wy-diagram-canvas';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'wy-diagram-edit';
    edit.textContent = 'Edit diagram';
    edit.contentEditable = 'false';
    edit.addEventListener('click', () => this.setEditing(!this.editing));
    this.editBtn = edit;
    this.dom.append(this.canvas, edit, this.bar);
    this.buildBar();
    this.draw();
    this.canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    this.canvas.addEventListener('dblclick', (e) => this.onDouble(e));
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.editing || !this.selected || (e.key !== 'Delete' && e.key !== 'Backspace') || (e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA' || (e.target as HTMLElement).closest?.('.wy-diagram-input')) return; // never while typing in a text box
      if (!this.dom.contains(document.activeElement) && document.activeElement !== this.view.dom) return;
      if (view.state.selection instanceof NodeSelection && view.state.selection.node === this.node) { e.preventDefault(); this.remove(); }
    };
    document.addEventListener('keydown', this.keyHandler);
  }
  private editBtn: HTMLButtonElement;
  private keyHandler: (e: KeyboardEvent) => void;

  private setEditing(on: boolean) {
    if (on && !this.view.editable) return; // a read-only editor shows the diagram but cannot change it
    this.editing = on;
    this.bar.hidden = !on;
    this.dom.classList.toggle('is-editing', on);
    this.editBtn.textContent = on ? 'Done' : 'Edit diagram';
    if (!on) { this.selected = null; this.tool = 'select'; this.arrowFrom = null; }
    else this.fitWidth();
    this.draw();
  }

  private buildBar() {
    const btn = (label: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', onClick);
      return b;
    };
    const add = (type: ShapeType) => () => {
      const n = this.model.shapes.length;
      if (n >= MAX_SHAPES) return; // more would be dropped on reload
      const id = `s${Date.now().toString(36)}${n}`;
      this.model.shapes.push({ id, type, x: 30 + (n % 5) * 24, y: 30 + (n % 5) * 24, w: type === 'text' ? 120 : 130, h: type === 'text' ? 30 : 60, text: type === 'text' ? 'Text' : 'Step', fill: this.fill.value });
      this.selected = id;
      this.commit();
    };
    this.fill = document.createElement('input');
    this.fill.type = 'color';
    this.fill.value = '#dbeafe';
    this.fill.setAttribute('aria-label', 'Fill colour');
    this.fill.addEventListener('input', () => { const s = this.sel(); if (s) { s.fill = this.fill.value; this.commit(); } });
    this.arrowBtn = btn('Arrow', () => { this.tool = this.tool === 'arrow' ? 'select' : 'arrow'; this.arrowFrom = null; this.arrowBtn.classList.toggle('on', this.tool === 'arrow'); });
    this.bar.append(btn('Rectangle', add('rect')), btn('Ellipse', add('ellipse')), btn('Diamond', add('diamond')), btn('Text', add('text')), this.arrowBtn, this.fill, btn('Delete', () => this.remove()), btn('Smaller', () => this.resize(0.85)), btn('Bigger', () => this.resize(1.15)));
  }
  private fill!: HTMLInputElement;
  private arrowBtn!: HTMLButtonElement;

  /** In edit mode the canvas is as wide as the page, so shapes can use the whole width. */
  private fitWidth() {
    const avail = Math.round(this.canvas.clientWidth);
    if (avail > this.model.w) { this.model.w = Math.min(1600, avail); this.commit(); }
  }

  private sel() { return this.model.shapes.find((s) => s.id === this.selected); }
  private resize(f: number) { const s = this.sel(); if (!s) return; s.w = Math.round(num(s.w * f, 30, 400, s.w)); s.h = Math.round(num(s.h * f, 24, 300, s.h)); this.commit(); }
  private remove() {
    if (!this.selected) return;
    const id = this.selected;
    this.model.shapes = this.model.shapes.filter((s) => s.id !== id);
    this.model.arrows = this.model.arrows.filter((a) => a.from !== id && a.to !== id);
    this.selected = null;
    this.commit();
  }

  private draw() {
    this.svgRoot = renderDiagram(this.model, this.editing ? this.selected : null);
    this.canvas.replaceChildren(this.svgRoot);
  }

  private commit() {
    const pos = this.getPos();
    if (pos === undefined) return;
    if (!this.view.editable) { this.resync(pos); return; }
    this.draw();
    const data = JSON.stringify(this.model);
    this.dom.setAttribute('data-diagram', data);
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, data });
    this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos))); // the selection must belong to the new document
    // A plugin may have rejected the change (a locked section): then the document is the truth, not the local model.
    if (this.view.state.doc.nodeAt(pos)?.attrs.data !== data) this.resync(pos);
  }

  /** Show what the document actually holds. */
  private resync(pos: number) {
    this.model = parseDiagram(this.view.state.doc.nodeAt(pos)?.attrs.data);
    this.dom.setAttribute('data-diagram', JSON.stringify(this.model));
    this.draw();
  }

  private point(e: PointerEvent): [number, number] {
    const m = this.svgRoot.getScreenCTM();
    if (!m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  }
  private shapeAt(e: Event): Shape | undefined {
    const g = (e.target as Element).closest?.('[data-id]');
    return g ? this.model.shapes.find((s) => s.id === g.getAttribute('data-id')) : undefined;
  }
  private onDown(e: PointerEvent) {
    if (!this.editing) return;
    const s = this.shapeAt(e);
    e.preventDefault();
    if (this.tool === 'arrow') {
      if (!s) return;
      if (!this.arrowFrom) { this.arrowFrom = s.id; this.selected = s.id; this.markSelection(); return; }
      if (s.id !== this.arrowFrom && !this.model.arrows.some((a) => a.from === this.arrowFrom && a.to === s.id)) this.model.arrows.push({ from: this.arrowFrom, to: s.id });
      this.arrowFrom = null;
      this.tool = 'select';
      this.arrowBtn.classList.remove('on');
      this.commit();
      return;
    }
    // Two quick presses on one shape open the text editor. Detected here because pointerdown's preventDefault
    // (needed to stop text selection while dragging) can suppress the browser's own dblclick.
    const now = Date.now();
    if (s && this.lastDown && this.lastDown.id === s.id && now - this.lastDown.at < 400) { this.lastDown = null; this.drag = null; this.editText(s); return; }
    this.lastDown = s ? { id: s.id, at: now } : null;
    this.selected = s?.id ?? null;
    if (s) { const [x, y] = this.point(e); this.drag = { id: s.id, dx: x - s.x, dy: y - s.y, moved: false }; this.fill.value = s.fill; }
    this.markSelection(); // not a redraw: replacing the element under the pointer would swallow the double-click
  }
  private markSelection() {
    this.svgRoot.querySelectorAll('.wy-d-shape').forEach((g) => g.classList.toggle('is-selected', g.getAttribute('data-id') === this.selected));
  }
  private onMove = (e: PointerEvent) => {
    if (!this.drag) return;
    const s = this.model.shapes.find((x) => x.id === this.drag!.id);
    if (!s) return;
    const [x, y] = this.point(e);
    s.x = Math.round(Math.max(0, Math.min(this.model.w - s.w, x - this.drag.dx)));
    s.y = Math.round(Math.max(0, Math.min(1200 - s.h, y - this.drag.dy)));
    this.model.h = Math.min(1200, Math.max(this.model.h, s.y + s.h + 24)); // the canvas grows downwards
    this.drag.moved = true;
    this.draw();
  };
  private onUp = () => {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) this.commit();
  };
  /** A cancelled touch must not leave the shape stuck to the pointer. */
  private onCancel = () => {
    if (!this.drag) return;
    this.drag = null;
    const pos = this.getPos();
    if (pos !== undefined) this.resync(pos);
  };
  private lastDown: { id: string; at: number } | null = null;
  private onDouble(e: MouseEvent) {
    if (!this.editing) return;
    const s = this.shapeAt(e);
    if (s) this.editText(s);
  }
  private editText(s: Shape) {
    if (this.canvas.querySelector('.wy-diagram-input')) return;
    const input = document.createElement('textarea');
    input.className = 'wy-diagram-input';
    input.value = s.text;
    input.rows = 2;
    input.setAttribute('aria-label', 'Shape text');
    const box = this.canvas.getBoundingClientRect();
    const k = box.width / this.model.w;
    Object.assign(input.style, { left: `${s.x * k}px`, top: `${s.y * k}px`, width: `${Math.max(90, s.w * k)}px`, height: `${Math.max(40, s.h * k)}px` });
    this.canvas.append(input);
    input.focus();
    input.select();
    const done = (save: boolean) => { if (!input.isConnected) return; input.remove(); if (!save || input.value === s.text) return; s.text = input.value.slice(0, 200); this.commit(); };
    input.addEventListener('blur', () => done(true));
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') done(false); if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); done(true); } });
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    if (!this.drag && node.attrs.data !== JSON.stringify(this.model)) {
      this.model = parseDiagram(node.attrs.data);
      if (this.selected && !this.model.shapes.some((s) => s.id === this.selected)) this.selected = null;
      this.dom.setAttribute('data-diagram', node.attrs.data);
      this.draw();
    }
    return true;
  }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e: Event) { return this.editing ? this.canvas.contains(e.target as Node) || this.bar.contains(e.target as Node) || e.target === this.editBtn : this.bar.contains(e.target as Node) || e.target === this.editBtn; }
  ignoreMutation() { return true; }
  destroy() {
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
    document.removeEventListener('keydown', this.keyHandler);
  }
}

const STARTER: DiagramModel = {
  w: 520,
  h: 280,
  shapes: [
    { id: 'a', type: 'ellipse', x: 20, y: 110, w: 110, h: 60, text: 'Start', fill: '#dcfce7' },
    { id: 'b', type: 'rect', x: 190, y: 110, w: 130, h: 60, text: 'Do the work', fill: '#dbeafe' },
    { id: 'c', type: 'diamond', x: 370, y: 100, w: 130, h: 80, text: 'Done?', fill: '#fef3c7' },
  ],
  arrows: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
};

/** An editable vector diagram block: rectangles, ellipses, diamonds, text and arrows. Stored as validated JSON in one attribute. */
export const Diagram: EditorPlugin = {
  name: 'diagram',
  nodes: {
    diagram: {
      group: 'block',
      atom: true,
      draggable: true,
      selectable: true,
      attrs: { data: { default: JSON.stringify(EMPTY_DIAGRAM) } },
      parseDOM: [{ tag: 'figure[data-diagram]', getAttrs: (n) => ({ data: JSON.stringify(parseDiagram((n as HTMLElement).getAttribute('data-diagram'))) }) }],
      toDOM: (node) => {
        const fig = document.createElement('figure');
        fig.className = 'wy-diagram';
        fig.setAttribute('data-diagram', JSON.stringify(parseDiagram(node.attrs.data)));
        fig.append(renderDiagram(parseDiagram(node.attrs.data)));
        return fig;
      },
    },
  },
  setup(editor) {
    editor.registerCommand('insertDiagram', (e, model?: DiagramModel) => {
      const { state, dispatch } = e.view;
      const node = state.schema.nodes.diagram.create({ data: JSON.stringify(parseDiagram(model ?? STARTER)) });
      dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
      return true;
    });
    return [new Plugin({ props: { nodeViews: { diagram: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new DiagramView(node, view, getPos) } } })];
  },
  toolbar: [{ name: 'diagram', label: 'Insert diagram', icon: '◇', command: 'insertDiagram' }],
};
