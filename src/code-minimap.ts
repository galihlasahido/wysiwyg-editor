import { simpleHighlight, type Highlighter, type TokenType } from './highlight';

type Palette = Record<TokenType | 'plain', string>;
const DARK: Palette = { plain: '#9da5b4', comment: '#6a9955', string: '#ce9178', number: '#b5cea8', keyword: '#c586c0', function: '#dcdcaa', literal: '#569cd6', tag: '#569cd6', attr: '#9cdcfe', variable: '#9cdcfe', property: '#9cdcfe', punct: '#808080' };
const LIGHT: Palette = { plain: '#6b7280', comment: '#15803d', string: '#b45309', number: '#047857', keyword: '#a626a4', function: '#7c3aed', literal: '#1d4ed8', tag: '#1d4ed8', attr: '#0e7490', variable: '#0e7490', property: '#0e7490', punct: '#9ca3af' };

/** A scaled-down picture of the whole text, with a slider for the visible part. Click or drag to scroll. */
export class Minimap {
  readonly dom = document.createElement('div');
  private canvas = document.createElement('canvas');
  private slider = document.createElement('div');
  private pending = 0;
  private dragging = false;

  constructor(private scroller: HTMLElement, private getText: () => string, private getLanguage: () => string | null, private highlight: Highlighter = simpleHighlight) {
    this.dom.className = 'wy-minimap';
    this.dom.setAttribute('aria-hidden', 'true');
    this.slider.className = 'wy-minimap-slider';
    this.dom.append(this.canvas, this.slider);
    scroller.addEventListener('scroll', this.syncSlider, { passive: true });
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => this.refresh()).observe(this.dom);
    this.dom.addEventListener('pointerdown', (e) => { this.dragging = true; this.dom.setPointerCapture(e.pointerId); this.scrollTo(e); });
    this.dom.addEventListener('pointermove', (e) => this.dragging && this.scrollTo(e));
    const stop = () => (this.dragging = false);
    this.dom.addEventListener('pointerup', stop);
    this.dom.addEventListener('pointercancel', stop);
  }

  private geometry() {
    const lines = this.getText().split('\n').length;
    const h = this.dom.clientHeight;
    const row = Math.max(0.5, Math.min(3, h / Math.max(1, lines)));
    return { lines, h, row, total: lines * row };
  }

  private scrollTo(e: PointerEvent) {
    const { total } = this.geometry();
    const y = e.clientY - this.dom.getBoundingClientRect().top;
    const ratio = total ? Math.min(1, Math.max(0, y / total)) : 0;
    this.scroller.scrollTop = ratio * this.scroller.scrollHeight - this.scroller.clientHeight / 2;
  }

  private syncSlider = () => {
    const { total } = this.geometry();
    const sh = this.scroller.scrollHeight || 1;
    this.slider.style.top = `${(this.scroller.scrollTop / sh) * total}px`;
    this.slider.style.height = `${Math.max(8, Math.min(total, (this.scroller.clientHeight / sh) * total))}px`;
  };

  /** Redraw (coalesced to one frame). Call after the text, language or theme changed. */
  refresh() {
    if (this.pending) return;
    this.pending = requestAnimationFrame(() => { this.pending = 0; this.draw(); });
  }

  private draw() {
    const { h, row } = this.geometry();
    const w = this.dom.clientWidth;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const bg = getComputedStyle(this.scroller).backgroundColor;
    const dark = (() => { const m = /\d+/g; const [r, g, b] = (bg.match(m) ?? ['255', '255', '255']).map(Number); return (r * 299 + g * 587 + b * 114) / 1000 < 128; })();
    const palette = dark ? DARK : LIGHT;
    const text = this.getText();
    const tokens = this.highlight(text, this.getLanguage());
    const colorAt = new Map<number, string>();
    for (const t of tokens) { const c = palette[t.type];
      if (c) for (let i = t.from; i < t.to; i++) colorAt.set(i, c); }
    const charW = 1;
    let y = 0;
    let offset = 0;
    for (const line of text.split('\n')) {
      let x = 0;
      for (let i = 0; i < line.length && x < w; i++) {
        const ch = line[i];
        if (ch === ' ') x += charW;
        else if (ch === '\t') x += charW * 2;
        else { ctx.fillStyle = colorAt.get(offset + i) ?? palette.plain; ctx.fillRect(x, y, charW, Math.max(1, row * 0.7)); x += charW; }
      }
      offset += line.length + 1;
      y += row;
      if (y > h) break;
    }
    this.syncSlider();
  }

  destroy() {
    this.scroller.removeEventListener('scroll', this.syncSlider);
    cancelAnimationFrame(this.pending);
    this.dom.remove();
  }
}
