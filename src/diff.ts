import { inertElement, stripScriptsKeepGraphics } from './inert';

export interface DiffResult {
  /** The compared document as HTML: unchanged content as it was, additions in `<ins class="wy-diff-ins">`, removals in `<del class="wy-diff-del">`. */
  html: string;
  stats: { added: number; removed: number; changedBlocks: number };
}

/** Longest common subsequence of two arrays of keys: the matching index pairs, in order. Falls back to no matches when huge. */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  if (n * m > 4_000_000) return []; // too big to compare exactly: show as replaced rather than freeze the page
  // trim the common ends first: most edits are local, so the table stays small
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const pairs: [number, number][] = [];
  for (let i = 0; i < start; i++) pairs.push([i, i]);
  const w = endB - start + 1;
  const table = new Uint32Array((endA - start + 1) * w);
  for (let i = endA - start - 1; i >= 0; i--) {
    for (let j = endB - start - 1; j >= 0; j--) {
      table[i * w + j] = a[start + i] === b[start + j] ? table[(i + 1) * w + j + 1] + 1 : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < endA - start && j < endB - start) {
    if (a[start + i] === b[start + j]) { pairs.push([start + i, start + j]); i++; j++; }
    else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) i++;
    else j++;
  }
  for (let k = 0; endA + k < n; k++) pairs.push([endA + k, endB + k]);
  return pairs;
}

const tokens = (s: string) => s.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
const words = (s: string) => (s.match(/[\p{L}\p{N}_]+/gu) ?? []).length;

/** Word-level diff of two texts as DOM nodes. */
function diffText(doc: Document, a: string, b: string, stats: DiffResult['stats']): Node[] {
  const ta = tokens(a);
  const tb = tokens(b);
  const pairs = lcs(ta, tb);
  const out: Node[] = [];
  const emit = (kind: 'eq' | 'ins' | 'del', text: string) => {
    if (!text) return;
    if (kind === 'eq') { out.push(doc.createTextNode(text)); return; }
    const el = doc.createElement(kind === 'ins' ? 'ins' : 'del');
    el.className = kind === 'ins' ? 'wy-diff-ins' : 'wy-diff-del';
    el.textContent = text;
    out.push(el);
    if (kind === 'ins') stats.added += words(text); else stats.removed += words(text);
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [ta.length, tb.length] as [number, number]]) {
    emit('del', ta.slice(i, pi).join(''));
    emit('ins', tb.slice(j, pj).join(''));
    if (pi < ta.length) emit('eq', ta[pi]);
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

const norm = (el: Element) => el.outerHTML.replace(/\s+/g, ' ');
const isTextBlock = (el: Element) => /^(P|H[1-6]|BLOCKQUOTE)$/.test(el.tagName);
const mark = (el: Element, cls: string) => { const c = el.cloneNode(true) as Element; c.classList.add(cls); return c; };

/** Compare two lists of sibling blocks and return the merged blocks. */
function diffBlocks(doc: Document, a: Element[], b: Element[], stats: DiffResult['stats']): Node[] {
  const pairs = lcs(a.map(norm), b.map(norm));
  const out: Node[] = [];
  const flush = (oldRun: Element[], newRun: Element[]) => {
    // a removed block followed by an added block of the same kind is an edit: show it inline
    let k = 0;
    for (; k < oldRun.length && k < newRun.length; k++) {
      const o = oldRun[k];
      const n = newRun[k];
      if (o.tagName === n.tagName && isTextBlock(o)) {
        const merged = n.cloneNode(false) as Element;
        for (const node of diffText(doc, o.textContent ?? '', n.textContent ?? '', stats)) merged.append(node);
        out.push(merged);
        stats.changedBlocks++;
      } else if (o.tagName === n.tagName && /^(UL|OL)$/.test(o.tagName)) {
        const merged = n.cloneNode(false) as Element;
        for (const node of diffBlocks(doc, [...o.children], [...n.children], stats)) merged.append(node);
        out.push(merged);
        stats.changedBlocks++;
      } else if (o.tagName === n.tagName && o.tagName === 'LI') {
        const merged = n.cloneNode(false) as Element;
        const oText = [...o.childNodes].filter((x) => !(x instanceof Element && /^(UL|OL)$/.test(x.tagName))).map((x) => x.textContent).join('');
        const nText = [...n.childNodes].filter((x) => !(x instanceof Element && /^(UL|OL)$/.test(x.tagName))).map((x) => x.textContent).join('');
        for (const node of diffText(doc, oText, nText, stats)) merged.append(node);
        const sub = [...n.children].filter((x) => /^(UL|OL)$/.test(x.tagName));
        const oldSub = [...o.children].filter((x) => /^(UL|OL)$/.test(x.tagName));
        sub.forEach((s, idx) => { const old = oldSub[idx]; if (old && old.tagName === s.tagName) { const m = s.cloneNode(false) as Element; for (const nn of diffBlocks(doc, [...old.children], [...s.children], stats)) m.append(nn); merged.append(m); } else merged.append(mark(s, 'wy-diff-ins')); });
        out.push(merged);
        stats.changedBlocks++;
      } else {
        out.push(mark(o, 'wy-diff-del-block'));
        out.push(mark(n, 'wy-diff-ins-block'));
        stats.removed += words(o.textContent ?? '');
        stats.added += words(n.textContent ?? '');
        stats.changedBlocks++;
      }
    }
    for (const o of oldRun.slice(k)) { out.push(mark(o, 'wy-diff-del-block')); stats.removed += words(o.textContent ?? ''); stats.changedBlocks++; }
    for (const n of newRun.slice(k)) { out.push(mark(n, 'wy-diff-ins-block')); stats.added += words(n.textContent ?? ''); stats.changedBlocks++; }
  };
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    flush(a.slice(i, pi), b.slice(j, pj));
    if (pi < a.length) out.push(b[pj].cloneNode(true));
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

/**
 * Compare two documents (editor HTML). Blocks are matched first; a changed paragraph, heading or list item is then compared word by word.
 * Removed blocks get `wy-diff-del-block`, added ones `wy-diff-ins-block`. The result is cleaned of scripts, so it is safe to show.
 */
export function diffDocuments(oldHtml: string, newHtml: string): DiffResult {
  const a = inertElement(oldHtml);
  const b = inertElement(newHtml);
  stripScriptsKeepGraphics(a);
  stripScriptsKeepGraphics(b);
  const stats = { added: 0, removed: 0, changedBlocks: 0 };
  const box = b.ownerDocument.createElement('div');
  for (const node of diffBlocks(b.ownerDocument, [...a.children], [...b.children], stats)) box.append(node);
  return { html: box.innerHTML, stats };
}
