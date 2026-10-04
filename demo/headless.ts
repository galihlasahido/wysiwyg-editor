import { createEditor, defaultPlugins } from '../src';
import { $, button, el } from './samples';

const stats = el('pre', { class: 'out' });
const bar = el('div', { class: 'actions' });
$('#app').append(
  el('div', { class: 'demo-note' }, el('strong', {}, 'No built-in toolbar.'), ' This UI is plain HTML calling ', el('code', {}, 'editor.execute(name)'), ' and reading ', el('code', {}, 'editor.view.state'), '. Anything the ribbon can do is available as a command.'),
  bar,
  el('div', { class: 'cols' }, el('div', { class: 'panel' }, el('div', { id: 'editor' })), el('div', { class: 'panel' }, el('h2', {}, 'Live state'), stats)),
);

const editor = createEditor({ element: $('#editor'), toolbar: false, plugins: defaultPlugins, content: '<h2>Build your own UI</h2><p>Select some text and use the buttons above.</p>', onChange: refresh });

const marks = ['bold', 'italic', 'underline'] as const;
const buttons = new Map<string, HTMLButtonElement>();
for (const m of marks) {
  const b = button(m, () => editor.execute(m));
  buttons.set(m, b);
  bar.append(b);
}
bar.append(button('Heading 2', () => editor.execute('heading', '2')), button('Paragraph', () => editor.execute('heading', 'paragraph')), button('Bulleted list', () => editor.execute('bulletList')), button('Undo', () => editor.execute('undo')), button('Redo', () => editor.execute('redo')));

function refresh() {
  const { state } = editor.view;
  const { $from, from, to, empty } = state.selection;
  const active = state.storedMarks ?? (empty ? $from.marks() : state.doc.nodeAt(from)?.marks ?? []);
  for (const m of marks) buttons.get(m)!.classList.toggle('primary', active.some((x) => x.type.name === m));
  const s = editor.getStats();
  stats.textContent = JSON.stringify({ selection: { from, to, empty }, block: $from.parent.type.name, ...s, html: editor.getHTML().slice(0, 140) }, null, 2);
}
// The editor reports content changes via onChange; selection changes come from the view.
editor.view.dom.addEventListener('keyup', refresh);
editor.view.dom.addEventListener('mouseup', refresh);
refresh();
