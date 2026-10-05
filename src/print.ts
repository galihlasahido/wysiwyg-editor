import type { Editor } from './editor';

export interface PrintOptions {
  /** Page size in CSS px (A4 portrait = 794 x 1123). Default: the Pages plugin's page, else A4. */
  width?: number;
  height?: number;
  /** Page margins in CSS px. Default: the Pages plugin's margins, else 1 inch. */
  margins?: { top: number; right: number; bottom: number; left: number };
  /** Running header / footer. `{page}` and `{pages}` become the page number and count. */
  header?: string;
  footer?: string;
  differentFirstPage?: boolean;
  firstHeader?: string;
  firstFooter?: string;
  /** The document title shown by the print dialog. */
  title?: string;
}

/** A header/footer template as a CSS `content` value: "Page " counter(page) " of " counter(pages). */
export function marginContent(template: string): string {
  const str = (s: string) => `"${s.replace(/[\\"]/g, '\\$&').replace(/\r?\n/g, '\\A ')}"`;
  const parts = template.split(/(\{page\}|\{pages\})/).filter(Boolean).map((p) => (p === '{page}' ? 'counter(page)' : p === '{pages}' ? 'counter(pages)' : str(p)));
  return parts.length ? parts.join(' ') : '""';
}

const boxCss = (header?: string, footer?: string) =>
  `${header ? `@top-center{content:${marginContent(header)};font:11px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#6b7280;vertical-align:bottom;padding-bottom:6px}` : ''}${footer ? `@bottom-center{content:${marginContent(footer)};font:11px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#6b7280;vertical-align:top;padding-top:6px}` : ''}`;

const escapeHTML = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Parts of the editor that are for editing, not for the paper. */
const EDITING_UI = '.wy-page-header, .wy-page-footer, .wy-page-gap, .wy-filler, .wy-diagram-edit, .wy-diagram-bar, .wy-mermaid-edit, .wy-fold, .wy-extra-caret, .wy-active-line, .wy-fold-chip';

/**
 * The HTML of a print-only page: the document alone (no toolbar, no host page), the real paper size and margins as `@page`,
 * and the running header and footer as `@page` margin boxes. Always light, whatever the editor theme.
 */
export function buildPrintHTML(editor: Editor, options: PrintOptions = {}): string {
  const page = (editor.extensions.pageSettings as (() => Record<string, any>) | undefined)?.();
  const width = options.width ?? page?.width ?? 794;
  const height = options.height ?? page?.height ?? 1123;
  const m = options.margins ?? page?.margins ?? { top: 96, right: 96, bottom: 96, left: 96 };
  const header = options.header ?? page?.header ?? '';
  const footer = options.footer ?? page?.footer ?? '';
  const differentFirst = options.differentFirstPage ?? page?.differentFirstPage ?? false;
  const firstHeader = options.firstHeader ?? page?.firstHeader ?? '';
  const firstFooter = options.firstFooter ?? page?.firstFooter ?? '';

  // Copy the live document, so rendered equations, diagrams, highlighted code and images are exactly what is on screen.
  const clone = editor.view.dom.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(EDITING_UI).forEach((e) => e.remove());
  clone.removeAttribute('contenteditable');
  clone.removeAttribute('spellcheck');
  clone.removeAttribute('style');
  clone.classList.remove('ProseMirror-focused');
  clone.querySelectorAll('.ProseMirror-selectednode').forEach((e) => e.classList.remove('ProseMirror-selectednode'));
  clone.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));

  // The page's own styles (the editor's, KaTeX's, your content styles) so the paper looks like the screen.
  const styles = [...document.querySelectorAll<HTMLElement>('style, link[rel="stylesheet"]')].map((n) => (n.tagName === 'LINK' ? `<link rel="stylesheet" href="${escapeHTML((n as HTMLLinkElement).href)}">` : n.outerHTML)).join('\n');

  const css = `
@page{size:${width}px ${height}px;margin:${m.top}px ${m.right}px ${m.bottom}px ${m.left}px;${boxCss(header, footer)}}
${differentFirst ? `@page :first{${boxCss(firstHeader, firstFooter)}}` : ''}
html,body{margin:0;padding:0;background:#fff;color:#111}
.wy-print{display:block!important;height:auto!important;max-height:none!important;overflow:visible!important;border:0!important;box-shadow:none!important;background:#fff!important;border-radius:0!important}
.wy-print .wy-body,.wy-print .wy-workspace,.wy-print .wy-content{display:block!important;height:auto!important;max-height:none!important;overflow:visible!important;padding:0!important;margin:0!important;width:auto!important;min-width:0!important;box-shadow:none!important;zoom:1!important;background:none!important;border:0!important}
.wy-print .ProseMirror{padding:0!important;margin:0!important;width:auto!important;min-height:0!important;max-width:none!important;box-shadow:none!important;border:0!important;outline:0!important;background:none!important;overflow:visible!important}
.wy-print .ProseMirror>*{margin-top:0;margin-bottom:12px}
.wy-manual-break,.wy-page-break{height:0!important;margin:0!important;break-after:page}
tr,img,figure,.wy-diagram,.wy-mermaid,.wy-math-block{break-inside:avoid}
h1,h2,h3,h4{break-after:avoid}
pre{white-space:pre-wrap}
*{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;

  return `<!doctype html><html lang="${escapeHTML(editor.root.lang || document.documentElement.lang || 'en')}" dir="${escapeHTML(editor.root.dir || 'ltr')}"><head><meta charset="utf-8"><title>${escapeHTML(options.title ?? 'Document')}</title>
${styles}
<style>${css}</style></head><body><div class="wy-editor wy-print" data-theme="light" data-page="light" dir="${escapeHTML(editor.root.dir || 'ltr')}"><div class="wy-body"><div class="wy-workspace"><div class="wy-content">${clone.outerHTML}</div></div></div></div></body></html>`;
}

/**
 * Print (or "Save as PDF") the document alone, in a hidden frame: the host page, the toolbar and the editing chrome are not
 * printed, the paper size and margins are the real ones, and the header, footer and page numbers appear on every page
 * (through `@page` margin boxes: Chrome and Edge 131+; other browsers print the document without them).
 */
export async function printDocument(editor: Editor, options: PrintOptions = {}): Promise<void> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.title = 'Print';
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' });
  const loaded = new Promise<void>((ok) => frame.addEventListener('load', () => ok(), { once: true }));
  frame.srcdoc = buildPrintHTML(editor, options);
  document.body.append(frame);
  await loaded;
  const win = frame.contentWindow!;
  const doc = frame.contentDocument!;
  // wait for pictures and fonts, or the printout would have empty boxes
  const wait = (p: Promise<unknown>, ms: number) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);
  await wait(Promise.all([...doc.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })))), 8000);
  await wait(doc.fonts?.ready ?? Promise.resolve(), 3000);
  const cleanup = () => frame.remove();
  win.addEventListener('afterprint', cleanup, { once: true });
  setTimeout(cleanup, 5 * 60 * 1000); // never leave the frame behind if afterprint does not fire
  win.focus();
  win.print();
}
