import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';
import { PdfEpub, createEditor, defaultPlugins } from '../src';
import { buildEpubFiles, exportEpub } from '../src/epub';
import { pagesToHtml, type PdfTextItem } from '../src/pdf';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content: string) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, PdfEpub()] });
};
const line = (str: string, y: number, size = 12, x = 72): PdfTextItem => ({ str, x, y, size });

describe('PDF text to HTML', () => {
  it('finds headings by larger type, joins wrapped lines, splits paragraphs on gaps and de-hyphenates', () => {
    const html = pagesToHtml([[
      line('Annual Report', 760, 28),
      line('This is the first paragraph of the report and it', 700),
      line('continues on a second line with an exam-', 686),
      line('ple of a hyphen.', 672),
      line('Second paragraph starts after a gap.', 640),
      line('Results', 600, 18),
      line('Body text again for the section below it.', 570),
    ]]);
    expect(html).toContain('<h1>Annual Report</h1>');
    expect(html).toContain('<h2>Results</h2>');
    expect(html).toContain('<p>This is the first paragraph of the report and it continues on a second line with an example of a hyphen.</p>');
    expect(html).toContain('<p>Second paragraph starts after a gap.</p>');
  });
  it('builds bullet and numbered lists and escapes text', () => {
    const html = pagesToHtml([[line('Items:', 700), line('• apples & pears', 680), line('• <b>plums</b>', 666), line('1. first', 640), line('2. second', 626)]]);
    expect(html).toContain('<ul><li><p>apples &amp; pears</p></li><li><p>&lt;b&gt;plums&lt;/b&gt;</p></li></ul>');
    expect(html).toContain('<ol><li><p>first</p></li><li><p>second</p></li></ol>');
    expect(html).not.toContain('<b>');
  });
  it('puts pieces of one line in order with spaces, and returns nothing for an empty page', () => {
    expect(pagesToHtml([[line('world', 700, 12, 120), line('Hello', 700, 12, 72)]])).toBe('<p>Hello world</p>');
    expect(pagesToHtml([[]])).toBe('');
  });
});

describe('EPUB export', () => {
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  it('writes a valid book: ordered mimetype, container, package, nav, chapters per h1, images packed', async () => {
    const ed = make(`<h1>One</h1><p>Alpha &amp; omega</p><img src="${PNG}" alt="dot"><h1>Two</h1><p>Beta<br>line</p><img src="https://x.test/remote.png" alt="remote"><script>alert(1)</script><p onclick="x()">safe</p>`);
    const blob = await exportEpub(ed, { title: 'Book', author: 'Ana', language: 'id' });
    expect(blob.type).toBe('application/epub+zip');
    const zip = await JSZip.loadAsync(blob);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');
    for (const f of ['META-INF/container.xml', 'OEBPS/content.opf', 'OEBPS/nav.xhtml', 'OEBPS/ch1.xhtml', 'OEBPS/ch2.xhtml', 'OEBPS/style.css', 'OEBPS/images/img1.png']) expect(names, f).toContain(f);
    const parse = async (p: string) => { const d = new DOMParser().parseFromString(await zip.file(p)!.async('string'), 'application/xml'); expect(d.querySelector('parsererror'), p).toBeNull(); return d; };
    const opf = await parse('OEBPS/content.opf');
    expect(opf.getElementsByTagName('dc:title')[0].textContent).toBe('Book');
    expect(opf.getElementsByTagName('dc:creator')[0].textContent).toBe('Ana');
    expect(opf.querySelectorAll('spine itemref')).toHaveLength(2);
    expect(opf.querySelector('item[properties=nav]')).not.toBeNull();
    await parse('OEBPS/nav.xhtml');
    const ch1 = await zip.file('OEBPS/ch1.xhtml')!.async('string');
    const ch2 = await zip.file('OEBPS/ch2.xhtml')!.async('string');
    await parse('OEBPS/ch1.xhtml'); await parse('OEBPS/ch2.xhtml');
    expect(ch1).toContain('Alpha &amp; omega');
    expect(ch1).toContain('src="images/img1.png"');
    expect(ch2).toContain('Beta<br />line');
    expect(ch2).toContain('[remote]'); // remote pictures are not packed
    expect(ch2).not.toMatch(/<script|onclick|xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"><p/);
    ed.destroy();
  });
  it('handles a document without headings and unsafe links', () => {
    const files = buildEpubFiles('<p>Hello <a href="javascript:alert(1)">x</a> <a href="https://ok.test">y</a></p>', {});
    const ch = files.find((f) => f.path === 'OEBPS/ch1.xhtml')!.data as string;
    expect(ch).not.toContain('javascript:');
    expect(ch).toContain('href="https://ok.test"');
    expect(files.find((f) => f.path === 'OEBPS/content.opf')!.data as string).toContain('<dc:title>Untitled</dc:title>');
  });
});

describe('PdfEpub plugin', () => {
  it('exportEpub emits an export event with the book', async () => {
    const ed = make('<h1>T</h1><p>x</p>');
    const got = new Promise<any>((r) => ed.on('export', (e) => r(e)));
    expect(ed.execute('exportEpub', '')).toBe(true); // empty name: do not download
    const e = await got;
    expect(e.format).toBe('epub');
    expect(e.blob.size).toBeGreaterThan(100);
    ed.destroy();
  });
});
