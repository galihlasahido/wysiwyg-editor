import { RestrictedEditing, createEditor, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';

const accent = el('input', { type: 'color', value: '#2563eb', 'aria-label': 'Accent colour' });
const tpl = el('select', { 'aria-label': 'Template' }, el('option', { value: 'classic', textContent: 'Classic' }), el('option', { value: 'modern', textContent: 'Modern' }));
$('#app').append(
  el('div', { class: 'actions' }, el('label', {}, 'Template ', tpl), el('label', {}, 'Accent ', accent), button('Print / Save as PDF', () => editor.execute('print'), true)),
  el('div', { class: 'panel cv-host classic', id: 'host' }, el('div', { id: 'editor' })),
);
const sec = (h: string, body: string) => `<section data-locked data-variant="cv-head" data-label="${h}"><h2>${h}</h2></section><div data-editable-region data-variant="cv" data-label="Fill in">${body}</div>`;
const content =
  '<section data-locked data-variant="cv-name" data-label="Name"><h1>Your Name</h1></section><div data-editable-region data-variant="cv" data-label="Contact"><p>email@example.com · +62 000 0000 · City</p></div>' +
  sec('Summary', '<p>Two sentences about what you do best.</p>') +
  sec('Experience', '<p><strong>Role, Company</strong> — 2022 to now</p><ul><li><p>What you achieved, with a number</p></li><li><p>What you led or built</p></li></ul>') +
  sec('Education', '<p><strong>Degree, School</strong> — 2018</p>') +
  sec('Skills', '<p>TypeScript, Node, SQL</p>');
const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, RestrictedEditing({ labels: false })], toolbar: ['bold', 'italic', 'link', '|', 'bulletList', 'orderedList'] });
accent.addEventListener('input', () => $('#host').style.setProperty('--cv', accent.value));
tpl.addEventListener('change', () => ($('#host').className = `panel cv-host ${tpl.value}`));
$('#app').append(codePanel(`
// locked headings keep the layout; fill-in regions hold the content
RestrictedEditing({ labels: false })
// style with CSS: .wy-locked[data-variant="cv-head"] { --wy-locked-bar: 0; border-bottom: 2px solid var(--cv) }
`));
