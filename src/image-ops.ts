/** Pure image maths for the image editor: no DOM, so it can be tested without a canvas. */

export interface Adjustments {
  /** -100..100 */ brightness: number;
  /** -100..100 */ contrast: number;
  /** -100..100 */ saturation: number;
  /** 0..100 */ grayscale: number;
  /** 0..100 */ sepia: number;
  /** -100 (cool) .. 100 (warm) */ warmth: number;
  invert: boolean;
  /** 0..20 pixels */ blur: number;
}

export const NEUTRAL: Readonly<Adjustments> = { brightness: 0, contrast: 0, saturation: 0, grayscale: 0, sepia: 0, warmth: 0, invert: false, blur: 0 };

export const isNeutral = (a: Adjustments): boolean => (Object.keys(NEUTRAL) as (keyof Adjustments)[]).every((k) => a[k] === NEUTRAL[k]);

export interface FilterPreset { id: string; label: string; adjust: Partial<Adjustments> }
export const FILTER_PRESETS: FilterPreset[] = [
  { id: 'none', label: 'Original', adjust: {} },
  { id: 'grayscale', label: 'Mono', adjust: { grayscale: 100 } },
  { id: 'noir', label: 'Noir', adjust: { grayscale: 100, contrast: 35, brightness: -8 } },
  { id: 'sepia', label: 'Sepia', adjust: { sepia: 85 } },
  { id: 'vivid', label: 'Vivid', adjust: { saturation: 45, contrast: 15 } },
  { id: 'fade', label: 'Fade', adjust: { contrast: -22, brightness: 12, saturation: -18 } },
  { id: 'warm', label: 'Warm', adjust: { warmth: 45, saturation: 10 } },
  { id: 'cool', label: 'Cool', adjust: { warmth: -45, saturation: 5 } },
  { id: 'invert', label: 'Invert', adjust: { invert: true } },
];

const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);
export const limit = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);

/** Apply colour adjustments to RGBA pixel data in place. Blur is separate (`boxBlur`) because it needs the image size. */
export function applyAdjustments(data: Uint8ClampedArray, a: Adjustments): void {
  const bri = limit(a.brightness, -100, 100) * 2.55;
  const c255 = limit(a.contrast, -100, 100) * 2.55;
  const contrast = (259 * (c255 + 255)) / (255 * (259 - c255));
  const sat = 1 + limit(a.saturation, -100, 100) / 100;
  const gray = limit(a.grayscale, 0, 100) / 100;
  const sep = limit(a.sepia, 0, 100) / 100;
  const warm = limit(a.warmth, -100, 100) / 100;
  if (!bri && !c255 && sat === 1 && !gray && !sep && !warm && !a.invert) return;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (bri) { r += bri; g += bri; b += bri; }
    if (c255) { r = (r - 128) * contrast + 128; g = (g - 128) * contrast + 128; b = (b - 128) * contrast + 128; }
    if (sat !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
    }
    if (warm) { r += warm * 30; b -= warm * 30; g += warm * 6; }
    if (sep) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sep; g += (sg - g) * sep; b += (sb - b) * sep;
    }
    if (gray) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r += (l - r) * gray; g += (l - g) * gray; b += (l - b) * gray;
    }
    if (a.invert) { r = 255 - r; g = 255 - g; b = 255 - b; }
    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
  }
}

/** Separable box blur in place (edges clamp). Radius in pixels; 0 does nothing. Two passes approximate a soft blur. */
export function boxBlur(data: Uint8ClampedArray, width: number, height: number, radius: number): void {
  const r = Math.round(limit(radius, 0, 20));
  if (!r || width < 1 || height < 1) return;
  const tmp = new Uint8ClampedArray(data.length);
  const pass = (src: Uint8ClampedArray, dst: Uint8ClampedArray, horizontal: boolean) => {
    const lines = horizontal ? height : width;
    const len = horizontal ? width : height;
    const stride = horizontal ? 4 : width * 4;
    const lineStride = horizontal ? width * 4 : 4;
    const win = 2 * r + 1;
    for (let l = 0; l < lines; l++) {
      const base = l * lineStride;
      for (let ch = 0; ch < 4; ch++) {
        let sum = 0;
        for (let k = -r; k <= r; k++) sum += src[base + clamp(k, 0, len - 1) * stride + ch];
        for (let i = 0; i < len; i++) {
          dst[base + i * stride + ch] = sum / win;
          sum += src[base + clamp(i + r + 1, 0, len - 1) * stride + ch] - src[base + clamp(i - r, 0, len - 1) * stride + ch];
        }
      }
    }
  };
  pass(data, tmp, true);
  pass(tmp, data, false);
}

/** Largest size that fits inside maxW x maxH with the same aspect ratio. Never scales up. */
export function fitWithin(w: number, h: number, maxW: number, maxH: number): { w: number; h: number } {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  const k = Math.min(1, maxW / w, maxH / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** Bounding box of a w x h image rotated by `deg` degrees. */
export function rotatedBounds(w: number, h: number, deg: number): { w: number; h: number } {
  const t = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(t));
  const s = Math.abs(Math.sin(t));
  return { w: Math.max(1, Math.round(w * c + h * s)), h: Math.max(1, Math.round(w * s + h * c)) };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** Keep a crop rectangle inside the image, at least `min` px, and (optionally) at a fixed aspect ratio (w / h). */
export function clampRect(r: Rect, imgW: number, imgH: number, aspect?: number | null, min = 8): Rect {
  let w = limit(r.w, min, imgW);
  let h = limit(r.h, min, imgH);
  if (aspect && aspect > 0) {
    // shrink the longer side to the ratio so the rectangle never grows outside the image
    if (w / h > aspect) w = h * aspect;
    else h = w / aspect;
    if (w > imgW) { w = imgW; h = w / aspect; }
    if (h > imgH) { h = imgH; w = h * aspect; }
  }
  return { x: limit(r.x, 0, imgW - w), y: limit(r.y, 0, imgH - h), w, h };
}

/** Parse "16:9", "1:1" or "free" into a ratio (w / h), or null for free. */
export function parseAspect(s: string): number | null {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(s.trim());
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a > 0 && b > 0 ? a / b : null;
}

/** New size when the user edits one side with the aspect ratio locked. Sides are limited to 1..max. */
export function resizeLocked(w: number, h: number, edit: { w?: number; h?: number }, max = 8000): { w: number; h: number } {
  const ratio = w / h;
  if (edit.w !== undefined) { const nw = Math.round(limit(edit.w, 1, max)); return { w: nw, h: Math.max(1, Math.min(max, Math.round(nw / ratio))) }; }
  if (edit.h !== undefined) { const nh = Math.round(limit(edit.h, 1, max)); return { w: Math.max(1, Math.min(max, Math.round(nh * ratio))), h: nh }; }
  return { w, h };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
}
