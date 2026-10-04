/**
 * Parse an HTML string into an element that belongs to an inert document. An element created with the page's own
 * `document` loads images and fires `onerror`/`onload` handlers even while it is detached, which runs attacker script
 * before any sanitising happens. A document made by `createHTMLDocument` has no browsing context, so nothing runs.
 */
export function inertElement(html: string): HTMLElement {
  const box = document.implementation.createHTMLDocument('').createElement('div');
  box.innerHTML = html;
  return box;
}

const ACTIVE = 'script, iframe, object, embed, frame, frameset, applet, link, meta, base, form, svg, math';
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'srcset'];
const UNSAFE_URL = /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i;

/** Remove executable content from an element tree in place: active elements, `on*` handlers and script URLs. */
export function stripActiveContent(root: Element): void {
  root.querySelectorAll(ACTIVE).forEach((e) => e.remove());
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if (URL_ATTRS.includes(name) && UNSAFE_URL.test(attr.value.replace(/[\u0000- ]/g, ''))) el.removeAttribute(attr.name);
    }
  }
}
