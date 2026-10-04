import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Editor, cropFromString, cropLayout, cropToString, defaultPlugins, dragCrop, normalizeCrop, visibleSize } from '../src';

describe('crop math', () => {
  it('normalizes: clamps, treats junk as 0, and returns null for "no crop"', () => {
    expect(normalizeCrop(null)).toBeNull();
    expect(normalizeCrop({})).toBeNull();
    expect(normalizeCrop({ left: 0, top: 0 })).toBeNull();
    expect(normalizeCrop({ left: NaN, top: 'x' as any, right: Infinity })).toBeNull();
    expect(normalizeCrop({ left: -1, top: 0.2 })).toEqual({ left: 0, top: 0.2, right: 0, bottom: 0 });
    expect(normalizeCrop({ left: 2 })).toEqual({ left: 0.95, top: 0, right: 0, bottom: 0 });
  });

  it('never lets opposite sides collapse the image', () => {
    const c = normalizeCrop({ left: 0.6, right: 0.6, top: 0.9, bottom: 0.9 })!;
    expect(1 - c.left - c.right).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(1 - c.top - c.bottom).toBeGreaterThanOrEqual(0.05 - 1e-9);
  });

  it('computes the visible size and a consistent layout', () => {
    const nat = { w: 400, h: 200 };
    const crop = { left: 0.25, top: 0, right: 0.25, bottom: 0.5 };
    expect(visibleSize(crop, nat)).toEqual({ w: 200, h: 100 });
    expect(visibleSize(null, nat)).toEqual(nat);
    const L = cropLayout(crop, nat, 100);
    expect(L.width).toBe(100);
    expect(L.height).toBe(50); // same aspect ratio as the visible region (2:1)
    expect(L.imgWidth).toBe(200);
    expect(L.imgHeight).toBe(100);
    expect(L.offsetX).toBe(-50); // the left quarter is clipped away
    expect(L.offsetY).toBeCloseTo(0);
  });

  it('serializes to and from a data attribute, rejecting malformed input', () => {
    const c = { left: 0.1, top: 0.2, right: 0.3, bottom: 0.05 };
    expect(cropFromString(cropToString(c))).toEqual(c);
    for (const bad of [null, '', '1,2,3', 'a,b,c,d', '0.1,0.2,0.3,x', '0,0,0,0', '9,9,9,9', '-0.5,0,0,0', '1,0,0,0']) expect(cropFromString(bad)).toBeNull();
  });

  it('dragCrop moves single edges, corners, and the whole box within bounds', () => {
    const none = { left: 0, top: 0, right: 0, bottom: 0 };
    expect(dragCrop(none, 'w', 0.2, 0)).toEqual({ left: 0.2, top: 0, right: 0, bottom: 0 });
    expect(dragCrop(none, 'e', -0.3, 0)).toEqual({ left: 0, top: 0, right: 0.3, bottom: 0 }); // dragging the right edge left crops
    expect(dragCrop(none, 'se', -0.1, -0.2)).toEqual({ left: 0, top: 0, right: 0.1, bottom: 0.2 });
    expect(dragCrop(none, 'w', -5, 0).left).toBe(0); // cannot go past the image
    expect(dragCrop(none, 'w', 5, 0).left).toBeCloseTo(0.95); // cannot collapse
    const c = { left: 0.2, top: 0.2, right: 0.2, bottom: 0.2 };
    const moved = dragCrop(c, 'move', 0.1, -0.1);
    expect(moved).toEqual({ left: 0.3, top: 0.1, right: 0.1, bottom: 0.3 }); // size unchanged
    expect(dragCrop(c, 'move', 9, 9)).toEqual({ left: 0.4, top: 0.4, right: 0, bottom: 0 }); // clamped to the image edge
  });
});

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function make(html: string) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  const e = new Editor({ element: el, content: html, plugins: defaultPlugins });
  editors.push(e);
  return e;
}
const selectImage = (e: Editor) => {
  let pos = -1;
  e.view.state.doc.descendants((n, p) => void (n.type.name === 'image' && (pos = p)));
  e.view.dispatch(e.view.state.tr.setSelection(NodeSelection.create(e.view.state.doc, pos)));
  return pos;
};
const attrs = (e: Editor) => {
  let a: any;
  e.view.state.doc.descendants((n) => void (n.type.name === 'image' && (a = n.attrs)));
  return a;
};
const IMG = '<p><img src="https://x.test/a.png" width="200"></p>';
const NAT = { w: 400, h: 200 };

describe('imageCrop command', () => {
  it('crops, keeps the on-screen scale, and records the natural size', () => {
    const e = make(IMG);
    selectImage(e);
    expect(e.execute('imageCrop', { left: 0.25, right: 0.25 }, NAT)).toBe(true);
    expect(attrs(e)).toMatchObject({ crop: { left: 0.25, top: 0, right: 0.25, bottom: 0 }, nw: 400, nh: 200 });
    // 200px wide was 400px of image => scale 0.5; the visible half (200 natural px) is now 100px wide
    expect(attrs(e).width).toBe(100);
  });

  it('refuses without a selected image or when the natural size is unknown', () => {
    const e = make(IMG);
    expect(e.execute('imageCrop', { left: 0.1 }, NAT)).toBe(false); // nothing selected
    selectImage(e);
    expect(e.execute('imageCrop', { left: 0.1 })).toBe(false); // jsdom never loads images: size unknown
    expect(attrs(e).crop).toBeNull();
  });

  it('resets a crop back to the full image at the same scale', () => {
    const e = make(IMG);
    selectImage(e);
    e.execute('imageCrop', { left: 0.5 }, NAT);
    expect(attrs(e).width).toBe(100);
    expect(e.execute('resetCrop')).toBe(true);
    expect(attrs(e)).toMatchObject({ crop: null, nw: null, nh: null, width: 200 });
    expect(e.execute('resetCrop')).toBe(false); // already uncropped
  });

  it('a second crop starts from the current one without drifting the scale', () => {
    const e = make(IMG);
    selectImage(e);
    e.execute('imageCrop', { left: 0.5 }, NAT);
    e.execute('imageCrop', { left: 0.5, top: 0.5 }, NAT);
    expect(attrs(e).width).toBe(100); // the width did not change, only the height
    e.execute('imageCrop', { left: 0.25, right: 0.25 });
    expect(attrs(e).nw).toBe(400); // natural size is remembered
  });

  it('survives an HTML round trip as a portable clipping box', () => {
    const e = make(IMG);
    selectImage(e);
    e.execute('imageCrop', { left: 0.25, right: 0.25, bottom: 0.5 }, NAT);
    const html = e.getHTML();
    expect(html).toContain('class="wy-crop"');
    expect(html).toContain('data-crop="0.25,0,0.25,0.5"');
    expect(html).toContain('overflow: hidden'); // works without object-view-box
    e.setHTML(html);
    expect(attrs(e)).toMatchObject({ crop: { left: 0.25, top: 0, right: 0.25, bottom: 0.5 }, nw: 400, nh: 200, width: 100 });
    expect(e.getHTML()).toBe(html);
  });

  it('keeps caption and alt text on cropped images', () => {
    const e = make('<p><img src="https://x.test/a.png" alt="A cat" data-caption="Fig 1" width="200"></p>');
    selectImage(e);
    e.execute('imageCrop', { top: 0.2 }, NAT);
    e.setHTML(e.getHTML());
    expect(attrs(e)).toMatchObject({ alt: 'A cat', caption: 'Fig 1' });
  });

  it('drops cropped images with unsafe or inconsistent data', () => {
    const box = (extra: string, src = 'https://x.test/a.png') => `<p><span data-crop="0.1,0,0,0" ${extra}><img src="${src}"></span></p>`;
    expect(make(box('data-nw="400" data-nh="200"', 'javascript:alert(1)')).getHTML()).not.toContain('javascript:');
    // Invalid crop data degrades gracefully: the image is kept, just uncropped.
    const noSize = make(box('data-nw="0" data-nh="200"')).getHTML();
    expect(noSize).toContain('<img');
    expect(noSize).not.toContain('wy-crop');
    const bad = make('<p><span data-crop="9,9,9,9" data-nw="4" data-nh="2"><img src="https://x.test/a.png"></span></p>').getHTML();
    expect(bad).toContain('<img');
    expect(bad).not.toContain('data-crop');
    expect(make(box('data-nw="400" data-nh="200"')).getHTML()).toContain('wy-crop'); // the valid one parses
  });

  it('alt text command sets, trims and clears', () => {
    const e = make(IMG);
    selectImage(e);
    expect(e.execute('imageAlt', '  A dog  ')).toBe(true);
    expect(attrs(e).alt).toBe('A dog');
    e.execute('imageAlt', '   ');
    expect(attrs(e).alt).toBeNull();
    expect(e.execute('imageAlt', null)).toBe(false); // cancelled prompt
  });
});

describe('crop mode UI', () => {
  const cropped = '<p><span class="wy-crop" data-crop="0.25,0,0.25,0" data-nw="400" data-nh="200" style="width: 100px"><img src="https://x.test/a.png"></span></p>';
  const ptr = (el: Element, type: string, x: number, y: number) => el.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));

  it('shows the full image with a crop rectangle and handles, and applies with Enter', () => {
    const e = make(cropped);
    selectImage(e);
    expect(e.execute('cropImage')).toBe(true);
    const ui = e.root.querySelector<HTMLElement>('.wy-crop-ui')!;
    expect(ui).not.toBeNull();
    expect(ui.querySelectorAll('.wy-crop-handle')).toHaveLength(8);
    const rect = ui.querySelector<HTMLElement>('.wy-crop-rect')!;
    expect(rect.style.left).toBe('25%');
    expect(rect.style.right).toBe('25%');
    // drag the west handle 20px to the right: full image is 200px wide at scale 0.5, so +0.1 of the width
    const west = rect.querySelector('.wy-crop-w')!;
    ptr(west, 'pointerdown', 100, 50);
    ptr(west, 'pointermove', 120, 50);
    ptr(west, 'pointerup', 120, 50);
    expect(rect.style.left).toBe('35%');
    rect.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(e.root.querySelector('.wy-crop-ui')).toBeNull();
    expect(attrs(e).crop).toMatchObject({ left: 0.35, right: 0.25 });
  });

  it('Escape and deselecting cancel without changing the image', () => {
    const e = make(cropped);
    selectImage(e);
    e.execute('cropImage');
    e.root.querySelector('.wy-crop-rect')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(e.root.querySelector('.wy-crop-ui')).toBeNull();
    expect(attrs(e).crop).toMatchObject({ left: 0.25, right: 0.25 });
    selectImage(e);
    e.execute('cropImage');
    // moving the selection elsewhere ends the crop
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1)));
    expect(e.root.querySelector('.wy-crop-ui')).toBeNull();
    expect(attrs(e).crop).toMatchObject({ left: 0.25 });
  });

  it('arrow keys move the rectangle, the Reset button clears it, and an empty crop removes the crop', () => {
    const e = make(cropped);
    selectImage(e);
    e.execute('cropImage');
    const rect = e.root.querySelector<HTMLElement>('.wy-crop-rect')!;
    rect.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
    expect(rect.style.left).toBe('30%');
    [...e.root.querySelectorAll<HTMLElement>('.wy-crop-bar button')].find((b) => b.title === 'Reset')!.click();
    expect(rect.style.left).toBe('0%');
    [...e.root.querySelectorAll<HTMLElement>('.wy-crop-bar button')].find((b) => b.title === 'Apply crop')!.click();
    expect(attrs(e).crop).toBeNull();
    expect(attrs(e).width).toBe(200); // the full image at the scale it had
  });

  it('cannot start on an image whose size is unknown, or twice', () => {
    const e = make(IMG); // never loaded in jsdom
    selectImage(e);
    expect(e.execute('cropImage')).toBe(false);
    const f = make(cropped);
    selectImage(f);
    expect(f.execute('cropImage')).toBe(true);
    expect(f.execute('cropImage')).toBe(false);
  });
});
