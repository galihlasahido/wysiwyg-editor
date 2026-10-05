import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Packer } from 'docx';
import JSZip from 'jszip';
import { Columns, createEditor, defaultPlugins } from '../src';
import { buildDocx } from '../src/docx';

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

describe('Columns in Word', () => {
  const xml = async (html: string) => {
    const ed = make(html);
    const zip = await JSZip.loadAsync(await Packer.toBuffer(await buildDocx(ed)));
    ed.destroy();
    return zip.file('word/document.xml')!.async('string');
  };
  it('writes each columns block as its own continuous section with the column count, gap and rule', async () => {
    const doc = await xml('<p>intro</p><div data-columns="3" data-rule="solid" data-gap="40"><p>a</p><p>b</p></div><p>outro</p>');
    const sects = doc.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g)!;
    expect(sects).toHaveLength(3);
    expect(sects[0]).not.toContain('<w:cols');
    expect(sects[1]).toMatch(/<w:cols[^>]*w:num="3"/);
    expect(sects[1]).toMatch(/w:space="600"/);
    expect(sects[1]).toMatch(/w:sep="(1|true)"/);
    expect(sects[1]).toContain('w:val="continuous"');
    expect(sects[2]).toContain('w:val="continuous"');
    expect(sects[2]).not.toContain('<w:cols');
    expect(doc.indexOf('intro')).toBeLessThan(doc.indexOf('>a<'));
    expect(doc.indexOf('>b<')).toBeLessThan(doc.indexOf('outro'));
  });
  it('a document without columns stays one section; a column break becomes a Word column break', async () => {
    expect((await xml('<p>plain</p>')).match(/<w:sectPr/g)).toHaveLength(1);
    const doc = await xml('<div data-columns="2"><p>left</p><div data-column-break></div><p>right</p></div>');
    expect(doc).toContain('<w:br w:type="column"');
  });
  it('insertColumnBreak only works inside columns and shows in the editor', () => {
    const ed = make('<p>x</p><div data-columns="2"><p>a</p></div>');
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 2)));
    expect(ed.execute('insertColumnBreak')).toBe(false);
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    expect(ed.execute('insertColumnBreak')).toBe(true);
    expect(ed.view.dom.querySelector('.wy-columns .wy-column-break')).not.toBeNull();
    ed.destroy();
  });
});

describe('setDocumentColumns', () => {
  it('puts everything below the title in columns, changes the count and restores one column', () => {
    const ed = make('<h1>Title</h1><p>a</p><p>b</p>');
    expect(ed.execute('setDocumentColumns', 2)).toBe(true);
    expect(ed.view.state.doc.child(0).type.name).toBe('heading');
    expect(ed.view.state.doc.child(1).type.name).toBe('columns');
    expect(ed.execute('setDocumentColumns', 3)).toBe(true);
    expect(ed.view.state.doc.child(1).attrs.count).toBe(3);
    expect(ed.execute('setDocumentColumns', 1)).toBe(true);
    expect([...Array(ed.view.state.doc.childCount).keys()].map((i) => ed.view.state.doc.child(i).type.name)).toEqual(['heading', 'paragraph', 'paragraph']);
    expect(ed.execute('setDocumentColumns', 1)).toBe(false);
    ed.destroy();
  });
});
