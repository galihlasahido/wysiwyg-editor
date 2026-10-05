import { inertElement } from './inert';

/** Is this clipboard HTML from Microsoft Word / Office? */
export const isWordHTML = (html: string): boolean => /urn:schemas-microsoft-com:office|class=["']?Mso|mso-[a-z-]+\s*:|<o:p>|content=["']?Microsoft Word/i.test(html);
/** Is it from Google Docs? Its whole selection is wrapped in a `<b id="docs-internal-guid-…">` that is not bold. */
export const isGoogleDocsHTML = (html: string): boolean => /id=["']?docs-internal-guid/i.test(html);

const KEEP_STYLE = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'text-align', 'vertical-align', 'color', 'background-color', 'background']);
const PLAIN_COLOR = /^(?:windowtext|black|#000(?:000)?|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\)|inherit|initial|transparent|auto)$/i;
const BULLET = /^[•·o§▪■●○◦\-–—*]/;

/** Keep only the styling a document should carry (bold, italic, underline, colour, alignment); drop Word's font, size, margins and mso-* noise. */
function cleanStyle(style: string): string {
  const out: string[] = [];
  for (const decl of style.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const name = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (!KEEP_STYLE.has(name) || !value) continue;
    if ((name === 'color' || name === 'background-color' || name === 'background') && PLAIN_COLOR.test(value)) continue;
    if (name === 'text-decoration' && /^none$/i.test(value)) continue;
    out.push(`${name}: ${value}`);
  }
  return out.join('; ');
}

interface ListState { level: number; el: HTMLElement; ordered: boolean }

const ROMAN = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x{1,3}|xl|l|xc|c)$/i;
const romanValue = (s: string) => { const v: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100 }; let n = 0; const t = s.toLowerCase(); for (let i = 0; i < t.length; i++) n += v[t[i]] < (v[t[i + 1]] ?? 0) ? -v[t[i]] : v[t[i]]; return n; };

/** How a Word marker is numbered: "1." decimal, "a." / "A." letters, "i." / "I." roman numerals, plus the number it stands for. */
export function markerStyle(marker: string, level: number): { type: '1' | 'a' | 'A' | 'i' | 'I'; start: number } {
  const m = marker.replace(/^\(|[.)]$/g, '');
  if (/^\d+$/.test(m)) return { type: '1', start: Number(m) };
  // "i" alone is ambiguous: roman at the third level (Word's default there), a letter otherwise
  if (ROMAN.test(m) && (m.length > 1 || (level >= 3 && /^[iIvVxX]$/.test(m)))) return { type: m === m.toUpperCase() ? 'I' : 'i', start: romanValue(m) };
  if (/^[a-z]$/.test(m)) return { type: 'a', start: m.charCodeAt(0) - 96 };
  if (/^[A-Z]$/.test(m)) return { type: 'A', start: m.charCodeAt(0) - 64 };
  return { type: '1', start: 1 };
}

/**
 * Turn Word's "list paragraphs" (a `<p class=MsoListParagraph style="mso-list:l0 level2 lfo1">` with a fake "1." marker
 * span) into real nested `<ol>` / `<ul>` lists, so a pasted numbered list stays a list.
 */
function rebuildLists(box: HTMLElement): void {
  const isListPara = (el: Element) => el.tagName === 'P' && (/mso-list\s*:\s*(?!none)/i.test(el.getAttribute('style') ?? '') || /MsoListParagraph/i.test(el.className));
  const kids = Array.from(box.children);
  let i = 0;
  while (i < kids.length) {
    if (!isListPara(kids[i])) { i++; continue; }
    let j = i;
    while (j < kids.length && isListPara(kids[j])) j++;
    const run = kids.slice(i, j);
    const root = document.implementation.createHTMLDocument('').createDocumentFragment();
    const doc = root.ownerDocument!;
    const stack: ListState[] = [];
    for (const p of run) {
      const marker = p.querySelector('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]');
      const markerText = (marker?.textContent ?? '').replace(/[\s ]+/g, ' ').trim();
      marker?.remove();
      const level = Math.min(9, Math.max(1, Number(/level(\d+)/i.exec(p.getAttribute('style') ?? '')?.[1] ?? 1)));
      const ordered = markerText !== '' && !BULLET.test(markerText);
      // unwind to this level, and start a sibling list when the kind changes
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      if (stack.length && stack[stack.length - 1].level === level && stack[stack.length - 1].ordered !== ordered) stack.pop();
      while (!stack.length || stack[stack.length - 1].level < level) {
        const lvl = stack.length ? stack[stack.length - 1].level + 1 : 1;
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        if (ordered && lvl === level) {
          const { type, start } = markerStyle(markerText, level);
          if (start > 1) list.setAttribute('start', String(start));
          if (type !== '1') list.setAttribute('type', type);
        }
        if (stack.length) {
          const parent = stack[stack.length - 1].el;
          let li = parent.lastElementChild as HTMLElement | null;
          if (!li) { li = doc.createElement('li'); parent.append(li); }
          li.append(list);
        } else root.append(list);
        stack.push({ level: lvl, el: list, ordered });
      }
      const li = doc.createElement('li');
      const para = doc.createElement('p');
      while (p.firstChild) para.append(p.firstChild);
      li.append(para);
      stack[stack.length - 1].el.append(li);
    }
    const first = run[0];
    first.replaceWith(root.cloneNode(true) as DocumentFragment);
    for (const p of run.slice(1)) p.remove();
    i = j;
  }
}

/**
 * Clean clipboard HTML from Word, Google Docs and similar before the editor parses it: conditional comments, `<o:p>`,
 * style sheets and mso-* styles go; fake list paragraphs become real lists; fonts, sizes and margins are dropped while bold,
 * italic, underline, colour and alignment stay; pictures that point at local files (which the browser cannot load) are removed.
 * HTML from other sources is returned untouched.
 */
export function cleanPastedHTML(html: string): string {
  const word = isWordHTML(html);
  const gdocs = isGoogleDocsHTML(html);
  if (!word && !gdocs) return html;
  const stripped = html
    .replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '') // <!--[if gte mso 9]> … <![endif]-->
    .replace(/<!\[if [^\]]*\]>/gi, '').replace(/<!\[endif\]>/gi, '') // downlevel-revealed: <![if !supportLists]>
    .replace(/<!--\s*(?:Start|End)Fragment\s*-->/gi, '');
  const box = inertElement(stripped);
  box.querySelectorAll('style, meta, link, title, xml, script, head, o\\:smarttagtype, v\\:shapetype').forEach((e) => e.remove());
  for (const e of Array.from(box.querySelectorAll('o\\:p, st1\\:place, st1\\:city'))) e.replaceWith(...Array.from(e.childNodes));
  for (const e of Array.from(box.querySelectorAll('b[id^="docs-internal-guid"]'))) e.replaceWith(...Array.from(e.childNodes));
  if (word) rebuildLists(box);
  for (const img of Array.from(box.querySelectorAll('img'))) if (/^(?:file|cid|ms-|webkit-fake-url|about):/i.test(img.getAttribute('src') ?? '')) img.remove();
  box.querySelectorAll('v\\:imagedata, v\\:shape, v\\:group').forEach((e) => e.remove());
  for (const el of Array.from(box.querySelectorAll('*'))) {
    const style = cleanStyle(el.getAttribute('style') ?? '');
    if (style) el.setAttribute('style', style); else el.removeAttribute('style');
    el.removeAttribute('class');
    el.removeAttribute('lang');
  }
  // blank lines at the very start and end are Word's padding, not content
  const blank = (e: Element | null) => !!e && e.tagName === 'P' && !e.textContent!.replace(/[\s ]+/g, '') && !e.querySelector('img, br');
  while (blank(box.firstElementChild)) box.firstElementChild!.remove();
  while (blank(box.lastElementChild)) box.lastElementChild!.remove();
  return box.innerHTML;
}

/** Does the clipboard hold text a normal paste can use (so an accompanying picture of that text should be ignored)? */
export function hasPasteableText(data: Pick<DataTransfer, 'getData'> | null | undefined): boolean {
  if (!data) return false;
  if (data.getData('text/plain').trim()) return true;
  const html = data.getData('text/html');
  return !!html && !!inertElement(html).textContent!.replace(/[\s ]+/g, '');
}
