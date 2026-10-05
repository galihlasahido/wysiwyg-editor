import { defineEditorElement, type WysiwygElement } from '../src';
import { $, codePanel, el } from './samples';

defineEditorElement(); // registers <wysiwyg-editor> once

const editor = $('wysiwyg-editor') as unknown as WysiwygElement;
const events = $('#events');
const log = (text: string) => (events.textContent = `${new Date().toLocaleTimeString()}  ${text}\n${events.textContent!.startsWith('editor-ready and') ? '' : events.textContent}`.split('\n').slice(0, 12).join('\n'));
editor.addEventListener('editor-ready', () => log('editor-ready'));
editor.addEventListener('editor-change', (e) => log(`editor-change (${(e as CustomEvent).detail.html.length} characters)`));

$('#post').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = Object.fromEntries(new FormData(e.target as HTMLFormElement).entries());
  $('#sent').textContent = JSON.stringify(data, null, 2);
});
$('#dark').addEventListener('click', () => editor.editor?.setTheme(editor.editor.theme === 'dark' ? 'light' : 'dark'));
$('#ro').addEventListener('click', () => (editor.readOnly = !editor.readOnly));

$('#app').append(codePanel(`
<link rel="stylesheet" href="wysiwyg-editor/style.css">
<wysiwyg-editor name="body" value="<p>Hello</p>" ribbon paged theme="dark"></wysiwyg-editor>
<script type="module">
  import { defineEditorElement } from 'wysiwyg-editor';
  defineEditorElement();                              // or defineEditorElement('my-editor')
  const el = document.querySelector('wysiwyg-editor');
  el.addEventListener('editor-change', (e) => save(e.detail.html));
  el.value = '<p>Set from code</p>';                  // el.value, el.readOnly, el.editor
  el.plugins = [...defaultPlugins, MyPlugin];          // before it is connected
  el.config = { toolbar: { position: 'bottom' } };     // any createEditor option
<\/script>
`));
void el;
