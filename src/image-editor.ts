import { openDialog } from './dialog';
import { FILTER_PRESETS, NEUTRAL, applyAdjustments, boxBlur, clampRect, formatBytes, isNeutral, limit, parseAspect, resizeLocked, rotatedBounds, type Adjustments, type Rect } from './image-ops';

export interface ImageEditorOptions {
  /** A Blob, a data: URL, or an http(s) URL (which must allow CORS, or the browser will not let us read its pixels). */
  source: Blob | string;
  /** Shown in the title and used for the saved name. */
  name?: string;
  /** Larger images are scaled down on load. Default 24 megapixels. */
  maxPixels?: number;
  /** Output format. Default: JPEG for JPEG sources, WebP for WebP, PNG otherwise. */
  type?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** 0.1..1 for JPEG / WebP. Default 0.92. */
  quality?: number;
  saveLabel?: string;
}

export interface ImageEditResult {
  blob: Blob;
  width: number;
  height: number;
  type: string;
}

type Tool = 'crop' | 'rotate' | 'resize' | 'adjust' | 'draw' | 'text';
const TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'crop', label: 'Crop', icon: '⛶' },
  { id: 'rotate', label: 'Rotate', icon: '⟳' },
  { id: 'resize', label: 'Resize', icon: '⤡' },
  { id: 'adjust', label: 'Adjust', icon: '☼' },
  { id: 'draw', label: 'Draw', icon: '✎' },
  { id: 'text', label: 'Text', icon: 'T' },
];

const MAX_HISTORY = 12;
const PREVIEW_MAX = 900;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const button = (label: string, onClick: () => void, cls = 'wy-btn') => {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
};
function canvasOf(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}
const ctxOf = (c: HTMLCanvasElement) => {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  return ctx;
};
const clone = (c: HTMLCanvasElement) => {
  const n = canvasOf(c.width, c.height);
  ctxOf(n).drawImage(c, 0, 0);
  return n;
};

/** Draw `src` scaled to w x h, halving step by step so a big reduction stays sharp. */
function scaled(src: HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  let cur = src;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const half = canvasOf(cur.width / 2, cur.height / 2);
    const c = ctxOf(half);
    c.imageSmoothingQuality = 'high';
    c.drawImage(cur, 0, 0, half.width, half.height);
    cur = half;
  }
  const out = canvasOf(w, h);
  const c = ctxOf(out);
  c.imageSmoothingQuality = 'high';
  c.drawImage(cur, 0, 0, out.width, out.height);
  return out;
}

async function load(source: Blob | string): Promise<HTMLImageElement> {
  let blob: Blob;
  if (typeof source === 'string') {
    if (/^data:/i.test(source)) blob = await (await fetch(source)).blob();
    else if (/^https?:|^\//i.test(source)) {
      const res = await fetch(source, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) throw new Error(`Could not load the image (${res.status}).`);
      blob = await res.blob();
    } else throw new Error('Unsupported image address.');
  } else blob = source;
  if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml') throw new Error('This file type cannot be edited as a picture.');
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error('The image could not be read.');
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * A modal image editor: crop (free or fixed ratio), rotate / flip / straighten, resize, adjust (brightness, contrast,
 * saturation, warmth, blur) with filters, freehand drawing and text, with undo and redo. Everything runs in the
 * browser on a canvas. Resolves with the edited picture, or null when cancelled. Rejects if the image cannot be read
 * (an unsupported type, or a remote address that does not allow CORS).
 */
export async function openImageEditor(root: HTMLElement, options: ImageEditorOptions): Promise<ImageEditResult | null> {
  const img = await load(options.source);
  const maxPixels = options.maxPixels ?? 24_000_000;
  const k = Math.min(1, Math.sqrt(maxPixels / (img.naturalWidth * img.naturalHeight)));
  let work = canvasOf(img.naturalWidth * k, img.naturalHeight * k);
  ctxOf(work).drawImage(img, 0, 0, work.width, work.height);
  const sourceType = options.source instanceof Blob ? options.source.type : /^data:([^;,]+)/i.exec(options.source)?.[1] ?? '';
  let outType: 'image/png' | 'image/jpeg' | 'image/webp' = options.type ?? (sourceType === 'image/jpeg' ? 'image/jpeg' : sourceType === 'image/webp' ? 'image/webp' : 'image/png');
  let quality = options.quality ?? 0.92;

  return new Promise<ImageEditResult | null>((resolve) => {
    // ---- history
    let undo: HTMLCanvasElement[] = [];
    let redo: HTMLCanvasElement[] = [];
    let dirty = false;
    const push = () => { undo.push(clone(work)); if (undo.length > MAX_HISTORY) undo.shift(); redo = []; dirty = true; refresh(); };
    const setWork = (c: HTMLCanvasElement) => { work = c; showWork(); };

    // ---- layout
    const backdrop = el('div', 'wy-ie-backdrop');
    const dlg = el('div', 'wy-ie');
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-label', `Edit image${options.name ? `: ${options.name}` : ''}`);
    const head = el('div', 'wy-ie-head');
    const title = el('strong', 'wy-ie-title', options.name ? `Edit image · ${options.name}` : 'Edit image');
    const undoBtn = button('↶ Undo', () => doUndo());
    const redoBtn = button('↷ Redo', () => doRedo());
    const resetBtn = button('Reset', () => reset());
    const formatSel = el('select');
    formatSel.setAttribute('aria-label', 'Output format');
    for (const [v, l] of [['image/png', 'PNG'], ['image/jpeg', 'JPEG'], ['image/webp', 'WebP']] as const) formatSel.add(new Option(l, v, false, v === outType));
    const qLabel = el('label', 'wy-ie-q', 'Quality ');
    const qInput = el('input');
    qInput.type = 'range'; qInput.min = '40'; qInput.max = '100'; qInput.value = String(Math.round(quality * 100));
    qInput.setAttribute('aria-label', 'Quality');
    qLabel.append(qInput);
    const cancelBtn = button('Cancel', () => requestClose());
    const saveBtn = button(options.saveLabel ?? 'Save', () => save(), 'wy-btn wy-btn-primary');
    head.append(title, el('span', 'wy-ie-sp'), undoBtn, redoBtn, resetBtn, formatSel, qLabel, cancelBtn, saveBtn);

    const body = el('div', 'wy-ie-body');
    const rail = el('div', 'wy-ie-rail');
    rail.setAttribute('role', 'toolbar');
    rail.setAttribute('aria-label', 'Tools');
    const stage = el('div', 'wy-ie-stage');
    const holder = el('div', 'wy-ie-holder');
    const overlay = el('div', 'wy-ie-overlay');
    stage.append(holder);
    const panel = el('div', 'wy-ie-panel');
    body.append(rail, stage, panel);
    const foot = el('div', 'wy-ie-foot');
    dlg.append(head, body, foot);
    backdrop.append(dlg);

    let shown: HTMLCanvasElement = work; // the canvas on screen: the working image or an adjust preview
    const showCanvas = (c: HTMLCanvasElement) => {
      shown = c;
      c.className = 'wy-ie-canvas';
      holder.replaceChildren(c, overlay);
    };
    function showWork() { showCanvas(work); refresh(); positionCrop(); }
    const toImage = (e: PointerEvent): [number, number] => {
      const r = shown.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * work.width, ((e.clientY - r.top) / r.height) * work.height];
    };

    // ---- tools
    let tool: Tool = 'crop';
    const toolButtons = new Map<Tool, HTMLButtonElement>();
    for (const t of TOOLS) {
      const b = button('', () => select(t.id), 'wy-ie-tool');
      b.append(el('span', 'wy-ie-ico', t.icon), el('span', '', t.label));
      b.setAttribute('aria-pressed', 'false');
      toolButtons.set(t.id, b);
      rail.append(b);
    }

    function select(t: Tool) {
      leaveTool();
      tool = t;
      for (const [id, b] of toolButtons) b.setAttribute('aria-pressed', String(id === t));
      panel.replaceChildren();
      overlay.replaceChildren();
      overlay.className = `wy-ie-overlay is-${t}`;
      PANELS[t]();
      positionCrop();
    }
    function leaveTool() {
      if (shown !== work) showWork(); // drop an unapplied adjust preview
    }

    const row = (label: string, ...controls: HTMLElement[]) => {
      const r = el('label', 'wy-ie-row');
      r.append(el('span', 'wy-ie-lab', label), ...controls);
      return r;
    };
    const slider = (min: number, max: number, value: number, onInput: (v: number) => void, label: string) => {
      const input = el('input');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.value = String(value);
      input.setAttribute('aria-label', label);
      const out = el('output', 'wy-ie-out', String(value));
      input.addEventListener('input', () => { out.textContent = input.value; onInput(Number(input.value)); });
      const wrap = el('span', 'wy-ie-slider');
      wrap.append(input, out);
      return { wrap, input, out };
    };
    const hint = (t: string) => el('p', 'wy-ie-hint', t);

    // -- crop
    let crop: Rect = { x: 0, y: 0, w: work.width, h: work.height };
    let aspect: number | null = null;
    const cropBox = el('div', 'wy-ie-crop');
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) { const d = el('div', `wy-ie-h wy-ie-h-${h}`); d.dataset.h = h; cropBox.append(d); }
    function positionCrop() {
      if (tool !== 'crop' || shown !== work) return;
      const r = shown.getBoundingClientRect();
      const hr = holder.getBoundingClientRect();
      const sx = r.width / work.width;
      Object.assign(cropBox.style, { left: `${r.left - hr.left + crop.x * sx}px`, top: `${r.top - hr.top + crop.y * sx}px`, width: `${crop.w * sx}px`, height: `${crop.h * sx}px` });
      cropInfo.textContent = `${Math.round(crop.w)} × ${Math.round(crop.h)} px`;
    }
    const cropInfo = el('div', 'wy-ie-info');
    let dragging: { mode: string; start: [number, number]; rect: Rect } | null = null;
    cropBox.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      cropBox.setPointerCapture(e.pointerId);
      dragging = { mode: (e.target as HTMLElement).dataset.h ?? 'move', start: toImage(e), rect: { ...crop } };
    });
    cropBox.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const [x, y] = toImage(e);
      const dx = x - dragging.start[0];
      const dy = y - dragging.start[1];
      const r = { ...dragging.rect };
      const m = dragging.mode;
      if (m === 'move') { r.x += dx; r.y += dy; }
      else {
        if (m.includes('w')) { r.x += dx; r.w -= dx; }
        if (m.includes('e')) r.w += dx;
        if (m.includes('n')) { r.y += dy; r.h -= dy; }
        if (m.includes('s')) r.h += dy;
      }
      if (r.w < 8 || r.h < 8) return;
      const c = clampRect(r, work.width, work.height, aspect);
      // when a corner/edge drags and the ratio is fixed, keep the opposite side anchored
      if (m !== 'move') {
        if (m.includes('w')) c.x = dragging.rect.x + dragging.rect.w - c.w;
        if (m.includes('n')) c.y = dragging.rect.y + dragging.rect.h - c.h;
      }
      crop = clampRect(c, work.width, work.height, aspect);
      positionCrop();
    });
    const endDrag = () => { dragging = null; };
    cropBox.addEventListener('pointerup', endDrag);
    cropBox.addEventListener('pointercancel', endDrag);

    const PANELS: Record<Tool, () => void> = {
      crop() {
        const sel = el('select');
        sel.setAttribute('aria-label', 'Aspect ratio');
        for (const v of ['free', '1:1', '4:3', '3:2', '16:9', '9:16', '3:4']) sel.add(new Option(v === 'free' ? 'Free' : v, v));
        sel.addEventListener('change', () => {
          aspect = parseAspect(sel.value);
          crop = clampRect(aspect ? { ...crop, h: crop.w / aspect } : crop, work.width, work.height, aspect);
          positionCrop();
        });
        const apply = button('Apply crop', () => {
          const r = { x: Math.round(crop.x), y: Math.round(crop.y), w: Math.max(1, Math.round(crop.w)), h: Math.max(1, Math.round(crop.h)) };
          if (r.w === work.width && r.h === work.height) return;
          push();
          const out = canvasOf(r.w, r.h);
          ctxOf(out).drawImage(work, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
          setWork(out);
          crop = { x: 0, y: 0, w: out.width, h: out.height };
          positionCrop();
        }, 'wy-btn wy-btn-primary');
        panel.append(row('Ratio', sel), cropInfo, hint('Drag the box or its handles. Apply crop commits it; you can undo.'), apply);
        crop = { x: work.width * 0.1, y: work.height * 0.1, w: work.width * 0.8, h: work.height * 0.8 };
        overlay.append(cropBox);
      },
      rotate() {
        const angle = el('input');
        angle.type = 'number'; angle.min = '-180'; angle.max = '180'; angle.step = '1'; angle.value = '0';
        angle.setAttribute('aria-label', 'Angle in degrees');
        const turn = (deg: number) => {
          push();
          const b = rotatedBounds(work.width, work.height, deg);
          const out = canvasOf(b.w, b.h);
          const c = ctxOf(out);
          c.translate(out.width / 2, out.height / 2);
          c.rotate((deg * Math.PI) / 180);
          c.drawImage(work, -work.width / 2, -work.height / 2);
          setWork(out);
        };
        const flip = (h: boolean) => {
          push();
          const out = canvasOf(work.width, work.height);
          const c = ctxOf(out);
          c.translate(h ? out.width : 0, h ? 0 : out.height);
          c.scale(h ? -1 : 1, h ? 1 : -1);
          c.drawImage(work, 0, 0);
          setWork(out);
        };
        const bar = el('div', 'wy-ie-btns');
        bar.append(button('⟲ 90°', () => turn(-90)), button('⟳ 90°', () => turn(90)), button('⇋ Flip', () => flip(true)), button('⇅ Flip', () => flip(false)));
        panel.append(bar, row('Angle', angle, button('Rotate', () => { const d = limit(Number(angle.value), -180, 180); if (d) turn(d); })), hint('Any angle: the corners become transparent (white in JPEG).'));
      },
      resize() {
        let lock = true;
        const w = el('input'); w.type = 'number'; w.min = '1'; w.max = '8000'; w.value = String(work.width);
        const h = el('input'); h.type = 'number'; h.min = '1'; h.max = '8000'; h.value = String(work.height);
        w.setAttribute('aria-label', 'Width'); h.setAttribute('aria-label', 'Height');
        const ratio = el('input'); ratio.type = 'checkbox'; ratio.checked = true;
        ratio.addEventListener('change', () => (lock = ratio.checked));
        w.addEventListener('input', () => { if (lock) h.value = String(resizeLocked(work.width, work.height, { w: Number(w.value) }).h); });
        h.addEventListener('input', () => { if (lock) w.value = String(resizeLocked(work.width, work.height, { h: Number(h.value) }).w); });
        const pct = el('div', 'wy-ie-btns');
        for (const p of [25, 50, 75]) pct.append(button(`${p}%`, () => { w.value = String(Math.max(1, Math.round((work.width * p) / 100))); h.value = String(Math.max(1, Math.round((work.height * p) / 100))); }));
        const apply = button('Apply size', () => {
          const nw = Math.round(limit(Number(w.value), 1, 8000));
          const nh = Math.round(limit(Number(h.value), 1, 8000));
          if (nw === work.width && nh === work.height) return;
          push();
          setWork(scaled(work, nw, nh));
          w.value = String(work.width); h.value = String(work.height);
        }, 'wy-btn wy-btn-primary');
        panel.append(row('Width', w), row('Height', h), row('Keep ratio', ratio), pct, apply, hint('Pixels, up to 8000 on a side.'));
      },
      adjust() {
        const state: Adjustments = { ...NEUTRAL };
        // a small copy to preview on: adjusting a 20 MP image on every slider move would be slow
        const pk = Math.min(1, PREVIEW_MAX / Math.max(work.width, work.height));
        const base = scaled(work, Math.max(1, Math.round(work.width * pk)), Math.max(1, Math.round(work.height * pk)));
        const prev = canvasOf(base.width, base.height);
        const render = () => {
          const c = ctxOf(prev);
          c.clearRect(0, 0, prev.width, prev.height);
          c.drawImage(base, 0, 0);
          if (!isNeutral(state)) {
            const d = c.getImageData(0, 0, prev.width, prev.height);
            applyAdjustments(d.data, state);
            if (state.blur) boxBlur(d.data, prev.width, prev.height, state.blur * pk);
            c.putImageData(d, 0, 0);
          }
          if (shown !== prev) showCanvas(prev);
        };
        const sliders: Partial<Record<keyof Adjustments, ReturnType<typeof slider>>> = {};
        const defs: [keyof Adjustments, string, number, number][] = [['brightness', 'Brightness', -100, 100], ['contrast', 'Contrast', -100, 100], ['saturation', 'Saturation', -100, 100], ['warmth', 'Warmth', -100, 100], ['blur', 'Blur', 0, 20]];
        for (const [key, label, min, max] of defs) {
          const s = slider(min, max, 0, (v) => { (state as unknown as Record<string, number>)[key] = v; render(); }, label);
          sliders[key] = s;
          panel.append(row(label, s.wrap));
        }
        const setAll = (a: Partial<Adjustments>) => {
          Object.assign(state, NEUTRAL, a);
          for (const [key] of defs) { const s = sliders[key]!; s.input.value = String(state[key] as number); s.out.textContent = String(state[key]); }
          render();
        };
        const presets = el('div', 'wy-ie-presets');
        for (const p of FILTER_PRESETS) {
          const t = button('', () => setAll(p.adjust), 'wy-ie-preset');
          const thumb = canvasOf(64, Math.max(1, Math.round((64 * base.height) / base.width)));
          const tc = ctxOf(thumb);
          tc.drawImage(base, 0, 0, thumb.width, thumb.height);
          const td = tc.getImageData(0, 0, thumb.width, thumb.height);
          applyAdjustments(td.data, { ...NEUTRAL, ...p.adjust });
          if (p.adjust.blur) boxBlur(td.data, thumb.width, thumb.height, p.adjust.blur);
          tc.putImageData(td, 0, 0);
          t.append(thumb, el('span', '', p.label));
          presets.append(t);
        }
        const apply = button('Apply', () => {
          if (isNeutral(state)) return;
          push();
          const c = ctxOf(work);
          const d = c.getImageData(0, 0, work.width, work.height);
          applyAdjustments(d.data, state);
          if (state.blur) boxBlur(d.data, work.width, work.height, state.blur);
          c.putImageData(d, 0, 0);
          showWork();
          select('adjust'); // fresh sliders on the new image
        }, 'wy-btn wy-btn-primary');
        panel.append(el('div', 'wy-ie-sub', 'Filters'), presets, apply, button('Reset sliders', () => setAll({})));
        showCanvas(prev);
        render();
      },
      draw() {
        let color = '#ef4444';
        let size = 8;
        let mode: 'pen' | 'marker' = 'pen';
        const col = el('input'); col.type = 'color'; col.value = color; col.setAttribute('aria-label', 'Colour');
        col.addEventListener('input', () => (color = col.value));
        const sz = slider(1, 80, size, (v) => (size = v), 'Brush size');
        const pen = button('Pen', () => { mode = 'pen'; pen.setAttribute('aria-pressed', 'true'); marker.setAttribute('aria-pressed', 'false'); });
        const marker = button('Highlighter', () => { mode = 'marker'; marker.setAttribute('aria-pressed', 'true'); pen.setAttribute('aria-pressed', 'false'); });
        pen.setAttribute('aria-pressed', 'true'); marker.setAttribute('aria-pressed', 'false');
        const bar = el('div', 'wy-ie-btns');
        bar.append(pen, marker);
        panel.append(bar, row('Colour', col), row('Size', sz.wrap), hint('Draw on the picture. Each stroke is one undo step.'));
        let last: [number, number] | null = null;
        overlay.addEventListener('pointerdown', (e) => {
          if (tool !== 'draw') return;
          e.preventDefault();
          overlay.setPointerCapture(e.pointerId);
          push();
          last = toImage(e);
          stroke(last, last);
        });
        overlay.addEventListener('pointermove', (e) => { if (last) { const p = toImage(e); stroke(last, p); last = p; } });
        const stop = () => { last = null; };
        overlay.addEventListener('pointerup', stop);
        overlay.addEventListener('pointercancel', stop);
        const stroke = (a: [number, number], b: [number, number]) => {
          const c = ctxOf(work);
          c.save();
          c.lineCap = 'round'; c.lineJoin = 'round';
          c.strokeStyle = color; c.lineWidth = mode === 'marker' ? size * 2.5 : size;
          c.globalAlpha = mode === 'marker' ? 0.35 : 1;
          c.globalCompositeOperation = mode === 'marker' ? 'multiply' : 'source-over';
          c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1] + (a[0] === b[0] && a[1] === b[1] ? 0.01 : 0)); c.stroke();
          c.restore();
        };
      },
      text() {
        const input = el('textarea');
        input.rows = 2; input.value = 'Text'; input.setAttribute('aria-label', 'Text');
        const col = el('input'); col.type = 'color'; col.value = '#ffffff'; col.setAttribute('aria-label', 'Colour');
        const outline = el('input'); outline.type = 'checkbox'; outline.checked = true;
        const bold = el('input'); bold.type = 'checkbox'; bold.checked = true;
        const sz = slider(10, 300, Math.max(24, Math.round(work.width / 14)), () => {}, 'Text size');
        panel.append(row('Text', input), row('Size', sz.wrap), row('Colour', col), row('Bold', bold), row('Outline', outline), hint('Click the picture where the text should go.'));
        overlay.addEventListener('pointerdown', (e) => {
          if (tool !== 'text' || !input.value.trim()) return;
          e.preventDefault();
          push();
          const [x, y] = toImage(e);
          const c = ctxOf(work);
          const px = Number(sz.input.value);
          c.font = `${bold.checked ? '700 ' : ''}${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          c.textBaseline = 'top';
          c.fillStyle = col.value;
          c.lineJoin = 'round';
          c.lineWidth = Math.max(2, px / 8);
          c.strokeStyle = (() => { const v = col.value; const l = (parseInt(v.slice(1, 3), 16) * 299 + parseInt(v.slice(3, 5), 16) * 587 + parseInt(v.slice(5, 7), 16) * 114) / 1000; return l > 140 ? 'rgba(0,0,0,.85)' : 'rgba(255,255,255,.9)'; })();
          input.value.slice(0, 500).split('\n').slice(0, 10).forEach((line, i) => {
            if (outline.checked) c.strokeText(line, x, y + i * px * 1.2);
            c.fillText(line, x, y + i * px * 1.2);
          });
        });
      },
    };

    // ---- history, reset, size info
    function doUndo() { const p = undo.pop(); if (!p) return; redo.push(clone(work)); setWork(p); crop = { x: 0, y: 0, w: work.width, h: work.height }; select(tool); }
    function doRedo() { const n = redo.pop(); if (!n) return; undo.push(clone(work)); setWork(n); crop = { x: 0, y: 0, w: work.width, h: work.height }; select(tool); }
    function reset() {
      if (!undo.length) return;
      const first = undo[0];
      undo = []; redo = []; dirty = false;
      setWork(clone(first));
      select(tool);
    }
    function refresh() {
      undoBtn.disabled = !undo.length;
      redoBtn.disabled = !redo.length;
      resetBtn.disabled = !undo.length;
      foot.textContent = `${work.width} × ${work.height} px`;
    }
    formatSel.addEventListener('change', () => { outType = formatSel.value as typeof outType; qLabel.hidden = outType === 'image/png'; });
    qInput.addEventListener('input', () => (quality = Number(qInput.value) / 100));
    qLabel.hidden = outType === 'image/png';

    // ---- finishing
    let closed = false;
    const previous = document.activeElement as HTMLElement | null;
    const finish = (r: ImageEditResult | null) => {
      if (closed) return;
      closed = true;
      window.removeEventListener('resize', positionCrop);
      backdrop.remove();
      previous?.focus?.();
      resolve(r);
    };
    function requestClose() {
      if (!dirty) return finish(null);
      openDialog(dlg, { title: 'Discard your changes?', body: 'The edits to this picture will be lost.', actions: [{ label: 'Keep editing' }, { label: 'Discard', primary: true, onClick: () => finish(null) }] });
    }
    async function save() {
      leaveTool();
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        let out = work;
        if (outType === 'image/jpeg') { // JPEG has no transparency: flatten on white
          out = canvasOf(work.width, work.height);
          const c = ctxOf(out);
          c.fillStyle = '#fff'; c.fillRect(0, 0, out.width, out.height); c.drawImage(work, 0, 0);
        }
        const blob = await new Promise<Blob | null>((ok) => out.toBlob(ok, outType, quality));
        if (!blob) throw new Error('The browser could not encode the picture.');
        foot.textContent = `${work.width} × ${work.height} px · ${formatBytes(blob.size)}`;
        finish({ blob, width: work.width, height: work.height, type: blob.type || outType });
      } catch (err) {
        saveBtn.disabled = false;
        saveBtn.textContent = options.saveLabel ?? 'Save';
        foot.textContent = err instanceof Error ? err.message : 'Could not save.';
      }
    }

    backdrop.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'number');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); requestClose(); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (e.key === 'Tab') {
        const f = [...dlg.querySelectorAll<HTMLElement>('button, input, select, textarea')].filter((x) => !(x as HTMLButtonElement).disabled && !x.hidden && x.offsetParent !== null);
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    });
    for (const t of ['keypress', 'keyup', 'beforeinput', 'paste', 'cut', 'copy']) backdrop.addEventListener(t, (e) => e.stopPropagation());
    window.addEventListener('resize', positionCrop);
    root.append(backdrop);
    showWork();
    select('crop');
    saveBtn.focus();
  });
}
