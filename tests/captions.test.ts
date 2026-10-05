import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Captions, collectCaptions, createEditor, defaultPlugins } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content = '<p></p>', opts = {}) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Captions(opts)] });
};
const cap = (id: string, kind: string, text: string, n = 1) => `<p class="wy-caption" id="${id}" data-caption="${kind}" data-n="${n}"><span class="wy-caption-label">Figure ${n}. </span><span class="wy-caption-text">${text}</span></p>`;
const labels = (ed: ReturnType<typeof make>) => [...ed.view.dom.querySelectorAll('.wy-caption-label')].map((l) => l.textContent);
const settle = () => new Promise((r) => setTimeout(r, 10));

describe('Captions', () => {
  it('numbers captions per kind in document order and ignores the printed label when parsing', async () => {
    const ed = make(`${cap('a', 'figure', 'First')}<p>text</p>${cap('b', 'table', 'Data')}${cap('c', 'figure', 'Second')}`);
    await settle();
    expect(labels(ed)).toEqual(['Figure 1. ', 'Table 1. ', 'Figure 2. ']);
    expect(ed.view.dom.querySelector('#a .wy-caption-text')!.textContent).toBe('First'); // not "Figure 1. First"
    expect(collectCaptions(ed.view.state.doc, [{ id: 'figure', label: 'Figure' }, { id: 'table', label: 'Table' }]).map((c) => c.n)).toEqual([1, 1, 2]);
    ed.destroy();
  });

  it('renumbers when a caption is inserted before, deleted or moved, and saves the numbers in the HTML', async () => {
    const ed = make(`<p>intro</p>${cap('a', 'figure', 'Alpha')}${cap('b', 'figure', 'Beta', 2)}`);
    await settle();
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 3)));
    ed.execute('insertCaption', 'figure', 'New first');
    await settle();
    expect(labels(ed)).toEqual(['Figure 1. ', 'Figure 2. ', 'Figure 3. ']);
    const html = ed.getHTML();
    expect(html).toContain('<span class="wy-caption-label">Figure 3. </span>');
    expect(html).toContain('data-n="3"');
    // delete the middle one
    let pos = -1;
    ed.view.state.doc.descendants((n, p) => { if (n.type.name === 'caption' && n.attrs.id === 'a') pos = p; });
    ed.view.dispatch(ed.view.state.tr.delete(pos, pos + ed.view.state.doc.nodeAt(pos)!.nodeSize));
    await settle();
    expect(labels(ed)).toEqual(['Figure 1. ', 'Figure 2. ']);
    ed.destroy();
  });

  it('cross-references follow the numbering and flag a missing target', async () => {
    const ed = make(`${cap('a', 'figure', 'Alpha')}${cap('b', 'figure', 'Beta', 2)}<p>See </p>`);
    await settle();
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    expect(ed.execute('insertCrossReference', 'b')).toBe(true);
    await settle();
    expect(ed.view.dom.querySelector('.wy-xref')!.textContent).toBe('Figure 2');
    expect(ed.getHTML()).toContain('data-xref="b"');
    // remove the first caption: "Beta" becomes Figure 1 and the reference follows
    ed.view.dispatch(ed.view.state.tr.delete(0, ed.view.state.doc.child(0).nodeSize));
    await settle();
    expect(ed.view.dom.querySelector('.wy-xref')!.textContent).toBe('Figure 1');
    // remove the target: the reference says so
    ed.view.dispatch(ed.view.state.tr.delete(0, ed.view.state.doc.child(0).nodeSize));
    await settle();
    expect(ed.view.dom.querySelector('.wy-xref')!.textContent).toBe('Missing reference');
    expect(ed.view.dom.querySelector('.wy-xref.is-missing')).not.toBeNull();
    ed.destroy();
  });

  it('a list of figures lists the captions of its kind and stays current', async () => {
    const ed = make(`${cap('a', 'figure', 'Alpha')}<p>x</p>${cap('t', 'table', 'Numbers')}`);
    await settle();
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    ed.execute('insertCaptionList', 'figure');
    await settle();
    const items = () => [...ed.view.dom.querySelectorAll('.wy-caption-list-item')].map((a) => a.textContent);
    expect(items()).toEqual(['Figure 1. Alpha']);
    ed.view.dispatch(ed.view.state.tr.insertText(' edited', 1 + 5));
    await settle();
    expect(items()[0]).toContain('Alpha');
    expect(ed.getHTML()).toContain('data-caption-list="figure"');
    ed.destroy();
  });

  it('inserts a caption after a table, or after the paragraph holding a picture, picking the kind', async () => {
    const ed = make('<table><tr><td><p>cell</p></td></tr></table><p>after table</p>');
    await settle();
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 4)));
    ed.execute('insertCaption');
    await settle();
    expect(labels(ed)).toEqual(['Table 1. ']);
    expect(ed.view.state.doc.child(1).type.name).toBe('caption'); // right after the table
    ed.destroy();
  });

  it('custom kinds and separator; hostile attributes are neutralised', async () => {
    const ed = make('<p class="wy-caption" id="x y" data-caption="evil" data-n="9"><span class="wy-caption-text">T</span></p>', { kinds: [{ id: 'figure', label: 'Gambar' }], separator: ': ' });
    await settle();
    expect(labels(ed)).toEqual(['Gambar 1: ']);
    const id = ed.view.state.doc.child(0).attrs.id;
    expect(id).toMatch(/^[\w-]+$/);
    ed.destroy();
  });

  it('exports numbered captions to Markdown', async () => {
    const ed = make(`${cap('a', 'figure', 'Alpha')}`);
    await settle();
    expect(ed.getMarkdown()).toContain('*Figure 1. Alpha*');
    ed.destroy();
  });
});
