import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { buildContextMenu, createEditor, tidyEntries } from '../src';
import type { ContextMenuEntry } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => { roots.splice(0).forEach((r) => r.remove()); document.querySelectorAll('.wy-ctx-layer').forEach((n) => n.remove()); });
const make = (content: string, opts: { readOnly?: boolean } = {}) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, ...opts });
};
const inCell = (ed: ReturnType<typeof make>, text: string) => {
  let pos = -1;
  ed.view.state.doc.descendants((n, p) => { if (pos < 0 && n.isText && n.text === text) pos = p + 1; });
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)));
};
const caret = (ed: ReturnType<typeof make>) => {
  let pos = -1;
  ed.view.state.doc.descendants((n, p) => { if (pos < 0 && n.isTextblock) pos = p + 1; });
  ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)));
};
const labels = (es: ContextMenuEntry[]): string[] => es.flatMap((e) => (e === '-' ? [] : [e.label]));
const hasTable = (ed: ReturnType<typeof make>) => /<table/.test(ed.getHTML());

describe('deleting a table that is down to one cell', () => {
  it('Backspace removes an empty 1x1 table', () => {
    const ed = make('<p>before</p><table><tr><td><p></p></td></tr></table><p>after</p>');
    caret(ed);
    let pos = -1;
    ed.view.state.doc.descendants((n, p) => { if (n.type.name === 'table_cell') pos = p + 2; });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)));
    expect(ed.execute('deleteRow')).toBe(true);
    expect(hasTable(ed)).toBe(false);
    ed.destroy();
  });
  it('deleteColumn on the only column removes the table', () => {
    const ed = make('<table><tr><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></table><p>x</p>');
    inCell(ed, 'a');
    expect(ed.execute('deleteColumn')).toBe(true);
    expect(hasTable(ed)).toBe(false);
    ed.destroy();
  });
  it('deleteRow still keeps the table when other rows remain', () => {
    const ed = make('<table><tr><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></table>');
    inCell(ed, 'a');
    ed.execute('deleteRow');
    expect(hasTable(ed)).toBe(true);
    expect(ed.getHTML()).not.toContain('>a<');
    ed.destroy();
  });
  it('the Backspace key removes an empty single cell', () => {
    const ed = make('<p>x</p><table><tr><td><p></p></td></tr></table><p>y</p>');
    let pos = -1;
    ed.view.state.doc.descendants((n, p) => { if (n.type.name === 'table_cell') pos = p + 2; });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, pos)));
    ed.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(hasTable(ed)).toBe(false);
    ed.destroy();
  });
});

describe('context menu entries', () => {
  it('offers table tools inside a table, and not outside', () => {
    const ed = make('<p>plain</p><table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
    caret(ed);
    expect(labels(buildContextMenu(ed, null))).not.toContain('Delete table');
    inCell(ed, 'a');
    const l = labels(buildContextMenu(ed, null));
    expect(l).toEqual(expect.arrayContaining(['Insert row above', 'Insert column right', 'Delete table', 'Merge cells', 'Cut', 'Paste']));
    ed.destroy();
  });
  it('offers list tools in a numbered list, with the numbering styles', () => {
    const ed = make('<ol><li><p>one</p></li></ol>');
    inCell(ed, 'one');
    const es = buildContextMenu(ed, null);
    expect(labels(es)).toEqual(expect.arrayContaining(['Bulleted list', 'Numbered list', 'Numbering style', 'Restart numbering at 1']));
    ed.destroy();
  });
  it('changes a bulleted list into a numbered one and sets the style', () => {
    const ed = make('<ul><li><p>one</p></li></ul>');
    inCell(ed, 'one');
    ed.execute('orderedList');
    expect(ed.getHTML()).toContain('<ol');
    ed.execute('listStyle', 'a');
    expect(ed.getHTML()).toContain('type="a"');
    ed.destroy();
  });
  it('offers link tools on a link', () => {
    const ed = make('<p><a href="https://example.com">site</a></p>');
    inCell(ed, 'site');
    expect(labels(buildContextMenu(ed, null))).toEqual(expect.arrayContaining(['Open link', 'Copy link address', 'Edit link…', 'Remove link']));
    ed.destroy();
  });
  it('a read-only editor only gets copy-type items', () => {
    const ed = make('<p><a href="https://example.com">site</a></p><table><tr><td><p>a</p></td></tr></table>', { readOnly: true });
    inCell(ed, 'site');
    const l = labels(buildContextMenu(ed, null));
    expect(l).toEqual(expect.arrayContaining(['Copy', 'Open link', 'Select all']));
    expect(l).not.toContain('Paste');
    expect(l).not.toContain('Remove link');
    ed.destroy();
  });
  it('tidyEntries drops leading, trailing and doubled separators and empty submenus', () => {
    const out = tidyEntries(['-', { label: 'a' }, '-', '-', { label: 'sub', items: [] }, '-', { label: 'b' }, '-'], false);
    expect(out).toEqual([{ label: 'a' }, '-', { label: 'b' }]);
  });
});

describe('context menu popup', () => {
  it('opens on contextmenu, runs an item and closes; Escape closes', () => {
    const ed = make('<table><tr><td><p>a</p></td><td><p>b</p></td></tr></table>');
    inCell(ed, 'a');
    ed.view.dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    const menu = document.querySelector('.wy-ctx');
    expect(menu).not.toBeNull();
    const item = [...document.querySelectorAll<HTMLElement>('.wy-ctx-item')].find((i) => i.textContent?.includes('Insert column right'))!;
    item.click();
    expect(document.querySelector('.wy-ctx')).toBeNull();
    expect(ed.view.dom.querySelectorAll('td').length).toBe(3);
    ed.view.dom.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(document.querySelector('.wy-ctx')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.wy-ctx')).toBeNull();
    ed.destroy();
  });
  it('Shift + right-click leaves the browser menu alone', () => {
    const ed = make('<p>a</p>');
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, shiftKey: true });
    ed.view.dom.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(document.querySelector('.wy-ctx')).toBeNull();
    ed.destroy();
  });
});
