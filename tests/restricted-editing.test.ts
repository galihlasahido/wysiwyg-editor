import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { RestrictedEditing, createEditor, defaultPlugins } from '../src';
import type { Editor } from '../src';

const HTML =
  '<section data-locked data-label="Head"><h1>Title</h1></section>' +
  '<p>free text</p>' +
  '<section data-locked data-label="Legal"><p>fixed clause</p></section>' +
  '<div data-editable-region><p>fill</p></div>';

let ed: Editor;
const make = (authorMode = false) => {
  ed = createEditor({ element: document.body.appendChild(document.createElement('div')), content: HTML, plugins: [...defaultPlugins, RestrictedEditing({ authorMode })] });
  return ed;
};
const find = (text: string) => {
  let at = -1;
  ed.view.state.doc.descendants((n, pos) => {
    if (at < 0 && n.isText && n.text!.includes(text)) at = pos + n.text!.indexOf(text);
  });
  return at;
};
const insertAt = (pos: number, text: string) => ed.view.dispatch(ed.view.state.tr.insertText(text, pos));
afterEach(() => ed?.destroy());

describe('RestrictedEditing styling', () => {
  it('adds custom classes, keeps variants and can hide labels', () => {
    ed = createEditor({ element: document.body.appendChild(document.createElement('div')), content: '<section data-locked data-variant="legal"><p>x</p></section><div data-editable-region><p>y</p></div><section data-locked data-variant="bad value"><p>z</p></section>', plugins: [...defaultPlugins, RestrictedEditing({ lockedClass: 'my-lock', regionClass: 'my-fill', labels: false })] });
    const lock = ed.view.dom.querySelector('section[data-locked]')!;
    expect(lock.classList.contains('my-lock') && lock.classList.contains('wy-locked') && lock.classList.contains('wy-no-label')).toBe(true);
    expect(lock.getAttribute('data-variant')).toBe('legal');
    expect(ed.view.dom.querySelector('.wy-region')!.classList.contains('my-fill')).toBe(true);
    expect(ed.view.dom.querySelectorAll('section[data-locked]')[1].hasAttribute('data-variant')).toBe(false);
  });
});

describe('RestrictedEditing', () => {
  it('rejects typing inside a locked section', () => {
    make();
    const before = ed.getHTML();
    insertAt(find('Title') + 2, 'X');
    expect(ed.getHTML()).toBe(before);
  });

  it('rejects deleting text of a locked section', () => {
    make();
    const p = find('fixed');
    ed.view.dispatch(ed.view.state.tr.delete(p, p + 3));
    expect(ed.getHTML()).toContain('fixed clause');
  });

  it('rejects a range delete that spans a lock', () => {
    make();
    const from = find('free') + 2;
    const to = find('fill');
    ed.view.dispatch(ed.view.state.tr.delete(from, to));
    expect(ed.getHTML()).toContain('fixed clause');
    expect(ed.getHTML()).toContain('free text');
  });

  it('allows editing outside locks and inside fill-in regions', () => {
    make();
    insertAt(find('free') + 1, 'Z');
    insertAt(find('fill') + 1, 'Q');
    expect(ed.getHTML()).toContain('fZree');
    expect(ed.getHTML()).toContain('fQill');
  });

  it('does not call onChange for a rejected edit', () => {
    let n = 0;
    ed = createEditor({ element: document.body.appendChild(document.createElement('div')), content: HTML, plugins: [...defaultPlugins, RestrictedEditing()], onChange: () => n++ });
    insertAt(find('Title') + 1, 'X');
    expect(n).toBe(0);
    insertAt(find('free') + 1, 'X');
    expect(n).toBe(1);
  });

  it('lets author mode change locked text and create locks', () => {
    make(true);
    insertAt(find('Title') + 1, 'X');
    expect(ed.getHTML()).toContain('TXitle');
    const p = find('free');
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, p + 1)));
    expect(ed.execute('lockBlocks', 'Mine')).toBe(true);
    expect(ed.getHTML()).toContain('data-label="Mine"');
  });

  it('refuses lock commands outside author mode and toggles', () => {
    make();
    expect(ed.execute('lockBlocks')).toBe(false);
    ed.execute('toggleAuthorMode');
    insertAt(find('Title') + 1, 'X');
    expect(ed.getHTML()).toContain('TXitle');
    ed.execute('toggleAuthorMode');
    const before = ed.getHTML();
    insertAt(find('fixed') + 1, 'Y');
    expect(ed.getHTML()).toBe(before);
  });

  it('round-trips the markup', () => {
    make();
    const html = ed.getHTML();
    expect(html).toContain('data-locked');
    expect(html).toContain('data-editable-region');
  });
});
