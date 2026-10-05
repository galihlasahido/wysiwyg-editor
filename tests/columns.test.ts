import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Columns, createEditor, defaultPlugins } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content: string) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Columns()] });
};

describe('Columns', () => {
  it('wraps the selected blocks, changes count/rule/gap and unwraps', () => {
    const ed = make('<p>one</p><p>two</p><p>three</p>');
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 2, 8)));
    expect(ed.execute('insertColumns', 3)).toBe(true);
    const el = ed.view.dom.querySelector('.wy-columns') as HTMLElement;
    expect(el.style.columnCount).toBe('3');
    expect(el.querySelectorAll('p')).toHaveLength(2);
    expect(ed.execute('setColumns', { count: 2, rule: 'solid', gap: 40 })).toBe(true);
    const html = ed.getHTML();
    expect(html).toContain('data-columns="2"');
    expect(html).toContain('data-rule="solid"');
    expect(html).toContain('data-gap="40"');
    expect(ed.execute('removeColumns')).toBe(true);
    expect(ed.view.dom.querySelector('.wy-columns')).toBeNull();
    expect(ed.view.dom.querySelectorAll('p')).toHaveLength(3);
    ed.destroy();
  });
  it('clamps hostile values on load and refuses setColumns outside columns', () => {
    const ed = make('<div data-columns="99" data-rule="x;color:red" data-gap="9999"><p>a</p></div><p>b</p>');
    const n = ed.view.state.doc.child(0);
    expect(n.attrs).toEqual({ count: 4, rule: 'none', gap: 80 });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    expect(ed.execute('setColumns', { count: 3 })).toBe(false);
    ed.destroy();
  });
  it('exports Markdown as plain flowing text', () => {
    const ed = make('<div data-columns="2"><p>a</p><p>b</p></div>');
    expect(ed.getMarkdown().trim()).toBe('a\n\nb');
    ed.destroy();
  });
});
