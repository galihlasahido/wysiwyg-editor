import type { FullExample } from '../full-code';

/** A tiny JavaScript runner for the coding examples: a hidden sandboxed iframe that evaluates code posted to it. */
const KERNEL = `// Runs JavaScript in a hidden sandboxed iframe (scripts allowed, no access to your page). var and function declarations persist between runs.
function kernelMain() {
  const fmt = (v) => {
    if (typeof v === 'string') return v;
    try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
  };
  addEventListener('message', async (e) => {
    const { id, code } = e.data;
    const lines = [];
    for (const k of ['log', 'warn', 'error']) console[k] = (...a) => lines.push((k === 'log' ? '' : k + ': ') + a.map(fmt).join(' '));
    try {
      const value = await (0, eval)(code);
      if (value !== undefined) lines.push('-> ' + fmt(value));
      parent.postMessage({ id, lines }, '*');
    } catch (err) {
      parent.postMessage({ id, lines, error: String(err) }, '*');
    }
  });
}

function createKernel() {
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.srcdoc = '<script>(' + kernelMain + ')()<\\\\/script>';
  document.body.append(frame);
  const ready = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
  let seq = 0;
  return async (code) => {
    await ready;
    const id = ++seq;
    return new Promise((resolve) => {
      const onMessage = (e) => {
        if (e.source !== frame.contentWindow || e.data.id !== id) return;
        removeEventListener('message', onMessage);
        resolve(e.data);
      };
      addEventListener('message', onMessage);
      frame.contentWindow.postMessage({ id, code }, '*');
    });
  };
}

const showResult = (r) => [...r.lines, r.error ? 'error: ' + r.error : ''].filter(Boolean).join('\\n') || '(no output)';
`;

export const group_c: Record<string, FullExample> = {
  'code-editor': {
    html: `<div class="bar">
  <button id="tab-main">main.js</button>
  <button id="tab-utils">utils.ts</button>
  <button id="run">Run (Ctrl+Enter)</button>
  <span id="status"></span>
</div>
<div id="editor"></div>
<pre id="out">Press Run to execute main.js.</pre>`,
    css: `.bar { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
#editor { height: 50vh; border: 1px solid #334155; border-radius: 8px; overflow: hidden; }
#out { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 70px; white-space: pre-wrap; }`,
    code: `
import { createCodeEditor, languageForFilename } from 'wysiwygido';
import 'wysiwygido/style.css';

${KERNEL}
const files = [
  { id: 'main.js', value: 'function isPrime(n) {\\n  if (n < 2) return false;\\n  for (let i = 2; i * i <= n; i++) if (n % i === 0) return false;\\n  return true;\\n}\\n\\nconst primes = [];\\nfor (let n = 1; primes.length < 12; n++) if (isPrime(n)) primes.push(n);\\n\\nconsole.log("first primes:", primes);\\nconsole.log({ sum: primes.reduce((a, b) => a + b, 0) });\\n' },
  { id: 'utils.ts', value: 'export interface Point { x: number; y: number }\\n\\nexport function distance(a: Point, b: Point): number {\\n  return Math.hypot(a.x - b.x, a.y - b.y);\\n}\\n' },
];

const status = document.getElementById('status');
const out = document.getElementById('out');
const run = createKernel();

const ide = createCodeEditor({
  element: document.getElementById('editor'),
  theme: 'dark',
  tabSize: 2,
  wordWrap: true,
  minimap: false,
  onChange: (value) => console.log('changed,', value.length, 'characters'),   // save the text wherever you like
  onCursor: ({ line, col }) => (status.textContent = 'Ln ' + line + ', Col ' + col),
});

function open(id) {
  const file = files.find((f) => f.id === id);
  ide.openFile({ id: file.id, value: file.value, language: languageForFilename(file.id) });   // each file keeps its own undo history
}
open('main.js');

document.getElementById('tab-main').onclick = () => open('main.js');
document.getElementById('tab-utils').onclick = () => open('utils.ts');
document.getElementById('run').onclick = async () => {
  out.textContent = 'Running...';
  out.textContent = showResult(await run(ide.getValue()));
};
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') document.getElementById('run').click();
});

ide.goToLine(7);
`,
  },

  'coding-docs': {
    html: `<div id="editor"></div>
<h3>Console</h3>
<pre id="out">Press Run on a JavaScript block.</pre>`,
    css: `#out { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 70px; white-space: pre-wrap; }`,
    code: `
import { CodeBlocks, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

${KERNEL}
const out = document.getElementById('out');
const run = createKernel();

createEditor({
  element: document.getElementById('editor'),
  theme: 'dark',
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic', 'code', 'link', '|', 'bulletList', 'orderedList', 'codeBlock', 'insertTable'],
  plugins: [
    ...defaultPlugins,
    CodeBlocks({
      // optional: highlight: (code, language) => [{ from: 0, to: 5, type: 'keyword' }],  (your own highlighter)
      actions: [
        {
          label: 'Run',
          title: 'Run in a sandboxed iframe',
          languages: ['javascript'],
          run: async (code) => {
            out.textContent = 'Running...';
            out.textContent = showResult(await run(code));
          },
        },
      ],
    }),
  ],
  content: '<h1>Retry helper</h1>' +
    '<p>A tiny wrapper around <code>fetch</code> that retries on network errors with exponential backoff.</p>' +
    '<h2>Install</h2>' +
    '<pre data-language="bash"><code>npm install @acme/retry-fetch\\nexport RETRY_MAX=3</code></pre>' +
    '<h2>Usage</h2>' +
    '<pre data-language="typescript"><code>import { retryFetch } from "@acme/retry-fetch";\\n\\nasync function load(id: number) {\\n  const res = await retryFetch("/api/users/" + id, { retries: 3 });\\n  return res.json();\\n}</code></pre>' +
    '<h2>Try the backoff</h2>' +
    '<p>This block is plain JavaScript, so Run works. Change the numbers and run it again.</p>' +
    '<pre data-language="javascript"><code>const delays = [];\\nfor (let attempt = 0; attempt &lt; 5; attempt++) delays.push(100 * 2 ** attempt);\\nconsole.log("delays (ms):", delays);\\nconsole.log({ total: delays.reduce((a, b) =&gt; a + b, 0) });</code></pre>' +
    '<h2>Response</h2>' +
    '<pre data-language="json"><code>{\\n  "id": 42,\\n  "name": "Ada",\\n  "active": true\\n}</code></pre>',
});
`,
  },

  'coding-notebook': {
    html: `<div class="bar"><button id="run-all">Run all cells</button> <button id="reset">Reset kernel</button></div>
<div id="editor"></div>
<h3>Outputs</h3>
<pre id="out">Press Run on a cell.</pre>`,
    css: `.bar { margin-bottom: 8px; display: flex; gap: 8px; }
#out { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 70px; white-space: pre-wrap; }`,
    code: `
import { CodeBlocks, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

${KERNEL}
const out = document.getElementById('out');
let run = createKernel();

// the text of every code cell, in document order
const cells = () => {
  const list = [];
  editor.view.state.doc.descendants((node) => void (node.type.name === 'code_block' && list.push(node.textContent)));
  return list;
};

async function runCell(code) {
  out.textContent = 'Running...';
  out.textContent = showResult(await run(code));
}

const editor = createEditor({
  element: document.getElementById('editor'),
  theme: 'dark',
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic', 'code', '|', 'bulletList', 'codeBlock'],
  plugins: [...defaultPlugins, CodeBlocks({ actions: [{ label: 'Run', languages: ['javascript'], run: runCell }] })],
  content: '<h1>Sorting, step by step</h1>' +
    '<p>Define some data. Variables declared with <code>var</code> stay available to the next cells.</p>' +
    '<pre data-language="javascript"><code>var people = [\\n  { name: "Ana", age: 31 },\\n  { name: "Budi", age: 24 },\\n  { name: "Citra", age: 28 },\\n];\\nconsole.log(people.length + " people");</code></pre>' +
    '<p>Now sort by age. The last expression is shown as the result.</p>' +
    '<pre data-language="javascript"><code>var byAge = [...people].sort((a, b) =&gt; a.age - b.age);\\nconsole.log(byAge.map((p) =&gt; p.name + " (" + p.age + ")").join(", "));\\nbyAge[0].name</code></pre>' +
    '<p>A function, and an error on purpose:</p>' +
    '<pre data-language="javascript"><code>function mean(xs) {\\n  return xs.reduce((s, x) =&gt; s + x, 0) / xs.length;\\n}\\nconsole.log(mean(people.map((p) =&gt; p.age)));\\nmean(undefined);</code></pre>',
});

document.getElementById('run-all').onclick = async () => {
  let text = '';
  for (const code of cells()) text += showResult(await run(code)) + '\\n---\\n';
  out.textContent = text;
};
document.getElementById('reset').onclick = () => {
  run = createKernel();                       // a fresh kernel forgets every variable
  out.textContent = 'Kernel reset.';
};
`,
  },

  'coding-playground': {
    html: `<div class="cols">
  <div id="editor"></div>
  <div>
    <h3>Preview</h3>
    <iframe id="preview" title="Live preview" sandbox="allow-scripts"></iframe>
    <pre id="console">Console output appears here.</pre>
  </div>
</div>`,
    css: `.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
#preview { width: 100%; height: 360px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; }
#console { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 70px; white-space: pre-wrap; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }`,
    code: `
import { CodeBlocks, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

const preview = document.getElementById('preview');
const consoleOut = document.getElementById('console');

const START = '<h2>HTML</h2>' +
  '<pre data-language="html"><code>&lt;button id="go"&gt;Click me&lt;/button&gt;\\n&lt;p id="out"&gt;Clicks: 0&lt;/p&gt;</code></pre>' +
  '<h2>CSS</h2>' +
  '<pre data-language="css"><code>body { font-family: system-ui; padding: 24px; }\\nbutton { padding: 10px 18px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; font-size: 16px; }\\n#out { color: #16a34a; font-weight: 600; }</code></pre>' +
  '<h2>JavaScript</h2>' +
  '<pre data-language="javascript"><code>let n = 0;\\ndocument.getElementById("go").addEventListener("click", () =&gt; {\\n  n++;\\n  document.getElementById("out").textContent = "Clicks: " + n;\\n  console.log("clicked", n);\\n});</code></pre>';

const editor = createEditor({
  element: document.getElementById('editor'),
  theme: 'dark',
  toolbar: false,
  plugins: [...defaultPlugins, CodeBlocks()],
  content: START,
  onChange: schedule,
});

// the text of every code block, grouped by its language
function blocks() {
  const by = { html: '', css: '', javascript: '' };
  editor.view.state.doc.descendants((node) => {
    const lang = node.attrs.language;
    if (node.type.name === 'code_block' && lang && lang in by) by[lang] += node.textContent + '\\n';
  });
  return by;
}

let timer;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(render, 250);
}

function render() {
  const { html, css, javascript } = blocks();
  consoleOut.textContent = '';
  // a closing tag inside the code could only end the author's own script (the iframe is sandboxed)
  const js = javascript.replace(/<\\/(script)/gi, '<\\\\/$1');
  const style = css.replace(/<\\/(style)/gi, '<\\\\/$1');
  const forward = "for (const k of ['log','warn','error']) { const o = console[k]; console[k] = (...a) => { parent.postMessage({ playground: true, k, text: a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }, '*'); o.apply(console, a); }; }" +
    "addEventListener('error', (e) => parent.postMessage({ playground: true, k: 'error', text: e.message }, '*'));";
  preview.srcdoc = '<!doctype html><meta charset="utf-8"><style>' + style + '</style>' + html +
    '<script>' + forward + '<\\/script><script>' + js + '<\\/script>';
}

window.addEventListener('message', (e) => {
  if (e.source !== preview.contentWindow || !e.data || !e.data.playground) return;
  consoleOut.textContent += (e.data.k === 'log' ? '' : e.data.k + ': ') + e.data.text + '\\n';
});

render();
`,
  },

  'coding-readme': {
    html: `<div class="bar"><button id="download">Download README.md</button> <button id="copy">Copy Markdown</button></div>
<div class="cols">
  <div id="editor"></div>
  <textarea id="md" rows="30" spellcheck="false" aria-label="README.md"></textarea>
</div>`,
    css: `.bar { margin-bottom: 8px; display: flex; gap: 8px; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
#md { font: 13px/1.5 ui-monospace, Menlo, monospace; padding: 12px; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }`,
    code: `
import { CodeBlocks, createEditor, defaultPlugins, download } from 'wysiwygido';
import 'wysiwygido/style.css';

const md = document.getElementById('md');

const editor = createEditor({
  element: document.getElementById('editor'),
  theme: 'auto',
  plugins: [...defaultPlugins, CodeBlocks()],
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic', 'code', 'link', '|', 'bulletList', 'orderedList', 'codeBlock', 'blockQuote'],
  onChange: () => document.activeElement !== md && (md.value = editor.getMarkdown()),
  content: '<h1>tiny-cache</h1><p>An in-memory cache with TTL and a 40-line implementation.</p>' +
    '<h2>Install</h2><pre data-language="bash"><code>npm install tiny-cache</code></pre>' +
    '<h2>Usage</h2><pre data-language="typescript"><code>import { Cache } from "tiny-cache";\\n\\nconst cache = new Cache({ ttl: 60_000 });\\ncache.set("a", "hello");\\nconsole.log(cache.get("a")); // "hello"</code></pre>' +
    '<h2>API</h2><ul><li><p><code>set(key, value, ttl?)</code>: store a value</p></li><li><p><code>get(key)</code>: read it, or <code>undefined</code> when expired</p></li><li><p><code>clear()</code>: remove everything</p></li></ul>' +
    '<blockquote><p>Zero dependencies. MIT licensed.</p></blockquote>',
});
md.value = editor.getMarkdown();                     // fenced blocks keep their language

// edit the Markdown and the visual editor follows
let timer;
md.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => editor.setMarkdown(md.value), 250);
});

document.getElementById('download').onclick = () => download(editor.getMarkdown(), 'README.md', 'text/markdown');
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(editor.getMarkdown());
`,
  },

  'collab-async': {
    code: `
import { Comments, TrackChanges, Versions, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

const HOUR = 3600e3;
const now = Date.now();
const ago = (hours) => now - hours * HOUR;

// comment threads you saved earlier (load them from your server)
const comments = Comments({
  author: 'You',
  initial: [
    { id: 'c1', author: 'Ana Lestari', text: 'Can we cite a source for this claim?', createdAt: ago(5), resolved: false, replies: [{ author: 'Budi Santoso', text: "I'll add the 2024 survey.", createdAt: ago(3) }] },
    { id: 'c2', author: 'Citra Dewi', text: 'Nice phrasing here.', createdAt: ago(2), resolved: true, replies: [] },
  ],
});

// named versions you can restore from the Versions panel
const versions = Versions({ author: 'You' });
const draft = '<h1>Launch announcement</h1><p>We are happy to announce our new editor.</p>';
versions.store.add({ id: 'v1', label: 'First draft', createdAt: ago(26), author: 'Ana Lestari', html: draft });
versions.store.add({ id: 'v2', label: 'After legal review', createdAt: ago(4), author: 'Budi Santoso', html: draft.replace('happy to announce', 'pleased to announce') });

// comments are spans with data-comment-id; suggestions are <ins> and <del> with an author and a date
const content = '<h1>Launch announcement</h1>' +
  '<p>We are pleased to announce our new editor, which is <span data-comment-id="c1">the fastest on the market</span> and works in every browser.</p>' +
  '<p>It supports tables, images and <ins data-author="Ana Lestari" data-date="' + ago(6) + '">real-time collaboration, </ins>comments' +
  '<del data-author="Budi Santoso" data-date="' + ago(5) + '"> and a lot of other stuff</del>' +
  '<ins data-author="Budi Santoso" data-date="' + ago(5) + '"> and a full revision history</ins>.</p>' +
  '<p><span data-comment-id="c2">Getting started takes one line of code.</span> Select text and add a comment, or switch to Suggesting mode and edit.</p>';

const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  plugins: [...defaultPlugins, comments, TrackChanges({ author: 'You' }), versions],
  ribbon: { initialTab: 'review' },            // open on the Review tab
});

// every button is also a command: acceptAll, rejectAll, nextChange, saveVersion, restoreVersion ...
editor.execute('acceptAll');
console.log(editor.getHTML());
`,
  },

  'collab-realtime': {
    noCdn: 'Real-time collaboration needs yjs to be one shared instance between your code and wysiwygido/collab, and a real deployment connects through a WebSocket server, so build it with npm (the CDN would load a second copy of yjs).',
    install: ['yjs', 'y-protocols', 'y-prosemirror'],
    html: `<button id="toggle">Disconnect Bob</button> <span id="status">Both editors are connected.</span>
<div class="cols">
  <div><h3>Ana (red cursor)</h3><div id="ana"></div></div>
  <div><h3>Bob (blue cursor)</h3><div id="bob"></div></div>
</div>`,
    css: `.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 12px; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }`,
    code: `
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Comments, createEditor, defaultPlugins } from 'wysiwygido';
import { Collaboration, linkAwareness, linkDocs } from 'wysiwygido/collab';
import 'wysiwygido/style.css';

// Two editors in one page, joined in memory. In a real app each user has their own page and the Yjs doc
// is shared through a server instead: see the commented lines at the bottom.
const ya = new Y.Doc();
const yb = new Y.Doc();
const aa = new Awareness(ya);
const ab = new Awareness(yb);
let unlink = linkDocs(ya, yb);                  // syncs the two documents both ways
linkAwareness(aa, ab);                          // shares cursors and names

const bar = ['undo', 'redo', '|', 'bold', 'italic', 'underline', '|', 'heading', 'bulletList', 'orderedList', '|', 'comment'];
const make = (id, ydoc, awareness, name, color, seed) =>
  createEditor({
    element: document.getElementById(id),
    toolbar: bar,
    plugins: [...defaultPlugins, Collaboration({ ydoc, awareness, user: { name, color }, seed }), Comments({ author: name })],
  });

// only the first editor seeds the starting text
make('ana', ya, aa, 'Ana', '#e03131', '<h1>Shared notes</h1><p>Type here and watch the other editor update. Undo only reverts your own changes.</p>');
make('bob', yb, ab, 'Bob', '#1971c2');

// go offline, edit both sides, reconnect: both edits are kept
const toggle = document.getElementById('toggle');
const status = document.getElementById('status');
let connected = true;
toggle.onclick = () => {
  connected = !connected;
  if (connected) unlink = linkDocs(ya, yb);
  else unlink();
  toggle.textContent = connected ? 'Disconnect Bob' : 'Reconnect Bob';
  status.textContent = connected ? 'Both editors are connected.' : 'Bob is offline: edits are kept locally and merged on reconnect.';
};

// With a server (placeholder URL, use your own): replace linkDocs/linkAwareness with
//   import { createWebSocketProvider } from 'wysiwygido/collab';
//   const provider = createWebSocketProvider('wss://your-host/collab/room-1?token=YOUR_TOKEN', ydoc);
//   await provider.synced;     // create the editor after the first sync
//   Collaboration({ ydoc, awareness: provider.awareness, user: { name, color } })
`,
  },

  'data-table-crud': {
    html: `<div class="bar">
  <button data-user="guest">Guest</button>
  <button data-user="viewer">Viewer</button>
  <button data-user="eka">Eka (editor)</button>
  <button data-user="mira">Mira (manager)</button>
  <button data-user="adi">Adi (admin)</button>
</div>
<p id="who"></p>
<div id="table"></div>
<pre id="log">The fake server log appears here.</pre>`,
    css: `.bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
#log { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 60px; }`,
    code: `
import { createDataTable, hasDataTableAccess } from 'wysiwygido/data-table';
import 'wysiwygido/style.css';

const users = {
  guest: { user: null, note: 'Not signed in: can look, nothing else.' },
  viewer: { user: { id: 'vera', roles: ['viewer'] }, note: 'Can look; no buttons.' },
  eka: { user: { id: 'eka', roles: ['editor'] }, note: 'Can add tickets and change only her own.' },
  mira: { user: { id: 'mira', roles: ['manager'] }, note: 'Can add and change every ticket; cannot delete.' },
  adi: { user: { id: 'adi', roles: ['admin'] }, note: 'Can do everything; deleting asks first.' },
};

const staff = ['eka', 'mira', 'adi', 'vera'];
const titles = ['Login fails on Safari', 'Export is slow', 'Typo on invoice', 'Dark mode contrast', 'Cannot reset password', 'Report totals differ', 'Email not delivered', 'Wrong time zone'];
const pick = (list, i) => list[i % list.length];
const rows = Array.from({ length: 24 }, (_, i) => [
  1001 + i,
  pick(titles, i * 3),
  pick(['Open', 'In progress', 'Done'], i),
  pick(['Low', 'Normal', 'High', 'Critical'], i * 5),
  pick(staff, i * 7),
  '2025-' + String((i % 12) + 1).padStart(2, '0') + '-' + String((i % 27) + 1).padStart(2, '0'),
  i % 5 === 0,
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = document.getElementById('log');
const say = (text) => (log.textContent = new Date().toLocaleTimeString() + '  ' + text + '\\n' + log.textContent);
let nextId = 2000;

const app = createDataTable({
  element: document.getElementById('table'),
  theme: 'light',
  table: {
    columns: [
      { key: 'id', title: '#', type: 'number', decimals: 0, width: 70 },
      { key: 'title', title: 'Title', type: 'text' },
      { key: 'status', title: 'Status', type: 'select', options: ['Open', 'In progress', 'Done'] },
      { key: 'priority', title: 'Priority', type: 'select', options: ['Low', 'Normal', 'High', 'Critical'] },
      { key: 'assignee', title: 'Assignee', type: 'select', options: staff },
      { key: 'opened', title: 'Opened', type: 'date' },
      { key: 'blocked', title: 'Blocked', type: 'boolean' },
    ],
    rows,
    rules: [{ column: 'priority', test: '=Critical', look: 'red' }, { column: 'status', test: '=Done', look: 'green' }],
    options: { title: 'Support tickets', pageSize: 8, search: true, filters: true, selectable: true },
  },
  crud: {
    user: users.guest.user,                    // the signed-in person (or a function that returns one)
    access: {
      create: ['editor', 'manager', 'admin'],  // a role or a permission; 'tickets.*' also works
      update: (user, row) => hasDataTableAccess(['manager', 'admin'], user) || (hasDataTableAccess('editor', user) && (!row || row.assignee === user.id)),
      delete: { roles: ['admin'] },
    },
    // your server calls go here (this demo only waits and logs); throw to refuse: the message shows in the dialog
    onCreate: async (row) => {
      await sleep(400);
      if (!String(row.title ?? '').trim()) throw new Error('A ticket needs a title.');
      say('POST /tickets  ' + row.title);
      return { id: nextId++ };                 // the server decides the number
    },
    onUpdate: async (row, before) => {
      await sleep(300);
      say('PUT /tickets/' + before.id);
    },
    onDelete: async (deleted) => {
      await sleep(300);
      if (deleted.some((r) => r.priority === 'Critical')) throw new Error('Critical tickets cannot be deleted; close them instead.');
      say('DELETE /tickets  ' + deleted.map((r) => r.id).join(', '));
    },
  },
});

// switching the person after sign-in or sign-out shows and hides the buttons
for (const button of document.querySelectorAll('[data-user]')) {
  button.onclick = () => {
    const u = users[button.dataset.user];
    app.setUser(u.user);
    document.getElementById('who').textContent = button.textContent + ': ' + u.note;
  };
}
document.getElementById('who').textContent = 'Guest: ' + users.guest.note;

// This hides what a person may not do. It is not security: check the same rules on your server.
`,
  },

  'data-table-finance': {
    html: `<div class="bar">
  <button id="group">Group by department</button>
  <button id="ungroup">No grouping</button>
  <button id="xlsx">Download .xlsx</button>
</div>
<div id="table"></div>
<p id="log">Change an Actual amount: the difference, the bar and the state follow.</p>`,
    css: `.bar { display: flex; gap: 8px; margin-bottom: 8px; }`,
    code: `
import { createDataTable } from 'wysiwygido/data-table';
import 'wysiwygido/style.css';

const lines = [
  ['Marketing', 'Advertising', 42000, 47850], ['Marketing', 'Events', 18000, 15200], ['Marketing', 'Content', 12000, 12400],
  ['Engineering', 'Salaries', 310000, 310000], ['Engineering', 'Cloud hosting', 54000, 61300], ['Engineering', 'Tools', 9000, 7100],
  ['Sales', 'Commissions', 76000, 81200], ['Sales', 'Travel', 22000, 26700], ['Sales', 'Training', 8000, 3900],
  ['Operations', 'Rent', 96000, 96000], ['Operations', 'Utilities', 14000, 13100], ['Operations', 'Insurance', 11000, 11000],
];

const app = createDataTable({
  element: document.getElementById('table'),
  theme: 'light',
  table: {
    columns: [
      { key: 'dept', title: 'Department', type: 'text' },
      { key: 'item', title: 'Item', type: 'text' },
      { key: 'budget', title: 'Budget', type: 'currency', currency: 'USD', decimals: 0, total: 'sum' },
      { key: 'actual', title: 'Actual', type: 'currency', currency: 'USD', decimals: 0, total: 'sum' },
      // calculated columns: leave the cell empty (null) and give a formula that names other columns
      { key: 'diff', title: 'Over / under', type: 'currency', currency: 'USD', decimals: 0, formula: '[Actual] - [Budget]', total: 'sum' },
      { key: 'pct', title: 'Used', type: 'number', decimals: 0, formula: 'ROUND([Actual] / [Budget] * 100)', bar: true },
      { key: 'state', title: 'State', type: 'text', formula: 'IF([Actual] > [Budget] * 1.05, "Over budget", IF([Actual] < [Budget] * 0.9, "Under", "On track"))' },
    ],
    rows: lines.map(([dept, item, budget, actual]) => [dept, item, budget, actual, null, null, null]),
    rules: [
      { column: 'state', test: 'Over budget', look: 'red', row: false },
      { column: 'state', test: 'Under', look: 'blue' },
      { column: 'state', test: 'On track', look: 'green' },
      { column: 'diff', test: '>5000', look: 'bold' },
    ],
    views: [{ name: 'Over budget only', search: '', filters: { state: 'Over budget' }, sort: [{ key: 'diff', dir: 'desc' }], groupBy: [], hidden: [], pageSize: 0 }],
    options: { title: 'Budget against actual, 2025', pageSize: 0, search: true, filters: true, groupBy: ['dept'] },
  },
});

const regroup = (groupBy) => {
  const table = app.getTable();
  app.setTable({ ...table, options: { ...table.options, groupBy } });
};
document.getElementById('group').onclick = () => regroup(['dept']);
document.getElementById('ungroup').onclick = () => regroup([]);
document.getElementById('xlsx').onclick = () => app.download('xlsx');
app.on('change', (table) => (document.getElementById('log').textContent = 'Edited. ' + table.rows.length + ' lines.'));
`,
  },

  'data-table-import': {
    html: `<p>Edit the text below, or open your own CSV or Excel file. Nothing leaves the page.</p>
<textarea id="paste" rows="6" aria-label="CSV text"></textarea>
<div class="bar">
  <button id="use">Use the pasted text</button>
  <button id="csv">Download .csv</button>
  <button id="xlsx">Download .xlsx</button>
  <input id="file" type="file" accept=".csv,.tsv,.xlsx" aria-label="Open a file" />
</div>
<div id="table"></div>
<p id="log"></p>`,
    css: `#paste { width: 100%; font: 13px ui-monospace, monospace; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }`,
    code: `
import { createDataTable, dataTableFromRows, parseCSV, parseXlsx } from 'wysiwygido/data-table';
import 'wysiwygido/style.css';

const sample = 'Product,Region,Units,Price\\nMatcha,North,120,4.5\\nOolong,South,80,3.9\\nChai,East,95,3.2\\nMatcha,West,60,4.5\\nCold brew,North,140,5.1';
document.getElementById('paste').value = sample;

const log = document.getElementById('log');
const app = createDataTable({
  element: document.getElementById('table'),
  theme: 'light',
  table: dataTableFromRows(parseCSV(sample), { title: 'Imported sales' }),   // first row = headings; types are guessed
});

function load(rows, title) {
  app.setTable(dataTableFromRows(rows, { title }));
  log.textContent = title + ': ' + (rows.length - 1) + ' rows read. Numbers, dates and yes/no were detected.';
}

document.getElementById('use').onclick = () => load(parseCSV(document.getElementById('paste').value), 'Pasted CSV');
document.getElementById('csv').onclick = () => app.download('csv');
document.getElementById('xlsx').onclick = () => app.download('xlsx');

document.getElementById('file').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (/\\.xlsx$/i.test(file.name)) load((await parseXlsx(bytes)).rows, file.name);   // read by the library, no extra package
    else load(parseCSV(new TextDecoder().decode(bytes)), file.name);
  } catch (err) {
    log.textContent = 'Could not read ' + file.name + ': ' + err.message;
  }
};
`,
  },

  'data-table-inventory': {
    html: `<div id="table"></div>
<p id="log">Use Views for "Needs ordering" or "By category". Tick rows and press Order selected.</p>`,
    code: `
import { createDataTable } from 'wysiwygido/data-table';
import 'wysiwygido/style.css';

const items = ['Matcha powder', 'Oolong tea', 'Green tea', 'Chai blend', 'Cold brew', 'Espresso beans', 'Oat milk', 'Syrup', 'Cups 12oz', 'Lids', 'Stir sticks', 'Napkins', 'Tote bag', 'Mug', 'Tumbler'];
const category = (i) => (i < 5 ? 'Tea' : i < 7 ? 'Coffee' : i < 8 ? 'Dairy' : i < 12 ? 'Supplies' : 'Merchandise');
const log = document.getElementById('log');

createDataTable({
  element: document.getElementById('table'),
  theme: 'light',
  table: {
    columns: [
      { key: 'sku', title: 'SKU', type: 'text', width: 90 },
      { key: 'name', title: 'Product', type: 'text' },
      { key: 'cat', title: 'Category', type: 'select', options: ['Tea', 'Coffee', 'Dairy', 'Supplies', 'Merchandise'] },
      { key: 'stock', title: 'In stock', type: 'number', decimals: 0, bar: true, total: 'sum' },
      { key: 'min', title: 'Reorder at', type: 'number', decimals: 0 },
      { key: 'cost', title: 'Unit cost', type: 'currency', currency: 'USD', decimals: 2 },
      { key: 'value', title: 'Stock value', type: 'currency', currency: 'USD', decimals: 2, formula: '[In stock] * [Unit cost]', total: 'sum' },
      { key: 'low', title: 'Low?', type: 'boolean', formula: '[In stock] < [Reorder at]' },
      { key: 'seen', title: 'Counted', type: 'date' },
    ],
    rows: items.map((name, i) => ['SKU-' + (100 + i), name, category(i), (i * 37) % 120, 30 + (i % 4) * 10, 1.5 + (i % 6) * 2.25, null, null, '2025-0' + (1 + (i % 9)) + '-1' + (i % 9)]),
    rules: [{ column: 'stock', test: '<20', look: 'red' }, { column: 'low', test: 'true', look: 'amber', row: true }],
    // saved views appear in the Views menu
    views: [
      { name: 'Needs ordering', search: '', filters: { low: 'true' }, sort: [{ key: 'stock', dir: 'asc' }], groupBy: [], hidden: ['seen'], pageSize: 0 },
      { name: 'By category', search: '', filters: {}, sort: [], groupBy: ['cat'], hidden: ['sku', 'seen'], pageSize: 0 },
    ],
    options: { title: 'Stock', pageSize: 0, search: true, filters: true, selectable: true, groupBy: [], striped: true },
  },
  // a button above the table that works on the ticked rows
  buttons: [{
    id: 'order',
    label: 'Order selected',
    needsSelection: true,
    title: 'Make a purchase order for the ticked products',
    onClick: ({ selected }) => (log.textContent = 'Purchase order: ' + selected.map((r) => r.name + ' x ' + Math.max(0, Number(r.min) * 2 - Number(r.stock))).join(', ')),
  }],
  // a button on each row, only where it makes sense
  rowActions: [{
    label: 'Count',
    title: 'Record a stock count',
    when: (row) => Number(row.stock) < Number(row.min),
    onClick: (row) => (log.textContent = 'Count ' + row.name + '...'),
  }],
  crud: { access: { delete: ['manager'] }, user: { id: 'sam', roles: ['clerk'] } },   // a clerk can add and change rows, but not delete
});
`,
  },

  'data-table-people': {
    html: `<div class="bar"><button id="ro">Read-only (directory view)</button></div>
<div id="table"></div>
<p id="log"></p>`,
    css: `.bar { margin-bottom: 8px; }`,
    code: `
import { createDataTable } from 'wysiwygido/data-table';
import 'wysiwygido/style.css';

const first = ['Ana', 'Budi', 'Citra', 'Dimas', 'Eka', 'Fajar', 'Gita', 'Hendra', 'Indah', 'Joko', 'Kiki', 'Lina'];
const teams = ['Design', 'Engineering', 'Finance', 'People', 'Sales'];
const pick = (list, i) => list[i % list.length];
const log = document.getElementById('log');

const rows = first.flatMap((name, i) =>
  [0, 1, 2].map((k) => [
    name + ' ' + pick(['Santoso', 'Wijaya', 'Lestari', 'Pratama'], i + k * 2),
    pick(teams, i + k),
    pick(['Lead', 'Specialist', 'Manager', 'Associate'], i * 2 + k),
    pick(['Jakarta', 'Bandung', 'Surabaya', 'Remote'], i + k),
    '20' + (18 + ((i + k) % 8)) + '-0' + (1 + ((i + k) % 9)) + '-1' + ((i + k) % 9),
    8000000 + ((i * 13 + k * 7) % 20) * 1000000,
    (i + k) % 4 === 3,
    name.toLowerCase() + '.' + k + '@example.com',
  ]),
);

const app = createDataTable({
  element: document.getElementById('table'),
  theme: 'light',
  table: {
    columns: [
      { key: 'name', title: 'Name', type: 'text' },
      { key: 'team', title: 'Team', type: 'select', options: teams },
      { key: 'title', title: 'Role', type: 'text' },
      { key: 'city', title: 'Office', type: 'select', options: ['Jakarta', 'Bandung', 'Surabaya', 'Remote'] },
      { key: 'start', title: 'Started', type: 'date' },
      { key: 'salary', title: 'Salary', type: 'currency', currency: 'IDR', decimals: 0, hidden: true },   // only in the details and the Columns menu
      { key: 'remote', title: 'Remote', type: 'boolean' },
      { key: 'email', title: 'Email', type: 'text', hidden: true },
    ],
    rows,
    options: { title: 'Staff directory', pageSize: 10, search: true, filters: true, detail: true, striped: true },   // detail: a row opens its details
  },
  // your own details panel (an element or text; may be async)
  detail: (row) => {
    const p = document.createElement('p');
    p.textContent = row.name + ' works in ' + row.team + ' as ' + row.title + ', based in ' + row.city + '. Reach them at ' + row.email + '.';
    return p;
  },
  rowActions: [{ label: 'Email', title: 'Write to this person', onClick: (row) => (log.textContent = 'mailto:' + row.email) }],
});

// a directory people can search but not change
document.getElementById('ro').onclick = () => {
  app.setReadOnly(!app.readOnly);
  log.textContent = app.readOnly ? 'Read-only: nothing can be changed.' : 'Editable again.';
};
`,
  },

  'data-table-server': {
    html: `<div id="table"></div>
<pre id="log">Each request to the fake server is logged here.</pre>`,
    css: `#log { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 40px; }`,
    code: `
import { createDataTable, queryDataTable } from 'wysiwygido/data-table';
import 'wysiwygido/style.css';

const columns = [
  { key: 'id', title: 'Order', type: 'number', decimals: 0, width: 90 },
  { key: 'customer', title: 'Customer', type: 'text' },
  { key: 'status', title: 'Status', type: 'select', options: ['New', 'Paid', 'Shipped', 'Returned'] },
  { key: 'placed', title: 'Placed', type: 'date' },
  { key: 'amount', title: 'Amount', type: 'currency', currency: 'USD', decimals: 2, total: 'sum' },
];

// A pretend server: 5,000 orders in an array. In a real app these live in your database and you call fetch() below.
const names = ['Ada', 'Budi', 'Chen', 'Dewi', 'Eko', 'Farah', 'Gita', 'Hana', 'Ivan', 'Joko'];
const statuses = ['New', 'Paid', 'Shipped', 'Returned'];
const db = Array.from({ length: 5000 }, (_, i) => [
  i + 1,
  names[(i * 7) % 10] + ' ' + String.fromCharCode(65 + ((i * 11) % 26)) + '.',
  statuses[(i * 3) % 4],
  '2025-' + String(((i * 3) % 12) + 1).padStart(2, '0') + '-' + String(((i * 3) % 27) + 1).padStart(2, '0'),
  10 + ((i * 37) % 900) + 0.99,
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = document.getElementById('log');
let calls = 0;

createDataTable({
  element: document.getElementById('table'),
  theme: 'light',
  // rows: [] and options.source: the table asks the function named 'orders' for one page at a time
  table: { columns, rows: [], options: { title: 'Orders (loaded from a server)', source: 'orders', pageSize: 20, search: true, filters: true, selectable: true } },
  sources: {
    orders: async ({ page, pageSize, search, filters, sort }) => {
      await sleep(250);                         // a real request goes here, e.g. fetch('/api/orders?page=' + page + ...)
      // searching, filtering and sorting here use the library's own query engine over the array
      const spec = { v: 1, columns, rows: db, options: { groupBy: [] }, rules: [], views: [] };
      const hits = queryDataTable(spec, { search, filters, sort });
      const rows = hits.slice(page * pageSize, (page + 1) * pageSize).map((r) => db[r]);
      log.textContent = 'Request ' + ++calls + ': page ' + (page + 1) + ', search "' + search + '", ' + hits.length + ' match, ' + rows.length + ' sent.';
      // total = all matches; totals = the sums for the footer
      return { rows, total: hits.length, totals: { amount: Math.round(hits.reduce((s, r) => s + db[r][4], 0) * 100) / 100 } };
    },
  },
  crud: {
    access: { delete: ['admin'] },
    user: { id: 'adi', roles: ['admin'] },
    // the table reloads the page after each of these; replace the array work with calls to your API
    onCreate: async (row) => {
      await sleep(300);
      const id = db.length + 1;
      db.unshift([id, row.customer, row.status, row.placed, row.amount]);
      return { id };
    },
    onUpdate: async (row, before) => {
      await sleep(300);
      const at = db.findIndex((r) => r[0] === before.id);
      if (at < 0) throw new Error('That order no longer exists.');
      db[at] = [before.id, row.customer, row.status, row.placed, row.amount];
    },
    onDelete: async (rows) => {
      await sleep(300);
      for (const r of rows) {
        const at = db.findIndex((x) => x[0] === r.id);
        if (at >= 0) db.splice(at, 1);
      }
    },
  },
});
`,
  },

  'data-table-standalone': {
    html: `<div class="bar">
  <button id="undo">Undo</button>
  <button id="redo">Redo</button>
  <button id="ro">Read-only</button>
  <button id="dark">Dark</button>
  <button id="light">Light</button>
  <button id="xlsx">Download .xlsx</button>
</div>
<div id="table"></div>
<p id="log">Changes appear here.</p>

<h3>As a custom element</h3>
<wysiwyg-data-table theme="nord">
  <script type="application/json">
    { "columns": [{ "title": "Language" }, { "title": "Year", "type": "number", "decimals": 0 }],
      "rows": [["Fortran", 1957], ["C", 1972], ["TypeScript", 2012]],
      "options": { "title": "As a custom element", "pageSize": 0, "search": false } }
  </script>
</wysiwyg-data-table>`,
    css: `.bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }`,
    code: `
// Only the stand-alone entry is used here: no editor, no ProseMirror.
import { createDataTable, defineDataTableElement } from 'wysiwygido/data-table';
import 'wysiwygido/style.css';

const people = ['Ada', 'Budi', 'Chen', 'Dewi', 'Eko', 'Farah', 'Gita', 'Hana'];
const regions = ['North', 'South', 'East', 'West'];
const two = (n) => String(n).padStart(2, '0');

const table = {
  columns: [
    { key: 'name', title: 'Customer', type: 'text' },
    { key: 'region', title: 'Region', type: 'select', options: regions },
    { key: 'qty', title: 'Orders', type: 'number', bar: true, total: 'sum' },
    { key: 'avg', title: 'Average', type: 'currency', currency: 'USD', decimals: 2 },
    { key: 'total', title: 'Revenue', type: 'currency', currency: 'USD', formula: '[Orders] * [Average]', total: 'sum' },
    { key: 'since', title: 'Customer since', type: 'date' },
    { key: 'vip', title: 'VIP', type: 'boolean' },
  ],
  rows: Array.from({ length: 120 }, (_, i) => [
    people[i % 8] + ' ' + String.fromCharCode(65 + (i % 26)) + '.',
    regions[i % 4],
    1 + ((i * 7) % 40),
    20 + ((i * 13) % 90) + 0.5,
    null,
    '20' + (15 + (i % 11)) + '-' + two((i % 12) + 1) + '-' + two((i % 27) + 1),
    i % 9 === 0,
  ]),
  rules: [{ column: 'qty', test: '>30', look: 'green' }, { column: 'vip', test: 'true', look: 'bold', row: true }],
  views: [{ name: 'Big accounts', search: '', filters: { qty: '>25' }, sort: [{ key: 'total', dir: 'desc' }], groupBy: [], hidden: ['since'], pageSize: 10 }],
  options: { title: 'Customers', pageSize: 10, search: true, filters: true, selectable: true, detail: true, reorder: true },
};

const log = document.getElementById('log');
let count = 0;
const app = createDataTable({
  element: document.getElementById('table'),
  table,
  theme: 'light',
  locale: 'en-US',
  buttons: [{ id: 'email', label: 'Email selected', needsSelection: true, onClick: ({ selected }) => (log.textContent = 'Would email ' + selected.length + ' customer(s).') }],
  rowActions: [{ label: 'Open', onClick: (row) => (log.textContent = 'Open ' + row.name) }],
  onChange: (t) => (log.textContent = 'Change ' + ++count + ': ' + t.rows.length + ' rows, ' + t.columns.length + ' columns.'),
});

const undo = document.getElementById('undo');
const redo = document.getElementById('redo');
const sync = () => {
  undo.disabled = !app.canUndo;
  redo.disabled = !app.canRedo;
};
app.on('change', sync);
sync();
undo.onclick = () => app.undo();
redo.onclick = () => app.redo();
document.getElementById('ro').onclick = () => app.setReadOnly(!app.readOnly);
document.getElementById('dark').onclick = () => app.setTheme('dark');
document.getElementById('light').onclick = () => app.setTheme('light');
document.getElementById('xlsx').onclick = () => app.download('xlsx');

// the same thing as a custom element: the data is JSON inside the tag (see the HTML above)
defineDataTableElement();
`,
  },

  'spreadsheet-classic': {
    html: `<label>Menu
  <select id="menu">
    <option value="classic">Ribbon</option>
    <option value="floating">Floating card (menus + toolbar)</option>
    <option value="menubar">Drop-down menus only</option>
    <option value="formula">Formula editor only</option>
    <option value="none">None</option>
  </select>
</label>
<div id="sheet"></div>`,
    css: `label { display: block; margin-bottom: 10px; font: 13px system-ui, sans-serif; }`,
    code: `
import { createSpreadsheet } from 'wysiwygido/spreadsheet';
import 'wysiwygido/style.css';

// A year of expenses: totals, a share-of-year column, a few summary formulas and a second sheet.
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const rent = [1200, 1200, 1200, 1200, 1200, 1200, 1250, 1250, 1250, 1250, 1250, 1250];
const food = [420, 390, 455, 410, 430, 468, 502, 475, 440, 430, 461, 520];
const travel = [0, 150, 80, 0, 320, 90, 640, 210, 0, 120, 0, 380];
const fun = [90, 60, 140, 75, 110, 95, 180, 130, 85, 100, 120, 260];

const head = { b: 1, bg: '#dbeafe', color: '#1e3a8a', align: 'center' };
const money = { fmt: 'currency' };
const cells = {};
['Month', 'Rent', 'Food', 'Travel', 'Fun', 'Total', 'Share of year'].forEach((title, c) => {
  cells['ABCDEFG'[c] + '1'] = { v: title, s: head };
});
months.forEach((month, i) => {
  const r = i + 2;                                       // a cell holds text as typed; a formula starts with =
  cells['A' + r] = { v: month };
  cells['B' + r] = { v: String(rent[i]), s: money };
  cells['C' + r] = { v: String(food[i]), s: money };
  cells['D' + r] = { v: String(travel[i]), s: money };
  cells['E' + r] = { v: String(fun[i]), s: money };
  cells['F' + r] = { v: '=SUM(B' + r + ':E' + r + ')', s: { ...money, b: 1 } };
  cells['G' + r] = { v: '=F' + r + '/$F$14', s: { fmt: 'percent', dec: 1 } };
});
cells.A14 = { v: 'Total', s: { b: 1, bt: 1 } };
for (const c of 'BCDEF') cells[c + '14'] = { v: '=SUM(' + c + '2:' + c + '13)', s: { ...money, b: 1, bt: 1, bg: '#f1f5f9' } };
cells.G14 = { v: '=SUM(G2:G13)', s: { fmt: 'percent', dec: 0, b: 1, bt: 1 } };
cells.A16 = { v: 'Average month', s: { b: 1 } };
cells.F16 = { v: '=AVERAGE(F2:F13)', s: money };
cells.A17 = { v: 'Biggest month', s: { b: 1 } };
cells.F17 = { v: '=MAX(F2:F13)', s: money };
cells.A18 = { v: 'Months over 2200', s: { b: 1 } };
cells.F18 = { v: '=COUNTIF(F2:F13,">2200")' };

const budget = {
  A1: { v: 'Category', s: head }, B1: { v: 'Planned', s: head }, C1: { v: 'Actual', s: head }, D1: { v: 'Difference', s: head },
  A2: { v: 'Rent' }, B2: { v: '14700', s: money }, C2: { v: '=Expenses!B14', s: money }, D2: { v: '=C2-B2', s: money },
  A3: { v: 'Food' }, B3: { v: '5400', s: money }, C3: { v: '=Expenses!C14', s: money }, D3: { v: '=C3-B3', s: money },
};

const sheet = createSpreadsheet({
  element: document.getElementById('sheet'),
  data: {
    sheets: [
      { name: 'Expenses', rows: 100, cols: 12, cells, colWidths: { 0: 130, 6: 120 }, freezeRows: 1 },
      { name: 'Budget', rows: 60, cols: 10, cells: budget, colWidths: { 0: 140, 1: 110, 2: 110, 3: 110 } },
    ],
  },
  menu: 'classic',                                           // 'classic' ribbon, 'floating' card, 'menubar', 'formula' or 'none'
  title: 'Yearly expenses',                              // name in the header
  storageKey: 'my-spreadsheet-classic',                      // keeps the workbook in localStorage; or pass save: (data) => fetch(...)
  height: '78vh',
  onChange: (data) => console.log('changed,', data.sheets.length, 'sheets'),
});

document.getElementById('menu').value = 'classic';
document.getElementById('menu').onchange = (e) => sheet.setMenu(e.target.value);

console.log(sheet.getValue('F14'));                      // the yearly total, calculated
console.log(sheet.toCSV());                              // the current sheet as CSV
`,
  },

  'spreadsheet-floating': {
    html: `<label>Menu
  <select id="menu">
    <option value="classic">Ribbon</option>
    <option value="floating">Floating card (menus + toolbar)</option>
    <option value="menubar">Drop-down menus only</option>
    <option value="formula">Formula editor only</option>
    <option value="none">None</option>
  </select>
</label>
<div id="sheet"></div>`,
    css: `label { display: block; margin-bottom: 10px; font: 13px system-ui, sans-serif; }`,
    code: `
import { createSpreadsheet } from 'wysiwygido/spreadsheet';
import 'wysiwygido/style.css';

// A year of expenses: totals, a share-of-year column, a few summary formulas and a second sheet.
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const rent = [1200, 1200, 1200, 1200, 1200, 1200, 1250, 1250, 1250, 1250, 1250, 1250];
const food = [420, 390, 455, 410, 430, 468, 502, 475, 440, 430, 461, 520];
const travel = [0, 150, 80, 0, 320, 90, 640, 210, 0, 120, 0, 380];
const fun = [90, 60, 140, 75, 110, 95, 180, 130, 85, 100, 120, 260];

const head = { b: 1, bg: '#dbeafe', color: '#1e3a8a', align: 'center' };
const money = { fmt: 'currency' };
const cells = {};
['Month', 'Rent', 'Food', 'Travel', 'Fun', 'Total', 'Share of year'].forEach((title, c) => {
  cells['ABCDEFG'[c] + '1'] = { v: title, s: head };
});
months.forEach((month, i) => {
  const r = i + 2;                                       // a cell holds text as typed; a formula starts with =
  cells['A' + r] = { v: month };
  cells['B' + r] = { v: String(rent[i]), s: money };
  cells['C' + r] = { v: String(food[i]), s: money };
  cells['D' + r] = { v: String(travel[i]), s: money };
  cells['E' + r] = { v: String(fun[i]), s: money };
  cells['F' + r] = { v: '=SUM(B' + r + ':E' + r + ')', s: { ...money, b: 1 } };
  cells['G' + r] = { v: '=F' + r + '/$F$14', s: { fmt: 'percent', dec: 1 } };
});
cells.A14 = { v: 'Total', s: { b: 1, bt: 1 } };
for (const c of 'BCDEF') cells[c + '14'] = { v: '=SUM(' + c + '2:' + c + '13)', s: { ...money, b: 1, bt: 1, bg: '#f1f5f9' } };
cells.G14 = { v: '=SUM(G2:G13)', s: { fmt: 'percent', dec: 0, b: 1, bt: 1 } };
cells.A16 = { v: 'Average month', s: { b: 1 } };
cells.F16 = { v: '=AVERAGE(F2:F13)', s: money };
cells.A17 = { v: 'Biggest month', s: { b: 1 } };
cells.F17 = { v: '=MAX(F2:F13)', s: money };
cells.A18 = { v: 'Months over 2200', s: { b: 1 } };
cells.F18 = { v: '=COUNTIF(F2:F13,">2200")' };

const budget = {
  A1: { v: 'Category', s: head }, B1: { v: 'Planned', s: head }, C1: { v: 'Actual', s: head }, D1: { v: 'Difference', s: head },
  A2: { v: 'Rent' }, B2: { v: '14700', s: money }, C2: { v: '=Expenses!B14', s: money }, D2: { v: '=C2-B2', s: money },
  A3: { v: 'Food' }, B3: { v: '5400', s: money }, C3: { v: '=Expenses!C14', s: money }, D3: { v: '=C3-B3', s: money },
};

const sheet = createSpreadsheet({
  element: document.getElementById('sheet'),
  data: {
    sheets: [
      { name: 'Expenses', rows: 100, cols: 12, cells, colWidths: { 0: 130, 6: 120 }, freezeRows: 1 },
      { name: 'Budget', rows: 60, cols: 10, cells: budget, colWidths: { 0: 140, 1: 110, 2: 110, 3: 110 } },
    ],
  },
  menu: 'floating',                                           // 'classic' ribbon, 'floating' card, 'menubar', 'formula' or 'none'
  title: 'Yearly expenses',                              // name in the header
  storageKey: 'my-spreadsheet-floating',                      // keeps the workbook in localStorage; or pass save: (data) => fetch(...)
  height: '78vh',
  onChange: (data) => console.log('changed,', data.sheets.length, 'sheets'),
});

document.getElementById('menu').value = 'floating';
document.getElementById('menu').onchange = (e) => sheet.setMenu(e.target.value);

console.log(sheet.getValue('F14'));                      // the yearly total, calculated
console.log(sheet.toCSV());                              // the current sheet as CSV
`,
  },

  'presentation-classic': {
    html: `<div id="deck"></div>`,
    code: `
import { createPresentation } from 'wysiwygido/presentation';
import 'wysiwygido/style.css';

const deck = createPresentation({
  element: document.getElementById('deck'),
  menu: 'classic',                                    // 'classic' (tabbed ribbon) or 'floating' (rounded card)
  storageKey: 'my-deck-classic',                      // keeps the deck in localStorage; or pass save: (data) => fetch(...)
  height: '80vh',
  onChange: (data) => console.log('changed,', data.slides.length, 'slides'),
});

// Build the slides: each layout brings its own boxes ('title', 'subtitle', 'body', 'body2'); fill them with text.
const lines = (...text) => text.map((t) => '<div>' + t + '</div>').join('');
const fill = (slide, ph, html) => {
  slide.els.find((e) => e.ph === ph).html = html;
};

deck.addSlide('titleContent');
deck.addSlide('twoContent');
deck.addSlide('section');
deck.addSlide('title');

const data = deck.getData();
const [intro, shipped, growth, next, thanks] = data.slides;
fill(intro, 'title', 'Product update');
fill(intro, 'subtitle', 'Q4 review: what shipped, what is next');
intro.notes = 'Welcome everyone. Keep this to 20 minutes.';
fill(shipped, 'title', 'What shipped');
fill(shipped, 'body', lines('Spreadsheet app with formulas and filters', 'Presentation app with themes and transitions', 'Floating menu for every editor', 'Faster tables: 100,000 rows'));
shipped.transition = 'fade';                      // 'none' | 'fade' | 'slide' | 'zoom'
fill(growth, 'title', 'Growth');
fill(growth, 'body', lines('Weekly users up 38 percent', 'Documents created: 1.2M', 'Support tickets down 21 percent'));
fill(growth, 'body2', lines('Next quarter', 'Charts', 'Tables', 'Collaboration'));
growth.transition = 'slide';
fill(next, 'title', 'What is next');
fill(next, 'subtitle', 'Three bets for the new year');
next.transition = 'zoom';
fill(thanks, 'title', 'Thank you');
fill(thanks, 'subtitle', 'Questions?');
data.theme = 'ocean';                             // office, dark, ocean, forest, sunset or mono
data.title = 'Product update';
deck.setData(data);

deck.goTo(0);
// deck.present(0);       // the slide show; present(0, true) opens the presenter view
// deck.toHTML();         // one self-contained page, one slide per printed page
// await deck.toPptx();   // a PowerPoint file (Blob)
`,
  },

  'presentation-floating': {
    html: `<div id="deck"></div>`,
    code: `
import { createPresentation } from 'wysiwygido/presentation';
import 'wysiwygido/style.css';

const deck = createPresentation({
  element: document.getElementById('deck'),
  menu: 'floating',                                    // 'classic' (tabbed ribbon) or 'floating' (rounded card)
  storageKey: 'my-deck-floating',                      // keeps the deck in localStorage; or pass save: (data) => fetch(...)
  height: '80vh',
  onChange: (data) => console.log('changed,', data.slides.length, 'slides'),
});

// Build the slides: each layout brings its own boxes ('title', 'subtitle', 'body', 'body2'); fill them with text.
const lines = (...text) => text.map((t) => '<div>' + t + '</div>').join('');
const fill = (slide, ph, html) => {
  slide.els.find((e) => e.ph === ph).html = html;
};

deck.addSlide('titleContent');
deck.addSlide('twoContent');
deck.addSlide('section');
deck.addSlide('title');

const data = deck.getData();
const [intro, shipped, growth, next, thanks] = data.slides;
fill(intro, 'title', 'Product update');
fill(intro, 'subtitle', 'Q4 review: what shipped, what is next');
intro.notes = 'Welcome everyone. Keep this to 20 minutes.';
fill(shipped, 'title', 'What shipped');
fill(shipped, 'body', lines('Spreadsheet app with formulas and filters', 'Presentation app with themes and transitions', 'Floating menu for every editor', 'Faster tables: 100,000 rows'));
shipped.transition = 'fade';                      // 'none' | 'fade' | 'slide' | 'zoom'
fill(growth, 'title', 'Growth');
fill(growth, 'body', lines('Weekly users up 38 percent', 'Documents created: 1.2M', 'Support tickets down 21 percent'));
fill(growth, 'body2', lines('Next quarter', 'Charts', 'Tables', 'Collaboration'));
growth.transition = 'slide';
fill(next, 'title', 'What is next');
fill(next, 'subtitle', 'Three bets for the new year');
next.transition = 'zoom';
fill(thanks, 'title', 'Thank you');
fill(thanks, 'subtitle', 'Questions?');
data.theme = 'ocean';                             // office, dark, ocean, forest, sunset or mono
data.title = 'Product update';
deck.setData(data);

deck.goTo(0);
// deck.present(0);       // the slide show; present(0, true) opens the presenter view
// deck.toHTML();         // one self-contained page, one slide per printed page
// await deck.toPptx();   // a PowerPoint file (Blob)
`,
  },

  'data-table': {
    html: `<div class="bar">
  <button id="group">Group by category</button>
  <button id="new">New data table</button>
  <button id="import">Import CSV or Excel...</button>
  <button id="server">Load from a server</button>
  <button id="xlsx">Download .xlsx</button>
</div>
<p id="status">Search, click a heading to sort, type in the filter row (for numbers try &gt;10 or 5..20), double-click a cell to edit.</p>
<div id="editor"></div>`,
    css: `.bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }`,
    code: `
import { Charts, DataTable, cleanDataTable, createEditor, defaultPlugins, download, queryDataTable } from 'wysiwygido';
import 'wysiwygido/style.css';

const status = document.getElementById('status');
const two = (n) => String(n).padStart(2, '0');

// 64 products to start with
const names = ['Oolong tea', 'Green tea', 'Black tea', 'Espresso beans', 'Filter coffee', 'Matcha', 'Chai mix', 'Hot chocolate', 'Cold brew', 'Rooibos', 'Earl Grey', 'Jasmine pearls'];
const rows = Array.from({ length: 64 }, (_, i) => [
  names[i % names.length] + ' ' + (Math.floor(i / names.length) + 1),
  [3, 4, 8].includes(i % 12) ? 'Coffee' : [6, 7].includes(i % 12) ? 'Other' : 'Tea',
  ((i * 7) % 40) + 3,
  Math.round((3 + ((i * 13) % 17) * 1.35) * 100) / 100,
  '2026-' + two((i % 12) + 1) + '-' + two((i % 27) + 1),
  i % 3 !== 0,
]);
const spec = {
  columns: [
    { key: 'name', title: 'Product', type: 'text' },
    { key: 'cat', title: 'Category', type: 'select', options: ['Tea', 'Coffee', 'Other'] },
    { key: 'stock', title: 'Stock', type: 'number', total: 'sum', bar: true },
    { key: 'price', title: 'Price', type: 'currency', currency: 'USD', total: 'avg' },
    { key: 'added', title: 'Added', type: 'date' },
    { key: 'active', title: 'Active', type: 'boolean' },
    { key: 'value', title: 'Stock value', type: 'currency', currency: 'USD', formula: '[Stock] * [Price]', total: 'sum' },
  ],
  rows,
  rules: [{ column: 'stock', test: '<10', look: 'red' }, { column: 'active', test: 'false', look: 'gray', row: true }],
  views: [
    { name: 'Low stock', search: '', filters: { stock: '<15' }, sort: [{ key: 'stock', dir: 'asc' }], groupBy: [], hidden: [], pageSize: 10 },
    { name: 'Coffee by value', search: '', filters: { cat: 'Coffee' }, sort: [{ key: 'value', dir: 'desc' }], groupBy: [], hidden: ['added'], pageSize: 10 },
  ],
  options: { title: 'Products', pageSize: 10, search: true, filters: true, striped: true, selectable: true, detail: true, reorder: true },
};

// A pretend server: 5,000 orders in an array, answering after a short delay. Replace loadOrders with a fetch() to your API.
const orderColumns = [
  { key: 'id', title: 'Order', type: 'number' },
  { key: 'customer', title: 'Customer', type: 'text' },
  { key: 'region', title: 'Region', type: 'select', options: ['North', 'South', 'East', 'West'] },
  { key: 'amount', title: 'Amount', type: 'currency', currency: 'USD', total: 'sum' },
  { key: 'placed', title: 'Placed', type: 'date' },
  { key: 'paid', title: 'Paid', type: 'boolean' },
];
const people = ['Ada', 'Budi', 'Chen', 'Dewi', 'Eko', 'Farah', 'Gita', 'Hana', 'Ilham', 'Joko'];
const orders = cleanDataTable({
  columns: orderColumns,
  rows: Array.from({ length: 5000 }, (_, i) => [i + 1, people[i % 10] + ' ' + String.fromCharCode(65 + (i % 26)) + '.', ['North', 'South', 'East', 'West'][i % 4], 20 + ((i * 37) % 900) + (i % 7) / 10, '2026-' + two((i % 12) + 1) + '-' + two((i % 27) + 1), i % 3 === 0]),
});
async function loadOrders({ page, pageSize, search, filters, sort }) {
  await new Promise((r) => setTimeout(r, 300));
  const hits = queryDataTable(orders, { search, filters, sort }, 'en-US');
  const rowsOnPage = hits.slice(page * pageSize, (page + 1) * pageSize).map((r) => orders.rows[r]);
  return { rows: rowsOnPage, total: hits.length, totals: { amount: hits.reduce((n, r) => n + orders.rows[r][3], 0) } };
}

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h2>Stock list</h2><p>This table lives in the document: edits are undoable, and it exports to Word.</p>',
  ribbon: true,
  plugins: [
    ...defaultPlugins.filter((p) => p.name !== 'dataTable'),
    Charts(),
    DataTable({
      locale: 'en-US',
      sources: { orders: loadOrders },            // options.source: 'orders' loads rows through this function
      buttons: [
        { id: 'restock', label: 'Mark inactive', needsSelection: true, onClick: ({ selected }) => (status.textContent = 'Would mark ' + selected.length + ' product(s) inactive.') },
        { id: 'count', label: 'How many?', onClick: ({ visible, spec: s }) => (status.textContent = visible.length + ' of ' + s.rows.length + ' rows match right now.') },
      ],
      rowActions: [{ label: 'View', onClick: (row) => (status.textContent = 'Open "' + row.name + '" (stock ' + row.stock + ').') }],
    }),
  ],
});
editor.execute('insertDataTable', spec);

document.getElementById('group').onclick = () => editor.execute('insertDataTable', { ...spec, options: { ...spec.options, title: 'Products by category', groupBy: ['cat'], pageSize: 0, filters: false } });
document.getElementById('new').onclick = () => editor.execute('insertDataTable');
document.getElementById('import').onclick = () => editor.execute('dataTableFromFile');
document.getElementById('server').onclick = () => editor.execute('insertDataTable', { columns: orderColumns, rows: [], options: { title: 'Orders (loaded 25 at a time)', source: 'orders', pageSize: 25, filters: true, selectable: true } });
document.getElementById('xlsx').onclick = () => {
  const blob = editor.extensions.dataTable.export('xlsx');   // 'csv' | 'xlsx' | 'pdf'
  if (blob) download(blob, 'products.xlsx');
};
`,
  },

  'export-word-pdf': {
    install: ['docx'],
    html: `<div class="bar">
  <button id="docx">Download .docx</button>
  <button id="print">Print / Save as PDF</button>
  <button id="html">Download HTML</button>
  <button id="md">Download Markdown</button>
  <button id="upload">Send to a server (simulated upload)</button>
</div>
<div id="editor"></div>
<pre id="log">Every export is reported here by the editor's "export" event.</pre>`,
    css: `.bar { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
#log { background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 40px; white-space: pre-wrap; }`,
    code: `
import { Comments, createEditor, defaultPlugins, download, exportHTML } from 'wysiwygido';
// the Word support needs the optional "docx" package
import * as docxSupport from 'wysiwygido/docx';
import 'wysiwygido/style.css';

const log = document.getElementById('log');
const note = (text) => (log.textContent = new Date().toLocaleTimeString() + '  ' + text + '\\n' + log.textContent);

const chart = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="240"><rect width="480" height="240" fill="#e0e7ff"/><text x="240" y="130" font-size="28" text-anchor="middle" fill="#3730a3">Chart</text></svg>');

const editor = createEditor({
  element: document.getElementById('editor'),
  // loads the Word support; with a bundler you can write docx: () => import('wysiwygido/docx') so it loads only when used
  docx: () => Promise.resolve(docxSupport),
  ribbon: true,
  pages: { header: 'Annual report', footer: 'Page {page} of {pages}', height: '65vh' },
  outline: true,
  plugins: [...defaultPlugins, Comments({ author: 'You' }), { name: 'quick-docx', keymap: { 'Mod-Shift-s': 'exportDocx' } }],   // Ctrl/Cmd+Shift+S downloads a .docx
  content: '<h1>Annual report</h1>' +
    '<p>Rich-text documents keep their <strong>formatting</strong>, <em>styles</em> and structure when exported to Word.</p>' +
    '<h2>Results</h2>' +
    '<table><tr><th>Quarter</th><th>Revenue</th><th>Growth</th></tr><tr><td>Q1</td><td>1.2M</td><td>+4%</td></tr><tr><td>Q2</td><td>1.5M</td><td>+25%</td></tr></table>' +
    '<p><img src="' + chart + '" alt="A placeholder chart" width="360" data-caption="Figure 1. A placeholder chart"></p>' +
    '<ul><li><p>Headings, lists, tables and images</p></li><li><p>Comments, tracked changes and page setup</p></li></ul>' +
    '<p>Footnotes<sup data-footnote="Footnotes become real Word footnotes."></sup> and a table of contents are exported too.</p>',
});

// every export (and every failure) is reported by the editor
editor.on('export', ({ format, blob }) => note('export event: ' + format + ', ' + (blob.size / 1024).toFixed(1) + ' KB'));
editor.on('exportError', (err) => note('export failed: ' + (err instanceof Error ? err.message : err)));

document.getElementById('docx').onclick = () => editor.exportDocx({ download: 'report.docx' });   // also returns the Blob
document.getElementById('print').onclick = () => editor.execute('print');                         // PDF: the browser print dialog ("Save as PDF")
document.getElementById('html').onclick = () => download(exportHTML(editor, { title: 'Annual report' }), 'report.html', 'text/html');
document.getElementById('md').onclick = () => download(editor.getMarkdown(), 'report.md', 'text/markdown');
document.getElementById('upload').onclick = async () => {
  const blob = await editor.exportDocx();            // no download: just the Blob
  const form = new FormData();
  form.append('file', blob, 'report.docx');
  // await fetch('https://your-server.example/api/documents', { method: 'POST', body: form });   // placeholder URL
  note('would upload report.docx: ' + blob.size + ' bytes');
};
`,
  },

  'import-word': {
    install: ['docx', 'mammoth'],
    html: `<div id="drop">Drop a .docx file here, or use the buttons below.</div>
<div class="bar">
  <button id="choose">Choose .docx...</button>
  <button id="sample">Generate a sample .docx and import it</button>
  <input id="file" type="file" accept=".docx" hidden />
</div>
<div class="cols">
  <div><h3>Editor</h3><div id="editor"></div></div>
  <div><h3>Conversion messages</h3><pre id="log">No file imported yet.</pre></div>
</div>`,
    css: `#drop { border: 2px dashed #94a3b8; border-radius: 8px; text-align: center; padding: 22px; }
.bar { display: flex; gap: 8px; margin: 8px 0; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
#log { white-space: pre-wrap; background: #f1f5f9; padding: 12px; border-radius: 8px; }
@media (max-width: 800px) { .cols { grid-template-columns: 1fr; } }`,
    code: `
import { createEditor } from 'wysiwygido';
// reading Word files needs "mammoth", creating them needs "docx"
import { exportDocx, importDocx } from 'wysiwygido/docx';
import 'wysiwygido/style.css';

const log = document.getElementById('log');
const drop = document.getElementById('drop');
const input = document.getElementById('file');

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<p>Import a document to see it here.</p>',
  ribbon: false,
});

async function load(file, name) {
  try {
    const warnings = await importDocx(editor, file);            // one undoable step; returns conversion warnings
    log.textContent = 'Imported ' + name + ' (' + Math.round(file.size / 1024) + ' KB).\\n' + (warnings.length ? warnings.join('\\n') : 'No warnings.') + '\\n\\nPress Ctrl/Cmd+Z to go back.';
  } catch (err) {
    log.textContent = 'Could not import ' + name + ': ' + (err instanceof Error ? err.message : err);   // e.g. not a .docx file
  }
}

document.getElementById('choose').onclick = () => input.click();
input.onchange = () => input.files[0] && load(input.files[0], input.files[0].name);
drop.ondragover = (e) => e.preventDefault();
drop.ondrop = (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) load(f, f.name);
};

// no file at hand? build a real .docx from a throwaway editor, then import it
document.getElementById('sample').onclick = async () => {
  const temp = createEditor({
    element: document.createElement('div'),
    toolbar: false,
    content: '<h1>Sample document</h1><p>This was exported to <strong>Word</strong> and read back.</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
  });
  await load(await exportDocx(temp), 'sample.docx');
  temp.destroy();
};
`,
  },

  'pdf-epub': {
    install: ['pdfjs-dist', 'jszip'],
    html: `<div class="bar">
  <button id="open">Open a PDF...</button>
  <button id="epub">Download EPUB</button>
</div>
<p id="status">Open a PDF, edit the text, then download it as an EPUB book.</p>
<div id="editor"></div>`,
    css: `.bar { display: flex; gap: 8px; margin-bottom: 8px; }`,
    code: `
import { PdfEpub, createEditor, defaultPlugins } from 'wysiwygido';
// PDF support needs "pdfjs-dist", EPUB support needs "jszip"
import * as pdfSupport from 'wysiwygido/pdf';
import * as epubSupport from 'wysiwygido/epub';
import 'wysiwygido/style.css';

const status = document.getElementById('status');

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Nothing yet</h1><p>Press "Open a PDF".</p>',
  plugins: [
    ...defaultPlugins,
    PdfEpub({
      // with a bundler you can write loadPdf: () => import('wysiwygido/pdf') so it loads only when used
      loadPdf: () => Promise.resolve(pdfSupport),
      loadEpub: () => Promise.resolve(epubSupport),
      // the PDF reader runs in a worker: use the same version as your pdfjs-dist
      pdf: { workerSrc: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs' },
      epub: { title: 'My book', author: 'Me', language: 'en' },
    }),
  ],
});

document.getElementById('open').onclick = () => editor.execute('openPdf');         // file picker; or editor.execute('importPdf', blob)
document.getElementById('epub').onclick = () => editor.execute('exportEpub');      // each top-level heading starts a chapter

editor.on('import', ({ warnings }) => (status.textContent = warnings.length ? warnings.join(' ') : 'PDF imported.'));
editor.on('export', ({ blob }) => (status.textContent = 'EPUB ready (' + Math.round(blob.size / 1024) + ' KB).'));
editor.on('error', ({ message }) => (status.textContent = message));
`,
  },

};
