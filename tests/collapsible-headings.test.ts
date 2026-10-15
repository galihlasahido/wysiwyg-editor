import { TextSelection } from 'prosemirror-state';
import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, defaultPlugins, CollapsibleHeadings } from '../src';

const DOC = '<h1>One</h1><p>a1</p><h2>One-A</h2><p>a2</p><h3>Deep</h3><p>a3</p><h2>One-B</h2><p>b1</p><h1>Two</h1><p>t1</p>';
const els: HTMLElement[] = [];
afterEach(() => { els.splice(0).forEach((e) => e.remove()); });
const make = (html = DOC) => {
  const element = document.createElement('div');
  document.body.append(element);
  els.push(element);
  const editor = createEditor({ element, plugins: defaultPlugins, content: html });
  return editor;
};
/** What a reader sees: the top-level blocks that are not hidden. */
const shown = (e: ReturnType<typeof make>) => [...e.view.dom.children].filter((c) => !c.classList.contains('wy-heading-hidden') && /^(H[1-6]|P)$/.test(c.tagName)).map((c) => c.textContent);
const headingPos = (e: ReturnType<typeof make>, text: string) => { let at = -1; e.view.state.doc.forEach((n, o) => { if (n.type.name === 'heading' && n.textContent === text) at = o; }); return at; };
const cursorIn = (e: ReturnType<typeof make>, text: string) => {
  let at = -1;
  e.view.state.doc.descendants((n, p) => { if (n.isTextblock && n.textContent === text) at = p + 1; });
  e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, at)));
};

describe('collapsible headings', () => {
  it('is part of the default plugins and marks the editor', () => {
    expect(defaultPlugins).toContain(CollapsibleHeadings);
    expect(make().view.dom.classList.contains('wy-collapsible')).toBe(true);
  });

  it('hides everything under a heading up to the next one of the same or a higher level', () => {
    const e = make();
    cursorIn(e, 'One-A');
    expect(e.execute('toggleHeadingFold')).toBe(true);
    expect(shown(e)).toEqual(['One', 'a1', 'One-A', 'One-B', 'b1', 'Two', 't1']);   // a2, Deep and a3 are hidden
    expect(e.view.dom.querySelectorAll('.wy-heading-folded').length).toBe(1);
  });

  it('a top level heading hides its sub-headings too, and opens again', () => {
    const e = make();
    cursorIn(e, 'One');
    e.execute('toggleHeadingFold');
    expect(shown(e)).toEqual(['One', 'Two', 't1']);
    e.execute('toggleHeadingFold');
    expect(shown(e)).toEqual(['One', 'a1', 'One-A', 'a2', 'Deep', 'a3', 'One-B', 'b1', 'Two', 't1']);
  });

  it('keeps the state of inner headings while an outer one is closed', () => {
    const e = make();
    cursorIn(e, 'One-A'); e.execute('toggleHeadingFold');   // close One-A
    cursorIn(e, 'One'); e.execute('toggleHeadingFold');      // close One
    e.execute('toggleHeadingFold');                          // open One
    expect(shown(e)).toEqual(['One', 'a1', 'One-A', 'One-B', 'b1', 'Two', 't1']);   // One-A is still closed
  });

  it('the cursor inside text that gets hidden moves to the heading, and the section stays closed', () => {
    const e = make();
    cursorIn(e, 'a2');
    e.execute('toggleHeadingFold');   // nearest heading above is One-A
    expect(e.view.state.selection.$from.parent.textContent).toBe('One-A');
    expect(shown(e)).not.toContain('a2');
  });

  it('opens the section when the cursor is moved into hidden text (search, undo, the outline)', () => {
    const e = make();
    cursorIn(e, 'One');
    e.execute('toggleHeadingFold');
    expect(shown(e)).toEqual(['One', 'Two', 't1']);
    cursorIn(e, 'a3');
    expect(shown(e)).toContain('a3');
    expect(e.view.dom.querySelectorAll('.wy-heading-folded').length).toBe(0);
  });

  it('collapses and expands every heading, and shows down to a level', () => {
    const e = make();
    e.execute('collapseHeadings');
    expect(shown(e)).toEqual(['One', 'Two']);
    e.execute('expandHeadings');
    expect(shown(e).length).toBe(10);
    e.execute('showHeadingLevel', 2);
    expect(shown(e)).toEqual(['One', 'a1', 'One-A', 'One-B', 'Two', 't1']);   // level 1 open, level 2 and deeper closed
    e.execute('showHeadingLevel', 3);
    expect(shown(e)).toEqual(['One', 'a1', 'One-A', 'a2', 'Deep', 'One-B', 'b1', 'Two', 't1']);
    e.execute('showHeadingLevel', 1);
    expect(shown(e)).toEqual(['One', 'Two']);
  });

  it('follows the headings when the text before them changes, and forgets a deleted heading', () => {
    const e = make();
    cursorIn(e, 'One-B');
    e.execute('toggleHeadingFold');
    cursorIn(e, 'a1');
    e.view.dispatch(e.view.state.tr.insertText('XX'));
    e.view.dispatch(e.view.state.tr.insert(e.view.state.doc.child(0).nodeSize, e.view.state.schema.nodes.paragraph.create(null, e.view.state.schema.text('new'))));
    expect(shown(e)).not.toContain('b1');
    expect(e.view.dom.querySelectorAll('.wy-heading-folded').length).toBe(1);
    const at = headingPos(e, 'One-B');
    e.view.dispatch(e.view.state.tr.delete(at, at + e.view.state.doc.nodeAt(at)!.nodeSize));
    expect(e.view.dom.querySelectorAll('.wy-heading-folded').length).toBe(0);
    expect(shown(e)).toContain('b1');
  });

  it('does not change the document, its HTML or undo', () => {
    const e = make();
    const before = e.getHTML();
    cursorIn(e, 'One');
    e.execute('toggleHeadingFold');
    expect(e.getHTML()).toBe(before);
    expect(e.view.dom.querySelectorAll('.wy-heading-folded, .wy-heading-hidden').length).toBeGreaterThan(0);
    e.execute('undo');
    expect(e.view.dom.querySelectorAll('.wy-heading-folded').length).toBe(1);   // folding is a view state: undo leaves it alone
  });

  it('a click in the margin left of a heading toggles it', () => {
    const e = make();
    const h = e.view.dom.querySelector('h1')!;
    h.getBoundingClientRect = () => ({ left: 100, right: 400, top: 0, bottom: 30, width: 300, height: 30, x: 100, y: 0, toJSON: () => ({}) });
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 80, button: 0 }));
    expect(shown(e)).toEqual(['One', 'Two', 't1']);
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 120, button: 0 }));   // inside the text: ordinary click
    expect(shown(e)).toEqual(['One', 'Two', 't1']);
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 80, button: 0 }));
    expect(shown(e).length).toBe(10);
  });

  it('a numbered heading folds what follows it inside its list item', () => {
    const e = make('<ol><li><h1>Numbered</h1><p>under</p></li><li><p>other</p></li></ol>');
    cursorIn(e, 'Numbered');
    expect(e.execute('toggleHeadingFold')).toBe(true);
    const li = e.view.dom.querySelector('li')!;
    expect(li.querySelector('p')!.classList.contains('wy-heading-hidden')).toBe(true);
    expect(li.querySelector('h1')!.classList.contains('wy-heading-folded')).toBe(true);
    expect(e.view.dom.querySelectorAll('li')[1].querySelector('p')!.classList.contains('wy-heading-hidden')).toBe(false);
    e.execute('toggleHeadingFold');
    expect(li.querySelector('p')!.classList.contains('wy-heading-hidden')).toBe(false);
  });

  it('a heading in a quote does not fold, and a document without headings is fine', () => {
    const e = make('<p>nothing here</p>');
    expect(e.execute('toggleHeadingFold')).toBe(false);
    expect(e.execute('collapseHeadings')).toBe(false);
    expect(e.execute('expandHeadings')).toBe(true);
  });

  it('works in a read-only editor', () => {
    const e = make();
    e.setReadOnly(true);
    expect(e.execute('collapseHeadings')).toBe(true);
    expect(shown(e)).toEqual(['One', 'Two']);
  });
});
