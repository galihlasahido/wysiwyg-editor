import type { Editor } from './editor';
import type { PageSettings } from './plugins/pages';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `body{font-family:system-ui,sans-serif;line-height:1.6;color:#1a1a1a;margin:0}
.page{box-sizing:border-box;margin:0 auto}
blockquote{margin:1em 0;padding-left:1em;border-left:4px solid #d4d4d4;color:#555}
pre{background:#1e1e1e;color:#eee;padding:12px;border-radius:6px;overflow-x:auto}
code{background:#f0f0f0;padding:1px 4px;border-radius:3px}pre code{background:none;padding:0}
img{max-width:100%}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:6px 8px;vertical-align:top}
ul[data-task-list]{list-style:none;padding-left:4px}li[data-task]::before{content:'\\2610 '}li[data-task][data-checked=true]::before{content:'\\2611 '}
ins{color:#15803d}del{color:#b91c1c}.wy-comment{background:#fef3c7}[data-page-break]{break-after:page}
@media print{.page{width:auto!important;padding:0!important}}`;

/** A standalone HTML document (page size and margins are applied when the paged view is on). */
export function exportHTML(editor: Editor, options: { title?: string } = {}): string {
  const page = (editor.extensions.pageSettings as (() => PageSettings) | undefined)?.();
  const style = page
    ? `.page{width:${page.width}px;padding:${page.margins.top}px ${page.margins.right}px ${page.margins.bottom}px ${page.margins.left}px}@page{size:${page.width}px ${page.height}px;margin:0}`
    : '.page{max-width:820px;padding:24px}';
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(options.title ?? 'Document')}</title>\n<style>${CSS}${style}</style>\n</head>\n<body>\n<div class="page">\n${editor.getHTML()}\n</div>\n</body>\n</html>\n`;
}

/** Trigger a browser download of `data` as `filename`. */
export function download(data: Blob | string, filename: string, type = 'text/plain'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
