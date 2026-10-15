import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { createEditor, defaultPlugins, TabKey } from '../src';

const els: HTMLElement[] = [];
afterEach(() => { els.splice(0).forEach((e) => e.remove()); });
const make = (html: string, plugins = defaultPlugins) => {
  const element = document.createElement('div');
  document.body.append(element);
  els.push(element);
  return createEditor({ element, plugins, content: html });
};
const press = (e: ReturnType<typeof make>, key: string, init: KeyboardEventInit = {}) => {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  e.view.dom.dispatchEvent(ev);
  return ev.defaultPrevented;                     // true: the editor used the key, so the focus stays
};
const cursorIn = (e: ReturnType<typeof make>, text: string) => {
  let at = -1;
  e.view.state.doc.descendants((n, p) => { if (n.isTextblock && n.textContent === text) at = p + 1; });
  e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, at)));
};
const indentOf = (e: ReturnType<typeof make>, text: string) => {
  let v: unknown = null;
  e.view.state.doc.descendants((n) => { if (n.isTextblock && n.textContent === text) v = n.attrs.indentLeft; });
  return v;
};

describe('the Tab key', () => {
  it('is in the default plugins', () => {
    expect(defaultPlugins).toContain(TabKey);
  });

  it('indents a paragraph or a heading, and Shift+Tab takes it back', () => {
    const e = make('<p>one</p><h2>two</h2>');
    cursorIn(e, 'one');
    expect(press(e, 'Tab')).toBe(true);
    expect(indentOf(e, 'one')).toBe(48);
    press(e, 'Tab');
    expect(indentOf(e, 'one')).toBe(96);
    press(e, 'Tab', { shiftKey: true });
    expect(indentOf(e, 'one')).toBe(48);
    cursorIn(e, 'two');
    press(e, 'Tab');
    expect(indentOf(e, 'two')).toBe(48);
  });

  it('indents every paragraph in the selection', () => {
    const e = make('<p>one</p><p>two</p><p>three</p>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 2, 7)));
    press(e, 'Tab');
    expect([indentOf(e, 'one'), indentOf(e, 'two'), indentOf(e, 'three')]).toEqual([48, 48, null]);
  });

  it('moves between table cells, and adds a row after the last one', () => {
    const e = make('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
    cursorIn(e, 'a');
    expect(press(e, 'Tab')).toBe(true);
    expect(e.view.state.selection.$from.parent.textContent).toBe('b');
    expect(e.view.dom.querySelectorAll('tr').length).toBe(1);
    expect(press(e, 'Tab')).toBe(true);                                  // last cell: a new row
    expect(e.view.dom.querySelectorAll('tr').length).toBe(2);
    expect(press(e, 'Tab', { shiftKey: true })).toBe(true);              // and back
    expect(e.view.state.selection.$from.parent.textContent).toBe('b');
  });

  it('keeps working in a list (the level) and never leaves from inside one', () => {
    const e = make('<ul><li><p>x</p></li><li><p>y</p></li></ul>');
    cursorIn(e, 'y');
    expect(press(e, 'Tab')).toBe(true);
    expect(e.getHTML()).toMatch(/<li><p>x<\/p><ul><li><p>y<\/p><\/li><\/ul><\/li>/);
    cursorIn(e, 'x');
    expect(press(e, 'Tab')).toBe(true);                                  // the first item cannot go deeper: nothing happens, the focus stays
  });

  it('Escape, then Tab leaves the editor (no keyboard trap), and the next Tab indents again', () => {
    const e = make('<p>one</p>');
    cursorIn(e, 'one');
    press(e, 'Escape');
    expect(press(e, 'Tab')).toBe(false);                                 // left to the browser: the focus moves on
    expect(indentOf(e, 'one')).toBeNull();
    expect(press(e, 'Tab')).toBe(true);
    expect(indentOf(e, 'one')).toBe(48);
    press(e, 'Escape');
    press(e, 'a');                                                       // any other key puts Tab back to work
    expect(press(e, 'Tab')).toBe(true);
  });

  it('does nothing in a read-only editor, and when something other than text is selected', () => {
    const e = make('<p>one</p>');
    cursorIn(e, 'one');
    e.setReadOnly(true);
    expect(press(e, 'Tab')).toBe(false);
    expect(indentOf(e, 'one')).toBeNull();
  });

  it('can be left out to keep the browser\'s behaviour', () => {
    const e = make('<p>one</p>', defaultPlugins.filter((p) => p !== TabKey));
    cursorIn(e, 'one');
    expect(press(e, 'Tab')).toBe(false);
    expect(indentOf(e, 'one')).toBeNull();
  });
});
