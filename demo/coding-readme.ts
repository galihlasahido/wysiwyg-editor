import { CodeBlocks, createEditor, defaultPlugins, download } from '../src';
import { $, button, codePanel, el } from './samples';

const md = el('textarea', { class: 'out', rows: 30, spellcheck: false, 'aria-label': 'README.md' });

$('#app').append(
  el('div', { class: 'demo-note' }, 'Write a README visually and get GitHub-flavoured Markdown, or edit the Markdown and see it rendered. Code blocks keep their language in the fence (for example ', el('code', {}, 'typescript'), ' after the opening backticks).'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'cols' }, el('div', { class: 'panel' }, el('h2', {}, 'Visual'), el('div', { id: 'editor' })), el('div', { class: 'panel' }, el('h2', {}, 'README.md'), md)),
);

const editor = createEditor({
  element: $('#editor'),
  theme: 'auto',
  plugins: [...defaultPlugins, CodeBlocks()],
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic', 'code', 'link', '|', 'bulletList', 'orderedList', 'codeBlock', 'blockQuote'],
  onChange: () => document.activeElement !== md && (md.value = editor.getMarkdown()),
  content: `<h1>tiny-cache</h1><p>An in-memory cache with TTL and a 40-line implementation.</p><h2>Install</h2><pre data-language="bash"><code>npm install tiny-cache</code></pre><h2>Usage</h2><pre data-language="typescript"><code>import { Cache } from 'tiny-cache';

const cache = new Cache&lt;string&gt;({ ttl: 60_000 });
cache.set('a', 'hello');
console.log(cache.get('a')); // "hello"</code></pre><h2>API</h2><ul><li><p><code>set(key, value, ttl?)</code>: store a value</p></li><li><p><code>get(key)</code>: read it, or <code>undefined</code> when expired</p></li><li><p><code>clear()</code>: remove everything</p></li></ul><blockquote><p>Zero dependencies. MIT licensed.</p></blockquote>`,
});
md.value = editor.getMarkdown();

let timer: ReturnType<typeof setTimeout>;
md.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => editor.setMarkdown(md.value), 250);
});

$('#actions').append(
  button('Download README.md', () => download(editor.getMarkdown(), 'README.md', 'text/markdown'), true),
  button('Copy Markdown', async () => navigator.clipboard?.writeText(editor.getMarkdown())),
);

$('#app').append(
  codePanel(`
const editor = createEditor({ element, plugins: [...defaultPlugins, CodeBlocks()] });

editor.getMarkdown();        // fenced blocks keep their language
editor.setMarkdown(source);  // a fence with a language becomes a code block with that language`),
);
