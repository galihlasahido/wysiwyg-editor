import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { createEditor, defaultPlugins } from '../src';

const els: HTMLElement[] = [];
afterEach(() => { els.splice(0).forEach((e) => e.remove()); });
const make = (html: string) => {
  const element = document.createElement('div');
  document.body.append(element);
  els.push(element);
  return createEditor({ element, plugins: defaultPlugins, content: html });
};
const cursorIn = (e: ReturnType<typeof make>, text: string) => {
  let at = -1;
  e.view.state.doc.descendants((n, p) => { if (n.isTextblock && n.textContent === text) at = p + 1; });
  e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, at)));
};

describe('bullets and numbering on a heading', () => {
  it('makes a heading a bulleted item and keeps it a heading', () => {
    const e = make('<h2>Plan</h2><p>text</p>');
    cursorIn(e, 'Plan');
    expect(e.execute('bulletList')).toBe(true);
    expect(e.getHTML()).toContain('<ul><li><h2>Plan</h2></li></ul>');
  });

  it('numbers a heading, and takes the list off again', () => {
    const e = make('<h1>Intro</h1><p>text</p>');
    cursorIn(e, 'Intro');
    e.execute('orderedList');
    expect(e.getHTML()).toMatch(/<ol[^>]*><li><h1>Intro<\/h1><\/li><\/ol>/);
    e.execute('orderedList');
    expect(e.getHTML()).toContain('<h1>Intro</h1>');
    expect(e.getHTML()).not.toContain('<ol');
  });

  it('turns a selection of headings and paragraphs into one list', () => {
    const e = make('<h2>One</h2><p>two</p><h2>Three</h2>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, e.view.state.doc.content.size - 1)));
    expect(e.execute('bulletList')).toBe(true);
    const html = e.getHTML();
    expect(html.match(/<li>/g)!.length).toBe(3);
    expect(html).toContain('<h2>One</h2>');
    expect(html).toContain('<h2>Three</h2>');
  });

  it('switches between bullets and numbers on a heading item', () => {
    const e = make('<h2>Plan</h2>');
    cursorIn(e, 'Plan');
    e.execute('bulletList');
    e.execute('orderedList');
    expect(e.getHTML()).toMatch(/<ol[^>]*><li><h2>Plan<\/h2><\/li><\/ol>/);
  });

  it('reads and writes such a list as HTML and Markdown', () => {
    const e = make('<ol><li><h2>Plan</h2><p>details</p></li></ol>');
    expect(e.getHTML()).toMatch(/<li><h2>Plan<\/h2><p>details<\/p><\/li>/);
    expect(e.getMarkdown()).toContain('Plan');
  });

  it('still makes a list out of an ordinary paragraph', () => {
    const e = make('<p>plain</p>');
    cursorIn(e, 'plain');
    e.execute('bulletList');
    expect(e.getHTML()).toContain('<ul><li><p>plain</p></li></ul>');
  });
});
