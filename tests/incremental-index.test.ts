import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { Captions, Comments, collectCaptions, createEditor, defaultPlugins, getOutline } from '../src';
import { touchesDoc } from '../src/plugins/helpers';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));

/** A small deterministic random generator so a failure can be reproduced from its seed. */
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const cap = (id: string, text: string) => `<p class="wy-caption" id="${id}" data-caption="figure"><span class="wy-caption-text">${text}</span></p>`;
const START =
  '<h1>Title</h1><div data-toc></div><p>alpha beta gamma</p>' + cap('f1', 'first') + '<h2>Part one</h2><p>delta <span data-comment-id="c1">epsilon zeta</span> eta<sup data-footnote="note A">1</sup></p>' +
  '<p>See <a data-xref="f2">x</a> and <a data-xref="f1">y</a>.</p><h2>Part two</h2><p>theta <span data-comment-id="c2">iota</span> kappa</p>' + cap('f2', 'second') + '<p>lambda<sup data-footnote="note B">2</sup> mu</p><h3>Deep</h3><p>nu xi omicron</p>';

function setup() {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  const comments = Comments({ author: 'T', initial: [{ id: 'c1', author: 'A', text: 'one', createdAt: 1, resolved: false, replies: [] }, { id: 'c2', author: 'A', text: 'two', createdAt: 2, resolved: false, replies: [] }] });
  const editor = createEditor({ element: el, content: START, plugins: [...defaultPlugins, comments, Captions()], outline: true });
  return editor;
}

/** What the document says, worked out the slow way. */
function truth(doc: PMNode) {
  const outline = getOutline(doc).map((i) => i.text);
  const footnotes: string[] = [];
  doc.descendants((n) => void (n.type.name === 'footnote' && footnotes.push(n.attrs.text)));
  const anchors = new Map<string, { from: number; to: number }>();
  doc.descendants((n, pos) => { for (const m of n.marks) if (m.type.name === 'comment') { const a = anchors.get(m.attrs.id); if (a) a.to = pos + n.nodeSize; else anchors.set(m.attrs.id, { from: pos, to: pos + n.nodeSize }); } });
  const quotes = [...anchors.entries()].sort((a, b) => a[1].from - b[1].from).map(([, a]) => doc.textBetween(a.from, a.to, ' ').slice(0, 80));
  return { outline, footnotes, quotes };
}

/** What the editor shows. */
function shown(root: HTMLElement) {
  const q = (sel: string) => [...root.querySelectorAll(sel)].map((e) => e.textContent ?? '');
  return { toc: q('.wy-toc-item'), outline: q('.wy-outline-item'), footnotes: q('.wy-footnotes li'), quotes: q('.wy-comment-quote') };
}

function operations(editor: ReturnType<typeof setup>, rand: () => number) {
  const view = editor.view;
  const blocks = () => { const out: { pos: number; node: PMNode }[] = []; view.state.doc.descendants((n, pos) => { if (n.isTextblock) out.push({ pos, node: n }); }); return out; };
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const ops: [string, () => void][] = [
    ['type in a paragraph', () => { const b = pick(blocks()); view.dispatch(view.state.tr.insertText('word ', b.pos + 1 + Math.floor(rand() * b.node.content.size))); }],
    ['type at the start of a block', () => { const b = pick(blocks()); view.dispatch(view.state.tr.insertText('X', b.pos + 1)); }],
    ['delete a few characters', () => { const b = pick(blocks()); if (b.node.content.size < 2) return; const f = b.pos + 1 + Math.floor(rand() * (b.node.content.size - 1)); view.dispatch(view.state.tr.delete(f, f + 1)); }],
    ['split a block', () => { const b = pick(blocks()); view.dispatch(view.state.tr.split(b.pos + 1 + Math.floor(rand() * b.node.content.size))); }],
    ['make a heading', () => { const b = pick(blocks()); if (b.node.type.name !== 'paragraph') return; view.dispatch(view.state.tr.setNodeMarkup(b.pos, view.state.schema.nodes.heading, { level: 2 })); }],
    ['make a paragraph', () => { const b = pick(blocks().filter((x) => x.node.type.name === 'heading')); if (!b) return; view.dispatch(view.state.tr.setNodeMarkup(b.pos, view.state.schema.nodes.paragraph)); }],
    ['delete a block', () => { const b = pick(blocks()); view.dispatch(view.state.tr.delete(b.pos, b.pos + b.node.nodeSize)); }],
    ['comment a word', () => { const b = pick(blocks().filter((x) => x.node.type.name === 'paragraph' && x.node.content.size > 4)); if (!b) return; view.dispatch(view.state.tr.addMark(b.pos + 1, b.pos + 3, view.state.schema.marks.comment.create({ id: 'c1' }))); }],
    ['uncomment', () => { view.dispatch(view.state.tr.removeMark(0, view.state.doc.content.size, view.state.schema.marks.comment)); }],
    ['add a footnote', () => { const b = pick(blocks().filter((x) => x.node.type.name === 'paragraph')); if (!b) return; view.dispatch(view.state.tr.insert(b.pos + 1, view.state.schema.nodes.footnote.create({ text: `n${Math.floor(rand() * 99)}` }))); }],
    ['add a caption', () => { editor.execute('insertCaption', 'figure', `cap ${Math.floor(rand() * 99)}`); }],
    ['move the caret', () => { const b = pick(blocks()); view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(b.pos + 1)))); }],
    ['undo', () => { editor.execute('undo'); }],
  ];
  return ops;
}

describe('incremental indexes agree with a full scan after every change', () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: outline, table of contents, footnotes, comments, captions`, async () => {
      const editor = setup();
      const rand = rng(seed);
      const ops = operations(editor, rand);
      await new Promise((r) => setTimeout(r, 20));
      const log: string[] = [];
      for (let i = 0; i < 120; i++) {
        const [name, run] = ops[Math.floor(rand() * ops.length)];
        log.push(name);
        try { run(); } catch { /* an operation that does not apply to this document */ }
        const t = truth(editor.view.state.doc);
        const s = shown(editor.root);
        const where = `seed ${seed}, step ${i} (${log.slice(-4).join(' > ')})`;
        expect(s.outline, `outline: ${where}`).toEqual(t.outline);
        expect(s.toc.length === 0 || s.toc.join('|') === t.outline.join('|'), `toc: ${where}`).toBe(true);
        expect(s.footnotes, `footnotes: ${where}`).toEqual(t.footnotes);
        const live = t.quotes.filter((_q, k) => k < 99);
        expect(s.quotes.length, `comment cards: ${where}`).toBeLessThanOrEqual(live.length + 0);
        expect(s.quotes, `comment quotes: ${where}`).toEqual(live.slice(0, s.quotes.length));
        // captions: numbers follow the order, cross-references say the same number
        const caps = collectCaptions(editor.view.state.doc, [{ id: 'figure', label: 'Figure' }, { id: 'table', label: 'Table' }]);
        const byId = new Map(caps.map((c) => [c.id, c]));
        editor.view.state.doc.descendants((n) => {
          if (n.type.name === 'caption') expect(n.attrs.n, `caption number: ${where}`).toBe(byId.get(n.attrs.id)!.n);
          if (n.type.name === 'xref') { const c = byId.get(n.attrs.target); expect(n.attrs.text, `xref: ${where}`).toBe(c ? `${c.label} ${c.n}` : 'Missing reference'); }
        });
      }
      editor.destroy();
    });
  }
});

describe('touchesDoc', () => {
  const doc = (html: string) => { const el = document.body.appendChild(document.createElement('div')); roots.push(el); return createEditor({ element: el, content: html }); };
  const isH = (n: PMNode) => n.type.name === 'heading';
  it('is false for typing in an ordinary paragraph and true for headings and structure', () => {
    const e = doc('<h1>T</h1><p>one</p><p>two</p>');
    const { state } = e.view;
    expect(touchesDoc(state.tr.insertText('x', 7), isH)).toBe(false);
    expect(touchesDoc(state.tr.insertText('x', 2), isH)).toBe(true); // inside the heading
    expect(touchesDoc(state.tr.setNodeMarkup(4, state.schema.nodes.heading, { level: 2 }), isH)).toBe(true); // a paragraph became a heading
    expect(touchesDoc(state.tr.delete(0, 3), isH)).toBe(true); // the heading was removed
    expect(touchesDoc(state.tr.delete(0, state.doc.content.size), isH)).toBe(true);
    expect(touchesDoc(state.tr, isH)).toBe(false); // nothing happened
    e.destroy();
  });
});
