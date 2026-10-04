/**
 * Word-style horizontal ruler: cm scale (zero at the left margin), shaded margin zones, draggable margin
 * edges, and paragraph indent markers (first line ▼ and hanging ▲ with the left-indent box, right indent ▲).
 *
 * The ruler is updated in place, never rebuilt, so a drag in progress is not destroyed by the layout
 * changes it causes. Drags preview locally (marker + a guide line over the page) and commit on release,
 * which keeps one undo step per drag.
 */
export interface RulerHost {
  /** Page width in CSS px. */
  width(): number;
  margins(): { left: number; right: number };
  setMargins(m: { left?: number; right?: number }): void;
  /** Indents of the paragraph at the cursor, or null when there is none. */
  paragraph(): { left: number; right: number; firstLine: number } | null;
  setParagraph(p: { left?: number; right?: number; firstLine?: number }): void;
  /** On-screen zoom factor (screen px per CSS px). */
  scale(): number;
  /** Show (x in page px) or hide (null) the vertical guide line. */
  guide(x: number | null): void;
}

const CM = 96 / 2.54;
type MarkerKind = 'first' | 'hang' | 'box' | 'right' | 'mleft' | 'mright';

interface State { ml: number; mr: number; left: number; right: number; firstLine: number }

export class Ruler {
  readonly el = document.createElement('div');
  private svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  private zones = { left: document.createElement('div'), right: document.createElement('div') };
  private markers = {} as Record<MarkerKind, HTMLElement>;
  /** Values being dragged; they override the host's until the drag is committed. */
  private preview: Partial<State> | null = null;
  private lastTicks = '';

  constructor(private host: RulerHost) {
    this.el.className = 'wy-ruler';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', 'Ruler');
    this.svg.setAttribute('class', 'wy-ruler-scale');
    this.svg.setAttribute('aria-hidden', 'true');
    this.zones.left.className = 'wy-ruler-zone wy-ruler-zone-left';
    this.zones.right.className = 'wy-ruler-zone wy-ruler-zone-right';
    this.el.append(this.svg, this.zones.left, this.zones.right);

    const make = (kind: MarkerKind, label: string, cls: string) => {
      const m = document.createElement('div');
      m.className = `wy-ruler-marker ${cls}`;
      m.tabIndex = 0;
      m.setAttribute('role', 'slider');
      m.setAttribute('aria-label', label);
      m.title = label;
      this.markers[kind] = m;
      this.el.append(m);
      this.attach(kind, m);
    };
    make('mleft', 'Left margin', 'wy-ruler-margin');
    make('mright', 'Right margin', 'wy-ruler-margin');
    make('box', 'Left indent', 'wy-ruler-box');
    make('hang', 'Hanging indent', 'wy-ruler-hang');
    make('first', 'First line indent', 'wy-ruler-first');
    make('right', 'Right indent', 'wy-ruler-right');
    // The host (editor view) may not exist yet; the owner calls rebuild() once it does.
  }

  private state(): State {
    const m = this.host.margins();
    const p = this.host.paragraph();
    return { ml: m.left, mr: m.right, left: p?.left ?? 0, right: p?.right ?? 0, firstLine: p?.firstLine ?? 0, ...this.preview };
  }

  /** Regenerate the scale (page size or margins changed), then reposition the markers. */
  rebuild(): void {
    this.lastTicks = '';
    this.update();
  }

  update(): void {
    const W = this.host.width();
    const s = this.state();
    this.el.style.width = `${W}px`;
    this.drawScale(W, s.ml);
    this.zones.left.style.width = `${s.ml}px`;
    this.zones.right.style.width = `${s.mr}px`;

    const hasParagraph = this.host.paragraph() !== null;
    const place = (kind: MarkerKind, x: number, value: number, min: number, max: number) => {
      const m = this.markers[kind];
      m.style.left = `${x}px`;
      m.setAttribute('aria-valuenow', String(Math.round(value)));
      m.setAttribute('aria-valuemin', String(Math.round(min)));
      m.setAttribute('aria-valuemax', String(Math.round(max)));
    };
    const innerRight = W - s.mr - s.right;
    place('mleft', s.ml, s.ml, 0, W / 2 - 50);
    place('mright', W - s.mr, s.mr, 0, W / 2 - 50);
    place('box', s.ml + s.left, s.left, 0, W - s.ml - s.mr - s.right - 20);
    place('hang', s.ml + s.left, s.left, 0, W - s.ml - s.mr - s.right - 20);
    place('first', s.ml + s.left + s.firstLine, s.firstLine, -s.left - s.ml, W - s.ml - s.mr);
    place('right', innerRight, s.right, 0, W - s.ml - s.mr - s.left - 20);
    for (const k of ['box', 'hang', 'first', 'right'] as const) this.markers[k].hidden = !hasParagraph;
  }

  private drawScale(W: number, ml: number): void {
    const key = `${W}:${ml}`;
    if (key === this.lastTicks) return;
    this.lastTicks = key;
    const q = CM / 4; // quarter-cm ticks; labels each cm, zero at the left margin
    let d = '';
    let labels = '';
    const from = -Math.floor(ml / q);
    const to = Math.floor((W - ml) / q);
    for (let k = from; k <= to; k++) {
      const x = ml + k * q;
      if (x < 0.5 || x > W - 0.5) continue;
      if (k % 4 === 0) {
        if (k !== 0) labels += `<text x="${x.toFixed(1)}" y="13" text-anchor="middle">${Math.abs(k / 4)}</text>`;
      } else d += `M${x.toFixed(1)} ${k % 2 === 0 ? 8 : 10}v${k % 2 === 0 ? 8 : 4}`;
    }
    this.svg.setAttribute('width', String(W));
    this.svg.setAttribute('height', '24');
    this.svg.innerHTML = `<path d="${d}" />${labels}`;
  }

  // ---- interaction -------------------------------------------------------

  private attach(kind: MarkerKind, el: HTMLElement): void {
    // Pointer users must not steal focus (and the text selection) from the editor; keyboard users still can Tab here.
    el.addEventListener('mousedown', (ev) => ev.preventDefault());
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      el.setPointerCapture?.(ev.pointerId); // (absent in some test environments)
      const start = this.state();
      const startX = ev.clientX;
      const W = this.host.width();
      const scale = this.host.scale() || 1;
      const move = (e: PointerEvent) => {
        const dx = Math.round((e.clientX - startX) / scale);
        this.preview = this.compute(kind, start, dx, W);
        this.update();
        this.host.guide(this.guideX(kind, { ...start, ...this.preview }));
      };
      const finish = (commit: boolean) => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', cancel);
        const result = this.preview;
        this.preview = null;
        this.host.guide(null);
        if (commit && result) this.commit(kind, start, result);
        this.update();
      };
      const up = () => finish(true);
      const cancel = () => finish(false);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', cancel);
    });

    el.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
      if (!dx) return;
      e.preventDefault();
      const start = this.state();
      this.commit(kind, start, this.compute(kind, start, dx, this.host.width()));
    });
  }

  /** New state for a drag of `dx` px, clamped to sensible bounds. */
  private compute(kind: MarkerKind, s: State, dx: number, W: number): Partial<State> {
    const clamp = (v: number, lo: number, hi: number) => Math.round(Math.max(lo, Math.min(hi, v)));
    const textWidth = W - s.ml - s.mr;
    switch (kind) {
      case 'mleft': return { ml: clamp(s.ml + dx, 0, W / 2 - 50) };
      case 'mright': return { mr: clamp(s.mr - dx, 0, W / 2 - 50) };
      case 'box': {
        const left = clamp(s.left + dx, 0, textWidth - s.right - 20);
        return { left }; // first line moves with it (it is relative to the left indent)
      }
      case 'hang': {
        // Move the left indent but keep the first line where it is on the page.
        const left = clamp(s.left + dx, 0, textWidth - s.right - 20);
        return { left, firstLine: s.firstLine + s.left - left };
      }
      case 'first': return { firstLine: clamp(s.firstLine + dx, -s.left - s.ml, textWidth - s.left - 20) };
      case 'right': return { right: clamp(s.right - dx, 0, textWidth - s.left - 20) };
    }
  }

  private guideX(kind: MarkerKind, s: State): number {
    const W = this.host.width();
    if (kind === 'mleft') return s.ml;
    if (kind === 'mright') return W - s.mr;
    if (kind === 'first') return s.ml + s.left + s.firstLine;
    if (kind === 'right') return W - s.mr - s.right;
    return s.ml + s.left;
  }

  private commit(kind: MarkerKind, from: State, to: Partial<State>): void {
    if (kind === 'mleft' || kind === 'mright') {
      this.host.setMargins(kind === 'mleft' ? { left: to.ml } : { right: to.mr });
    } else {
      const patch: { left?: number; right?: number; firstLine?: number } = {};
      if (to.left !== undefined && to.left !== from.left) patch.left = to.left;
      if (to.right !== undefined && to.right !== from.right) patch.right = to.right;
      if (to.firstLine !== undefined && to.firstLine !== from.firstLine) patch.firstLine = to.firstLine;
      if (Object.keys(patch).length) this.host.setParagraph(patch);
    }
  }
}
