import type { FullExample } from '../full-code';

// Small helpers used by several examples are written inline in each (every example must stand alone).

export const group_a: Record<string, FullExample> = {
  ai: {
    css: '#editor { max-width: 820px; margin: 24px auto; }',
    code: String.raw`
import { AIAssistant, TrackChanges, createEditor, createFetchProvider, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// A stand-in for a language model that works offline: it fixes a few typos and streams the result word by word.
// In your app, replace it with: const provider = createFetchProvider('/api/ai');
// (your server calls the model; never put API keys in the browser. '/api/ai' is a placeholder for your own endpoint.)
const fixes = [[/\bteh\b/gi, 'the'], [/\brecieve\b/gi, 'receive'], [/\bdont\b/gi, "don't"], [/\balot\b/gi, 'a lot'], [/\bi\b/g, 'I']];
const fix = (t) => fixes.reduce((s, [re, to]) => s.replace(re, to), t);

async function* mock({ action, text, signal }) {
  let out;
  if (action === 'complete') out = ' We will share the details in the next update.';
  else if (action === 'summarize') out = 'Summary: ' + fix(text).split('.')[0] + '.';
  else if (action === 'shorten') out = fix(text).split('.')[0] + '.';
  else if (action === 'chat') out = 'Mock answer. In your app the real model answers here.';
  else out = fix(text); // grammar, improve, review, ...
  for (const word of out.split(/(\s+)/)) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, 25));
    yield word;
  }
}
const provider = mock; // or createFetchProvider('/api/ai')

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Quarterly update</h1><p>i recieve teh report yesterday and dont know which numbers to trust. there is alot of data.</p><p>The team shipped three features this quarter. Next quarter we plan to focus on reliability.</p>',
  plugins: [
    ...defaultPlugins,
    TrackChanges({ author: 'You' }),        // the review action proposes fixes as tracked changes
    AIAssistant({
      provider,
      inline: { delayMs: 700, minChars: 15 }, // grey continuation while you type (Tab accepts, Esc dismisses)
      chat: true,                             // a chat panel about the document
      review: { author: 'AI' },
    }),
  ],
});

// Select a sentence and pick an action from the AI menu. The result streams into a preview; nothing changes until you accept.
editor.on('change', () => console.log(editor.getStats().words + ' words'));
`,
  },

  bilingual: {
    html: '<div class="cols">\n  <div><h2>English (LTR)</h2><div id="en"></div></div>\n  <div><h2>العربية (RTL)</h2><div id="ar"></div></div>\n</div>',
    css: '.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 1100px; margin: 24px auto; }\n@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }',
    code: String.raw`
import { createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// Each editor has its own interface language and direction.
createEditor({
  element: document.getElementById('en'),
  plugins: defaultPlugins,
  content: '<h1>Welcome</h1><p>This document is available in two languages. Edit either side.</p><ul><li><p>Simple to start</p></li><li><p>Easy to extend</p></li></ul><p dir="rtl">مثال: نص عربي داخل فقرة</p>',
});

const arabic = createEditor({
  element: document.getElementById('ar'),
  plugins: defaultPlugins,
  locale: 'ar', // Arabic toolbar and right-to-left layout
  content: '<h1 dir="rtl">مرحبًا</h1><p dir="rtl">هذا المستند متاح بلغتين. يمكنك تحرير أي جانب.</p><ul dir="rtl"><li><p dir="rtl">سهل البدء</p></li><li><p dir="rtl">سهل التوسيع</p></li></ul><p dir="ltr">Example: English text inside a paragraph</p>',
});

// One paragraph at a time, for mixed text: place the cursor in it first.
// arabic.execute('direction', 'rtl');
`,
  },

  'blog-cms': {
    html: String.raw`<div class="post">
  <label>Title <input id="title" value="Why small editors win" /></label>
  <label>Slug <input id="slug" /></label>
  <div id="editor"></div>
  <p id="meta" class="meta"></p>
  <div class="row">
    <select id="width" aria-label="Preview width">
      <option value="375">Phone (375)</option>
      <option value="768">Tablet (768)</option>
      <option value="100%" selected>Desktop</option>
    </select>
    <button id="md">Show Markdown</button>
    <button id="dl">Download .html</button>
  </div>
  <iframe id="preview" title="Preview" sandbox=""></iframe>
  <pre id="markdown" hidden></pre>
</div>`,
    css: `.post { max-width: 820px; margin: 24px auto; font: 15px system-ui, sans-serif; display: grid; gap: 10px; }
.post input { width: 100%; padding: 6px; box-sizing: border-box; }
.row { display: flex; gap: 8px; }
.meta { color: #666; margin: 0; }
#preview { width: 100%; height: 320px; border: 1px solid #ccc; border-radius: 8px; }
#markdown { background: #f6f6f6; padding: 10px; overflow: auto; white-space: pre-wrap; }`,
    code: String.raw`
import { createEditor, defaultPlugins, download } from 'wysiwygido';
import 'wysiwygido/style.css';

const $ = (id) => document.getElementById(id);
let manualSlug = false;
let showMarkdown = false;

const toSlug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);

const editor = createEditor({
  element: $('editor'),
  plugins: defaultPlugins,
  content: '<p>Big editors do everything, and you pay for all of it. A small core with plugins lets you ship only what you need.</p><h2>What changes</h2><ul><li><p>Smaller bundles</p></li><li><p>Fewer surprises</p></li></ul><p>Drop an image into the editor, or paste one.</p>',
  onChange: refresh,
});

function refresh() {
  if (!manualSlug) $('slug').value = toSlug($('title').value);
  const body = editor.getHTML(); // schema-sanitised HTML, safe to embed
  const words = body.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  $('meta').textContent = words + ' words, ' + Math.max(1, Math.round(words / 200)) + ' min read, /blog/' + ($('slug').value || '...');
  const title = $('title').value.replace(/[<&]/g, '');
  // the preview is a sandboxed iframe, so nothing in the post can run
  $('preview').srcdoc = '<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui;margin:16px}img{max-width:100%;height:auto}</style><h1>' + title + '</h1>' + body;
  const w = $('width').value;
  $('preview').style.width = w.endsWith('%') ? w : w + 'px';
  $('markdown').textContent = '# ' + title + '\n\n' + editor.getMarkdown();
  $('markdown').hidden = !showMarkdown;
}

$('slug').addEventListener('input', () => (manualSlug = true));
$('title').addEventListener('input', refresh);
$('width').addEventListener('change', refresh);
$('md').addEventListener('click', () => { showMarkdown = !showMarkdown; refresh(); });
$('dl').addEventListener('click', () => download('<!doctype html><meta charset="utf-8"><title>' + $('title').value.replace(/[<&]/g, '') + '</title>' + editor.getHTML(), ($('slug').value || 'post') + '.html', 'text/html'));
refresh();
`,
  },

  captions: {
    html: '<p><button id="docx">Download .docx</button></p>\n<div id="editor"></div>',
    css: '#editor { max-width: 860px; margin: 24px auto; }\nbody > p { max-width: 860px; margin: 24px auto 0; }',
    install: ['docx'],
    code: String.raw`
import { Captions, createEditor, defaultPlugins, download } from 'wysiwygido';
import { exportDocx } from 'wysiwygido/docx';
import 'wysiwygido/style.css';

// a small generated picture so the example needs no files
function picture(label, hue) {
  const c = document.createElement('canvas');
  c.width = 420;
  c.height = 200;
  const g = c.getContext('2d');
  g.fillStyle = 'hsl(' + hue + ' 75% 55%)';
  g.fillRect(0, 0, 420, 200);
  g.fillStyle = '#fff';
  g.font = 'bold 28px system-ui, sans-serif';
  g.fillText(label, 16, 44);
  return c.toDataURL('image/png');
}
const caption = (id, kind, text) => '<p class="wy-caption" id="' + id + '" data-caption="' + kind + '"><span class="wy-caption-text">' + text + '</span></p>';

const content =
  '<h1>Annual report</h1><div data-caption-list="figure"></div><div data-caption-list="table"></div>' +
  '<h2>Results</h2><p>Revenue is shown in <a data-xref="t1">Table 1</a>, and the trend in <a data-xref="f2">Figure 2</a>.</p>' +
  '<p><img src="' + picture('Chart A', 150) + '" alt="Chart A" width="320"></p>' + caption('f1', 'figure', 'Revenue by quarter') +
  '<table><tr><th>Quarter</th><th>Revenue</th></tr><tr><td>Q1</td><td>1.2M</td></tr><tr><td>Q2</td><td>1.5M</td></tr></table>' + caption('t1', 'table', 'Revenue figures') +
  '<p><img src="' + picture('Chart B', 20) + '" alt="Chart B" width="320"></p>' + caption('f2', 'figure', 'Growth trend') +
  '<p>Select a picture or a table and use the caption button: it is numbered automatically, and every cross-reference and list above updates.</p>';

const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  plugins: [...defaultPlugins, Captions()], // Captions({ kinds: [{ id: 'figure', label: 'Gambar' }, ...] }) renames the labels
});

editor.execute('insertCaptionList', 'figure');    // also available as commands: insertCaption, insertCrossReference
console.log(editor.extensions.captions.list());   // [{ id, kind, n, label, text }]

// numbers and references are written as text in the Word file
document.getElementById('docx').addEventListener('click', async () => download(await exportDocx(editor), 'captions.docx'));
`,
  },

  charts: {
    html: '<p class="bar"><button id="line">Line chart</button> <button id="bar">Bar chart</button> <button id="title">Set title</button> <button id="docx">Download .docx</button></p>\n<div id="editor"></div>',
    css: '#editor, .bar { max-width: 860px; margin: 16px auto; }',
    install: ['docx'],
    code: String.raw`
import { Charts, createEditor, defaultPlugins, download } from 'wysiwygido';
import { exportDocx } from 'wysiwygido/docx';
import 'wysiwygido/style.css';

const content =
  '<h1>Sales review</h1><p>Click inside the table, then use the chart buttons in the toolbar.</p>' +
  '<table><tr><th>Quarter</th><th>2025</th><th>2026</th></tr><tr><td>Q1</td><td>1,200</td><td>1,500</td></tr><tr><td>Q2</td><td>900</td><td>1,100</td></tr><tr><td>Q3</td><td>1,350</td><td>1,800</td></tr><tr><td>Q4</td><td>1,600</td><td>2,100</td></tr></table><p></p>' +
  // a chart is stored as data and drawn again on load
  "<figure data-chart='{\"type\":\"pie\",\"title\":\"Share by region\",\"labels\":[\"Java\",\"Sumatra\",\"Bali\",\"Other\"],\"series\":[{\"name\":\"Share\",\"values\":[52,21,14,13]}]}'></figure>";

const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  plugins: [...defaultPlugins, Charts()],
});

// the buttons act on the selected chart; select the pie chart first
document.getElementById('line').onclick = () => editor.execute('setChart', { type: 'line' });
document.getElementById('bar').onclick = () => editor.execute('setChart', { type: 'bar' });
document.getElementById('title').onclick = () => editor.execute('setChart', { title: 'Revenue by quarter' });
document.getElementById('docx').onclick = async () => download(await exportDocx(editor), 'charts.docx'); // charts become pictures

// a chart from your own data instead of a table:
// editor.execute('insertChart', 'bar', { title: 'Users', labels: ['a', 'b'], series: [{ name: 'S', values: [1, 2] }] });
`,
  },

  columns: {
    html: '<p class="bar"><button id="c2">2 columns</button> <button id="c3">3 columns</button> <button id="gap">Wider gap</button> <button id="brk">Column break here</button> <button id="docx">Download .docx</button></p>\n<div id="editor"></div>',
    css: '#editor, .bar { max-width: 860px; margin: 16px auto; }',
    install: ['docx'],
    code: String.raw`
import { Columns, createEditor, defaultPlugins, download } from 'wysiwygido';
import { exportDocx } from 'wysiwygido/docx';
import 'wysiwygido/style.css';

const lorem = 'The editor keeps every paragraph in one flow and the browser balances it across the columns, so adding text never needs manual breaks. ';
const content =
  '<h1>Newsletter</h1>' +
  '<div data-columns="2" data-rule="solid"><p>' + lorem.repeat(3) + '</p><p>' + lorem.repeat(3) + '</p><p>' + lorem.repeat(2) + '</p></div>' +
  '<p>Select blocks and use the columns buttons to wrap them; the remove button unwraps them again.</p>';

const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  plugins: [...defaultPlugins, Columns()],
});

// put the cursor inside the columns, then press a button
document.getElementById('c2').onclick = () => editor.execute('setColumns', { count: 2 });
document.getElementById('c3').onclick = () => editor.execute('setColumns', { count: 3 });
document.getElementById('gap').onclick = () => editor.execute('setColumns', { gap: 56 });
document.getElementById('brk').onclick = () => editor.execute('insertColumnBreak');
// each columns block is a real Word section in the .docx
document.getElementById('docx').onclick = async () => download(await exportDocx(editor), 'columns.docx');

// other commands: insertColumns (wrap the selection), removeColumns, setDocumentColumns
`,
  },

  'contract-form': {
    html: '<p class="bar"><button id="check">Check the form</button> <button id="print">Print / Save as PDF</button> <button id="docx">Download .docx</button> <button id="reset">Reset</button></p>\n<div id="editor"></div>\n<pre id="answers">(press "Check the form")</pre>',
    css: '#editor, .bar, #answers { max-width: 860px; margin: 16px auto; }\n#answers { background: #f6f6f6; padding: 10px; white-space: pre-wrap; }',
    install: ['docx'],
    code: String.raw`
import { FormFields, RestrictedEditing, createEditor, defaultPlugins, download } from 'wysiwygido';
import { exportDocx } from 'wysiwygido/docx';
import 'wysiwygido/style.css';

const hint = (t) => '<p><i>' + t + '</i></p>';
// <section data-locked> is fixed text; <div data-editable-region> is a place to fill in
const content =
  '<section data-locked data-variant="title" data-label="Header"><h1>Services contract</h1><p>Between the parties named below. Complete every highlighted field.</p></section>' +
  '<h2>1. Parties</h2><div data-editable-region data-label="Client">' + hint('Client full name and address') + '</div><div data-editable-region data-label="Provider">' + hint('Provider full name and address') + '</div>' +
  '<h2>2. Services</h2><div data-editable-region data-label="Scope">' + hint('Describe the services') + '</div>' +
  '<h2>3. Fees</h2><div data-editable-region data-label="Amount">' + hint('Fee and payment schedule') + '</div>' +
  "<p><span data-field=\"select\" data-name=\"payment\" data-label=\"Payment method\" data-options='[\"Bank transfer\",\"Card\",\"Cash\"]' data-required data-value=\"\"></span> <span data-field=\"date\" data-name=\"start\" data-label=\"Start date\" data-required data-value=\"\"></span></p>" +
  '<section data-locked data-variant="legal" data-label="Standard terms"><h2>4. Standard terms</h2><ol><li><p>Payment is due within 30 days of the invoice date.</p></li><li><p>Either party may end this contract with 14 days written notice.</p></li></ol><p><span data-field="checkbox" data-name="accept" data-label="I accept these terms" data-required data-value="false"></span></p></section>' +
  '<h2>5. Signatures</h2><div data-editable-region data-label="Signature">' + hint('Type your full name to sign') + '</div>';

const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  plugins: [...defaultPlugins, FormFields(), RestrictedEditing({ authorControls: false })],
});

document.getElementById('check').onclick = () => {
  const form = editor.extensions.form;
  const missing = form.validate(); // names of required fields still empty
  document.getElementById('answers').textContent = missing.length ? 'Still required: ' + missing.join(', ') : JSON.stringify(form.getData(), null, 2);
};
document.getElementById('print').onclick = () => editor.execute('print');
document.getElementById('docx').onclick = async () => download(await exportDocx(editor), 'contract.docx');
document.getElementById('reset').onclick = () => editor.setHTML(content);
`,
  },

  'custom-plugin': {
    css: '#editor { max-width: 820px; margin: 24px auto; }\naside.callout { border-left: 4px solid #3b82f6; background: #eff6ff; padding: 4px 12px; margin: 8px 0; border-radius: 4px; }\naside.callout[data-kind="warning"] { border-color: #f59e0b; background: #fffbeb; }\naside.callout[data-kind="danger"] { border-color: #ef4444; background: #fef2f2; }\naside.callout[data-kind="success"] { border-color: #22c55e; background: #f0fdf4; }\n.goal { max-width: 820px; margin: 8px auto; font: 13px system-ui, sans-serif; display: flex; gap: 8px; align-items: center; }',
    code: String.raw`
import { createEditor, defaultPlugins, definePlugin } from 'wysiwygido';
import 'wysiwygido/style.css';

const KINDS = ['info', 'warning', 'danger', 'success'];

// A plugin is one object: a document model, commands, toolbar buttons and a shortcut.
const Callout = definePlugin({
  name: 'callout',

  // 1. the document model (a ProseMirror node spec)
  nodes: {
    callout: {
      group: 'block',
      content: 'block+',
      defining: true,
      attrs: { kind: { default: 'info' } },
      parseDOM: [{ tag: 'aside.callout', getAttrs: (n) => ({ kind: KINDS.find((k) => k === n.dataset.kind) || 'info' }) }],
      toDOM: (n) => ['aside', { class: 'callout', 'data-kind': n.attrs.kind }, 0],
    },
  },

  // 2. behaviour: a command that wraps the selected blocks
  setup(editor) {
    editor.registerCommand('insertCallout', (e, kind = 'info') => {
      const { state, dispatch } = e.view;
      const range = state.selection.$from.blockRange(state.selection.$to);
      if (!range) return false;
      const attrs = { kind: KINDS.find((k) => k === kind) || 'info' };
      dispatch(state.tr.wrap(range, [{ type: state.schema.nodes.callout, attrs }]).scrollIntoView());
      return true;
    });
  },

  // 3. toolbar buttons
  toolbar: [
    { name: 'calloutInfo', label: 'Info callout', icon: 'ℹ️', command: 'insertCallout', args: ['info'] },
    { name: 'calloutWarning', label: 'Warning callout', icon: '⚠️', command: 'insertCallout', args: ['warning'] },
  ],

  // 4. keyboard shortcut
  keymap: { 'Mod-Alt-c': 'insertCallout' },
});

// A second plugin that listens to editor events and shows a live word goal. It cleans up after itself.
const WordGoal = (goal) => {
  let badge;
  return definePlugin({
    name: 'word-goal',
    requires: ['word-count'], // fails with a clear message when the plugin it needs is missing
    onReady(editor) {
      badge = document.createElement('div');
      badge.className = 'goal';
      editor.root.after(badge);
      const update = () => {
        const words = editor.getStats().words;
        badge.textContent = words + ' / ' + goal + ' words' + (words >= goal ? ' - goal reached' : '');
      };
      update();
      editor.on('change', update); // events: ready change selection focus blur command destroy
    },
    destroy() { badge.remove(); },
  });
};

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Release notes</h1><p>Select a paragraph and wrap it in a callout with the buttons or Ctrl/Cmd+Alt+C.</p><p>The word goal below updates as you type.</p>',
  plugins: [...defaultPlugins, Callout, WordGoal(60)],
});

// the toolbar can be rearranged at any time
editor.setToolbar({ items: ['bold', 'italic', 'link', '|', 'calloutInfo', 'calloutWarning'], overflow: 'wrap' });
`,
  },

  diagram: {
    html: '<p class="bar"><button id="more">Insert another</button> <button id="show">Show HTML</button></p>\n<div id="editor"></div>\n<pre id="out" hidden></pre>',
    css: '#editor, .bar, #out { max-width: 820px; margin: 16px auto; }\n#out { background: #f6f6f6; padding: 10px; overflow: auto; white-space: pre-wrap; }',
    code: String.raw`
import { Diagram, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// A diagram is stored as validated JSON on a <figure> and drawn as SVG.
const flow = {
  w: 520, h: 140,
  shapes: [
    { id: 'a', type: 'rect', x: 20, y: 40, w: 110, h: 50, text: 'Write', fill: '#dbeafe' },
    { id: 'b', type: 'diamond', x: 200, y: 30, w: 120, h: 70, text: 'Review?', fill: '#fef3c7' },
    { id: 'c', type: 'ellipse', x: 390, y: 40, w: 110, h: 50, text: 'Release', fill: '#dcfce7' },
  ],
  arrows: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }],
};
const figure = '<figure data-diagram=\'' + JSON.stringify(flow) + '\'></figure>';

const editor = createEditor({
  element: document.getElementById('editor'),
  plugins: [...defaultPlugins, Diagram], // Diagram is a plugin, not a function
  content: '<h1>Release process</h1><p>The flow below is a diagram block, editable in place: press Edit diagram, then Arrow and click two shapes to connect them.</p>' + figure + '<p></p>',
});

document.getElementById('more').onclick = () => editor.execute('insertDiagram'); // an empty one; pass a model to start from your own
document.getElementById('show').onclick = () => {
  const out = document.getElementById('out');
  out.hidden = false;
  out.textContent = editor.getHTML();
};
`,
  },

  'editor-types': {
    html: '<h2>Classic (toolbar on top)</h2>\n<div id="classic"></div>\n<h2>Inline / balloon (select text, or type "/" on an empty line)</h2>\n<div id="inline"></div>\n<h2>Document (ribbon, pages, outline)</h2>\n<div id="document"></div>',
    css: 'body > div, body > h2 { max-width: 900px; margin-left: auto; margin-right: auto; }\nbody > h2 { font: 600 16px system-ui, sans-serif; margin-top: 24px; margin-bottom: 8px; }',
    code: String.raw`
import { BalloonToolbar, SlashCommands, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// 1. Classic: the toolbar is always visible at the top. Good for forms and CMS fields.
createEditor({
  element: document.getElementById('classic'),
  content: '<h2>Classic editor</h2><p>The toolbar is always visible at the top.</p>',
  placeholder: 'Write something...',
});

// 2. Inline: no toolbar; a small one floats over the selection, and "/" opens a block menu.
createEditor({
  element: document.getElementById('inline'),
  toolbar: false,
  plugins: [...defaultPlugins, BalloonToolbar(), SlashCommands()],
  content: '<h2>Inline editor</h2><p>Select some of this text and a toolbar floats above it. On an empty line, type <code>/</code> to insert a block.</p><p></p>',
});

// 3. Document: ribbon, paged layout with header and footer, and a heading outline.
createEditor({
  element: document.getElementById('document'),
  content: '<h1>The case for small, modular editors</h1><p>Large editors do everything, and you pay for all of it. A small core with plugins lets you ship only what you need.</p><h2>What changes</h2><p>Bundles shrink, and there are fewer surprises.</p><h2>What stays</h2><p>Every feature is still one plugin away.</p>',
  ribbon: true,
  pages: { header: 'The case for small, modular editors', footer: 'Page {page} of {pages}', height: '60vh' },
  outline: true,
});
`,
  },

  'email-campaign': {
    html: String.raw`<div class="wrap">
  <section>
    <h2>Compose</h2>
    <label>Subject <input id="subject" value="Your {{plan}} plan, {{first_name}}" /></label>
    <div id="editor"></div>
  </section>
  <section>
    <h2>Recipients</h2>
    <ul id="people"></ul>
    <button id="send">Send test (simulated)</button>
    <p id="result"></p>
    <h2>Preview</h2>
    <iframe id="preview" title="Email preview" sandbox=""></iframe>
  </section>
</div>`,
    css: `.wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1100px; margin: 24px auto; font: 14px system-ui, sans-serif; }
@media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } }
input { width: 100%; padding: 6px; box-sizing: border-box; margin-bottom: 8px; }
#people { list-style: none; padding: 0; }
#preview { width: 100%; height: 340px; border: 1px solid #ccc; }`,
    code: String.raw`
import { MergeFields, createEditor, defaultPlugins, getMergeFields, renderMergeFields, toEmailHTML } from 'wysiwygido';
import 'wysiwygido/style.css';

const FIELDS = [{ name: 'first_name', label: 'First name' }, { name: 'company', label: 'Company' }, { name: 'plan', label: 'Plan' }];
const PEOPLE = [
  { email: 'ana@kopi.id', first_name: 'Ana', company: 'Kopi Nusantara', plan: 'Team' },
  { email: 'budi@santoso.id', first_name: 'Budi', company: 'Santoso & Sons <b>', plan: 'Business' },
  { email: 'citra@example.com', first_name: 'Citra' }, // no company or plan: it will be flagged
];
const $ = (id) => document.getElementById(id);
const field = (n) => '<span data-merge-field="' + n + '"></span>';
let selected = 0;

const editor = createEditor({
  element: $('editor'),
  plugins: [...defaultPlugins, MergeFields(FIELDS)], // adds an Insert field menu
  content: '<h2>Hello ' + field('first_name') + '</h2><p>Your ' + field('plan') + ' plan for <strong>' + field('company') + '</strong> is ready.</p><p><a href="https://example.com/start">Open your dashboard</a></p>',
  onChange: render,
});

const fill = (text, p) => text.replace(/\{\{(\w+)\}\}/g, (m, k) => p[k] || m);
const esc = (s) => s.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));

// fields used in the body or the subject that this recipient has no value for
function missing(p) {
  const inSubject = ($('subject').value.match(/\{\{(\w+)\}\}/g) || []).map((m) => m.slice(2, -2));
  return [...new Set([...getMergeFields(editor.view.state.doc), ...inSubject])].filter((k) => !p[k]);
}

function render() {
  $('people').replaceChildren(...PEOPLE.map((p, i) => {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.textContent = p.email + (i === selected ? ' (previewing)' : '');
    b.onclick = () => { selected = i; render(); };
    const m = missing(p);
    li.append(b, m.length ? ' missing: ' + m.join(', ') : ' ok');
    return li;
  }));
  const p = PEOPLE[selected];
  // values are inserted as text, never as markup
  $('preview').srcdoc = '<!doctype html><meta charset="utf-8"><p style="font:12px system-ui;color:#666">Subject: ' + esc(fill($('subject').value, p)) + '</p>' + toEmailHTML(renderMergeFields(editor.getHTML(), p));
}

$('subject').addEventListener('input', render);
$('send').onclick = () => {
  const bad = PEOPLE.filter((p) => missing(p).length);
  $('result').textContent = bad.length ? 'Blocked: ' + bad.length + ' recipient(s) are missing data.' : 'Would send ' + PEOPLE.length + ' emails. Nothing is sent from this example.';
};
render();
`,
  },

  email: {
    html: String.raw`<div class="wrap">
  <section>
    <h2>Compose</h2>
    <label>Subject <input id="subject" value="Welcome aboard!" /></label>
    <div id="editor"></div>
  </section>
  <section>
    <h2>Output</h2>
    <p><button id="t-preview">Preview</button> <button id="t-html">HTML</button> <button id="t-text">Plain text</button> <button id="copy">Copy HTML</button></p>
    <iframe id="preview" title="Email preview" sandbox=""></iframe>
    <pre id="source" hidden></pre>
  </section>
</div>`,
    css: `.wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1100px; margin: 24px auto; font: 14px system-ui, sans-serif; }
@media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } }
input { width: 100%; padding: 6px; box-sizing: border-box; margin-bottom: 8px; }
#preview { width: 100%; height: 400px; border: 1px solid #ccc; }
#source { background: #f6f6f6; padding: 10px; overflow: auto; white-space: pre-wrap; max-height: 400px; }`,
    code: String.raw`
import { createEditor, toEmailHTML, toEmailText } from 'wysiwygido';
import 'wysiwygido/style.css';

const $ = (id) => document.getElementById(id);
let mode = 'preview';

const editor = createEditor({
  element: $('editor'),
  toolbar: ['bold', 'italic', 'underline', '|', 'heading', 'link', '|', 'bulletList', 'orderedList', '|', 'image'],
  content: '<h1>Welcome aboard!</h1><p>Hi there, thanks for signing up. Here is what to do next:</p><ol><li><p>Confirm your address</p></li><li><p>Pick a plan</p></li><li><p>Invite your team</p></li></ol><p><a href="https://example.com/start">Get started</a> - it only takes a minute.</p>',
  onChange: render,
});

function render() {
  // mail clients ignore most CSS, so this lays the content out in tables with inline styles
  const html = toEmailHTML(editor.getHTML(), { width: 600 });
  $('preview').srcdoc = '<!doctype html><meta charset="utf-8"><title>' + $('subject').value.replace(/[<&]/g, '') + '</title>' + html;
  $('source').textContent = mode === 'text' ? toEmailText(editor.getHTML()) : html; // the plain-text alternative
  $('preview').hidden = mode !== 'preview';
  $('source').hidden = mode === 'preview';
}

for (const m of ['preview', 'html', 'text']) $('t-' + m).onclick = () => { mode = m; render(); };
$('subject').addEventListener('input', render);
$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText(toEmailHTML(editor.getHTML(), { width: 600 })); $('copy').textContent = 'Copied!'; } catch { $('copy').textContent = 'Copy failed'; }
  setTimeout(() => ($('copy').textContent = 'Copy HTML'), 1500);
};
render();
`,
  },

  embeds: {
    html: '<p class="bar"><button id="insert">Insert media...</button> <button id="show">Show the saved HTML</button></p>\n<div id="editor"></div>\n<pre id="out" hidden></pre>',
    css: '#editor, .bar, #out { max-width: 820px; margin: 16px auto; }\n#out { background: #f6f6f6; padding: 10px; overflow: auto; white-space: pre-wrap; }',
    code: String.raw`
import { DEFAULT_EMBED_PROVIDERS, Embeds, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// A provider you add yourself: any service, as long as it returns an https address on its own host.
const loom = {
  id: 'loom',
  name: 'Loom',
  match: (url) => {
    if (url.hostname !== 'www.loom.com') return null;
    const id = /^\/share\/([a-f0-9]{32})/.exec(url.pathname);
    return id ? { src: 'https://www.loom.com/embed/' + id[1], aspect: 16 / 9, title: 'Loom video' } : null;
  },
};

const editor = createEditor({
  element: document.getElementById('editor'),
  plugins: [...defaultPlugins, Embeds({ providers: [...DEFAULT_EMBED_PROVIDERS, loom] })],
  // saved as <figure data-embed-url>: no iframe in the stored HTML, it is rebuilt (and re-checked) on load
  content: '<h1>Field trip</h1><p>Where we went:</p><figure data-embed-url="https://www.openstreetmap.org/#map=14/-6.1754/106.8272"></figure><p>The talk, recorded:</p><figure data-embed-url="https://www.youtube.com/watch?v=jNQXAC9IVRw"></figure><p></p>',
});

// You can also paste a YouTube or Vimeo link on an empty line. Anything from another host is refused.
document.getElementById('insert').onclick = () => editor.execute('insertEmbed'); // asks for the address
document.getElementById('show').onclick = () => {
  const out = document.getElementById('out');
  out.hidden = false;
  out.textContent = editor.getHTML();
};
`,
  },

  'floating-menu': {
    css: 'body { margin: 0; }',
    code: String.raw`
import { Autosave, Comments, TrackChanges, Versions, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

const para = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>';
const content =
  '<h1>Yearly expenses</h1><div data-toc></div>' + para.repeat(3) +
  '<h2>Background</h2>' + para.repeat(6) +
  '<h2>Plan</h2><ul data-task-list><li data-task data-checked="true"><p>Research</p></li><li data-task data-checked="false"><p>Build</p></li></ul>' + para.repeat(8) +
  '<h2>Conclusion</h2>' + para.repeat(4);

// your own element for the right side of the header
const end = document.createElement('div');
end.innerHTML = '<button type="button">Share</button>';

const author = 'Guest';
const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  pages: { header: 'Yearly expenses', footer: 'Page {page} of {pages}', height: '82vh' },
  outline: true,
  ribbon: true,
  floating: {
    title: 'Yearly expenses',                                  // the document name
    onTitle: (name) => { document.title = name; },            // makes the name editable
    end,                                                       // menus: [...] changes the menu bar, false hides it
  },
  plugins: [
    ...defaultPlugins,
    Comments({ author }),
    TrackChanges({ author }),
    Versions({ author }),
    Autosave({ save: () => new Promise((resolve) => setTimeout(resolve, 400)) }), // the card shows Saving... / Saved
  ],
});
editor.execute('toggleOutline'); // the outline starts hidden; View > Outline opens it
`,
  },

  headless: {
    html: '<div class="wrap">\n  <div>\n    <p id="bar"></p>\n    <div id="editor"></div>\n  </div>\n  <div><h2>Live state</h2><pre id="stats"></pre></div>\n</div>',
    css: `.wrap { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; max-width: 1000px; margin: 24px auto; font: 14px system-ui, sans-serif; }
@media (max-width: 800px) { .wrap { grid-template-columns: 1fr; } }
#bar button { margin: 0 4px 4px 0; }
#bar button.on { background: #2563eb; color: #fff; }
#stats { background: #f6f6f6; padding: 10px; overflow: auto; white-space: pre-wrap; }`,
    code: String.raw`
import { createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// No built-in toolbar: the UI below is plain HTML calling editor.execute(name).
const editor = createEditor({
  element: document.getElementById('editor'),
  toolbar: false,
  plugins: defaultPlugins,
  content: '<h2>Build your own UI</h2><p>Select some text and use the buttons above.</p>',
  onChange: refresh,
});

const bar = document.getElementById('bar');
const markButtons = {};
function add(label, run) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = run;
  bar.append(b);
  return b;
}
for (const mark of ['bold', 'italic', 'underline']) markButtons[mark] = add(mark, () => editor.execute(mark));
add('Heading 2', () => editor.execute('heading', '2'));
add('Paragraph', () => editor.execute('heading', 'paragraph'));
add('Bulleted list', () => editor.execute('bulletList'));
add('Undo', () => editor.execute('undo'));
add('Redo', () => editor.execute('redo'));

// read the editor state to draw your own UI
function refresh() {
  const { state } = editor.view;
  const { $from, from, to, empty } = state.selection;
  const active = state.storedMarks || (empty ? $from.marks() : (state.doc.nodeAt(from) && state.doc.nodeAt(from).marks) || []);
  for (const [mark, button] of Object.entries(markButtons)) button.classList.toggle('on', active.some((m) => m.type.name === mark));
  document.getElementById('stats').textContent = JSON.stringify({ selection: { from, to, empty }, block: $from.parent.type.name, ...editor.getStats(), html: editor.getHTML().slice(0, 140) }, null, 2);
}
// onChange reports content changes; selection changes come from the view
editor.view.dom.addEventListener('keyup', refresh);
editor.view.dom.addEventListener('mouseup', refresh);
refresh();
`,
  },

  images: {
    html: '<p class="bar"><button id="gen">Add a generated image</button> <button id="up">Upload from device...</button></p>\n<div id="editor"></div>\n<div id="uploads"></div>',
    css: '#editor, .bar, #uploads { max-width: 860px; margin: 16px auto; }\n#uploads { font: 13px system-ui, sans-serif; }',
    code: String.raw`
import { createEditor } from 'wysiwygido';
import 'wysiwygido/style.css';

// a small generated picture so the example needs no files
function picture(label, hue) {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = 270;
  const g = c.getContext('2d');
  g.fillStyle = 'hsl(' + hue + ' 75% 55%)';
  g.fillRect(0, 0, 480, 270);
  g.fillStyle = '#fff';
  g.font = 'bold 32px system-ui, sans-serif';
  g.fillText(label, 16, 48);
  return c.toDataURL('image/png');
}

// Called for every dropped, pasted or picked image. It must resolve to an https: address, a data: URL or a /path.
// Here the upload is simulated (it reads the file and shows progress); in your app, send the file to your server:
//   const body = new FormData(); body.append('file', file);
//   const { url } = await (await fetch('/api/upload', { method: 'POST', body })).json();  // '/api/upload' is a placeholder
//   return url;
function upload(file) {
  const row = document.createElement('div');
  const bar = document.createElement('progress');
  bar.max = 100;
  bar.value = 0;
  row.append(file.name + ' ', bar);
  document.getElementById('uploads').append(row);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const timer = setInterval(() => {
        bar.value += 20;
        if (bar.value >= 100) {
          clearInterval(timer);
          row.append(' done');
          resolve(reader.result);
        }
      }, 120);
    };
    reader.readAsDataURL(file);
  });
}

const editor = createEditor({
  element: document.getElementById('editor'),
  ribbon: true, // click an image to get the Picture tab: crop, width, caption, alt text
  uploadImage: upload,
  content: '<h2>Photo essay</h2><p>Drag an image file here, paste one, or use Insert > Picture. Click the picture below to crop it. <img src="' + picture('Sample 1', 200) + '" alt="A blue and green gradient" width="320" data-caption="A generated sample image"> Resize with the corner handle.</p><p></p>',
});

document.getElementById('gen').onclick = () => editor.execute('image', picture('Image ' + Math.floor(Math.random() * 90 + 10), Math.floor(Math.random() * 360)));
document.getElementById('up').onclick = () => editor.execute('uploadImage'); // opens the file picker
// editor.execute('imageCrop', { left: 0.1, right: 0.2 }); // crops the selected image
`,
  },

  'legal-review': {
    html: '<p class="bar"><button id="accept">Accept all</button> <button id="reject">Reject all</button> <button id="next">Next change</button></p>\n<div id="editor"></div>',
    css: '.bar { max-width: 900px; margin: 16px auto; }\n#editor { max-width: 1000px; margin: 0 auto; }',
    code: String.raw`
import { Comments, RestrictedEditing, TrackChanges, Versions, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// <section data-locked> is fixed text: it can be commented on but not changed
const content =
  '<section data-locked data-variant="legal" data-label="Standard clause"><h2>1. Definitions</h2><p>"Confidential Information" means all non-public information disclosed by one party to the other.</p></section>' +
  '<h2>2. Term</h2><p>This agreement lasts for twelve months from the effective date.</p>' +
  '<h2>3. Liability</h2><p>Each party is liable for direct damages up to the fees paid in the previous year.</p>' +
  '<section data-locked data-variant="legal" data-label="Standard clause"><h2>4. Governing law</h2><p>This agreement is governed by the laws of the Republic of Indonesia.</p></section>';

const author = 'Reviewer';
const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  plugins: [...defaultPlugins, Comments({ author }), TrackChanges({ author }), Versions({ author }), RestrictedEditing({ authorControls: false })],
  ribbon: true,
  pages: { header: 'Agreement (draft)', footer: 'Page {page} of {pages}', height: '70vh' },
});

editor.execute('setTracking', true); // suggesting mode: edits become tracked changes

document.getElementById('accept').onclick = () => editor.execute('acceptAll');
document.getElementById('reject').onclick = () => editor.execute('rejectAll');
document.getElementById('next').onclick = () => editor.execute('nextChange');
`,
  },

  'markdown-live': {
    html: '<div class="cols">\n  <div><h2>Markdown</h2><div id="code"></div></div>\n  <div><h2>Preview</h2><div id="preview"></div></div>\n</div>\n<div id="renderer" hidden></div>',
    css: `.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 1100px; margin: 24px auto; font-family: system-ui, sans-serif; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
#preview { min-height: 480px; overflow: auto; border: 1px solid #ddd; border-radius: 8px; padding: 0 16px; }`,
    code: String.raw`
import { createCodeEditor, createEditor } from 'wysiwygido';
import 'wysiwygido/style.css';

const SAMPLE = [
  '# Release notes',
  '',
  'Welcome to **version 2**. The editor now has:',
  '',
  '- line numbers in the code view',
  '- a live preview, kept in sync',
  '- ' + String.fromCharCode(96) + 'inline code' + String.fromCharCode(96) + ' and [links](https://example.com)',
  '',
  '> Quotes work too.',
  '',
  '## Steps',
  '',
  '1. Write on the left',
  '2. Read on the right',
  '3. Ship it',
  '',
].join('\n');

// The renderer is a hidden editor: Markdown goes in, schema-sanitised HTML comes out.
const renderer = createEditor({ element: document.getElementById('renderer'), content: '' });
const preview = document.getElementById('preview');
function render(markdown) {
  renderer.setMarkdown(markdown);
  preview.innerHTML = renderer.getHTML();
}

createCodeEditor({
  element: document.getElementById('code'),
  value: SAMPLE,
  language: 'markdown',
  height: '480px',
  onChange: render,
});
render(SAMPLE);
`,
  },

  markdown: {
    html: '<div class="cols">\n  <div><h2>WYSIWYG</h2><div id="editor"></div></div>\n  <div><h2>Markdown</h2><textarea id="md" rows="22" spellcheck="false" aria-label="Markdown"></textarea></div>\n</div>',
    css: `.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 1100px; margin: 24px auto; font-family: system-ui, sans-serif; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }
#md { width: 100%; box-sizing: border-box; font: 13px/1.5 ui-monospace, monospace; padding: 10px; }`,
    code: String.raw`
import { createEditor } from 'wysiwygido';
import 'wysiwygido/style.css';

const md = document.getElementById('md');

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Notes</h1><p>Type <strong>bold</strong>, <em>italic</em> or a <a href="https://commonmark.org">link</a>.</p><ul><li><p>Lists work</p></li><li><p>both ways</p></li></ul><blockquote><p>Quotes too.</p></blockquote>',
  // WYSIWYG -> Markdown (not while you are typing in the textarea)
  onChange: () => document.activeElement !== md && (md.value = editor.getMarkdown()),
});
md.value = editor.getMarkdown();

// Markdown -> WYSIWYG (raw HTML in Markdown is ignored)
let timer;
md.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => editor.setMarkdown(md.value), 250);
});
`,
  },
};
