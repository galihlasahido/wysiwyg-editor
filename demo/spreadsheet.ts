import { TableFormulas, computeFormulasInHTML, createEditor, defaultPlugins, download } from '../src';
import { $, button, codePanel, el } from './samples';

const cell = (t: string) => `<td><p>${t}</p></td>`;
const head = (t: string) => `<th><p>${t}</p></th>`;
const row = (...c: string[]) => `<tr>${c.map(cell).join('')}</tr>`;
const content =
  '<h1>Quarterly budget</h1><p>Columns are A, B, C… and rows 1, 2, 3… of each table (the header row is row 1). Formulas only see their own table. Click a result to see and edit its formula.</p>' +
  `<table><tr>${['Item', 'Qty', 'Price', 'Total'].map(head).join('')}</tr>` +
  row('Laptops', '4', '1200', '=B2*C2') + row('Monitors', '6', '300', '=B3*C3') + row('Desks', '5', '450', '=B4*C4') +
  row('Total', '=SUM(B2:B4)', '=AVERAGE(C2:C4)', '=SUM(D2:D4)') + '</table>' +
  '<p></p><h2>Checks</h2>' +
  `<table><tr>${['Rule', 'Value'].map(head).join('')}</tr>` +
  row('Budget limit', '15000') + row('Spent', '8850') + row('Left', '=B2-B3') + row('Over budget?', '=IF(B3>B2,"yes","no")') + row('Spent share', '=ROUND(B3/B2*100,1)&"%"') + row('Division by zero', '=1/0') + '</table>';

const out = el('pre', { class: 'out', hidden: true });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Functions: ', el('code', {}, 'SUM AVERAGE MIN MAX COUNT ROUND ABS SQRT IF CONCAT'), ' · operators ', el('code', {}, '+ - * / ^ % & < > = <>'), '. Errors show as ', el('code', {}, '#DIV/0! #REF! #NAME? #CYCLE!'), '. Formulas are parsed by a small safe evaluator, never run as code.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  out,
);
const editor = createEditor({ element: $('#editor'), plugins: [...defaultPlugins, TableFormulas], content });
$('#actions').append(
  button('Export values (HTML)', () => { out.hidden = false; out.textContent = computeFormulasInHTML(editor.getHTML()); }, true),
  button('Download .html', () => download(`<!doctype html><meta charset="utf-8">${computeFormulasInHTML(editor.getHTML())}`, 'budget.html', 'text/html')),
);
$('#app').append(codePanel(`
plugins: [...defaultPlugins, TableFormulas],
// a cell whose text starts with "=" shows its value; the text stays the document content
computeFormulasInHTML(editor.getHTML());       // formulas replaced by values, for export
evaluateGrid([['1', '2'], ['=A1+B1', '=SUM(A1:B1)']]);   // [[1, 2], [3, 3]]
`));
