import type { FullExample } from '../full-code';

export const group_b: Record<string, FullExample> = {
  'math-diagrams': {
    install: ['katex', 'mermaid'],
    // KaTeX needs its stylesheet; with npm you can also `import 'katex/dist/katex.min.css'` instead of the link
    html: `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css" />
<div id="editor"></div>
<p><button id="md">Show Markdown</button></p>
<pre id="out" hidden></pre>`,
    code: `
import { Equations, Mermaid, createEditor, defaultPlugins } from 'wysiwygido';
import katex from 'katex';
import mermaid from 'mermaid';
import 'wysiwygido/style.css';

const content =
  '<h1>Notes on the quadratic formula</h1>' +
  '<p>For <span data-math="ax^2 + bx + c = 0"></span>, the solutions are:</p>' +
  '<div data-math-block="x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}"></div>' +
  '<p>Try typing <code>$e^{i\\\\pi}+1=0$</code> yourself.</p>' +
  '<figure data-mermaid="flowchart TD\\n  A[Read a, b, c] --> B{a = 0?}\\n  B -- Yes --> C[Linear: x = -c / b]\\n  B -- No --> D[Discriminant D = b² - 4ac]"></figure>' +
  '<p></p>';

const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  ribbon: true,
  plugins: [...defaultPlugins, Equations({ katex: () => Promise.resolve(katex) }), Mermaid({ mermaid: () => Promise.resolve(mermaid) })],
});

editor.execute('insertMath', 'E = mc^2');                 // inline equation
editor.execute('insertMermaid', 'flowchart LR\\n  A --> B'); // diagram

document.getElementById('md').addEventListener('click', () => {
  const out = document.getElementById('out');
  out.hidden = false;
  out.textContent = editor.getMarkdown();                 // $x^2$, $$ ... $$ and mermaid fences
});
`,
  },

  'meeting-notes': {
    css: `.cols { display: grid; grid-template-columns: 2fr 1fr; gap: 20px; } ul { list-style: none; padding: 0; }`,
    html: `<div class="cols">
  <div id="editor"></div>
  <div>
    <h2>Action items</h2>
    <div id="summary"></div>
    <ul id="items"></ul>
  </div>
</div>`,
    code: `
import { Comments, Mentions, SlashCommands, Templates, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

const people = [{ id: 'u1', label: 'Ana Lestari' }, { id: 'u2', label: 'Budi Santoso' }, { id: 'u3', label: 'Citra Dewi' }];

const editor = createEditor({
  element: document.getElementById('editor'),
  plugins: [
    ...defaultPlugins,
    Templates(),
    SlashCommands(),
    Mentions({ search: (q) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())) }),
    Comments({ author: 'You' }),
  ],
  content: '<h1>Weekly sync</h1><p><strong>Attendees:</strong> @Ana, @Budi</p><h2>Decisions</h2><ul><li><p>Ship the beta on Friday</p></li></ul><h2>Action items</h2><ul data-task-list><li data-task data-checked="true"><p>@Ana writes the release notes</p></li><li data-task data-checked="false"><p>@Budi books the demo room</p></li></ul>',
  onChange: render,
});

// every checklist item in the document is an action item
function render() {
  const doc = new DOMParser().parseFromString(editor.getHTML(), 'text/html');
  const all = [...doc.querySelectorAll('li[data-task]')]
    .map((li) => ({ text: li.textContent.trim(), done: li.getAttribute('data-checked') === 'true' }))
    .filter((i) => i.text);
  document.getElementById('summary').textContent = all.filter((i) => i.done).length + ' of ' + all.length + ' done';
  document.getElementById('items').replaceChildren(...all.map((i) => {
    const li = document.createElement('li');
    li.textContent = (i.done ? '[x] ' : '[ ] ') + i.text;
    return li;
  }));
}
render();
`,
  },

  'merge-fields': {
    css: `.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; } #preview { padding: 14px; border: 1px solid #ccc; border-radius: 8px; min-height: 200px; }`,
    html: `<div class="cols">
  <div><h2>Template</h2><div id="editor"></div><p id="used"></p></div>
  <div><h2>Preview for <select id="who"></select></h2><div id="preview"></div></div>
</div>`,
    code: `
import { MergeFields, createEditor, defaultPlugins, getMergeFields, renderMergeFields } from 'wysiwygido';
import 'wysiwygido/style.css';

const fields = [
  { name: 'first_name', label: 'First name' },
  { name: 'last_name', label: 'Last name' },
  { name: 'company', label: 'Company' },
  { name: 'plan', label: 'Plan' },
  { name: 'renewal_date', label: 'Renewal date' },
];
const people = {
  'Ana Lestari': { first_name: 'Ana', last_name: 'Lestari', company: 'Kopi Nusantara', plan: 'Team', renewal_date: '1 March 2027' },
  'Budi Santoso': { first_name: 'Budi', last_name: 'Santoso', company: 'Santoso & Sons <b>', plan: 'Business', renewal_date: '14 June 2027' }, // markup in a value stays text
  'No data yet': { first_name: 'Citra' },                  // fields without data stay visible
};

const who = document.getElementById('who');
for (const name of Object.keys(people)) who.append(new Option(name, name));

const f = (n) => '<span data-merge-field="' + n + '"></span>';
const editor = createEditor({
  element: document.getElementById('editor'),
  plugins: [...defaultPlugins, MergeFields(fields)],     // adds a "Merge field" dropdown
  content: '<h2>Your ' + f('plan') + ' plan renews soon</h2><p>Dear ' + f('first_name') + ' ' + f('last_name') + ',</p><p>The subscription for <strong>' + f('company') + '</strong> renews on ' + f('renewal_date') + '.</p><p>Thank you,<br>The team</p>',
  onChange: render,
});

function render() {
  document.getElementById('preview').innerHTML = renderMergeFields(editor.getHTML(), people[who.value]); // values are inserted as text
  document.getElementById('used').textContent = 'Fields used: ' + (getMergeFields(editor.view.state.doc).join(', ') || 'none');
}
who.addEventListener('change', render);
render();
`,
  },

  mobile: {
    css: `.phone { max-width: 375px; margin: 0 auto; border: 1px solid #ccc; border-radius: 16px; padding: 8px; }`,
    html: `<div class="phone touch">
  <div id="editor"></div>
</div>`,
    code: `
import { createEditor } from 'wysiwygido';
import 'wysiwygido/style.css';

// A compact toolbar that wraps on a narrow screen. The "touch" class on a wrapper gives 40px controls for fingers.
createEditor({
  element: document.getElementById('editor'),
  toolbar: ['bold', 'italic', 'underline', '|', 'heading', 'bulletList', 'orderedList', '|', 'link', 'image', 'insertTable'],
  content: '<h1>Field notes</h1><p>This editor fits a 375px screen. The toolbar wraps and the buttons are easy to tap.</p><ul><li><p>Try the list button</p></li><li><p>Or add a link</p></li></ul>',
});
`,
  },

  productivity: {
    code: `
import { Mentions, SlashCommands, Templates, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

const people = [
  { id: 'u1', label: 'Ana Lestari' }, { id: 'u2', label: 'Budi Santoso' }, { id: 'u3', label: 'Citra Dewi' },
  { id: 'u4', label: 'Dimas Pratama' },
];

createEditor({
  element: document.getElementById('editor'),
  plugins: [
    ...defaultPlugins,
    Templates(),                                   // a "Template" dropdown (undoable)
    SlashCommands(),                               // type / on an empty line for a block menu
    Mentions({ search: (query) => people.filter((p) => p.label.toLowerCase().includes(query.toLowerCase())) }), // type @
  ],
  content: '<h2>Standup notes</h2><p>Hi @Ana, can you review the draft? Start a new line and press <code>/</code>.</p><p></p>',
});
// Markdown shortcuts work too: "# ", "- ", "1. ", "> ", three backticks, **bold**
`,
  },

  proofreading: {
    html: `<p><button id="check">Check again</button> <button id="next">Next issue</button> <span id="status"></span></p>
<div id="editor"></div>`,
    code: `
import { SpellCheck, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// An offline stand-in for a proofreading service. Replace it with
// createLanguageToolProvider('https://your-languagetool/v2/check') to use a real server (the text is sent to it).
const typos = { teh: 'the', recieve: 'receive', definately: 'definitely', seperate: 'separate', alot: 'a lot', wich: 'which' };
const provider = async ({ text, signal }) => {
  await new Promise((r) => setTimeout(r, 150));
  if (signal.aborted) return [];
  const issues = [];
  for (const m of text.matchAll(/[A-Za-z']+/g)) {
    const fix = typos[m[0].toLowerCase()];
    if (fix) issues.push({ offset: m.index, length: m[0].length, message: 'Possible spelling mistake: ' + m[0], replacements: [fix], rule: 'MOCK_SPELL', kind: 'spelling' });
  }
  for (const m of text.matchAll(/\\b(\\w+)\\s+\\1\\b/gi)) {
    issues.push({ offset: m.index + m[1].length + 1, length: m[1].length, message: 'Repeated word.', replacements: [''], rule: 'MOCK_REPEAT', kind: 'style' });
  }
  return issues;
};

const editor = createEditor({
  element: document.getElementById('editor'),
  plugins: [...defaultPlugins.filter((p) => p.name !== 'spellcheck'), SpellCheck({ provider, lang: 'en-US', delayMs: 500 })],
  content: '<h1>Meeting notes</h1><p>We definately recieve teh agenda early, wich is is alot better than last time.</p><p>Plan a seperate review for each item.</p>',
});

editor.on('proofread-status', (e) => { document.getElementById('status').textContent = e.message; });
document.getElementById('check').addEventListener('click', () => editor.execute('checkDocument'));
document.getElementById('next').addEventListener('click', () => editor.execute('nextIssue'));
`,
  },

  recording: {
    html: `<p id="status" aria-live="polite"></p>
<div id="editor"></div>`,
    code: `
import { Recording, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// Adds three toolbar buttons: record audio, record the screen, and dictate. The browser asks for permission first.
// Recordings are embedded in the document. To store them on a server instead, pass
// upload: async (blob, kind) => (await fetch('https://example.com/api/media', { method: 'POST', body: blob }).then((r) => r.json())).url
const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Meeting notes</h1><p>Press the microphone to attach a voice note, or the speech button and talk.</p><p></p>',
  plugins: [...defaultPlugins, Recording({ maxSeconds: 120, dictationLang: 'en-US' })],
});

editor.on('recording-status', (e) => { document.getElementById('status').textContent = e.message; });
// editor.execute('recordAudio'); editor.execute('recordScreen'); editor.execute('stopRecording'); editor.execute('toggleDictation');
`,
  },

  'restricted-editing': {
    code: `
import { RestrictedEditing, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// data-locked sections cannot be changed; data-editable-region areas are for filling in.
// Text outside both is ordinary text.
const content =
  '<section data-locked data-variant="title" data-label="Title block"><h1>Service agreement</h1></section>' +
  '<h2>Parties</h2><div data-editable-region data-label="Fill in"><p>Client: <i>type the client name here</i></p><p>Provider: <i>type the provider name here</i></p></div>' +
  '<h2>Terms</h2><section data-locked data-variant="legal" data-label="Legal text"><p>Both parties agree to the standard terms below. These clauses cannot be changed by the person filling in the document.</p><ol><li><p>Payment is due within 30 days of the invoice date.</p></li><li><p>Either party may end this agreement with 14 days written notice.</p></li></ol></section>' +
  '<h2>Notes</h2><div data-editable-region data-variant="plain" data-label="Fill in"><p>Add any extra notes here.</p></div>';

const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  ribbon: true,                                          // the Restrict tab has Author mode to lock and unlock blocks
  plugins: [...defaultPlugins, RestrictedEditing({ lockedClass: 'my-locked' })],   // { authorMode: true } for the template author
});

// editor.execute('toggleAuthorMode');
console.log(editor.getHTML());
`,
  },

  'resume-builder': {
    css: `.cv-host { --cv: #2563eb; } .cv-host .wy-locked[data-variant="cv-head"] { --wy-locked-bar: 0; border-bottom: 2px solid var(--cv); }`,
    html: `<p>
  <label>Accent <input id="accent" type="color" value="#2563eb" /></label>
  <button id="print">Print / Save as PDF</button>
</p>
<div class="cv-host" id="host"><div id="editor"></div></div>`,
    code: `
import { RestrictedEditing, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// Locked headings keep the layout; fill-in regions hold your content.
const section = (title, body) =>
  '<section data-locked data-variant="cv-head" data-label="' + title + '"><h2>' + title + '</h2></section>' +
  '<div data-editable-region data-variant="cv" data-label="Fill in">' + body + '</div>';

const content =
  '<section data-locked data-variant="cv-name" data-label="Name"><h1>Your Name</h1></section>' +
  '<div data-editable-region data-variant="cv" data-label="Contact"><p>email@example.com · +62 000 0000 · City</p></div>' +
  section('Summary', '<p>Two sentences about what you do best.</p>') +
  section('Experience', '<p><strong>Role, Company</strong> — 2022 to now</p><ul><li><p>What you achieved, with a number</p></li></ul>') +
  section('Education', '<p><strong>Degree, School</strong> — 2018</p>') +
  section('Skills', '<p>TypeScript, Node, SQL</p>');

const editor = createEditor({
  element: document.getElementById('editor'),
  content,
  plugins: [...defaultPlugins, RestrictedEditing({ labels: false, authorControls: false })],
  toolbar: ['bold', 'italic', 'link', '|', 'bulletList', 'orderedList'],
});

document.getElementById('accent').addEventListener('input', (e) => document.getElementById('host').style.setProperty('--cv', e.target.value));
document.getElementById('print').addEventListener('click', () => editor.execute('print'));
`,
  },

  'save-endpoint': {
    html: `<p><input id="title" value="Quarterly update" aria-label="Title" /></p>
<div id="editor"></div>`,
    code: `
import { Autosave, Comments, Offline, createEditor, createEndpointSaver, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// Replace the address with your own API. It receives a PUT with JSON { title, html, comments }.
// On 5xx or a network error the save is retried with backoff; on 409 it stops and shows "Conflict".
// Until your server answers, this page just shows a failed save, so point it at a real endpoint.
const API = 'https://example.com/api/posts/1';
const token = 'your-token';

// what your server returned the last time the post was loaded
const post = {
  title: 'Quarterly update',
  html: '<h1>Quarterly update</h1><p>Revenue grew <span data-comment-id="c1">twelve percent</span> this quarter. Select text and add a comment: the thread is saved with the post.</p>',
  comments: [{ id: 'c1', author: 'Ana', text: 'Can we add the source for this number?', createdAt: Date.now() - 3600000, resolved: false, replies: [] }],
};

const title = document.getElementById('title');

const editor = createEditor({
  element: document.getElementById('editor'),
  content: post.html,
  ribbon: { initialTab: 'review' },
  plugins: [
    ...defaultPlugins,
    Comments({ author: 'You', initial: post.comments }),     // saved threads go back in
    Offline({ id: 'post-1' }),                               // keeps a draft on this device until the server has the document
    Autosave({
      delayMs: 600,
      save: createEndpointSaver({ url: API, method: 'PUT', headers: () => ({ Authorization: 'Bearer ' + token }), title: () => title.value }),
    }),
  ],
});

title.addEventListener('input', () => editor.execute('saveNow'));
`,
  },

  slides: {
    css: `.slide { border: 1px solid #ccc; border-radius: 8px; padding: 24px 32px; margin: 12px 0; min-height: 200px; } .nav { display: flex; gap: 8px; align-items: center; }`,
    html: `<div id="editor"></div>
<h2>Slides</h2>
<div class="nav"><button id="prev">Previous</button><span id="pos"></span><button id="next">Next</button></div>
<div id="slide" class="slide"></div>
<p id="notes"></p>`,
    code: `
import { createEditor, defaultPlugins, splitSlides } from 'wysiwygido';
import 'wysiwygido/style.css';

// A horizontal line starts a new slide. A paragraph starting with "Notes:" is a speaker note.
const content =
  '<h1>Small editors, big ideas</h1><p>A talk about modular rich-text editing</p><p>Notes: Welcome everyone.</p><hr>' +
  '<h2>Why modular?</h2><ul><li><p>Ship only what you use</p></li><li><p>Replace one part, not the whole</p></li></ul><p>Notes: Give the bundle-size example here.</p><hr>' +
  '<h2>The plan</h2><ol><li><p>Core engine</p></li><li><p>Plugins</p></li><li><p>Your own UI</p></li></ol><hr>' +
  '<h1>Thank you</h1><p>Questions?</p>';

let slides = [];
let index = 0;

const editor = createEditor({ element: document.getElementById('editor'), plugins: defaultPlugins, content, onChange: render });

function render() {
  slides = splitSlides(editor.getHTML());                  // [{ html, notes, title }]
  index = Math.min(index, slides.length - 1);
  const s = slides[index];
  document.getElementById('slide').innerHTML = s.html;     // the editor already sanitised it
  document.getElementById('notes').textContent = s.notes ? 'Notes: ' + s.notes : '';
  document.getElementById('pos').textContent = index + 1 + ' / ' + slides.length + ' · ' + s.title;
}
document.getElementById('prev').addEventListener('click', () => { index = Math.max(0, index - 1); render(); });
document.getElementById('next').addEventListener('click', () => { index = Math.min(slides.length - 1, index + 1); render(); });
render();
`,
  },

  'source-editing': {
    code: `
import { SourceEditing, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// The "source" button (</>) at the end of the toolbar switches to the HTML. Leaving source mode parses the text
// with the editor's schema, so a script tag or a javascript: link is removed.
const editor = createEditor({
  element: document.getElementById('editor'),
  plugins: [...defaultPlugins, SourceEditing],
  toolbar: ['undo', 'redo', '|', 'bold', 'italic', 'underline', '|', 'heading', 'bulletList', 'orderedList', 'link', 'insertTable', '|', 'source'],
  content: '<h1>Edit the source</h1><p>Press the <code>&lt;/&gt;</code> button, change the HTML, and press it again.</p><ul><li><p>One</p></li><li><p>Two</p></li></ul>',
});

// editor.execute('toggleSource');
`,
  },

  spreadsheet: {
    html: `<div id="editor"></div>
<p><button id="export">Export values (HTML)</button></p>
<pre id="out" hidden></pre>`,
    code: `
import { TableFormulas, computeFormulasInHTML, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

const cell = (t) => '<td><p>' + t + '</p></td>';
const head = (t) => '<th><p>' + t + '</p></th>';
const row = (...c) => '<tr>' + c.map(cell).join('') + '</tr>';

// Columns are A, B, C and rows 1, 2, 3 of each table (the header row is row 1). A cell starting with "=" is a formula.
const content =
  '<h1>Quarterly budget</h1><p>Click a result to see and edit its formula.</p>' +
  '<table><tr>' + ['Item', 'Qty', 'Price', 'Total'].map(head).join('') + '</tr>' +
  row('Laptops', '4', '1200', '=B2*C2') + row('Monitors', '6', '300', '=B3*C3') + row('Desks', '5', '450', '=B4*C4') +
  row('Total', '=SUM(B2:B4)', '=AVERAGE(C2:C4)', '=SUM(D2:D4)') + '</table>' +
  '<p></p><table><tr>' + ['Rule', 'Value'].map(head).join('') + '</tr>' +
  row('Budget limit', '15000') + row('Spent', '8850') + row('Left', '=B2-B3') + row('Over budget?', '=IF(B3>B2,"yes","no")') + '</table>';

const editor = createEditor({ element: document.getElementById('editor'), plugins: [...defaultPlugins, TableFormulas], content });

document.getElementById('export').addEventListener('click', () => {
  const out = document.getElementById('out');
  out.hidden = false;
  out.textContent = computeFormulasInHTML(editor.getHTML());   // formulas replaced by their values
});
`,
  },

  themes: {
    html: `<p id="buttons"></p>
<div id="editor"></div>`,
    code: `
import { createEditor, defaultPlugins, defaultThemes, Themes } from 'wysiwygido';
import 'wysiwygido/style.css';

// your own theme: a few colours, the rest is derived
const brand = {
  name: 'brand',
  label: 'Brand',
  palette: { mode: 'light', bg: '#fff8f0', surface: '#ffeede', fg: '#2a1a10', muted: '#7a5a44', border: '#f0d6bf', accent: '#e8590c', workspace: '#f0d2b8', pageBg: '#ffffff', pageFg: '#2a1a10' },
};

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Pick a look</h1><p>Every theme restyles the toolbar, the ribbon, the panels and the paper.</p><blockquote><p>Switching is instant and never touches the page outside the editor.</p></blockquote>',
  ribbon: true,
  pages: true,
  plugins: [...defaultPlugins.filter((p) => p.name !== 'themes'), Themes({ extra: [brand], initial: 'sepia' })],
});

const buttons = document.getElementById('buttons');
for (const t of [...defaultThemes, brand]) {
  const b = document.createElement('button');
  b.textContent = t.label;
  b.addEventListener('click', () => editor.execute('colorTheme', t.name));
  buttons.append(b, ' ');
}
const next = document.createElement('button');
next.textContent = 'Next';
next.addEventListener('click', () => editor.execute('cycleColorTheme'));
buttons.append(next);
`,
  },

  'web-component': {
    html: `<form id="post">
  <wysiwyg-editor name="body" value="<p>Hello from a web component.</p>" ribbon paged></wysiwyg-editor>
  <p>
    <button type="submit">Submit the form</button>
    <button type="button" id="dark">Toggle dark</button>
    <button type="button" id="ro">Toggle read-only</button>
  </p>
</form>
<pre id="events"></pre>
<pre id="sent"></pre>`,
    code: `
import { defineEditorElement } from 'wysiwygido';
import 'wysiwygido/style.css';

defineEditorElement();                                      // registers <wysiwyg-editor> (or pass your own tag name)

const el = document.querySelector('wysiwyg-editor');
const events = document.getElementById('events');
const log = (text) => { events.textContent = new Date().toLocaleTimeString() + '  ' + text + '\\n' + events.textContent; };

el.addEventListener('editor-ready', () => log('editor-ready'));
el.addEventListener('editor-change', (e) => log('editor-change (' + e.detail.html.length + ' characters)'));

// the editor takes part in the form under its name attribute
document.getElementById('post').addEventListener('submit', (e) => {
  e.preventDefault();
  document.getElementById('sent').textContent = JSON.stringify(Object.fromEntries(new FormData(e.target).entries()), null, 2);
});
document.getElementById('dark').addEventListener('click', () => el.editor.setTheme(el.editor.theme === 'dark' ? 'light' : 'dark'));
document.getElementById('ro').addEventListener('click', () => { el.readOnly = !el.readOnly; });
`,
  },

  wiki: {
    css: `.wiki { display: grid; grid-template-columns: 220px 1fr; gap: 20px; } #nav { list-style: none; padding: 0; } #nav button.on { font-weight: bold; }`,
    html: `<div class="wiki">
  <div>
    <h2>Pages</h2>
    <input id="search" placeholder="Search pages…" aria-label="Search" />
    <ul id="nav"></ul>
    <button id="new">New page</button>
    <h3>Linked from</h3>
    <ul id="back"></ul>
  </div>
  <div id="editor"></div>
</div>`,
    code: `
import { Versions, askDialog, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// Pages live in this browser (localStorage). Links between pages use href="#wiki:Page name".
const KEY = 'my-wiki';
const link = (t) => '<a href="#wiki:' + encodeURIComponent(t) + '">' + t + '</a>';
const pages = {
  Home: '<h1>Home</h1><p>Welcome to the team wiki. Start with ' + link('Onboarding') + ' or read the ' + link('Style guide') + '.</p><div data-toc></div>',
  Onboarding: '<h1>Onboarding</h1><h2>Week one</h2><ul><li><p>Get access</p></li><li><p>Read the ' + link('Style guide') + '</p></li></ul><p>Back to ' + link('Home') + '.</p>',
  'Style guide': '<h1>Style guide</h1><p>Short sentences. Active voice. See ' + link('Onboarding') + '.</p>',
};
try { Object.assign(pages, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* storage blocked or corrupt: use the samples */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pages)); } catch { /* ignore */ } };

let current = 'Home';
const editor = createEditor({
  element: document.getElementById('editor'),
  plugins: [...defaultPlugins, Versions({ author: 'You' })],
  content: pages[current],
  onChange: () => { pages[current] = editor.getHTML(); save(); backlinks(); },
});

const search = document.getElementById('search');
const nav = document.getElementById('nav');
const back = document.getElementById('back');
const item = (name, on) => {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.textContent = name;
  b.className = on ? 'on' : '';
  b.addEventListener('click', () => open(name));
  li.append(b);
  return li;
};

function open(name) {
  current = name;
  editor.setHTML(pages[name] ?? '<p></p>');
  renderNav();
  backlinks();
}
function renderNav() {
  const q = search.value.toLowerCase();
  nav.replaceChildren(...Object.keys(pages).filter((n) => !q || n.toLowerCase().includes(q) || pages[n].toLowerCase().includes(q)).sort().map((n) => item(n, n === current)));
}
function backlinks() {
  const needle = '#wiki:' + encodeURIComponent(current);
  const from = Object.keys(pages).filter((n) => n !== current && pages[n].includes(needle));
  back.replaceChildren(...from.map((n) => item(n, false)));
}

search.addEventListener('input', renderNav);
document.getElementById('new').addEventListener('click', async () => {
  const name = await askDialog(editor.root, { title: 'New page', label: 'Page name', submitLabel: 'Create', validate: (v) => (v in pages ? 'A page with this name already exists.' : null) });
  if (name) { pages[name] = '<h1>' + name.replace(/[<&]/g, '') + '</h1><p></p>'; save(); open(name); }
});
// a click on a page link opens the page instead of navigating
editor.view.dom.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#wiki:"]');
  if (!a) return;
  e.preventDefault();
  open(decodeURIComponent(a.getAttribute('href').slice(6)));
});
renderNav();
backlinks();
`,
  },

  'file-manager': {
    html: `<p><button id="open">Open file library</button></p>
<div id="editor"></div>`,
    code: `
import { FileManager, createEditor, createFileStore, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// Files are kept in this browser (IndexedDB). Nothing is uploaded anywhere.
// For a server, write your own FileStore, or give attachments an address with
// FileManager({ store, resolveUrl: async (file, blob) => (await upload(blob)).url })
const store = createFileStore('my-files');

// a sample picture and note so there is something in the library on first visit
if (!(await store.list()).length) {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 800;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1200, 800);
  grad.addColorStop(0, '#0ea5e9');
  grad.addColorStop(1, '#8b5cf6');
  g.fillStyle = grad; g.fillRect(0, 0, 1200, 800);
  g.fillStyle = '#fff'; g.font = '700 100px system-ui, sans-serif'; g.fillText('Mountains', 60, 740);
  const png = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  await store.put(png, { name: 'mountains.png', width: 1200, height: 800 });
  await store.put(new Blob(['Meeting notes\\n\\n- Ship the beta on Friday\\n'], { type: 'text/plain' }), { name: 'meeting-notes.txt' });
}

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Field report</h1><p>Open the file library, insert a picture, then click it and choose Picture, Edit image.</p><p></p>',
  plugins: [...defaultPlugins, FileManager({ store, maxFileSize: 10 * 1024 * 1024 })],
  ribbon: true,
});

document.getElementById('open').addEventListener('click', () => editor.execute('openFiles'));   // editor.execute('editImage') edits the selected picture
`,
  },

  'image-editor': {
    css: `#result { display: flex; gap: 16px; flex-wrap: wrap; } #result img { max-width: 320px; }`,
    html: `<p>
  <button id="pick">Choose a picture…</button>
  <button id="sample">Use a sample picture</button>
  <input id="file" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
</p>
<p id="msg"></p>
<div id="result"></div>`,
    code: `
import { formatBytes, openImageEditor } from 'wysiwygido';
import 'wysiwygido/style.css';

// The image editor works on its own. It resolves with { blob, width, height, type }, or null when cancelled.
const msg = document.getElementById('msg');
const result = document.getElementById('result');
const input = document.getElementById('file');

function sample() {
  const c = document.createElement('canvas');
  c.width = 1400; c.height = 900;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1400, 900);
  grad.addColorStop(0, '#0ea5e9'); grad.addColorStop(0.55, '#8b5cf6'); grad.addColorStop(1, '#f43f5e');
  g.fillStyle = grad; g.fillRect(0, 0, 1400, 900);
  g.fillStyle = '#fff'; g.font = '700 110px system-ui, sans-serif'; g.fillText('Edit me', 80, 780);
  return c.toDataURL('image/png');
}

async function edit(source, name) {
  msg.textContent = '';
  try {
    const r = await openImageEditor(document.body, { source, name, saveLabel: 'Done' });   // source: a File/Blob, a data: URL or an https URL (needs CORS)
    if (!r) { msg.textContent = 'Cancelled: nothing changed.'; return; }
    const img = document.createElement('img');
    img.src = URL.createObjectURL(r.blob);
    img.alt = 'Edited picture';
    const caption = document.createElement('p');
    caption.textContent = r.width + ' x ' + r.height + ' px, ' + formatBytes(r.blob.size) + ', ' + r.type;
    result.replaceChildren(img, caption);   // upload r.blob to your server here
  } catch (e) {
    msg.textContent = e instanceof Error ? e.message : 'The picture could not be opened.';
  }
}

document.getElementById('pick').addEventListener('click', () => input.click());
document.getElementById('sample').addEventListener('click', () => edit(sample(), 'sample.png'));
input.addEventListener('change', () => { const f = input.files[0]; if (f) edit(f, f.name); input.value = ''; });
`,
  },

  dialogs: {
    html: `<p><button id="name">Ask for a name</button> <button id="email">Ask for an email</button> <button id="comment">Comment style</button></p>
<p id="result">Results appear here.</p>
<div id="editor"></div>`,
    code: `
import { Comments, Footnotes, Versions, askDialog, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

// askDialog(root, options) replaces window.prompt. It resolves with the text, or null when cancelled.
const root = document.body;
const result = document.getElementById('result');
const show = (what, v) => { result.textContent = what + ': ' + (v === null ? 'cancelled (null)' : JSON.stringify(v)); };

document.getElementById('name').addEventListener('click', async () => {
  show('name', await askDialog(root, { title: 'Your name', label: 'Name', placeholder: 'e.g. Ana', submitLabel: 'Save', maxLength: 60 }));
});
document.getElementById('email').addEventListener('click', async () => {
  show('email', await askDialog(root, {
    title: 'Invite someone', label: 'Email', description: 'We will send them a link.', submitLabel: 'Invite',
    validate: (v) => (/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(v) ? null : 'That does not look like an email address.'),   // checked before the dialog closes
  }));
});
document.getElementById('comment').addEventListener('click', async () => {
  show('comment', await askDialog(root, {
    title: 'Add a comment', quote: 'Revenue grew twelve percent this quarter.', author: 'Ana Lestari',
    multiline: true, placeholder: 'Write a comment…', submitLabel: 'Comment',   // Ctrl/Cmd+Enter sends
  }));
});

// the editor opens the same dialogs for comments, links, footnotes and version names
createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Try the dialogs</h1><p>Select this sentence and press Comment in the Review tab, or Link in the Insert tab.</p><p>Add a footnote here, or save a version of this document.</p>',
  plugins: [...defaultPlugins, Comments({ author: 'You' }), Footnotes, Versions({ author: 'You' })],
  ribbon: { initialTab: 'review' },
});
`,
  },
};
