import { Comments, createEditor, defaultPlugins, download, exportHTML } from '../src';
import { $, ARTICLE, button, el, makeImage } from './samples';

const content = `${ARTICLE}
<h2>Results</h2>
<table><tr><th>Quarter</th><th>Revenue</th><th>Growth</th></tr><tr><td>Q1</td><td>1.2M</td><td>+4%</td></tr><tr><td>Q2</td><td>1.5M</td><td>+25%</td></tr></table>
<p><img src="${makeImage(480, 240, 'Chart', 150)}" alt="A placeholder chart" width="360" data-caption="Figure 1. A placeholder chart"></p>
<p>Footnotes<sup data-footnote="Footnotes become real Word footnotes."></sup> and a table of contents are exported too.</p>`;

$('#app').append(
  el('div', { class: 'demo-note' }, 'The .docx keeps headings, formatting, lists, tables, images (including crops), footnotes, comments, tracked changes, page size, margins, orientation and header/footer. ', el('strong', {}, 'PDF'), ' uses the browser print dialog with the real page margins ("Save as PDF").'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);

const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, Comments({ author: 'You' })], ribbon: true, pages: { header: 'Annual report', footer: 'Page {page} of {pages}', height: '65vh' }, outline: true });

$('#actions').append(
  button('Download .docx', async () => download(await (await import('../src/docx')).exportDocx(editor), 'report.docx'), true),
  button('Print / Save as PDF', () => editor.execute('print')),
  button('Download HTML', () => download(exportHTML(editor, { title: 'Annual report' }), 'report.html', 'text/html')),
  button('Download Markdown', () => download(editor.getMarkdown(), 'report.md', 'text/markdown')),
);
