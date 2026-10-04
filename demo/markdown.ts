import { createEditor } from '../src';
import { $, el, codePanel } from './samples';

const md = el('textarea', { class: 'out', rows: 22, spellcheck: false, 'aria-label': 'Markdown' });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Edit either side. The right side is ', el('code', {}, 'editor.getMarkdown()'), '; typing there calls ', el('code', {}, 'editor.setMarkdown()'), ' (raw HTML in Markdown is ignored).'),
  el('div', { class: 'cols' }, el('div', { class: 'panel' }, el('h2', {}, 'WYSIWYG'), el('div', { id: 'editor' })), el('div', { class: 'panel' }, el('h2', {}, 'Markdown'), md)),
);

const editor = createEditor({
  element: $('#editor'),
  content: '<h1>Notes</h1><p>Type <strong>bold</strong>, <em>italic</em> or a <a href="https://commonmark.org">link</a>.</p><ul><li><p>Lists work</p></li><li><p>both ways</p></li></ul><blockquote><p>Quotes too.</p></blockquote>',
  onChange: () => document.activeElement !== md && (md.value = editor.getMarkdown()),
});
md.value = editor.getMarkdown();

let timer: ReturnType<typeof setTimeout>;
md.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(() => editor.setMarkdown(md.value), 250);
});

$('#app').append(codePanel(`
editor.getMarkdown();            // WYSIWYG -> Markdown
editor.setMarkdown(markdown);    // Markdown -> WYSIWYG (raw HTML in Markdown is ignored)
`));
