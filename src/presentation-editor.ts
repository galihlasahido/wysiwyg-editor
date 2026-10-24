/**
 * The editing canvas of the presentation app: the current slide, drawn at the size that fits, with selecting, moving (snapping to
 * the slide and to other boxes), resizing, rotating, typing in a box, the keyboard, the clipboard and dropped pictures.
 */
import { observeSize } from './resize';
import { fitSlide, renderEl, renderSlide, ensureSlideCss } from './presentation-render';
import {
  addEls, cleanHTML, cloneEls, newImageEl, newTextEl, removeEls, styleEls, textToHTML, htmlToText, updateEls,
  type Deck, type DeckStore, type ElStyle, type Slide, type SlideEl,
} from './presentation-model';

export interface CanvasOptions {
  readOnly?: boolean;
  onSelect?: () => void;
  /** The editing state or the text selection changed (so the toolbar can follow). */
  onState?: () => void;
  /** A picture was turned away (not an image, too large, would not open). */
  onError?: (message: string) => void;
  onContext?: (x: number, y: number, onElement: boolean) => void;
}

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: { h: Handle; sx: number; sy: number }[] = [
  { h: 'nw', sx: -1, sy: -1 }, { h: 'n', sx: 0, sy: -1 }, { h: 'ne', sx: 1, sy: -1 }, { h: 'e', sx: 1, sy: 0 },
  { h: 'se', sx: 1, sy: 1 }, { h: 's', sx: 0, sy: 1 }, { h: 'sw', sx: -1, sy: 1 }, { h: 'w', sx: -1, sy: 0 },
];

const rad = (d: number) => (d * Math.PI) / 180;

/** Read a picture file as a data URL, shrunk to at most 1920 pixels so the deck stays a size that can be saved. */
/** The biggest picture file taken (before it is shrunk). */
const MAX_PICTURE_FILE = 30 * 1024 * 1024;

export function readImageFile(file: File, maxSide = 1920): Promise<{ src: string; w: number; h: number }> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|gif|webp|svg\+xml|avif)$/.test(file.type)) { reject(new Error('Not a picture')); return; }
    if (file.size > MAX_PICTURE_FILE) { reject(new Error('The picture is too large')); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.onload = () => {
      const src = String(reader.result);
      const img = new Image();
      img.onerror = () => reject(new Error('Could not open the picture'));
      img.onload = () => {
        const w = img.naturalWidth || 400; const h = img.naturalHeight || 300;
        if (w * h > 100_000_000) { reject(new Error('The picture is too large')); return; }   // a small file that unpacks to gigabytes
        const big = Math.max(w, h) > maxSide && file.type !== 'image/svg+xml' && file.type !== 'image/gif';
        if (!big) { resolve({ src, w, h }); return; }
        const k = maxSide / Math.max(w, h);
        const c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k);
        const ctx = c.getContext('2d');
        if (!ctx) { resolve({ src, w, h }); return; }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve({ src: c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88), w: c.width, h: c.height });
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export class SlideCanvas {
  readonly el = document.createElement('div');
  private box = document.createElement('div');
  private overlay = document.createElement('div');
  private slideDom: HTMLElement | null = null;
  private nodes = new Map<string, { ref: SlideEl; dom: HTMLElement }>();
  private deckKey = '';
  slideId = '';
  selected: string[] = [];
  private editing: { id: string; content: HTMLElement; before: string } | null = null;
  private k = 1;
  private zoomMode: 'fit' | number = 'fit';
  private grid = false;
  private clip: SlideEl[] = [];
  private clipText = '';
  private drag: null | {
    kind: 'move' | 'resize' | 'rotate' | 'marquee';
    startX: number; startY: number; moved: boolean;
    base?: Deck; snapshot?: SlideEl[]; handle?: { sx: number; sy: number }; el?: SlideEl; center?: { x: number; y: number };
    pendingEdit?: string; shift?: boolean;
  } = null;
  private marquee = document.createElement('div');
  private guides: { x?: number; y?: number }[] = [];
  private unsub: () => void;
  private stopSize: (() => void) | null = null;
  readOnly: boolean;

  constructor(private store: DeckStore, private o: CanvasOptions = {}) {
    ensureSlideCss();
    this.readOnly = !!o.readOnly;
    const el = this.el;
    el.className = 'wy-pr-canvas';
    el.tabIndex = 0;
    el.setAttribute('role', 'application');
    el.setAttribute('aria-label', 'Slide');
    this.box.className = 'wy-pr-stagebox';
    this.overlay.className = 'wy-pr-overlay';
    this.marquee.className = 'wy-pr-marquee';
    this.marquee.hidden = true;
    el.append(this.box);
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('dblclick', (e) => this.onDbl(e));
    el.addEventListener('keydown', (e) => this.onKey(e));
    el.addEventListener('contextmenu', (e) => this.onContext(e));
    el.addEventListener('paste', (e) => this.onPaste(e));
    el.addEventListener('copy', (e) => { if (!this.editing) { e.preventDefault(); this.copy(e.clipboardData); } });
    el.addEventListener('cut', (e) => { if (!this.editing) { e.preventDefault(); this.copy(e.clipboardData); this.deleteSelected(); } });
    el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
    el.addEventListener('drop', (e) => { const f = [...(e.dataTransfer?.files ?? [])].filter((x) => x.type.startsWith('image/')); if (f.length && !this.readOnly) { e.preventDefault(); void this.addImages(f); } });
    document.addEventListener('selectionchange', this.onSelectionChange);
    this.unsub = store.on((e) => {
      if (this.editing && e.label !== 'live') this.endEdit(false);
      this.sync();
    });
    this.stopSize = observeSize(el, () => this.layout());
  }

  destroy(): void { this.unsub(); this.stopSize?.(); document.removeEventListener('selectionchange', this.onSelectionChange); this.el.remove(); }

  get deck(): Deck { return this.store.deck; }
  get slide(): Slide | undefined { return this.deck.slides.find((s) => s.id === this.slideId); }
  get isEditing(): boolean { return !!this.editing; }
  get editingId(): string | null { return this.editing?.id ?? null; }
  get scale(): number { return this.k; }
  get gridOn(): boolean { return this.grid; }

  focus(): void { if (this.editing) this.editing.content.focus(); else this.el.focus({ preventScroll: true }); }

  setSlide(id: string): void {
    if (id === this.slideId) return;
    if (this.editing) this.endEdit(true);
    this.slideId = id;
    this.selected = [];
    this.sync();
    this.o.onSelect?.();
  }

  setZoom(z: 'fit' | number): void { this.zoomMode = z; this.layout(); }
  get zoom(): 'fit' | number { return this.zoomMode; }
  setGrid(on: boolean): void { this.grid = on; this.overlay.classList.toggle('has-grid', on); this.drawOverlay(); }
  setReadOnly(on: boolean): void { this.readOnly = on; if (on && this.editing) this.endEdit(true); this.drawOverlay(); }

  // ---- drawing

  private layout() {
    const d = this.deck;
    const w = this.el.clientWidth - 48; const h = this.el.clientHeight - 48;
    const fit = w > 0 && h > 0 ? Math.min(w / d.width, h / d.height) : 1;
    this.k = Math.max(0.05, this.zoomMode === 'fit' ? fit : this.zoomMode);
    this.box.style.width = `${d.width * this.k}px`;
    this.box.style.height = `${d.height * this.k}px`;
    this.box.style.setProperty('--k', String(this.k));
    if (this.slideDom) this.slideDom.style.transform = `scale(${this.k})`;
    this.overlay.style.width = `${d.width}px`; this.overlay.style.height = `${d.height}px`;
    this.overlay.style.transform = `scale(${this.k})`;
  }

  /** Bring the DOM in line with the deck: only the boxes that changed are touched. */
  sync(): void {
    const deck = this.deck;
    const slide = deck.slides.find((s) => s.id === this.slideId);
    if (!slide) { this.slideId = deck.slides[0]?.id ?? ''; if (this.slideId && this.slideId !== slide) { this.sync(); } return; }
    const key = `${deck.theme}|${deck.width}|${deck.height}|${slide.id}|${slide.bg ?? ''}`;
    if (!this.slideDom || key !== this.deckKey) {
      this.deckKey = key;
      this.nodes.clear();
      const dom = renderSlide(deck, { ...slide, els: [] });
      dom.classList.add('is-editing-canvas');
      this.slideDom = dom;
      this.box.replaceChildren(dom, this.overlay);
      this.overlay.append(this.marquee);
    }
    const dom = this.slideDom;
    const seen = new Set<string>();
    let prev: Node | null = null;
    for (const e of slide.els) {
      seen.add(e.id);
      let n = this.nodes.get(e.id);
      if (!n || n.ref !== e) {
        const same = n && sameContent(n.ref, e);
        if (n && same) { applyGeometry(n.dom, e); n.ref = e; }
        else {
          const fresh = renderEl(deck, e, { prompts: !this.readOnly });
          if (n) n.dom.replaceWith(fresh);
          n = { ref: e, dom: fresh };
          this.nodes.set(e.id, n);
        }
      }
      const want = n.dom;
      if (want.parentNode !== dom || (prev ? prev.nextSibling : dom.firstChild) !== want) dom.insertBefore(want, prev ? prev.nextSibling : dom.firstChild);
      prev = want;
    }
    for (const [id, n] of [...this.nodes]) if (!seen.has(id)) { n.dom.remove(); this.nodes.delete(id); }
    this.selected = this.selected.filter((id) => seen.has(id));
    this.layout();
    fitSlide(dom);
    this.drawOverlay();
  }

  private elOf(id: string): SlideEl | undefined { return this.slide?.els.find((e) => e.id === id); }

  private drawOverlay() {
    const keep = this.marquee;
    for (const c of [...this.overlay.children]) if (c !== keep) c.remove();
    const slide = this.slide;
    if (!slide) return;
    const inv = 1 / this.k;
    this.overlay.style.setProperty('--inv', String(inv));
    if (!this.editing) {
      const single = this.selected.length === 1;
      for (const id of this.selected) {
        const e = slide.els.find((x) => x.id === id);
        if (!e) continue;
        const b = document.createElement('div');
        b.className = `wy-pr-selbox${single ? ' is-single' : ''}${e.locked ? ' is-locked' : ''}`;
        Object.assign(b.style, { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${e.h}px`, transform: e.rot ? `rotate(${e.rot}deg)` : '' });
        if (single && !e.locked && !this.readOnly) {
          for (const h of HANDLES) { const n = document.createElement('div'); n.className = `wy-pr-handle h-${h.h}`; n.dataset.handle = h.h; b.append(n); }
          const rot = document.createElement('div'); rot.className = 'wy-pr-rotate'; rot.dataset.handle = 'rotate'; rot.title = 'Rotate'; b.append(rot);
        }
        this.overlay.append(b);
      }
    } else {
      const e = this.elOf(this.editing.id);
      if (e) { const b = document.createElement('div'); b.className = 'wy-pr-selbox is-editing'; Object.assign(b.style, { left: `${e.x}px`, top: `${e.y}px`, width: `${e.w}px`, height: `${e.h}px`, transform: e.rot ? `rotate(${e.rot}deg)` : '' }); this.overlay.append(b); }
    }
    for (const g of this.guides) {
      const n = document.createElement('div');
      n.className = `wy-pr-guide ${g.x !== undefined ? 'v' : 'h'}`;
      if (g.x !== undefined) n.style.left = `${g.x}px`; else n.style.top = `${g.y}px`;
      this.overlay.append(n);
    }
  }

  // ---- selection

  select(ids: string[], additive = false): void {
    const next = additive ? [...new Set([...this.selected, ...ids])] : ids;
    if (next.length === this.selected.length && next.every((x, i) => x === this.selected[i])) return;
    this.selected = next;
    this.drawOverlay();
    this.o.onSelect?.();
  }

  selectAll(): void { this.select((this.slide?.els ?? []).map((e) => e.id)); }

  get selectedEls(): SlideEl[] { const s = this.slide; return s ? s.els.filter((e) => this.selected.includes(e.id)) : []; }

  // ---- pointer

  private toLogical(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = (this.slideDom ?? this.box).getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.k, y: (e.clientY - r.top) / this.k };
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (this.editing && this.editing.content.contains(target)) return;       // the caret goes where the click is
    if (this.editing) this.endEdit(true);
    this.focus();
    if (this.readOnly) return;
    const slide = this.slide;
    if (!slide) return;
    const p = this.toLogical(e);
    const handle = target.closest<HTMLElement>('[data-handle]');
    const base = this.deck;
    if (handle && this.selected.length === 1) {
      const el = this.elOf(this.selected[0])!;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      const cx = el.x + el.w / 2; const cy = el.y + el.h / 2;
      if (handle.dataset.handle === 'rotate') { this.drag = { kind: 'rotate', startX: e.clientX, startY: e.clientY, moved: false, base, el, center: { x: cx, y: cy } }; return; }
      const h = HANDLES.find((x) => x.h === handle.dataset.handle)!;
      this.drag = { kind: 'resize', startX: p.x, startY: p.y, moved: false, base, el, handle: { sx: h.sx, sy: h.sy }, shift: e.shiftKey };
      return;
    }
    const node = target.closest<HTMLElement>('.wy-pr-el');
    const id = node && this.slideDom?.contains(node) ? node.dataset.id : undefined;
    // a click on a box that is under the pointer but not hit-tested (the overlay) is still a click on the box
    const hitId = id ?? this.hitTest(p.x, p.y);
    if (hitId) {
      const el = this.elOf(hitId)!;
      e.preventDefault();
      this.el.setPointerCapture(e.pointerId);
      let pendingEdit: string | undefined;
      if (e.shiftKey) { this.select(this.selected.includes(hitId) ? this.selected.filter((x) => x !== hitId) : [...this.selected, hitId]); if (!this.selected.includes(hitId)) return; }
      else if (!this.selected.includes(hitId)) this.select([hitId]);
      else if (this.selected.length === 1 && (el.type === 'text' || (el.type === 'shape' && el.shape !== 'line'))) pendingEdit = hitId;
      if (el.locked) return;
      this.drag = { kind: 'move', startX: p.x, startY: p.y, moved: false, base, snapshot: this.selectedEls.filter((x) => !x.locked).map((x) => ({ ...x })), pendingEdit };
      return;
    }
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    if (!e.shiftKey) this.select([]);
    this.drag = { kind: 'marquee', startX: p.x, startY: p.y, moved: false, base, shift: e.shiftKey };
  }

  /** The topmost box at a point (boxes are hit by their rectangle, so a line or an empty text box can be picked). */
  private hitTest(x: number, y: number): string | undefined {
    const els = this.slide?.els ?? [];
    for (let i = els.length - 1; i >= 0; i--) {
      const e = els[i];
      const cx = e.x + e.w / 2; const cy = e.y + e.h / 2;
      const a = -rad(e.rot ?? 0);
      const lx = (x - cx) * Math.cos(a) - (y - cy) * Math.sin(a) + cx;
      const ly = (x - cx) * Math.sin(a) + (y - cy) * Math.cos(a) + cy;
      const pad = e.type === 'shape' && e.shape === 'line' ? 8 : 0;
      if (lx >= e.x - pad && lx <= e.x + e.w + pad && ly >= e.y - pad && ly <= e.y + e.h + pad) return e.id;
    }
    return undefined;
  }

  private onMove(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    const deck = d.base!;
    const slide = deck.slides.find((s) => s.id === this.slideId);
    if (!slide) return;
    const p = this.toLogical(e);
    if (d.kind === 'marquee') {
      if (!d.moved && Math.hypot(p.x - d.startX, p.y - d.startY) * this.k < 3) return;
      d.moved = true;
      const x0 = Math.min(d.startX, p.x); const y0 = Math.min(d.startY, p.y); const x1 = Math.max(d.startX, p.x); const y1 = Math.max(d.startY, p.y);
      Object.assign(this.marquee.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
      this.marquee.hidden = false;
      const hit = slide.els.filter((el) => el.x < x1 && el.x + el.w > x0 && el.y < y1 && el.y + el.h > y0).map((el) => el.id);
      this.select(d.shift ? [...new Set([...this.selected, ...hit])] : hit);
      return;
    }
    if (d.kind === 'move') {
      const dx0 = p.x - d.startX; const dy0 = p.y - d.startY;
      if (!d.moved && Math.hypot(dx0, dy0) * this.k < 3) return;
      d.moved = true;
      d.pendingEdit = undefined;
      let dx = dx0; let dy = dy0;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const snap = d.snapshot!;
      const minX = Math.min(...snap.map((s) => s.x)); const minY = Math.min(...snap.map((s) => s.y));
      const maxX = Math.max(...snap.map((s) => s.x + s.w)); const maxY = Math.max(...snap.map((s) => s.y + s.h));
      this.guides = [];
      if (!e.altKey) {
        const ids = new Set(snap.map((s) => s.id));
        const xs = [0, deck.width / 2, deck.width]; const ys = [0, deck.height / 2, deck.height];
        for (const o of slide.els) if (!ids.has(o.id)) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
        const tol = 6 / this.k;
        const fit = (vals: number[], targets: number[]): { d: number; at: number } | null => {
          let best: { d: number; at: number } | null = null;
          for (const v of vals) for (const t of targets) { const diff = t - v; if (Math.abs(diff) <= tol && (!best || Math.abs(diff) < Math.abs(best.d))) best = { d: diff, at: t }; }
          return best;
        };
        const sx = dx === 0 && e.shiftKey ? null : fit([minX + dx, (minX + maxX) / 2 + dx, maxX + dx], xs);
        const sy = dy === 0 && e.shiftKey ? null : fit([minY + dy, (minY + maxY) / 2 + dy, maxY + dy], ys);
        if (sx) { dx += sx.d; this.guides.push({ x: sx.at }); }
        if (sy) { dy += sy.d; this.guides.push({ y: sy.at }); }
        if (this.grid) { dx = Math.round((minX + dx) / 10) * 10 - minX; dy = Math.round((minY + dy) / 10) * 10 - minY; }
      }
      const byId = new Map(snap.map((s) => [s.id, s]));
      this.store.live(updateEls(deck, this.slideId, [...byId.keys()], (el) => ({ x: Math.round(byId.get(el.id)!.x + dx), y: Math.round(byId.get(el.id)!.y + dy) })));
      return;
    }
    if (d.kind === 'resize') {
      const el = d.el!; const { sx, sy } = d.handle!;
      d.moved = true;
      const a = rad(el.rot ?? 0);
      const dxw = p.x - d.startX; const dyw = p.y - d.startY;
      const dx = dxw * Math.cos(-a) - dyw * Math.sin(-a);
      const dy = dxw * Math.sin(-a) + dyw * Math.cos(-a);
      let w = Math.max(12, el.w + sx * dx); let h = Math.max(12, el.h + sy * dy);
      const keep = (e.shiftKey || el.type === 'image') && !(e.altKey);
      if (keep && el.w > 0 && el.h > 0) {
        const ratio = el.w / el.h;
        if (sx !== 0 && sy !== 0) { if (Math.abs(w - el.w) / el.w > Math.abs(h - el.h) / el.h) h = w / ratio; else w = h * ratio; }
        else if (sx !== 0) h = w / ratio; else w = h * ratio;
        w = Math.max(12, w); h = Math.max(12, h);
      }
      if (this.grid) { w = Math.max(10, Math.round(w / 10) * 10); h = Math.max(10, Math.round(h / 10) * 10); }
      const dw = w - el.w; const dh = h - el.h;
      const lx = (sx * dw) / 2; const ly = (sy * dh) / 2;
      const gx = lx * Math.cos(a) - ly * Math.sin(a); const gy = lx * Math.sin(a) + ly * Math.cos(a);
      const cx = el.x + el.w / 2 + gx; const cy = el.y + el.h / 2 + gy;
      this.store.live(updateEls(deck, this.slideId, [el.id], { x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) }));
      return;
    }
    if (d.kind === 'rotate') {
      const c = d.center!;
      d.moved = true;
      let ang = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
      if (e.shiftKey) ang = Math.round(ang / 15) * 15;
      else for (const t of [0, 90, 180, 270, -90, -180, 360]) if (Math.abs(ang - t) < 3) ang = t;
      ang = ((ang + 540) % 360) - 180;
      this.store.live(updateEls(deck, this.slideId, [d.el!.id], { rot: Math.round(ang) || undefined }));
    }
  }

  private onUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    this.marquee.hidden = true;
    this.guides = [];
    if (!d) return;
    this.store.endLive();
    this.drawOverlay();
    if (d.kind === 'move' && !d.moved && d.pendingEdit) this.startEdit(d.pendingEdit);
  }

  private onDbl(e: MouseEvent) {
    if (this.readOnly || this.editing) return;
    const p = this.toLogical(e);
    const id = this.hitTest(p.x, p.y);
    if (!id) return;
    const el = this.elOf(id);
    if (el && (el.type === 'text' || el.type === 'shape') && !el.locked) { this.select([id]); this.startEdit(id); }
  }

  private onContext(e: MouseEvent) {
    e.preventDefault();
    if (this.editing) return;
    const p = this.toLogical(e);
    const id = this.hitTest(p.x, p.y);
    if (id && !this.selected.includes(id)) this.select([id]);
    this.o.onContext?.(e.clientX, e.clientY, !!id);
  }

  // ---- editing text

  /** Type in a box. `text` (a typed character) is added at the end. */
  startEdit(id?: string, text?: string): void {
    if (this.readOnly || this.editing) return;
    const eid = id ?? this.selected[0];
    const el = eid ? this.elOf(eid) : undefined;
    const n = eid ? this.nodes.get(eid) : undefined;
    if (!el || !n || el.locked || (el.type !== 'text' && el.type !== 'shape')) return;
    let content = n.dom.querySelector<HTMLElement>('.wy-pr-content');
    if (!content) {
      // a shape without text yet: give it a text part
      this.store.set(updateEls(this.deck, this.slideId, [eid!], { html: '' }), 'edit');
      content = this.nodes.get(eid!)?.dom.querySelector<HTMLElement>('.wy-pr-content') ?? null;
      if (!content) return;
    }
    this.select([eid!]);
    content.contentEditable = 'true';
    content.spellcheck = true;
    content.classList.remove('is-empty');
    content.removeAttribute('data-prompt');
    this.editing = { id: eid!, content, before: el.html ?? '' };
    const box = content.parentElement as HTMLElement;
    box.style.overflow = 'visible';
    content.addEventListener('keydown', this.onEditKey);
    content.addEventListener('paste', this.onEditPaste);
    content.addEventListener('drop', this.onEditDrop);
    content.addEventListener('blur', this.onEditBlur);
    try { document.execCommand('defaultParagraphSeparator', false, 'div'); document.execCommand('styleWithCSS', false, 'false'); } catch { /* not supported */ }
    content.focus();
    const sel = getSelection();
    if (sel) { const r = document.createRange(); r.selectNodeContents(content); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
    if (text) document.execCommand('insertText', false, text);
    this.drawOverlay();
    this.o.onState?.();
  }

  private onEditKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); this.endEdit(true); this.el.focus({ preventScroll: true }); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const el = this.editing ? this.elOf(this.editing.id) : undefined;
      if (el?.style?.bullets) document.execCommand(e.shiftKey ? 'outdent' : 'indent');
    }
  };
  private onEditPaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (text) document.execCommand('insertText', false, text);
  };
  /** Something dropped into the text goes in as plain text; dropped HTML would carry markup that is only cleaned when typing ends. */
  private onEditDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const text = e.dataTransfer?.getData('text/plain') ?? '';
    if (text) document.execCommand('insertText', false, text);
  };
  private onEditBlur = () => {
    // the focus moved to the toolbar or the formula of another control: keep editing while the toolbar is used (its buttons keep the selection)
    window.setTimeout(() => { if (this.editing && document.activeElement !== this.editing.content && !this.el.contains(document.activeElement) && !(document.activeElement as HTMLElement | null)?.closest('.wy-oc, .wy-oc-layer')) this.endEdit(true); }, 0);
  };
  private onSelectionChange = () => { if (this.editing) this.o.onState?.(); };

  /** Finish typing. With `commit` the text goes into the deck (one undo step). */
  endEdit(commit = true): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    ed.content.removeEventListener('keydown', this.onEditKey);
    ed.content.removeEventListener('paste', this.onEditPaste);
    ed.content.removeEventListener('drop', this.onEditDrop);
    ed.content.removeEventListener('blur', this.onEditBlur);
    ed.content.contentEditable = 'false';
    const raw = ed.content.innerHTML;
    const html = cleanHTML(raw);
    const text = htmlToText(html).trim();
    const next = text === '' && !/<img/i.test(html) ? '' : html;
    const el = this.elOf(ed.id);
    if (commit && el && next !== (el.html ?? '')) {
      let deck = updateEls(this.deck, this.slideId, [ed.id], { html: next });
      // a plain text box grows with its text; the ones with a fixed place (title, body) shrink the text instead
      if (el.type === 'text' && !el.ph && !el.style?.fit && ed.content.scrollHeight > el.h) deck = updateEls(deck, this.slideId, [ed.id], { h: Math.ceil(ed.content.scrollHeight + 8) });
      this.store.set(deck, 'text');
    } else {
      this.deckKey = '';           // draw the box again (the editing changed its DOM)
      this.sync();
    }
    this.o.onState?.();
    this.drawOverlay();
  }

  /** The text selection inside the box being typed in, or null. */
  private range(): Range | null {
    const ed = this.editing;
    const sel = getSelection();
    if (!ed || !sel || sel.rangeCount === 0) return null;
    const r = sel.getRangeAt(0);
    return ed.content.contains(r.commonAncestorContainer) ? r : null;
  }

  get hasTextSelection(): boolean { const r = this.range(); return !!r && !r.collapsed; }

  /** Is this character format on at the cursor or selection while typing? */
  queryInline(cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough'): boolean { try { return !!this.editing && document.queryCommandState(cmd); } catch { return false; } }

  /** Bold, italic, underline or strike on the selected text while typing. */
  execInline(cmd: 'bold' | 'italic' | 'underline' | 'strikeThrough'): boolean {
    if (!this.editing) return false;
    this.editing.content.focus();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(cmd);
    this.o.onState?.();
    return true;
  }

  /** A style on the selected text while typing: colour, size, font, highlight (the selection is wrapped in a span). */
  styleSelection(style: Record<string, string>): boolean {
    const ed = this.editing;
    const r = this.range();
    if (!ed || !r) return false;
    ed.content.focus();
    if (r.collapsed) return false;
    const span = document.createElement('span');
    for (const [k, v] of Object.entries(style)) span.style.setProperty(k, v);
    span.append(r.extractContents());
    // inner spans that set the same property would win over the new one
    for (const inner of span.querySelectorAll<HTMLElement>('span')) for (const k of Object.keys(style)) inner.style.removeProperty(k);
    r.insertNode(span);
    const sel = getSelection();
    if (sel) { const nr = document.createRange(); nr.selectNodeContents(span); sel.removeAllRanges(); sel.addRange(nr); }
    this.o.onState?.();
    return true;
  }

  insertLink(href: string): boolean {
    if (!this.editing || !this.range()) return false;
    this.editing.content.focus();
    document.execCommand('createLink', false, href);
    return true;
  }

  // ---- keyboard

  private onKey(e: KeyboardEvent) {
    if (this.editing) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (this.readOnly) return;
    if (k === 'Escape') { this.select([]); return; }
    if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); this.selectAll(); return; }
    if (mod && (k === 'd' || k === 'D')) { e.preventDefault(); this.duplicate(); return; }
    if (mod && !e.shiftKey && ['b', 'i', 'u'].includes(k.toLowerCase()) && this.selected.length) {
      e.preventDefault();
      const f = k.toLowerCase() as 'b' | 'i' | 'u';
      const on = this.selectedEls.every((x) => !!x.style?.[f]);
      this.store.set(styleEls(this.deck, this.slideId, this.selected, { [f]: on ? undefined : 1 }), 'format');
      return;
    }
    if (!this.selected.length) return;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.deleteSelected(); return; }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); this.startEdit(); return; }
    if (k === 'Tab') {
      const els = this.slide?.els ?? [];
      if (!els.length) return;
      e.preventDefault();
      const i = els.findIndex((x) => x.id === this.selected[0]);
      this.select([els[(i + (e.shiftKey ? -1 : 1) + els.length) % els.length].id]);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const d = k === 'ArrowLeft' ? [-step, 0] : k === 'ArrowRight' ? [step, 0] : k === 'ArrowUp' ? [0, -step] : k === 'ArrowDown' ? [0, step] : null;
    if (d) {
      e.preventDefault();
      const ids = this.selectedEls.filter((x) => !x.locked).map((x) => x.id);
      if (ids.length) this.store.set(updateEls(this.deck, this.slideId, ids, (x) => ({ x: x.x + d[0], y: x.y + d[1] })), 'move');
      return;
    }
    // a typed character starts editing the box
    if (k.length === 1 && !mod && !e.altKey && this.selected.length === 1) {
      const el = this.selectedEls[0];
      if (el && (el.type === 'text' || (el.type === 'shape' && el.shape !== 'line')) && !el.locked) { e.preventDefault(); this.startEdit(el.id, k); }
    }
  }

  // ---- clipboard and structure

  deleteSelected(): void {
    if (this.readOnly || !this.selected.length) return;
    const ids = this.selectedEls.filter((x) => !x.locked).map((x) => x.id);
    if (!ids.length) return;
    this.selected = [];
    this.store.set(removeEls(this.deck, this.slideId, ids), 'delete');
    this.o.onSelect?.();
  }

  copy(data?: DataTransfer | null): void {
    const els = this.selectedEls;
    if (!els.length) return;
    this.clip = els.map((e) => ({ ...e }));
    this.clipText = els.map((e) => htmlToText(e.html ?? '')).join('\n\n');
    data?.setData('text/plain', this.clipText || ' ');
  }

  cut(): void { this.copy(null); this.deleteSelected(); }

  paste(): void {
    if (this.readOnly || !this.clip.length) return;
    const copies = cloneEls(this.clip, 24);
    this.clip = this.clip.map((e) => ({ ...e, x: e.x + 24, y: e.y + 24 }));    // the next paste goes a little further
    this.store.set(addEls(this.deck, this.slideId, copies), 'paste');
    this.select(copies.map((c) => c.id));
  }

  duplicate(): void {
    if (this.readOnly || !this.selected.length) return;
    const copies = cloneEls(this.selectedEls, 24);
    this.store.set(addEls(this.deck, this.slideId, copies), 'duplicate');
    this.select(copies.map((c) => c.id));
  }

  private onPaste(e: ClipboardEvent) {
    if (this.editing || this.readOnly) return;
    e.preventDefault();
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { void this.addImages(files); return; }
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (this.clip.length && (text === this.clipText || (text.trim() === '' && this.clipText.trim() === ''))) { this.paste(); return; }
    if (text.trim()) {
      const el = { ...newTextEl(this.deck, text), h: Math.min(this.deck.height - 80, 40 + text.split('\n').length * 40) };
      this.store.set(addEls(this.deck, this.slideId, [el]), 'paste');
      this.select([el.id]);
    } else if (this.clip.length) this.paste();
  }

  async addImages(files: File[]): Promise<void> {
    let deck = this.deck;
    const added: string[] = [];
    for (const f of files) {
      try {
        const { src, w, h } = await readImageFile(f);
        const el = newImageEl(deck, src, { w, h }, f.name.replace(/\.[^.]+$/, ''));
        deck = addEls(deck, this.slideId, [el]);
        added.push(el.id);
      } catch (e) { this.o.onError?.(e instanceof Error ? e.message : 'The picture could not be added'); }
    }
    if (added.length) { this.store.set(deck, 'image'); this.select(added); }
  }

  /** The slide's text as the slide's reading order, for accessible names. */
  get label(): string { const s = this.slide; return s ? s.els.map((e) => htmlToText(e.html ?? '')).filter(Boolean).join('. ') : ''; }

  /** Style fields of the selection for the toolbar (the first selected box). */
  styleOfSelection(): ElStyle { return this.selectedEls[0]?.style ?? {}; }
}

/** Do two boxes differ only in where they are? Then the DOM node can just be moved. */
function sameContent(a: SlideEl, b: SlideEl): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof SlideEl>) {
    if (k === 'x' || k === 'y' || k === 'w' || k === 'h' || k === 'rot') continue;
    if (a[k] !== b[k] && JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}

function applyGeometry(dom: HTMLElement, e: SlideEl): void {
  dom.style.left = `${e.x}px`; dom.style.top = `${e.y}px`; dom.style.width = `${e.w}px`; dom.style.height = `${e.h}px`;
  dom.style.transform = e.rot ? `rotate(${e.rot}deg)` : '';
}

export { textToHTML };
export type { Slide };
