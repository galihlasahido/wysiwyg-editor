import { NodeSelection } from 'prosemirror-state';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, defaultPlugins, Image } from '../src';
import { PICTURE_STYLES, pictureStyleCss, pictureStyleId } from '../src/picture-styles';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const els: HTMLElement[] = [];
afterEach(() => { els.splice(0).forEach((e) => e.remove()); });
const make = (html = `<p>text <img src="${PNG}" alt="dot" width="120"> more</p>`) => {
  const element = document.createElement('div');
  document.body.append(element);
  els.push(element);
  return createEditor({ element, plugins: defaultPlugins, content: html });
};
const selectImage = (e: ReturnType<typeof make>) => {
  let at = -1;
  e.view.state.doc.descendants((n, p) => { if (n.type.name === 'image') at = p; });
  e.view.dispatch(e.view.state.tr.setSelection(NodeSelection.create(e.view.state.doc, at)));
};

describe('picture styles', () => {
  it('has a gallery of unique styles, each with a label and CSS', () => {
    expect(PICTURE_STYLES.length).toBe(28);
    expect(new Set(PICTURE_STYLES.map((s) => s.id)).size).toBe(28);
    expect(PICTURE_STYLES.every((s) => s.label && s.css)).toBe(true);
    expect(PICTURE_STYLES.some((s) => /rotate/.test(s.css))).toBe(true);
  });

  it('only knows the ids in its table', () => {
    expect(pictureStyleId('metal-oval')).toBe('metal-oval');
    expect(pictureStyleId('nope')).toBeNull();
    expect(pictureStyleId('background:url(x)')).toBeNull();
    expect(pictureStyleId(null)).toBeNull();
    expect(pictureStyleCss('nope')).toBe('');
    expect(pictureStyleCss('metal-oval')).toContain('border-radius:50%');
  });

  it('applies a style to the selected image and writes it into the HTML', () => {
    const e = make();
    expect(e.execute('pictureStyle', 'frame-white')).toBe(false);          // nothing selected yet
    selectImage(e);
    expect(e.execute('pictureStyle', 'frame-white')).toBe(true);
    const html = e.getHTML();
    expect(html).toContain('data-picture-style="frame-white"');
    expect(html).toContain('class="wy-ps"');
    expect(html).toContain('border: 6px solid');                           // inline, so it shows in exported HTML too
    expect(html).toContain('width="120"');
  });

  it('reads the style back from HTML, and ignores anything that is not in the table', () => {
    const e = make();
    e.setHTML(`<p><img src="${PNG}" data-picture-style="reflected-black"></p>`);
    expect(e.getHTML()).toContain('data-picture-style="reflected-black"');
    e.setHTML(`<p><img src="${PNG}" data-picture-style="x;background:red" style="outline:9px solid red"></p>`);
    const html = e.getHTML();
    expect(html).not.toContain('data-picture-style');
    expect(html).not.toContain('background:red');
    expect(html).not.toContain('outline');
  });

  it('refuses an unknown style, changes one style to another and clears it', () => {
    const e = make();
    selectImage(e);
    expect(e.execute('pictureStyle', 'made-up')).toBe(false);
    e.execute('pictureStyle', 'rounded');
    e.execute('pictureStyle', 'metal-oval');
    expect(e.getHTML()).toContain('data-picture-style="metal-oval"');
    expect(e.getHTML()).not.toContain('data-picture-style="rounded"');
    expect(e.execute('pictureStyle', null)).toBe(true);
    expect(e.getHTML()).not.toContain('data-picture-style');
    expect(e.getHTML()).toContain('width="120"');
  });

  it('works on a cropped picture too', () => {
    const e = make();
    selectImage(e);
    e.execute('imageCrop', { left: 0.1, top: 0.1, right: 0.2, bottom: 0.1 }, { w: 40, h: 20 });
    selectImage(e);
    e.execute('pictureStyle', 'rotated-white');
    const html = e.getHTML();
    expect(html).toMatch(/class="wy-crop wy-ps"/);
    expect(html).toContain('data-picture-style="rotated-white"');
    expect(html).toMatch(/transform: rotate\(-5deg\)/);
    e.setHTML(html);
    expect(e.getHTML()).toContain('data-picture-style="rotated-white"');
  });

  it('draws the picture with its style in the editor, and has a gallery in the ribbon and the right-click menu', () => {
    const e = make();
    selectImage(e);
    e.execute('pictureStyle', 'oval-black');
    const img = e.view.dom.querySelector('img')!;
    expect(img.style.borderRadius).toBe('50%');
    expect(e.hasCommand('pictureStyle')).toBe(true);
    expect(Image.contextMenu).toBeTypeOf('function');
    const items = Image.contextMenu!({ editor: e, state: e.view.state, event: null, readonly: false, closest: () => null } as never);
    const sub = items.find((i) => typeof i === 'object' && i.label === 'Picture style') as { items: { label: string; checked?: boolean }[] };
    expect(sub.items.length).toBe(30);   // 28 styles, a separator, Clear style
    expect(sub.items.find((i) => typeof i === 'object' && i.checked)!.label).toBe('Oval, black outline');
  });
});
