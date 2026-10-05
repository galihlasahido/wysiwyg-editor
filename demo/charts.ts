import { Charts, createEditor, defaultPlugins, download } from '../src';
import { $, button, codePanel, el } from './samples';

const content =
  '<h1>Sales review</h1><p>Click inside the table, then press 📊, 📈 or 🥧.</p>' +
  '<table><tr><th>Quarter</th><th>2025</th><th>2026</th></tr><tr><td>Q1</td><td>1,200</td><td>1,500</td></tr><tr><td>Q2</td><td>900</td><td>1,100</td></tr><tr><td>Q3</td><td>1,350</td><td>1,800</td></tr><tr><td>Q4</td><td>1,600</td><td>2,100</td></tr></table><p></p>' +
  '<figure data-chart=\'{"type":"pie","title":"Share by region","labels":["Java","Sumatra","Bali","Other"],"series":[{"name":"Share","values":[52,21,14,13]}]}\'></figure>';

$('#app').append(
  el('div', { class: 'demo-note' }, 'The chart is stored as data (not markup) and drawn again on load. Select a chart and use the buttons to change its type or title.'),
  el('div', { class: 'actions' },
    button('Make it a line chart', () => editor.execute('setChart', { type: 'line' }), true),
    button('Make it a bar chart', () => editor.execute('setChart', { type: 'bar' })),
    button('Title…', () => editor.execute('setChart', { title: 'Revenue by quarter' })),
    button('Download .docx', async () => download(await editor.exportDocx(), 'charts.docx')),
  ),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, Charts()] });
(window as unknown as { editor: typeof editor }).editor = editor;
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Charts()],
editor.execute('insertChart', 'bar');          // from the table at the cursor
editor.execute('insertChart', 'pie', { title, labels: ['a','b'], series: [{ name: 'S', values: [1, 2] }] }); // or from data
editor.execute('setChart', { type: 'line', title: 'Trend' }); // the selected chart
`));
