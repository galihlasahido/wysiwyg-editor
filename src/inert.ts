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

const ACTIVE = 'script, iframe, object, embed, frame, frameset, applet, link, meta, base, form, svg, math, style, noscript, template';
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

// style, noscript, template, mglyph, malignmark and annotation-xml are the elements a mutation-XSS payload hides behind: they change how
// the same text parses the second time (see `stableHTML`), and nothing a document needs is lost without them
const SCRIPTY = 'script, iframe, object, embed, frame, frameset, applet, link, meta, base, form, foreignObject, animate, set, animateTransform, animateMotion, style, noscript, template, mglyph, malignmark, annotation-xml';
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

/**
 * The cleaned HTML of an element, in a form that parses to the same thing every time. Taking a tree apart and writing it out as text
 * is not always undone by parsing the text again (nested svg, math, style and table tricks change shape on the way back: mutation
 * XSS), so the text is parsed and cleaned again until it stops changing. If it will not settle, nothing is returned.
 */
export function stableHTML(root: Element, clean: (e: Element) => void): string {
  let out = root.innerHTML;
  for (let i = 0; i < 4; i++) {
    const again = inertElement(out);
    clean(again);
    const next = again.innerHTML;
    if (next === out) return out;
    out = next;
  }
  return '';
}

/** Parse markup from a renderer, drop executable parts, and return the cleaned HTML. */
export function cleanRendered(html: string): string {
  const box = inertElement(html);
  stripScriptsKeepGraphics(box);
  return stableHTML(box, stripScriptsKeepGraphics);
}
