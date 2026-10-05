import { createEditor, defaultPlugins, definePlugin, registerIcon, type ToolbarEntry, type ToolbarOptions } from '../src';
import { $, codePanel, el } from './samples';

// ---- A plugin written by "someone else": everything it needs is in one object ------------------------------------------
registerIcon('callout', '<rect x="3.5" y="5" width="17" height="14" rx="2.500"/><path d="M8 10h8M8 14h5"/>');

const KINDS = ['info', 'warning', 'danger', 'success'] as const;

const Callout = definePlugin({
  name: 'callout',

  // 1. the document model
  nodes: {
    callout: {
      group: 'block',
      content: 'block+',
      defining: true,
      attrs: { kind: { default: 'info' } },
      parseDOM: [{ tag: 'aside.callout', getAttrs: (n) => ({ kind: KINDS.find((k) => k === (n as HTMLElement).dataset.kind) ?? 'info' }) }],
      toDOM: (n) => ['aside', { class: 'callout', 'data-kind': n.attrs.kind }, 0],
    },
  },

  // 2. behaviour: commands (and any ProseMirror plugins you want to return)
  setup(editor) {
    editor.registerCommand('insertCallout', (e, kind: string = 'info') => {
      const { state, dispatch } = e.view;
      const { $from, $to } = state.selection;
      const range = $from.blockRange($to);
      if (!range) return false;
      dispatch(state.tr.wrap(range, [{ type: state.schema.nodes.callout, attrs: { kind: KINDS.find((k) => k === kind) ?? 'info' } }]).scrollIntoView());
      return true;
    });
  },

  // 3. toolbar buttons (the compact toolbar can place them by name)
  toolbar: [
    { name: 'calloutInfo', label: 'Info callout', icon: 'ℹ️', command: 'insertCallout', args: ['info'] },
    { name: 'calloutWarning', label: 'Warning callout', icon: '⚠️', command: 'insertCallout', args: ['warning'] },
  ],

  // 4. keyboard shortcut
  keymap: { 'Mod-Alt-c': 'insertCallout' },

  // 5. a group in the ribbon, on a tab of its own
  ribbon: {
    tab: 'extras',
    tabLabel: 'Extras',
    group: {
      id: 'callouts',
      label: 'Callouts',
      controls: KINDS.map((k) => ({ kind: 'command' as const, id: `callout-${k}`, command: 'insertCallout', args: [k], label: k[0].toUpperCase() + k.slice(1), icon: 'callout', size: 'large' as const })),
    },
  },
});

/** Another plugin: listens to editor events and keeps a live word-goal badge. Cleans up after itself. */
const WordGoal = (goal: number) => definePlugin({
  name: 'word-goal',
  requires: ['word-count'], // fails fast, with a clear message, when the plugin it needs is missing
  onReady(editor) {
    const badge = el('div', { class: 'goal' }, el('progress', { max: goal, value: 0 }), el('span', {}, ''));
    editor.root.after(badge);
    const update = () => {
      const words = editor.getStats().words;
      (badge.querySelector('progress') as HTMLProgressElement).value = Math.min(goal, words);
      badge.querySelector('span')!.textContent = `${words} / ${goal} words${words >= goal ? ' ✓ goal reached' : ''}`;
    };
    update();
    const off = editor.on('change', update); // 'ready', 'change', 'selection', 'focus', 'blur', 'command', 'destroy'
    (badge as unknown as { off: () => void }).off = off;
    (editor as unknown as { __badge: HTMLElement }).__badge = badge;
  },
  destroy(editor) {
    (editor as unknown as { __badge?: HTMLElement }).__badge?.remove();
  },
});

// ---- Toolbar layout playground -------------------------------------------------------------------------------------
const PRESETS: Record<string, ToolbarEntry[] | undefined> = {
  default: undefined,
  minimal: ['bold', 'italic', 'link'],
  grouped: [
    { group: 'Text', items: ['bold', 'italic', 'underline', 'strike'] },
    { group: 'Blocks', items: ['heading', 'bulletList', 'orderedList', 'blockQuote'] },
    { group: 'Insert', items: ['link', 'image', 'insertTable', 'calloutInfo', 'calloutWarning'] },
    '>',
    { name: 'clear', label: 'Clear all', icon: '🧹', run: (e) => e.setHTML('<p></p>') },
  ],
  'two rows': ['bold', 'italic', 'underline', '|', 'heading', '-', 'bulletList', 'orderedList', '|', 'link', 'image', '>', 'calloutInfo', 'calloutWarning'],
};

const select = (label: string, id: string, options: string[]) => el('label', {}, label, el('select', { id }, ...options.map((o) => el('option', { value: o, textContent: o }))));
const sticky = el('input', { type: 'checkbox', id: 'sticky' });
const code = el('pre', { class: 'out' });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Left: a compact toolbar you can rearrange. Below it, a ribbon editor shows the same plugin adding an ', el('strong', {}, 'Extras'), ' tab. Select text and press ', el('code', {}, 'Ctrl/Cmd+Alt+C'), ' for a callout.'),
  el('div', { class: 'playground' }, select('Layout', 'preset', Object.keys(PRESETS)), select('Position', 'position', ['top', 'bottom']), select('When it does not fit', 'overflow', ['wrap', 'more', 'scroll']), select('Align', 'align', ['start', 'center', 'end']), el('label', {}, 'Sticky', sticky)),
  el('div', { class: 'panel', style: 'resize:horizontal;overflow:auto;max-width:100%' }, el('div', { id: 'editor' })),
  el('h2', { style: 'font-size:15px;margin:16px 0 6px' }, 'The configuration'),
  code,
  el('h2', { style: 'font-size:15px;margin:16px 0 6px' }, 'Same plugin in the ribbon'),
  el('div', { class: 'panel' }, el('div', { id: 'ribbon' })),
);

const content = '<h1>Release notes</h1><p>Select a paragraph and wrap it in a callout with the buttons, the shortcut, or the Extras tab.</p><p>Drag the right edge of the editor panel to make it narrower and try the "more" overflow.</p>';
const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, Callout, WordGoal(60)], toolbar: { overflow: 'wrap' } });
(window as unknown as { editor: typeof editor }).editor = editor;

function apply() {
  const v = (id: string) => ($(`#${id}`) as HTMLSelectElement).value;
  const opts: ToolbarOptions = { items: PRESETS[v('preset')], position: v('position') as 'top' | 'bottom', overflow: v('overflow') as 'wrap' | 'more' | 'scroll', align: v('align') as 'start' | 'center' | 'end', sticky: sticky.checked };
  editor.setToolbar(opts);
  const shown = { ...opts, items: opts.items ?? '(every plugin item, in order)' };
  code.textContent = `createEditor({\n  plugins: [...defaultPlugins, Callout],\n  toolbar: ${JSON.stringify(shown, (_k, val) => (typeof val === 'function' ? '[Function]' : val), 2).replace(/\n/g, '\n  ')},\n});\n\n// or later: editor.setToolbar({ ... })`;
}
for (const id of ['preset', 'position', 'overflow', 'align']) $(`#${id}`).addEventListener('change', apply);
sticky.addEventListener('change', apply);
apply();

createEditor({ element: $('#ribbon'), content: '<p>Open the <strong>Extras</strong> tab: its group comes from the plugin, not from the library.</p>', plugins: [...defaultPlugins, Callout], ribbon: true });

$('#app').append(codePanel(`
const MyPlugin = definePlugin({
  name: 'my-plugin',
  requires: ['word-count'],                 // fails fast if a dependency is missing
  nodes: { /* ProseMirror NodeSpec */ },
  marks: { /* ProseMirror MarkSpec */ },
  setup(editor) {                           // register commands, return ProseMirror plugins
    editor.registerCommand('hello', () => true);
  },
  toolbar: [{ name: 'hello', label: 'Hello', icon: '👋', command: 'hello' }],
  keymap: { 'Mod-Alt-h': 'hello' },
  ribbon: { tab: 'insert', after: 'tables', group: { id: 'hello', label: 'Hello', controls: [/* ... */] } },
  onReady(editor) { editor.on('change', () => {}); },   // events: ready change selection focus blur command destroy
  destroy(editor) { /* remove what you added */ },
});

createEditor({ element, plugins: [...defaultPlugins, MyPlugin],
  toolbar: { items: [{ group: 'Text', items: ['bold', 'italic'] }, '-', 'hello', '>', { name: 'x', label: 'X', icon: '✕', run: (e) => {} }],
             position: 'bottom', overflow: 'more', sticky: true } });
`));
