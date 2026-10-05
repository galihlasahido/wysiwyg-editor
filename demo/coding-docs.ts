import { CodeBlocks, createEditor, defaultPlugins } from '../src';
import { $, Kernel, codePanel, el } from './samples';

const out = el('pre', { class: 'out', style: 'min-height:90px', textContent: 'Press Run on a JavaScript block.' });
$('#app').append(
  el('div', { class: 'demo-note' }, 'A developer-docs editor. Code blocks have a language picker, syntax highlighting, ', el('strong', {}, 'Copy'), ', and (for JavaScript) ', el('strong', {}, '▶ Run'), ', which executes in a sandboxed iframe. ', el('kbd', {}, 'Tab'), ' indents; ', el('kbd', {}, 'Enter'), ' keeps the indentation and adds a level after ', el('code', {}, '{'), ' or ', el('code', {}, ':'), '. Type three backticks and a language name, then a space, to start a block.'),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  el('div', { class: 'panel', style: 'margin-top:12px' }, el('h2', {}, 'Console'), out),
);

const kernel = new Kernel();

createEditor({
  element: $('#editor'),
  theme: 'dark',
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic', 'code', 'link', '|', 'bulletList', 'orderedList', 'codeBlock', 'insertTable'],
  plugins: [
    ...defaultPlugins,
    CodeBlocks({
      actions: [
        {
          label: '▶ Run',
          title: 'Run in a sandboxed iframe',
          languages: ['javascript'],
          run: async (code) => {
            out.textContent = 'Running…';
            const r = await kernel.run(code);
            out.textContent = [...r.lines, r.error ? `✖ ${r.error}` : ''].filter(Boolean).join('\n') || '(no output)';
          },
        },
      ],
    }),
  ],
  content: `<h1>Retry helper</h1>
<p>A tiny wrapper around <code>fetch</code> that retries on network errors and 5xx responses with exponential backoff.</p>
<h2>Install</h2>
<pre data-language="bash"><code># from your project root
npm install @acme/retry-fetch
export RETRY_MAX=3</code></pre>
<h2>Usage</h2>
<pre data-language="typescript"><code>import { retryFetch } from '@acme/retry-fetch';

interface User { id: number; name: string }

async function load(id: number): Promise&lt;User&gt; {
  const res = await retryFetch(\`/api/users/\${id}\`, { retries: 3 });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}</code></pre>
<h2>Try the backoff</h2>
<p>This block is plain JavaScript, so <strong>Run</strong> works. Change the numbers and run it again.</p>
<pre data-language="javascript"><code>const delays = [];
for (let attempt = 0; attempt &lt; 5; attempt++) {
  delays.push(100 * 2 ** attempt); // 100, 200, 400, ...
}
console.log('delays (ms):', delays);
console.log({ total: delays.reduce((a, b) =&gt; a + b, 0) });</code></pre>
<h2>Response</h2>
<pre data-language="json"><code>{
  "id": 42,
  "name": "Ada",
  "active": true,
  "tags": ["admin", "beta"],
  "lastLogin": null
}</code></pre>
<h2>Python equivalent</h2>
<pre data-language="python"><code>import time, requests

def retry_get(url, retries=3):
    for attempt in range(retries):
        try:
            return requests.get(url, timeout=5)
        except requests.RequestException:
            time.sleep(0.1 * 2 ** attempt)
    raise RuntimeError("giving up")</code></pre>`,
});

$('#app').append(
  codePanel(`
import { CodeBlocks, createEditor, defaultPlugins } from 'wysiwygido';

createEditor({
  element,
  theme: 'dark',
  plugins: [
    ...defaultPlugins,
    CodeBlocks({
      // optional: use your own highlighter (highlight.js, Shiki, ...)
      // highlight: (code, language) => [{ from: 0, to: 5, type: 'keyword' }],
      actions: [{ label: '▶ Run', languages: ['javascript'], run: (code) => runInSandbox(code) }],
    }),
  ],
});`),
);
