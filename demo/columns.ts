import { Columns, createEditor, defaultPlugins, download } from '../src';
import { $, button, codePanel, el } from './samples';

const lorem = 'The editor keeps every paragraph in one flow and the browser balances it across the columns, so adding text never needs manual breaks. ';
const content = `<h1>Newsletter</h1><div data-columns="2" data-rule="solid"><p>${lorem.repeat(3)}</p><p>${lorem.repeat(3)}</p><p>${lorem.repeat(2)}</p></div><p>Select blocks and press ▥ or ☷ to wrap them; ▭ removes the columns again.</p>`;

$('#app').append(
  el('div', { class: 'demo-note' }, 'Place the cursor inside the columns to change their count, rule or gap. In the downloaded .docx each columns block is a real Word section with its own column count, so Word shows the same layout (the text before and after stays one column). On narrow screens the editor shows a single column.'),
  el('div', { class: 'actions' },
    button('2 columns', () => editor.execute('setColumns', { count: 2 }), true),
    button('3 columns', () => editor.execute('setColumns', { count: 3 })),
    button('Toggle rule', () => editor.execute('setColumns', { rule: editor.view.dom.querySelector('.has-rule') ? 'none' : 'solid' })),
    button('Wider gap', () => editor.execute('setColumns', { gap: 56 })),
    button('Column break here', () => editor.execute('insertColumnBreak')),
    button('Whole page in 2 columns', () => editor.execute('setDocumentColumns', 2)),
    button('Back to one column', () => editor.execute('setDocumentColumns', 1)),
    button('Download .docx', async () => download(await editor.exportDocx(), 'columns.docx')),
  ),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, Columns()] });
(window as unknown as { editor: typeof editor }).editor = editor;
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Columns()],
editor.execute('insertColumns', 3);                       // wrap the selected blocks
editor.execute('setColumns', { count: 2, rule: 'solid', gap: 40 });
editor.execute('removeColumns');
`));
