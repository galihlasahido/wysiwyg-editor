import JSZip from 'jszip';
import { Packer } from 'docx';
import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { type EditorPlugin, Comments, Editor, TrackChanges, defaultPlugins, Pages } from '../src';
import { buildDocx, imageInfo, importDocx } from '../src/docx';

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function make(html: string, extra: EditorPlugin[] = []) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  return new Editor({ element: el, content: html, plugins: [...defaultPlugins, ...extra] });
}

async function parts(editor: Editor, options = {}) {
  const buf = await Packer.toBuffer(await buildDocx(editor, options));
  const zip = await JSZip.loadAsync(buf);
  const read = async (name: string) => (await zip.file(name)?.async('string')) ?? '';
  return { zip, doc: await read('word/document.xml'), read, names: Object.keys(zip.files) };
}

describe('imageInfo', () => {
  it('reads PNG, GIF and JPEG headers and rejects junk', () => {
    const png = Uint8Array.from(atob(PNG.split(',')[1]), (c) => c.charCodeAt(0));
    expect(imageInfo(png)).toEqual({ type: 'png', width: 1, height: 1 });
    expect(imageInfo(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 5, 0, 7, 0, 0]))).toEqual({ type: 'gif', width: 5, height: 7 });
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 20, 0, 30, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    expect(imageInfo(jpg)).toEqual({ type: 'jpg', width: 30, height: 20 });
    expect(imageInfo(Uint8Array.from([1, 2, 3, 4]))).toBeNull();
  });
});

describe('docx export', () => {
  it('exports headings, formatted runs, alignment and links', async () => {
    const e = make('<h1>Title</h1><p style="text-align: center"><strong>bold</strong> <em>it</em> <u>un</u> <s>st</s> <a href="https://x.test/a">link</a></p>');
    const { doc } = await parts(e);
    expect(doc).toContain('w:pStyle w:val="Heading1"');
    expect(doc).toContain('Title');
    expect(doc).toContain('<w:jc w:val="center"/>');
    expect(doc).toMatch(/<w:b\/>/);
    expect(doc).toMatch(/<w:i\/>/);
    expect(doc).toMatch(/<w:strike\/>/);
    expect(doc).toContain('<w:hyperlink');
  });

  it('exports colors, font family and size', async () => {
    const e = make('<p><span style="color: #e03131"><span style="font-size: 24px"><span style="font-family: Georgia">x</span></span></span></p>');
    const { doc } = await parts(e);
    expect(doc).toContain('w:color w:val="E03131"');
    expect(doc).toContain('w:sz w:val="36"'); // 24px = 36 half-points
    expect(doc).toContain('Georgia');
  });

  it('exports bullet and ordered lists with nesting and restarts numbering per list', async () => {
    const e = make('<ul><li><p>a</p><ul><li><p>b</p></li></ul></li></ul><ol><li><p>one</p></li></ol><ol><li><p>again</p></li></ol>');
    const { doc, read } = await parts(e);
    expect(doc).toContain('<w:ilvl w:val="1"/>');
    const numbering = await read('word/numbering.xml');
    expect((numbering.match(/<w:abstractNum /g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(doc).toContain('one');
    expect(doc).toContain('again');
  });

  it('exports tables with header rows, spans and cell shading', async () => {
    const e = make('<table><tr><th>H</th><th style="background-color: rgb(255, 201, 201)">H2</th></tr><tr><td colspan="2">wide</td></tr></table>');
    const { doc } = await parts(e);
    expect(doc).toContain('<w:tbl>');
    expect(doc).toContain('<w:tblHeader');
    expect(doc).toContain('w:gridSpan w:val="2"');
    expect(doc).toContain('w:fill="FFC9C9"');
  });

  it('embeds data-URL images and falls back to alt text for others', async () => {
    const e = make(`<p><img src="${PNG}" alt="dot" width="50"><img src="https://nope.invalid/x.png" alt="remote"></p>`);
    const { doc, names } = await parts(e, { fetchImages: false });
    expect(names.some((n) => n.startsWith('word/media/'))).toBe(true);
    expect(doc).toContain('<w:drawing>');
    expect(doc).toContain('[remote]');
  });

  it('exports footnotes, mentions, code blocks, quotes, rules and page breaks', async () => {
    const e = make('<p>text<sup data-footnote="the note"></sup> <span data-mention-id="u1">@Ana</span></p><blockquote><p>q</p></blockquote><pre><code>a\nb</code></pre><hr><div data-page-break></div>', [Pages()]);
    const { doc, read } = await parts(e);
    expect(doc).toContain('w:footnoteReference');
    expect(await read('word/footnotes.xml')).toContain('the note');
    expect(doc).toContain('@Ana');
    expect(doc).toContain('Courier New');
    expect(doc).toContain('w:type="page"');
  });

  it('exports page size, margins, orientation and header/footer with page numbers', async () => {
    const e = make('<p>x</p>', [Pages({ size: 'letter', orientation: 'landscape', margins: { left: 48 }, header: 'Top', footer: 'Page {page} of {pages}' })]);
    const { doc, names, read } = await parts(e);
    expect(doc).toContain('w:orient="landscape"');
    expect(doc).toContain('w:left="720"'); // 48px
    const footer = await read(names.find((n) => /footer\d*\.xml$/.test(n))!);
    expect(footer).toContain('PAGE');
    expect(footer).toContain('NUMPAGES');
    expect(await read(names.find((n) => /header\d*\.xml$/.test(n))!)).toContain('Top');
  });

  it('exports comments and tracked changes', async () => {
    const comments = Comments({ author: 'Ana' });
    const e = make('<p>hello world</p>', [comments, TrackChanges({ author: 'Ana', enabled: true })]);
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, 6)));
    e.execute('addComment', 'check this');
    e.view.dispatch(e.view.state.tr.insertText('NEW', 12));
    const { doc, read } = await parts(e);
    expect(doc).toContain('w:commentRangeStart');
    expect(doc).toContain('w:commentReference');
    expect(await read('word/comments.xml')).toContain('check this');
    expect(doc).toContain('<w:ins ');
  });

  it('exports a table of contents field and an empty document', async () => {
    expect((await parts(make('<h1>A</h1><div data-toc></div>'))).doc).toContain('TOC');
    expect((await parts(make(''))).doc).toContain('<w:body>');
  });
});

describe('docx import', () => {
  it('round-trips structure through export and import', async () => {
    const src = make(`<h1>Report</h1><p>Hello <strong>bold</strong> and <em>italic</em> <u>under</u>.</p><ul><li><p>one</p></li><li><p>two</p></li></ul><ol><li><p>first</p></li></ol><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><p><img src="${PNG}" alt="dot"></p>`);
    const blob = new Blob([(await Packer.toBuffer(await buildDocx(src))) as BlobPart]);
    const dst = make('<p>PREVIOUS-CONTENT</p>');
    const warnings = await importDocx(dst, blob);
    const html = dst.getHTML();
    expect(html).toContain('<h1>Report</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<u>under</u>');
    expect(html).toMatch(/<ul><li><p>one<\/p><\/li><li><p>two<\/p><\/li><\/ul>/);
    expect(html).toContain('<ol>');
    expect(html).toContain('<table>');
    expect(html).toContain('<img');
    expect(html).not.toContain('PREVIOUS-CONTENT');
    expect(Array.isArray(warnings)).toBe(true);
    dst.execute('undo');
    expect(dst.getHTML()).toContain('PREVIOUS-CONTENT'); // import is undoable
  });

  it('rejects a file that is not a docx', async () => {
    await expect(importDocx(make('<p>x</p>'), new Blob(['not a zip']))).rejects.toThrow();
  });
});

describe('docx export of cropped images', () => {
  it('exports a cropped image (full image fallback where canvas is unavailable) without failing', async () => {
    const e = make(`<p><span class="wy-crop" data-crop="0.25,0,0.25,0" data-nw="400" data-nh="200" style="width: 100px"><img src="${PNG}" alt="c"></span></p>`);
    expect(e.view.state.doc.firstChild!.firstChild!.attrs.crop).toMatchObject({ left: 0.25, right: 0.25 });
    const { doc, names } = await parts(e, { fetchImages: false });
    expect(names.some((n) => n.startsWith('word/media/'))).toBe(true);
    expect(doc).toContain('<w:drawing>');
  });

  it('uses canvas cropping when the browser provides it', async () => {
    const calls: number[][] = [];
    const g = globalThis as any;
    const realBitmap = g.createImageBitmap;
    const realOff = g.OffscreenCanvas;
    g.createImageBitmap = async () => ({ width: 400, height: 200 });
    g.OffscreenCanvas = class {
      constructor(public width: number, public height: number) {}
      getContext() { return { drawImage: (...a: number[]) => calls.push(a.slice(1)) }; }
      async convertToBlob() {
        // a real 1x1 PNG so the exporter can read its header
        return new Blob([Uint8Array.from(atob(PNG.split(',')[1]), (c) => c.charCodeAt(0))]);
      }
    };
    try {
      const e = make(`<p><span class="wy-crop" data-crop="0.25,0,0.25,0.5" data-nw="400" data-nh="200" style="width: 100px"><img src="${PNG}"></span></p>`);
      await parts(e, { fetchImages: false });
      expect(calls).toEqual([[100, 0, 200, 100, 0, 0, 200, 100]]); // source rect = the visible half, drawn 1:1
    } finally {
      g.createImageBitmap = realBitmap;
      g.OffscreenCanvas = realOff;
    }
  });
});

