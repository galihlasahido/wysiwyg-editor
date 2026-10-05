import { Captions, Charts, Columns, Comments, Embeds, FormFields, TrackChanges, createEditor, defaultPlugins, type Editor } from '../src';
import { $, button, el } from './samples';

/** A document of about `n` blocks: headings, paragraphs with formatting and links, lists, tables, captions and cross-references. */
export function makeDoc(n: number): string {
  const para = (i: number) => `<p>Paragraph ${i}: Lorem ipsum dolor sit amet, <strong>consectetur</strong> adipiscing elit, <em>sed do eiusmod</em> tempor incididunt ut labore et <a href="https://example.com/${i}">dolore magna</a> aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>`;
  const out: string[] = ['<h1>Large document</h1><div data-toc></div>'];
  for (let i = 0; i < n; i++) {
    if (i % 40 === 0) out.push(`<h2>Section ${i / 40 + 1}</h2>`);
    if (i % 25 === 12) out.push('<ul><li><p>First point</p></li><li><p>Second point</p></li><li><p>Third point</p></li></ul>');
    else if (i % 60 === 30) out.push('<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr></table>', `<p class="wy-caption" id="c${i}" data-caption="table"><span class="wy-caption-text">Table for block ${i}</span></p>`);
    else out.push(para(i));
  }
  return out.join('');
}

const plugins = () => [...defaultPlugins, Comments({ author: 'Perf' }), TrackChanges({ author: 'Perf' }), Captions(), Columns(), Charts(), FormFields(), Embeds()];
let editor: Editor | null = null;
const mount = $('#app');
const out = el('pre', { class: 'out', id: 'result' }, 'Press “Run”.');
const sizeInput = el('input', { type: 'number', value: '2000', min: '100', max: '50000', 'aria-label': 'Blocks' }) as HTMLInputElement;
const paged = el('input', { type: 'checkbox', id: 'paged' }) as HTMLInputElement;

const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const p95 = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length * 0.95)] ?? 0;
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Build a document, then time what a person feels: opening it, typing, and saving it. */
export async function run(blocks: number, usePages = false) {
  editor?.destroy();
  const host = document.getElementById('editor')!;
  host.replaceChildren();
  const html = makeDoc(blocks);
  const r: Record<string, number | string> = { blocks, paged: String(usePages), htmlKB: Math.round(html.length / 1024) };
  let t = performance.now();
  editor = createEditor({ element: host, content: html, plugins: plugins(), ...(usePages ? { pages: { height: '70vh' } } : {}), outline: false });
  r.createMs = Math.round(performance.now() - t);
  await nextFrame();
  await new Promise((res) => setTimeout(res, 300));
  const e = editor;
  r.nodes = e.view.state.doc.nodeSize;

  const typeAt = async (where: 'end' | 'middle') => {
    const { state } = e.view;
    let pos = where === 'end' ? state.doc.content.size - 1 : 0;
    if (where === 'middle') { state.doc.descendants((n, p) => { if (!pos && n.isTextblock && p > state.doc.content.size / 2) { pos = p + 1; return false; } }); }
    e.view.dispatch(state.tr.setSelection((await import('prosemirror-state')).TextSelection.create(state.doc, pos)));
    const times: number[] = [];
    for (let i = 0; i < 40; i++) {
      const s = e.view.state;
      t = performance.now();
      e.view.dispatch(s.tr.insertText('x', s.selection.from));
      times.push(performance.now() - t); // the transaction, plugin state and DOM update
      await nextFrame();
    }
    return times;
  };
  const end = await typeAt('end');
  const mid = await typeAt('middle');
  r.typeEndMedianMs = +median(end).toFixed(1); r.typeEndP95Ms = +p95(end).toFixed(1);
  r.typeMidMedianMs = +median(mid).toFixed(1); r.typeMidP95Ms = +p95(mid).toFixed(1);
  t = performance.now(); const h = e.getHTML(); r.getHTMLMs = Math.round(performance.now() - t); r.outKB = Math.round(h.length / 1024);
  t = performance.now(); e.getMarkdown(); r.getMarkdownMs = Math.round(performance.now() - t);
  t = performance.now(); e.execute('undo'); r.undoMs = Math.round(performance.now() - t);
  t = performance.now(); e.setHTML(html); r.setHTMLMs = Math.round(performance.now() - t);
  out.textContent = JSON.stringify(r, null, 2);
  return r;
}

mount.append(
  el('div', { class: 'demo-note' }, 'Plugins on: comments, track changes, captions, columns, charts, form fields, embeds, plus the defaults. Times are for this browser and machine.'),
  el('div', { class: 'actions' }, el('label', {}, 'Blocks ', sizeInput), el('label', {}, paged, ' Paged view'), button('Run', () => void run(Number(sizeInput.value) || 2000, paged.checked), true)),
  out,
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
/** Typing cost with some plugins left out (finds which ones scale with the document). */
export async function typing(blocks: number, leaveOut: string[] = []) {
  editor?.destroy();
  const host = document.getElementById('editor')!;
  host.replaceChildren();
  const all = plugins().filter((p) => !leaveOut.includes(p.name));
  const e = (editor = createEditor({ element: host, content: makeDoc(blocks), plugins: all, outline: false }));
  await nextFrame();
  const { TextSelection } = await import('prosemirror-state');
  e.view.dispatch(e.view.state.tr.setSelection(TextSelection.atEnd(e.view.state.doc)));
  const times: number[] = [];
  for (let i = 0; i < 25; i++) { const s = e.view.state; const t0 = performance.now(); e.view.dispatch(s.tr.insertText('x', s.selection.from)); times.push(performance.now() - t0); }
  return { median: +median(times).toFixed(2), names: all.map((p) => p.name) };
}
/** The floor: the same document in a bare ProseMirror view with the editor's schema and no plugins. */
export async function rawPM(blocks: number) {
  const { EditorState, TextSelection } = await import('prosemirror-state');
  const { EditorView } = await import('prosemirror-view');
  const { DOMParser } = await import('prosemirror-model');
  const tmp = createEditor({ element: document.createElement('div'), content: '', plugins: plugins(), outline: false });
  const schema = tmp.schema;
  const dom = new window.DOMParser().parseFromString(makeDoc(blocks), 'text/html').body;
  const doc = DOMParser.fromSchema(schema).parse(dom);
  const host = document.getElementById('editor')!;
  host.replaceChildren();
  const view = new EditorView(host, { state: EditorState.create({ doc, selection: TextSelection.atEnd(doc) }) });
  const times: number[] = [];
  for (let i = 0; i < 25; i++) { const s = view.state; const t0 = performance.now(); view.dispatch(s.tr.insertText('x', s.selection.from)); times.push(performance.now() - t0); }
  view.destroy();
  return { median: +median(times).toFixed(2) };
}
(window as unknown as { perfLab: unknown }).perfLab = { run, makeDoc, typing, rawPM, current: () => editor };
