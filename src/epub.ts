/**
 * EPUB 3 export. Lives in its own entry point (`wysiwygido/epub`) so `jszip` stays optional. Chapters start at each top-level heading,
 * embedded pictures become files in the book, and anything that needs scripts (players, forms) is reduced to text.
 */
import type { Editor } from './editor';

export interface EpubOptions {
  title?: string;
  author?: string;
  /** BCP 47 language of the book. Default `en`. */
  language?: string;
  /** Identifier; default a random `urn:uuid:`. */
  identifier?: string;
  /** Extra CSS for the book. */
  css?: string;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const BOOK_CSS = 'body{font-family:serif;line-height:1.5;margin:5%}h1,h2,h3{line-height:1.2}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #888;padding:.25em .5em}blockquote{margin-left:1.5em;font-style:italic}pre,code{font-family:monospace}pre{white-space:pre-wrap}figcaption,.wy-caption{font-size:.9em}';
const DROP = 'script,style,iframe,object,embed,audio,video,form,button,input,select,textarea,link,meta,svg';

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

interface Chapter { title: string; nodes: Node[] }

/** The book as files, ready to zip (exported for tests). */
export function buildEpubFiles(html: string, o: EpubOptions = {}): { path: string; data: string | Uint8Array }[] {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  const body = doc.body;
  body.querySelectorAll(DROP).forEach((n) => n.remove());
  // embedded media and fields were replaced by plain text by the editor's own HTML; remaining scripted bits are removed above
  body.querySelectorAll('*').forEach((el) => { for (const a of [...el.attributes]) if (/^on/i.test(a.name) || /^(?:data-(?!$).*|contenteditable|draggable)$/i.test(a.name) || (a.name === 'style' && /url\(|expression/i.test(a.value))) el.removeAttribute(a.name); });
  body.querySelectorAll('a[href]').forEach((a) => { const h = a.getAttribute('href') ?? ''; if (!/^(?:https?:|mailto:|#)/i.test(h)) a.removeAttribute('href'); });

  const files: { path: string; data: string | Uint8Array }[] = [];
  let imgN = 0;
  body.querySelectorAll('img').forEach((img) => {
    const m = /^data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)$/i.exec(img.getAttribute('src') ?? '');
    if (!m) { const t = doc.createTextNode(img.getAttribute('alt') ? `[${img.getAttribute('alt')}]` : ''); img.replaceWith(t); return; } // remote pictures are not packed
    const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
    const name = `images/img${++imgN}.${ext}`;
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    files.push({ path: `OEBPS/${name}`, data: bytes });
    img.setAttribute('src', name);
    if (!img.hasAttribute('alt')) img.setAttribute('alt', '');
  });

  const title = o.title?.trim() || body.querySelector('h1')?.textContent?.trim() || 'Untitled';
  const chapters: Chapter[] = [];
  let cur: Chapter | null = null;
  for (const n of [...body.childNodes]) {
    if (n.nodeType === 1 && (n as Element).tagName === 'H1') { cur = { title: n.textContent?.trim() || title, nodes: [] }; chapters.push(cur); }
    if (!cur) { cur = { title, nodes: [] }; chapters.push(cur); }
    cur.nodes.push(n);
  }
  if (!chapters.length) chapters.push({ title, nodes: [doc.createElement('p')] });

  const lang = o.language || 'en';
  const ser = new XMLSerializer();
  const xhtml = (t: string, nodes: Node[]) =>
    `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}" xml:lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(t)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body>${nodes.map((n) => ser.serializeToString(n).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')).join('')}</body></html>`;

  const ids = chapters.map((_, i) => `ch${i + 1}`);
  chapters.forEach((c, i) => files.push({ path: `OEBPS/${ids[i]}.xhtml`, data: xhtml(c.title, c.nodes) }));
  files.push({ path: 'OEBPS/style.css', data: BOOK_CSS + (o.css ?? '') });
  files.push({
    path: 'OEBPS/nav.xhtml',
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(lang)}"><head><meta charset="utf-8"/><title>${esc(title)}</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters.map((c, i) => `<li><a href="${ids[i]}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav></body></html>`,
  });
  const id = o.identifier || `urn:uuid:${uuid()}`;
  const images = files.filter((f) => f.path.startsWith('OEBPS/images/'));
  files.push({
    path: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${esc(lang)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="bookid">${esc(id)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:language>${esc(lang)}</dc:language>${o.author ? `<dc:creator>${esc(o.author)}</dc:creator>` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${ids.map((c) => `<item id="${c}" href="${c}.xhtml" media-type="application/xhtml+xml"/>`).join('')}${images.map((f, i) => `<item id="img${i + 1}" href="${f.path.slice(6)}" media-type="${MIME[f.path.split('.').pop()!] ?? 'image/png'}"/>`).join('')}</manifest><spine>${ids.map((c) => `<itemref idref="${c}"/>`).join('')}</spine></package>`,
  });
  files.push({ path: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' });
  return files;
}

/** The document as an EPUB 3 file. Needs the optional `jszip` package. */
export async function exportEpub(editor: Editor, options: EpubOptions = {}): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' }); // must be first and uncompressed
  for (const f of buildEpubFiles(editor.getHTML(), options)) zip.file(f.path, f.data);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}
