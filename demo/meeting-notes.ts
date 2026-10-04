import { Comments, Mentions, SlashCommands, Templates, createEditor, defaultPlugins } from '../src';
import { $, PEOPLE, button, codePanel, el } from './samples';

const list = el('ul', { class: 'tips', style: 'list-style:none;padding:0' });
const summary = el('div', { class: 'status' });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Pick a ', el('strong', {}, 'Template'), ' or write freely. Type ', el('code', {}, '@'), ' to mention a teammate. Every checklist item becomes an action item on the right.'),
  el('div', { class: 'cols' }, el('div', { class: 'panel' }, el('div', { id: 'editor' })), el('div', { class: 'panel' }, el('h2', {}, 'Action items'), summary, list, el('div', { class: 'actions', id: 'actions' }))),
);

const editor = createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, Templates(), SlashCommands(), Mentions({ search: (q) => PEOPLE.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())) }), Comments({ author: 'You' })],
  content: '<h1>Weekly sync</h1><p><strong>Date:</strong> Monday</p><p><strong>Attendees:</strong> @Ana, @Budi</p><h2>Decisions</h2><ul><li><p>Ship the beta on Friday</p></li></ul><h2>Action items</h2><ul data-task-list><li data-task data-checked="true"><p>@Ana writes the release notes</p></li><li data-task data-checked="false"><p>@Budi books the demo room</p></li><li data-task data-checked="false"><p>Review the pricing page</p></li></ul>',
  onChange: render,
});

type Item = { text: string; done: boolean };
const items = (): Item[] => [...new DOMParser().parseFromString(editor.getHTML(), 'text/html').querySelectorAll('li[data-task]')].map((li) => ({ text: li.textContent!.trim(), done: li.getAttribute('data-checked') === 'true' })).filter((i) => i.text);
function render() {
  const all = items();
  summary.textContent = `${all.filter((i) => i.done).length} of ${all.length} done`;
  list.replaceChildren(...all.map((i) => el('li', { style: `padding:4px 0;${i.done ? 'text-decoration:line-through;opacity:.6' : ''}` }, `${i.done ? '☑' : '☐'} ${i.text}`)));
}
$('#actions').append(button('Copy as Markdown', async () => { try { await navigator.clipboard.writeText(items().map((i) => `- [${i.done ? 'x' : ' '}] ${i.text}`).join('\n')); } catch { /* clipboard blocked */ } }));
render();
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Templates(), SlashCommands(), Mentions({ search }), Comments({ author })],
// action items: every <li data-task> in editor.getHTML()
`));
