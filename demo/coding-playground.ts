import { CodeBlocks, createEditor, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';

const preview = el('iframe', { class: 'preview', title: 'Live preview', style: 'height:420px' });
preview.setAttribute('sandbox', 'allow-scripts'); // runs the user's JS but cannot touch this page
const consoleOut = el('pre', { class: 'out', style: 'min-height:70px;margin-top:8px', textContent: 'Console output appears here.' });

$('#app').append(
  el('div', { class: 'demo-note' }, 'A mini playground: edit the HTML, CSS and JavaScript blocks and the preview updates as you type. The preview is a sandboxed iframe; ', el('code', {}, 'console.log'), ' is forwarded to the console below.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'cols' }, el('div', { class: 'panel' }, el('div', { id: 'editor' })), el('div', { class: 'panel' }, el('h2', {}, 'Preview'), preview, consoleOut)),
);

const START = `<h2>HTML</h2>
<pre data-language="html"><code>&lt;button id="go"&gt;Click me&lt;/button&gt;
&lt;p id="out"&gt;Clicks: 0&lt;/p&gt;</code></pre>
<h2>CSS</h2>
<pre data-language="css"><code>body { font-family: system-ui; padding: 24px; }
button {
  padding: 10px 18px;
  border: 0;
  border-radius: 8px;
  background: #2563eb;
  color: #fff;
  font-size: 16px;
}
#out { color: #16a34a; font-weight: 600; }</code></pre>
<h2>JavaScript</h2>
<pre data-language="javascript"><code>let n = 0;
document.getElementById('go').addEventListener('click', () =&gt; {
  n++;
  document.getElementById('out').textContent = 'Clicks: ' + n;
  console.log('clicked', n);
});</code></pre>`;

const editor = createEditor({ element: $('#editor'), theme: 'dark', toolbar: false, plugins: [...defaultPlugins, CodeBlocks()], content: START, onChange: schedule });

/** Collect the text of every code block, grouped by language. */
function blocks() {
  const by: Record<string, string> = { html: '', css: '', javascript: '' };
  editor.view.state.doc.descendants((n) => {
    const lang = n.attrs.language as string | null;
    if (n.type.name === 'code_block' && lang && lang in by) by[lang] += n.textContent + '\n';
  });
  return by;
}

let timer: ReturnType<typeof setTimeout>;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(render, 250);
}

function render() {
  const { html, css, javascript } = blocks();
  consoleOut.textContent = '';
  // The code is data inside a sandboxed document; a closing tag in it can only end the author's own script.
  const safeJs = javascript.replace(/<\/(script)/gi, '<\\/$1');
  const safeCss = css.replace(/<\/(style)/gi, '<\\/$1');
  preview.srcdoc =
    `<!doctype html><meta charset="utf-8"><style>${safeCss}</style>${html}` +
    `<script>for (const k of ['log','warn','error']) { const o = console[k]; console[k] = (...a) => { parent.postMessage({ playground: true, k, text: a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }, '*'); o.apply(console, a); }; }` +
    `addEventListener('error', (e) => parent.postMessage({ playground: true, k: 'error', text: e.message }, '*'));<\/script>` +
    `<script>${safeJs}<\/script>`;
}

window.addEventListener('message', (e) => {
  if (e.source !== preview.contentWindow || !e.data?.playground) return;
  consoleOut.textContent += `${e.data.k === 'log' ? '' : e.data.k + ': '}${e.data.text}\n`;
});

$('#actions').append(
  button('Reset', () => (editor.setHTML(START), render())),
  button('Refresh preview', render, true),
);
render();

$('#app').append(
  codePanel(`
// collect each block's text by language, then feed it to a sandboxed iframe
editor.view.state.doc.descendants((node) => {
  if (node.type.name === 'code_block') code[node.attrs.language] += node.textContent;
});
iframe.setAttribute('sandbox', 'allow-scripts');
iframe.srcdoc = \`<style>\${css}</style>\${html}<script>\${js}<\\/script>\`;`),
);
