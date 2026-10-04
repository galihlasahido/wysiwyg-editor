import { describe, expect, it } from 'vitest';
import { FILTER_PRESETS, NEUTRAL, applyAdjustments, boxBlur, clampRect, fitWithin, formatBytes, isNeutral, parseAspect, resizeLocked, rotatedBounds } from '../src/image-ops';

const px = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);

describe('applyAdjustments', () => {
  it('leaves pixels alone when nothing is adjusted', () => {
    const d = px(10, 20, 30);
    applyAdjustments(d, { ...NEUTRAL });
    expect([...d]).toEqual([10, 20, 30, 255]);
    expect(isNeutral({ ...NEUTRAL })).toBe(true);
    expect(isNeutral({ ...NEUTRAL, blur: 1 })).toBe(false);
  });
  it('brightens, clamps, and never touches alpha', () => {
    const d = px(100, 200, 250, 77);
    applyAdjustments(d, { ...NEUTRAL, brightness: 50 });
    expect([...d]).toEqual([228, 255, 255, 77]);
  });
  it('grayscale makes the channels equal; invert flips them', () => {
    const d = px(200, 100, 50);
    applyAdjustments(d, { ...NEUTRAL, grayscale: 100 });
    expect(d[0]).toBe(d[1]);
    expect(d[1]).toBe(d[2]);
    const e = px(10, 100, 250);
    applyAdjustments(e, { ...NEUTRAL, invert: true });
    expect([...e]).toEqual([245, 155, 5, 255]);
  });
  it('saturation -100 equals grayscale 100 and contrast moves values away from the middle', () => {
    const a = px(200, 100, 50);
    const b = px(200, 100, 50);
    applyAdjustments(a, { ...NEUTRAL, saturation: -100 });
    applyAdjustments(b, { ...NEUTRAL, grayscale: 100 });
    expect([...a]).toEqual([...b]);
    const c = px(160, 128, 96);
    applyAdjustments(c, { ...NEUTRAL, contrast: 50 });
    expect(c[0]).toBeGreaterThan(160);
    expect(c[2]).toBeLessThan(96);
    expect(c[1]).toBe(128);
  });
  it('warmth shifts red up and blue down; out-of-range and NaN inputs are limited', () => {
    const d = px(100, 100, 100);
    applyAdjustments(d, { ...NEUTRAL, warmth: 100 });
    expect(d[0]).toBeGreaterThan(d[2]);
    const e = px(100, 100, 100);
    applyAdjustments(e, { ...NEUTRAL, brightness: Number.NaN, contrast: 9999 });
    expect(e.every((v) => v >= 0 && v <= 255)).toBe(true);
  });
  it('every preset only uses known adjustments', () => {
    for (const p of FILTER_PRESETS) for (const k of Object.keys(p.adjust)) expect(k in NEUTRAL).toBe(true);
  });
});

describe('boxBlur', () => {
  it('spreads a bright pixel over its neighbours and keeps the average', () => {
    const w = 5;
    const h = 5;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 3; i < d.length; i += 4) d[i] = 255;
    const mid = (2 * w + 2) * 4;
    d[mid] = 255; d[mid + 1] = 255; d[mid + 2] = 255;
    boxBlur(d, w, h, 1);
    expect(d[mid]).toBeLessThan(255);
    expect(d[(2 * w + 1) * 4]).toBeGreaterThan(0);
    const total = [...d].filter((_, i) => i % 4 === 0).reduce((s, v) => s + v, 0);
    expect(Math.abs(total - 255)).toBeLessThan(8); // box blur conserves brightness (up to rounding)
  });
  it('does nothing for radius 0 and survives tiny images', () => {
    const d = px(1, 2, 3);
    boxBlur(d, 1, 1, 0);
    boxBlur(d, 1, 1, 5);
    expect(d[3]).toBe(255);
  });
});

describe('geometry', () => {
  it('fitWithin never scales up and keeps the ratio', () => {
    expect(fitWithin(4000, 2000, 1000, 1000)).toEqual({ w: 1000, h: 500 });
    expect(fitWithin(100, 50, 1000, 1000)).toEqual({ w: 100, h: 50 });
    expect(fitWithin(0, 5, 10, 10)).toEqual({ w: 0, h: 0 });
  });
  it('rotatedBounds for quarter turns and 45 degrees', () => {
    expect(rotatedBounds(300, 200, 90)).toEqual({ w: 200, h: 300 });
    expect(rotatedBounds(300, 200, 180)).toEqual({ w: 300, h: 200 });
    const r = rotatedBounds(100, 100, 45);
    expect(r.w).toBe(141);
    expect(r.h).toBe(141);
  });
  it('clampRect keeps the rectangle inside the image and honours a ratio', () => {
    expect(clampRect({ x: -10, y: 500, w: 5000, h: 20 }, 800, 600)).toEqual({ x: 0, y: 500, w: 800, h: 20 });
    const sq = clampRect({ x: 700, y: 0, w: 400, h: 300 }, 800, 600, 1);
    expect(sq.w).toBeCloseTo(sq.h);
    expect(sq.x + sq.w).toBeLessThanOrEqual(800);
    const wide = clampRect({ x: 0, y: 0, w: 800, h: 600 }, 800, 600, 16 / 9);
    expect(wide.w / wide.h).toBeCloseTo(16 / 9);
    expect(wide.h).toBeLessThanOrEqual(600);
  });
  it('parseAspect', () => {
    expect(parseAspect('16:9')).toBeCloseTo(16 / 9);
    expect(parseAspect('1:1')).toBe(1);
    expect(parseAspect('free')).toBeNull();
    expect(parseAspect('0:5')).toBeNull();
  });
  it('resizeLocked keeps the ratio and limits the size', () => {
    expect(resizeLocked(400, 200, { w: 200 })).toEqual({ w: 200, h: 100 });
    expect(resizeLocked(400, 200, { h: 50 })).toEqual({ w: 100, h: 50 });
    expect(resizeLocked(400, 200, { w: 99999 }, 8000).w).toBe(8000);
    expect(resizeLocked(400, 200, { w: Number.NaN }).w).toBeGreaterThanOrEqual(1);
  });
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
    expect(formatBytes(-1)).toBe('—');
  });
});
