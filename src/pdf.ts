/**
 * PDF import. Lives in its own entry point (`wysiwyg-editor/pdf`) so `pdfjs-dist` stays optional. It reads the text of a PDF and rebuilds
 * paragraphs, headings (from larger type) and lists. Pictures, tables, columns and scanned pages are not recovered.
 */
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { Editor } from './editor';

export interface PdfTextItem { str: string; x: number; y: number; size: number; hasEOL?: boolean }
export interface PdfImportOptions {
  /** Address of `pdf.worker.min.mjs`, served by you (with Vite: `import url from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`). Required once. */
  workerSrc?: string;
  /** Stop after this many pages. Default 200. */
  maxPages?: number;
}

export const MAX_PDF_BYTES = 30 * 1024 * 1024;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const BULLET = /^\s*[•◦▪●○■•●\-–—*]\s+/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+/;

interface Line { text: string; y: number; size: number; x: number }

/** Group the text pieces of one page into lines (top to bottom, left to right). */
export function itemsToLines(items: PdfTextItem[]): Line[] {
  const real = items.filter((i) => i.str.trim() || i.str === ' ').sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { items: PdfTextItem[]; y: number }[] = [];
  for (const it of real) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(2, it.size * 0.4)) last.items.push(it);
    else lines.push({ items: [it], y: it.y });
  }
  return lines
    .map((l) => {
      const parts = l.items.sort((a, b) => a.x - b.x);
      let text = '';
      let prevEnd = -Infinity;
      for (const p of parts) {
        if (text && p.x - prevEnd > p.size * 0.15 && !text.endsWith(' ') && !p.str.startsWith(' ')) text += ' ';
        text += p.str;
        prevEnd = p.x + p.str.length * p.size * 0.5;
      }
      const chars = parts.reduce((n, p) => n + p.str.length, 0) || 1;
      const size = parts.reduce((n, p) => n + p.size * p.str.length, 0) / chars;
      return { text: text.replace(/\s+/g, ' ').trim(), y: l.y, size, x: Math.min(...parts.map((p) => p.x)) };
    })
    .filter((l) => l.text);
}

/** HTML for the text of all pages: headings from larger type, bullet and numbered lists, paragraphs joined across line ends. */
export function pagesToHtml(pages: PdfTextItem[][]): string {
  const all = pages.map(itemsToLines);
  const weight = new Map<number, number>();
  for (const l of all.flat()) { const k = Math.round(l.size * 2) / 2; weight.set(k, (weight.get(k) ?? 0) + l.text.length); }
  const body = [...weight.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 12;
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  const flushPara = () => { if (para.length) out.push(`<p>${esc(para.join(' '))}</p>`); para = []; };
  const flushList = () => { if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li><p>${esc(i)}</p></li>`).join('')}</${list.tag}>`); list = null; };
  const join = (a: string, b: string) => (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b) ? a.slice(0, -1) + b : `${a} ${b}`);
  for (const lines of all) {
    let prev: Line | null = null;
    for (const l of lines) {
      const gap = prev ? prev.y - l.y : 0;
      const ratio = l.size / body;
      if (ratio >= 1.2 && l.text.length < 140) {
        flushPara(); flushList();
        out.push(`<h${ratio >= 1.8 ? 1 : ratio >= 1.4 ? 2 : 3}>${esc(l.text)}</h${ratio >= 1.8 ? 1 : ratio >= 1.4 ? 2 : 3}>`);
      } else if (BULLET.test(l.text) || NUMBERED.test(l.text)) {
        flushPara();
        const tag = NUMBERED.test(l.text) ? 'ol' : 'ul';
        if (list && list.tag !== tag) flushList();
        (list ??= { tag, items: [] }).items.push(l.text.replace(BULLET, '').replace(NUMBERED, ''));
      } else if (list && prev && l.x > prev.x + 2 && gap < body * 2) {
        list.items[list.items.length - 1] = join(list.items[list.items.length - 1], l.text); // a wrapped list line
      } else {
        flushList();
        if (prev && gap > body * 1.9) flushPara();
        para = para.length ? [...para.slice(0, -1), join(para[para.length - 1], l.text)] : [l.text];
        if (/[.!?:]$/.test(l.text) && prev && prev.text.length < l.text.length * 0.6) flushPara();
      }
      prev = l;
    }
    flushPara(); flushList();
  }
  return out.join('');
}

/** Read the text of a PDF file into HTML. Needs the optional `pdfjs-dist` package. */
export async function pdfToHtml(source: Blob | ArrayBuffer, options: PdfImportOptions = {}): Promise<{ html: string; pages: number; warnings: string[] }> {
  const size = source instanceof ArrayBuffer ? source.byteLength : source.size;
  if (size > MAX_PDF_BYTES) throw new Error(`The PDF is too large (${Math.round(size / 1048576)} MB; the limit is ${MAX_PDF_BYTES / 1048576} MB).`);
  const pdfjs = await import('pdfjs-dist');
  // pdf.js runs in a worker; the library does not bundle it (1.5 MB), so the app says where it is served from
  if (options.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = options.workerSrc;
  if (!pdfjs.GlobalWorkerOptions.workerSrc) throw new Error('Opening a PDF needs the pdf.js worker file. Pass { workerSrc } (for example the URL of pdfjs-dist/build/pdf.worker.min.mjs).');
  const data = new Uint8Array(source instanceof ArrayBuffer ? source : await source.arrayBuffer());
  const task = pdfjs.getDocument({ data, enableXfa: false, disableFontFace: true });
  const doc = await task.promise;
  const warnings: string[] = [];
  const n = Math.min(doc.numPages, options.maxPages ?? 200);
  if (doc.numPages > n) warnings.push(`Only the first ${n} of ${doc.numPages} pages were read.`);
  const pages: PdfTextItem[][] = [];
  try {
    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.filter((it): it is TextItem => 'str' in it).map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], size: Math.hypot(it.transform[2], it.transform[3]) || it.height || 12, hasEOL: it.hasEOL })));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  const html = pagesToHtml(pages);
  if (!html) warnings.push('No text was found. A scanned PDF needs text recognition (OCR) first.');
  return { html, pages: n, warnings };
}

/** Replace the document with the text of a PDF (one undo step). Resolves with the converter's warnings. */
export async function importPdf(editor: Editor, source: Blob | ArrayBuffer, options?: PdfImportOptions): Promise<string[]> {
  const { html, warnings } = await pdfToHtml(source, options);
  if (html) editor.replaceHTML(html);
  return warnings;
}
