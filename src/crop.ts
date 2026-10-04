/**
 * Image cropping math. A crop is the fraction of the *natural* image removed from each side, so it survives
 * resizing and is independent of how large the image is shown.
 */
export interface Crop { left: number; top: number; right: number; bottom: number }
export interface Natural { w: number; h: number }

/** The smallest visible share of the image on either axis (so a crop can never collapse to nothing). */
export const MIN_VISIBLE = 0.05;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v * 10000) / 10000;

/** Clamp a crop into a valid range; null means "no crop". Junk values are treated as 0. */
export function normalizeCrop(input: Partial<Crop> | null | undefined): Crop | null {
  if (!input || typeof input !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? clamp(v, 0, 1 - MIN_VISIBLE) : 0);
  let { left, top, right, bottom } = { left: n(input.left), top: n(input.top), right: n(input.right), bottom: n(input.bottom) };
  // Keep at least MIN_VISIBLE of each axis: shrink the larger side first.
  const fit = (a: number, b: number): [number, number] => {
    const excess = a + b - (1 - MIN_VISIBLE);
    if (excess <= 0) return [a, b];
    return a >= b ? [a - excess, b] : [a, b - excess];
  };
  [left, right] = fit(left, right);
  [top, bottom] = fit(top, bottom);
  const c = { left: round(left), top: round(top), right: round(right), bottom: round(bottom) };
  return c.left || c.top || c.right || c.bottom ? c : null;
}

/** Natural size of the visible region (what a crop leaves), in natural px. */
export function visibleSize(crop: Crop | null, nat: Natural): Natural {
  const c = crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
  return { w: nat.w * (1 - c.left - c.right), h: nat.h * (1 - c.top - c.bottom) };
}

export interface CropLayout {
  /** Size of the visible box. */
  width: number;
  height: number;
  /** Size and offset of the full image inside the box. */
  imgWidth: number;
  imgHeight: number;
  offsetX: number;
  offsetY: number;
}

/** Lay out a crop so the visible box is `displayWidth` px wide. */
export function cropLayout(crop: Crop, nat: Natural, displayWidth: number): CropLayout {
  const vw = 1 - crop.left - crop.right;
  const vh = 1 - crop.top - crop.bottom;
  const width = displayWidth;
  const height = (width * (vh * nat.h)) / (vw * nat.w);
  const imgWidth = width / vw;
  const imgHeight = height / vh;
  return { width, height, imgWidth, imgHeight, offsetX: -crop.left * imgWidth, offsetY: -crop.top * imgHeight };
}

/** Serialize as "left,top,right,bottom" for a data attribute. */
export const cropToString = (c: Crop) => `${c.left},${c.top},${c.right},${c.bottom}`;

export function cropFromString(s: string | null): Crop | null {
  if (!s) return null;
  const p = s.split(',').map(Number);
  // Data from HTML is untrusted: out-of-range values mean the markup is bogus, so reject it instead of clamping.
  if (p.length !== 4 || p.some((x) => !Number.isFinite(x) || x < 0 || x >= 1)) return null;
  return normalizeCrop({ left: p[0], top: p[1], right: p[2], bottom: p[3] });
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';

/**
 * Apply a drag of (dx, dy) fractions of the full image to a crop rectangle. Edges move independently,
 * `move` slides the whole rectangle without resizing it. Result is always valid.
 */
export function dragCrop(start: Crop, handle: Handle, dx: number, dy: number): Crop {
  let { left, top, right, bottom } = start;
  if (handle === 'move') {
    const w = 1 - left - right;
    const h = 1 - top - bottom;
    left = clamp(left + dx, 0, 1 - w);
    top = clamp(top + dy, 0, 1 - h);
    right = 1 - w - left;
    bottom = 1 - h - top;
  } else {
    if (handle.includes('w')) left = clamp(left + dx, 0, 1 - right - MIN_VISIBLE);
    if (handle.includes('e')) right = clamp(right - dx, 0, 1 - left - MIN_VISIBLE);
    if (handle.includes('n')) top = clamp(top + dy, 0, 1 - bottom - MIN_VISIBLE);
    if (handle.includes('s')) bottom = clamp(bottom - dy, 0, 1 - top - MIN_VISIBLE);
  }
  return { left: round(left), top: round(top), right: round(right), bottom: round(bottom) };
}

/**
 * Render the cropped region of an image to PNG bytes (browser only: needs canvas). Returns null when canvas
 * is unavailable, so callers can fall back to the full image.
 */
export async function cropBytes(data: Uint8Array, crop: Crop): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null;
    const bmp = await createImageBitmap(new Blob([data as Uint8Array<ArrayBuffer>]));
    const sx = Math.round(bmp.width * crop.left);
    const sy = Math.round(bmp.height * crop.top);
    const sw = Math.max(1, Math.round(bmp.width * (1 - crop.left - crop.right)));
    const sh = Math.max(1, Math.round(bmp.height * (1 - crop.top - crop.bottom)));
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(sw, sh) : Object.assign(document.createElement('canvas'), { width: sw, height: sh });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null;
    if (!ctx) return null;
    ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob: Blob | null = 'convertToBlob' in canvas ? await canvas.convertToBlob({ type: 'image/png' }) : await new Promise((r) => (canvas as HTMLCanvasElement).toBlob(r, 'image/png'));
    return blob ? { data: new Uint8Array(await blob.arrayBuffer()), width: sw, height: sh } : null;
  } catch {
    return null;
  }
}
