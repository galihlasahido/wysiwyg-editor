import { Mentions, SlashCommands, Templates, createEditor, defaultPlugins } from '../src';
import { $, PEOPLE, el, codePanel } from './samples';

$('#app').append(
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  el('ul', { class: 'tips' },
    el('li', {}, 'Type ', el('code', {}, '/'), ' on an empty line for a block menu (try ', el('code', {}, '/table'), ' or ', el('code', {}, '/todo'), ').'),
    el('li', {}, 'Type ', el('code', {}, '@'), ' and a name to mention a teammate.'),
    el('li', {}, 'Use the ', el('strong', {}, 'Template'), ' dropdown to start from a layout (undoable).'),
    el('li', {}, 'Markdown shortcuts: ', el('code', {}, '# '), ' ', el('code', {}, '- '), ' ', el('code', {}, '1. '), ' ', el('code', {}, '> '), ' ', el('code', {}, '```'), ' ', el('code', {}, '**bold**'), '.')),
);

createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, Templates(), SlashCommands(), Mentions({ search: (q) => PEOPLE.filter((p) => p.label.toLowerCase().includes(q.toLowerCase())) })],
  content: '<h2>Standup notes</h2><p>Hi @Ana, can you review the draft? Start a new line and press <code>/</code>.</p><p></p>',
});

$('#app').append(codePanel(`
createEditor({
  element,
  plugins: [
    ...defaultPlugins,
    Templates(),
    SlashCommands(),
    Mentions({ search: (query) => people.filter((p) => p.label.includes(query)) }),
  ],
});
`));
