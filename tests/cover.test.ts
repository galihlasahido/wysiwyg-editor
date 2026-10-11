import { afterEach, describe, expect, it } from 'vitest';
import { createEditor, defaultPlugins, Pages, paginate } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content = '<p>text</p>') => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Pages({})] });
};
const IMG = 'data:image/png;base64,iVBORw0KGgo=';

describe('cover page', () => {
  it('goes first, and a second one replaces it', () => {
    const ed = make();
    expect(ed.execute('coverPage', IMG, 'a')).toBe(true);
    expect(ed.view.state.doc.firstChild!.type.name).toBe('cover_page');
    ed.execute('coverPage', 'https://example.com/b.jpg');
    const covers = [] as string[];
    ed.view.state.doc.forEach((n) => n.type.name === 'cover_page' && covers.push(n.attrs.src));
    expect(covers).toEqual(['https://example.com/b.jpg']);
    ed.destroy();
  });
  it('refuses an unsafe address', () => {
    const ed = make();
    expect(ed.execute('coverPage', 'javascript:alert(1)')).toBe(false);
    expect(ed.getHTML()).not.toContain('cover');
    ed.destroy();
  });
  it('removeCover takes it out and reports false when there is none', () => {
    const ed = make();
    expect(ed.execute('removeCover')).toBe(false);
    ed.execute('coverPage', IMG);
    expect(ed.execute('removeCover')).toBe(true);
    expect(ed.view.state.doc.firstChild!.type.name).toBe('paragraph');
    ed.destroy();
  });
  it('round-trips through HTML', () => {
    const ed = make();
    ed.execute('coverPage', IMG, 'My cover');
    const html = ed.getHTML();
    expect(html).toContain('data-cover-page');
    ed.setHTML(html);
    expect(ed.view.state.doc.firstChild!.attrs).toMatchObject({ src: IMG, alt: 'My cover' });
    ed.destroy();
  });
  it('drops an unsafe picture from pasted HTML', () => {
    const ed = make('<div data-cover-page><img src="javascript:alert(1)"></div><p>x</p>');
    expect(ed.view.state.doc.firstChild!.type.name).toBe('paragraph');
    ed.destroy();
  });
  it('the next block starts on a new page', () => {
    const r = paginate([{ height: 900, breakAfter: true }, { height: 40 }], 1000);
    expect(r.breaks.map((b) => b.index)).toEqual([1]);
  });
  it('shows up in the Layout and Insert tabs', () => {
    const el = document.body.appendChild(document.createElement('div'));
    roots.push(el);
    const ed = createEditor({ element: el, content: '<p>x</p>', plugins: [...defaultPlugins, Pages({})], ribbon: true });
    const tabs = [...ed.root.querySelectorAll('[data-tab], .wy-tab')].map((t) => t.textContent);
    expect(tabs).toEqual(expect.arrayContaining(['Layout', 'Insert']));
    expect(ed.root.querySelectorAll('[aria-label="Cover Page"], [title="Cover Page"]').length).toBeGreaterThanOrEqual(2);
    ed.destroy();
  });
});
