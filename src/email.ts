import { stripActiveContent } from './inert';
/**
 * Convert editor HTML into email-safe HTML: layout in tables, styles inlined (many mail clients ignore <style>
 * and classes), no classes or data attributes. Meant for output only, not for round-tripping.
 */
export interface EmailOptions {
  /** Content width in px. Default 600. */
  width?: number;
  fontFamily?: string;
  color?: string;
  linkColor?: string;
}

const BLOCK_STYLES: Record<string, string> = {
  p: 'margin:0 0 14px 0;',
  h1: 'margin:0 0 16px 0;font-size:28px;line-height:1.25;',
  h2: 'margin:0 0 14px 0;font-size:22px;line-height:1.3;',
  h3: 'margin:0 0 12px 0;font-size:18px;line-height:1.3;',
  h4: 'margin:0 0 10px 0;font-size:16px;line-height:1.3;',
  blockquote: 'margin:0 0 14px 0;padding:0 0 0 14px;border-left:4px solid #d4d4d4;color:#555555;',
  ul: 'margin:0 0 14px 0;padding:0 0 0 24px;',
  ol: 'margin:0 0 14px 0;padding:0 0 0 24px;',
  li: 'margin:0 0 4px 0;',
  pre: 'margin:0 0 14px 0;padding:12px;background:#1e1e1e;color:#eeeeee;font-family:Consolas,Menlo,monospace;font-size:13px;white-space:pre-wrap;',
  code: 'font-family:Consolas,Menlo,monospace;background:#f0f0f0;padding:1px 4px;',
  hr: 'border:0;border-top:1px solid #d4d4d4;margin:18px 0;',
  table: 'border-collapse:collapse;width:100%;margin:0 0 14px 0;',
  td: 'border:1px solid #cccccc;padding:6px 8px;vertical-align:top;',
  th: 'border:1px solid #cccccc;padding:6px 8px;vertical-align:top;background:#f3f4f6;text-align:left;',
  img: 'max-width:100%;height:auto;border:0;',
  sup: 'font-size:75%;vertical-align:super;line-height:0;',
  sub: 'font-size:75%;vertical-align:sub;line-height:0;',
};
const KEEP_ATTRS: Record<string, string[]> = { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], ol: ['start'] };
const SAFE_HREF = /^(https?:|mailto:|tel:|#)/i;
const SAFE_IMG = /^(https?:\/\/|data:image\/(?:png|jpe?g|gif|webp);base64,)/i;
/** Option values land inside a style attribute: allow only characters a CSS value needs. */
const cssValue = (v: string, fallback: string) => (/^[\w\s,.#()%'"-]{1,200}$/.test(v) && !/["<>]/.test(v) ? v.replace(/'/g, '') : fallback);
const SAFE_STYLE_VALUE = /^[\w\s,.#()%+\-\/"']*$/;

export function toEmailHTML(html: string, options: EmailOptions = {}): string {
  const width = Math.max(200, Math.min(1200, Math.round(Number(options.width ?? 600)) || 600));
  const font = cssValue(options.fontFamily ?? 'Arial,Helvetica,sans-serif', 'Arial,Helvetica,sans-serif');
  const color = cssValue(options.color ?? '#1a1a1a', '#1a1a1a');
  const link = cssValue(options.linkColor ?? '#1d4ed8', '#1d4ed8');
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  stripActiveContent(doc.body); // the input may not come from the editor: no scripts, frames, handlers or script URLs

  for (const el of Array.from(doc.body.querySelectorAll<HTMLElement>('*'))) {
    const tag = el.tagName.toLowerCase();
    // Keep only the inline formatting that is already encoded in `style` (alignment, indent, spacing, color, size).
    const own = el.getAttribute('style') ?? '';
    const keep = own.split(';').map((s) => s.trim()).filter((s) => /^(text-align|margin-left|margin-right|margin-top|margin-bottom|text-indent|line-height|color|background-color|font-size|font-family|width|height)\s*:/i.test(s) && !/url\(|expression|javascript:|\\|@import/i.test(s) && SAFE_STYLE_VALUE.test(s.slice(s.indexOf(':') + 1)));
    const attrs = KEEP_ATTRS[tag] ?? [];
    for (const a of Array.from(el.attributes)) if (!attrs.includes(a.name)) el.removeAttribute(a.name);
    const base = BLOCK_STYLES[tag] ?? (tag === 'a' ? `color:${link};text-decoration:underline;` : tag === 'ins' ? 'text-decoration:underline;' : tag === 'del' ? 'text-decoration:line-through;' : '');
    const style = `${base}${keep.join(';')}${keep.length ? ';' : ''}`;
    if (style) el.setAttribute('style', style);
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      if (!SAFE_HREF.test(href)) el.removeAttribute('href');
      else {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
    }
    if (tag === 'img' && !SAFE_IMG.test(el.getAttribute('src') ?? '')) el.remove();
    if (tag === 'table') {
      el.setAttribute('cellpadding', '0');
      el.setAttribute('cellspacing', '0');
    }
    if (tag === 'strong' || tag === 'b') el.setAttribute('style', 'font-weight:bold;');
    if (tag === 'em' || tag === 'i') el.setAttribute('style', 'font-style:italic;');
    if (tag === 'u') el.setAttribute('style', 'text-decoration:underline;');
    if (tag === 's') el.setAttribute('style', 'text-decoration:line-through;');
    if (tag === 'li' && el.closest('ul[data-task-list]')) el.removeAttribute('data-task');
  }

  const inner = doc.body.innerHTML;
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${width}px;background:#ffffff;">` +
    `<tr><td style="padding:28px 32px;font-family:${font};font-size:16px;line-height:1.6;color:${color};">${inner}</td></tr></table>` +
    `</td></tr></table>`
  );
}

/** A plain-text alternative for the HTML part of an email. */
export function toEmailText(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const out: string[] = [];
  const walk = (node: Node) => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) out.push(c.textContent ?? '');
      else if (c instanceof HTMLElement) {
        const t = c.tagName.toLowerCase();
        if (t === 'br') out.push('\n');
        else if (t === 'li') (out.push((c.parentElement?.tagName === 'OL' ? '1. ' : '- ')), walk(c), out.push('\n'));
        else if (t === 'a' && /^https?:/i.test(c.getAttribute('href') ?? '')) (walk(c), out.push(` (${c.getAttribute('href')})`));
        else if (t === 'img') out.push(c.getAttribute('alt') ? `[${c.getAttribute('alt')}]` : '');
        else if (t === 'script' || t === 'style') continue;
        else (walk(c), /^(p|h[1-6]|blockquote|pre|tr|ul|ol|table|div)$/.test(t) && out.push('\n\n'));
      }
    }
  };
  walk(doc.body);
  return out.join('').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
}
