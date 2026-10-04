import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { CodeBlocks, createEditor, defaultPlugins, type EditorPlugin } from '../src';
import { $, Kernel, button, codePanel, el } from './samples';

const kernel = new Kernel();

interface Output { code: string; lines: string[]; error?: string; running?: boolean }
/** Outputs live outside the document, keyed by the cell's position among the code blocks. */
const outputs = new Map<number, Output>();

/** Shows a widget under each code cell while its code is unchanged since the run (an edit makes the output stale). */
const Outputs: EditorPlugin = {
  name: 'notebook-outputs',
  setup() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            let ordinal = 0;
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'code_block') return;
              const o = outputs.get(ordinal++);
              if (!o || (o.code !== node.textContent && !o.running)) return false;
              decos.push(
                Decoration.widget(
                  pos + node.nodeSize,
                  () => {
                    const box = el('div', { class: `nb-output${o.error ? ' is-error' : ''}`, contentEditable: 'false' });
                    box.textContent = o.running ? 'Running…' : [...o.lines, o.error ? `✖ ${o.error}` : ''].filter(Boolean).join('\n') || '(no output)';
                    return box;
                  },
                  { side: 1, key: `out-${ordinal}-${o.running}-${o.lines.join('|')}-${o.error}` },
                ),
              );
              return false;
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
};

let editor: ReturnType<typeof createEditor>;
const cells = () => {
  const list: string[] = [];
  editor.view.state.doc.descendants((n) => void (n.type.name === 'code_block' && list.push(n.textContent)));
  return list;
};
const redraw = () => editor.view.dispatch(editor.view.state.tr.setMeta('addToHistory', false));

async function runCell(index: number) {
  const code = cells()[index];
  if (code === undefined) return;
  outputs.set(index, { code, lines: [], running: true });
  redraw();
  outputs.set(index, { code, ...(await kernel.run(code)) });
  redraw();
}

$('#app').append(
  el('style', {}, '.nb-output{margin:-6px 0 16px;padding:8px 12px;border-left:3px solid #4ade80;background:rgba(74,222,128,.08);font:13px/1.5 ui-monospace,Menlo,monospace;white-space:pre-wrap;color:var(--wy-page-fg)}.nb-output.is-error{border-color:#f87171;background:rgba(248,113,113,.1)}'),
  el('div', { class: 'demo-note' }, 'A notebook: prose and runnable cells in one document. ', el('strong', {}, '▶ Run'), ' executes a cell in a shared sandboxed kernel, so later cells can use ', el('code', {}, 'var'), ' variables and functions defined earlier (use ', el('code', {}, 'var'), ', not ', el('code', {}, 'let'), ', to share). An output disappears when you edit its cell.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);

editor = createEditor({
  element: $('#editor'),
  theme: 'dark',
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic', 'code', '|', 'bulletList', 'codeBlock'],
  plugins: [
    ...defaultPlugins,
    CodeBlocks({
      actions: [
        {
          label: '▶ Run',
          languages: ['javascript'],
          run: (code) => {
            // Find the cell by position: the first block with this text that has not been counted yet.
            let found = -1;
            let n = 0;
            editor.view.state.doc.descendants((node) => {
              if (node.type.name !== 'code_block') return;
              if (found < 0 && node.textContent === code) found = n;
              n++;
            });
            void runCell(Math.max(0, found));
          },
        },
      ],
    }),
    Outputs,
  ],
  content: `<h1>Sorting, step by step</h1>
<p>Define some data. Variables declared with <code>var</code> stay available to the next cells.</p>
<pre data-language="javascript"><code>var people = [
  { name: 'Ana', age: 31 },
  { name: 'Budi', age: 24 },
  { name: 'Citra', age: 28 },
];
console.log(people.length + ' people');</code></pre>
<p>Now sort by age and print the result. The last expression is shown as the result.</p>
<pre data-language="javascript"><code>var byAge = [...people].sort((a, b) =&gt; a.age - b.age);
console.log(byAge.map((p) =&gt; p.name + ' (' + p.age + ')').join(', '));
byAge[0].name</code></pre>
<p>A function, and an error on purpose:</p>
<pre data-language="javascript"><code>function mean(xs) {
  return xs.reduce((s, x) =&gt; s + x, 0) / xs.length;
}
console.log(mean(people.map((p) =&gt; p.age)));
mean(undefined);</code></pre>`,
});

$('#actions').append(
  button(
    '▶ Run all cells',
    async () => {
      for (let i = 0; i < cells().length; i++) await runCell(i);
    },
    true,
  ),
  button('Reset kernel', () => (kernel.reset(), outputs.clear(), redraw())),
);

$('#app').append(
  codePanel(`
// Outputs are widget decorations, not document content, so they never reach the saved HTML.
Decoration.widget(pos + node.nodeSize, () => outputElement(result), { side: 1 })

// The kernel is a sandboxed iframe that only talks through postMessage.
iframe.setAttribute('sandbox', 'allow-scripts'); // no same-origin access to your page
iframe.contentWindow.postMessage({ id, code }, '*');`),
);
