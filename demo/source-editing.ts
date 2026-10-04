import { SourceEditing, createEditor, defaultPlugins } from '../src';
import { $, ARTICLE, el } from './samples';

$('#app').append(
  el('div', { class: 'demo-note' }, 'Press the ', el('code', {}, '</>'), ' (Source) button at the end of the toolbar. Edit the HTML, then press it again. Try adding ', el('code', {}, '<script>alert(1)</script>'), ' or ', el('code', {}, '<a href="javascript:alert(1)">'), ': they are removed when you switch back.'),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);

createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, SourceEditing],
  toolbar: ['undo', 'redo', '|', 'bold', 'italic', 'underline', '|', 'heading', 'bulletList', 'orderedList', 'link', 'insertTable', '|', 'source'],
  content: ARTICLE,
});
