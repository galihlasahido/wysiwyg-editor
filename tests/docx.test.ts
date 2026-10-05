import JSZip from 'jszip';
import { Packer } from 'docx';
import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { type EditorPlugin, Comments, Editor, Equations, Mermaid, TrackChanges, defaultPlugins, Pages } from '../src';
import { buildDocx, imageInfo, importDocx } from '../src/docx';

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function make(html: string, extra: EditorPlugin[] = []) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  return new Editor({ element: el, content: html, docx: () => import('../src/docx'), plugins: [...defaultPlugins, ...extra] });
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


describe('docx limits', () => {
  it('ignores images with zero or absurd dimensions instead of producing NaN sizes', () => {
    const png = (w: number, h: number) => { const b = new Uint8Array(33); b.set([0x89, 0x50, 0x4e, 0x47]); new DataView(b.buffer).setUint32(16, w); new DataView(b.buffer).setUint32(20, h); return b; };
    expect(imageInfo(png(1, 1))).not.toBeNull();
    expect(imageInfo(png(0, 10))).toBeNull();
    expect(imageInfo(png(10, 0))).toBeNull();
    expect(imageInfo(png(4_000_000_000, 10))).toBeNull();
  });
  it('refuses to import an oversized file', async () => {
    const editor = { replaceHTML() { throw new Error('should not be reached'); } } as never;
    const big = { size: 60 * 1024 * 1024 } as Blob;
    await expect(importDocx(editor, big)).rejects.toThrow(/too large/);
  });
});

describe('equations and diagrams in Word', () => {
  it('writes LaTeX as native Word equations, falling back to text for what it cannot convert', async () => {
    const e = make('<p>Area <span data-math="\\pi r^2"></span> and <span data-math="\\begin{pmatrix}a\\end{pmatrix}"></span></p><div data-math-block="\\frac{a}{b}"></div>', [Equations()]);
    const { doc } = await parts(e);
    expect(doc).toContain('<m:oMath>');
    expect(doc).toContain('<m:f>'); // the display equation
    expect(doc).toContain('<m:sSup>'); // r^2
    expect(doc).toContain('\\begin{pmatrix}a\\end{pmatrix}'); // unsupported: kept as text, never silently dropped
  });
  it('keeps a diagram as labelled source when it cannot be drawn (no canvas), without failing the export', async () => {
    const fake = { initialize() {}, render: async () => ({ svg: '<svg viewBox="0 0 10 10"><text>x</text></svg>' }) };
    const e = make('<p>x</p><figure data-mermaid="graph TD\n A-->B"></figure>', [Mermaid({ mermaid: fake })]);
    const { doc } = await parts(e);
    expect(doc).toContain('Diagram (Mermaid source)');
    expect(doc).toContain('graph TD');
  });
});

describe('numbered list styles in Word', () => {
  it('exports a. b. and i. ii. numbering and the start number', async () => {
    const e = make('<ol type="a" start="3"><li><p>x</p></li></ol><ol type="I"><li><p>y</p></li></ol>');
    const { read } = await parts(e);
    const numbering = await read('word/numbering.xml');
    expect(numbering).toContain('w:val="lowerLetter"');
    expect(numbering).toContain('w:val="upperRoman"');
    expect(numbering).toMatch(/w:start w:val="3"/);
  });
});

describe('editor.exportDocx() API', () => {
  const bytes = (blob: Blob) => new Promise<ArrayBuffer>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result as ArrayBuffer); r.onerror = () => fail(r.error); r.readAsArrayBuffer(blob); }); // jsdom's Blob has no arrayBuffer()
  const unzip = async (blob: Blob) => (await JSZip.loadAsync(await bytes(blob))).file('word/document.xml')!.async('string');

  it('returns the .docx as a Blob and emits an export event', async () => {
    const e = make('<h1>Report</h1><p>Hello <strong>world</strong></p>');
    const seen: { format: string; size: number }[] = [];
    e.on('export', (p: { format: string; blob: Blob }) => seen.push({ format: p.format, size: p.blob.size }));
    const blob = await e.exportDocx();
    expect(blob.size).toBeGreaterThan(1000);
    expect(await unzip(blob)).toContain('Hello');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ format: 'docx' });
  });

  it('download saves it under a clean file name', async () => {
    const e = make('<p>x</p>');
    const clicks: string[] = [];
    const orig = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { clicks.push(this.download); };
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    try {
      await e.exportDocx({ download: '../../my report' });
      await e.exportDocx({ download: true, title: 'Q3' });
      await e.exportDocx(); // no download unless asked
    } finally { HTMLAnchorElement.prototype.click = orig; }
    expect(clicks).toEqual(['my report.docx', 'Q3.docx']);
  });

  it('the exportDocx command is always available, works read-only, and can be called from any event', async () => {
    const e = make('<p>hello</p>');
    expect(e.hasCommand('exportDocx')).toBe(true);
    e.setReadOnly(true);
    const done = new Promise<Blob>((res) => e.on('export', (p: { blob: Blob }) => res(p.blob)));
    expect(e.execute('exportDocx', { download: false })).toBe(true); // no ribbon, no app-supplied handler
    expect((await done).size).toBeGreaterThan(1000);
  });

  it('importDocx round-trips what exportDocx wrote', async () => {
    const e = make('<h2>Title</h2><p>Body text</p>');
    const blob = await e.exportDocx();
    const e2 = make('<p></p>');
    await e2.importDocx(blob);
    expect(e2.getHTML()).toContain('Title');
    expect(e2.getHTML()).toContain('Body text');
  });
});
