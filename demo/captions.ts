import { Captions, createEditor, defaultPlugins, download } from '../src';
import { $, button, codePanel, el, makeImage } from './samples';

const cap = (id: string, kind: string, text: string) => `<p class="wy-caption" id="${id}" data-caption="${kind}"><span class="wy-caption-text">${text}</span></p>`;
const content =
  '<h1>Annual report</h1><div data-caption-list="figure"></div><div data-caption-list="table"></div>' +
  '<h2>Results</h2><p>Revenue is shown in <a data-xref="t1">Table 1</a>, and the trend in <a data-xref="f2">Figure 2</a>.</p>' +
  `<p><img src="${makeImage(420, 200, 'Chart A', 150)}" alt="Chart A" width="320"></p>${cap('f1', 'figure', 'Revenue by quarter')}` +
  '<table><tr><th>Quarter</th><th>Revenue</th></tr><tr><td>Q1</td><td>1.2M</td></tr><tr><td>Q2</td><td>1.5M</td></tr></table>' + cap('t1', 'table', 'Revenue figures') +
  `<p><img src="${makeImage(420, 200, 'Chart B', 20)}" alt="Chart B" width="320"></p>${cap('f2', 'figure', 'Growth trend')}` +
  '<p>Select a picture or a table and press the 🏷 button to add a caption: it is numbered automatically, and every cross-reference and the lists above update.</p>';

$('#app').append(
  el('div', { class: 'demo-note' }, el('strong', {}, '🏷'), ' adds a caption after the selected picture or table (or at the cursor), ', el('strong', {}, '🔗'), ' inserts a cross-reference to a caption, ', el('strong', {}, '☰'), ' a list of figures. Delete or move a caption and watch the numbers, the references and the lists change. Try ', el('strong', {}, 'Download .docx'), ': numbers and references are written as text.'),
  el('div', { class: 'actions' }, button('Download .docx', async () => download(await editor.exportDocx(), 'captions.docx'), true)),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, Captions()], ribbon: false });
(window as unknown as { editor: typeof editor }).editor = editor;
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Captions({ kinds: [{ id: 'figure', label: 'Gambar' }, { id: 'table', label: 'Tabel' }], separator: ': ' })],

editor.execute('insertCaption');                 // after the selected picture/table; kind is detected
editor.execute('insertCrossReference', captionId); // or without an id: a dialog lists the captions
editor.execute('insertCaptionList', 'figure');   // list of figures ('table' for tables)
editor.extensions.captions.list();               // [{ id, kind, n, label, text }]
`));
