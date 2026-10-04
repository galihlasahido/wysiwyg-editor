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

const SCRIPTY = 'script, iframe, object, embed, frame, frameset, applet, link, meta, base, form, foreignObject, animate, set, animateTransform, animateMotion';
const UNSAFE_REF = /^\s*(?:javascript|vbscript|data\s*:\s*text\/html)/i;

/**
 * Remove executable content from rendered markup that legitimately contains `svg` and `math` (a formula, a diagram):
 * scripts, frames, `foreignObject`, animations that can set attributes, `on*` handlers and script URLs. In place.
 */
export function stripScriptsKeepGraphics(root: Element): void {
  root.querySelectorAll(SCRIPTY).forEach((e) => e.remove());
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href' || name === 'src' || name === 'action') && UNSAFE_REF.test(attr.value.replace(/[\u0000- ]/g, ''))) el.removeAttribute(attr.name);
    }
  }
}

/** Parse markup from a renderer, drop executable parts, and return the cleaned HTML. */
export function cleanRendered(html: string): string {
  const box = inertElement(html);
  stripScriptsKeepGraphics(box);
  return box.innerHTML;
}
