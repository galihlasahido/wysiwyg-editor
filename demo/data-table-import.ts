// Bring in data: paste or open a CSV, open an Excel file, or start from rows in your code; then export it again.
import { dataTableFromRows, parseCSV, parseXlsx } from '../src/data-table-app';
import { codePanel, button, el } from './samples';
import { mountTable } from './data-table-kit';

const sample = `Product,Region,Units,Price
Matcha,North,120,4.5
Oolong,South,80,3.9
Chai,East,95,3.2
Matcha,West,60,4.5
Cold brew,North,140,5.1`;
const demo = mountTable({ theme: 'light', table: dataTableFromRows(parseCSV(sample), { title: 'Imported sales' }) });
const load = (rows: unknown[][], title: string) => { demo.app.setTable(dataTableFromRows(rows, { title })); demo.log(`${title}: ${rows.length - 1} rows read. Types (number, date, yes/no) were guessed from the values.`); };

const paste = el('textarea', { rows: 6, style: 'width:100%;font:13px ui-monospace,monospace', value: sample, 'aria-label': 'CSV text' });
const file = el('input', { type: 'file', accept: '.csv,.tsv,.xlsx', 'aria-label': 'Open a file' });
file.addEventListener('change', async () => {
  const f = file.files?.[0];
  if (!f) return;
  const bytes = new Uint8Array(await f.arrayBuffer());
  try {
    if (/\.xlsx$/i.test(f.name)) load((await parseXlsx(bytes)).rows, f.name);
    else load(parseCSV(new TextDecoder().decode(bytes)), f.name);
  } catch (e) { demo.log(`Could not read ${f.name}: ${(e as Error).message}`); }
});
demo.actions.prepend(button('Use the pasted text', () => load(parseCSV(paste.value), 'Pasted CSV')), button('Download .csv', () => demo.app.download('csv')), button('Download .xlsx', () => demo.app.download('xlsx')), file);
demo.panel.before(el('p', { class: 'hint' }, 'Edit the text, or open your own file. Nothing leaves the page.'), paste);

document.querySelector('#app')!.append(codePanel(`
const rows = parseCSV(text);                    // quotes, commas and line breaks inside quotes are handled
const table = dataTableFromRows(rows);          // first row = headings; numbers, dates and yes/no are detected
app.setTable(table);

const { rows: sheetRows } = await parseXlsx(await file.arrayBuffer());   // .xlsx, read by the library (no extra package)
app.download('xlsx');                           // and back out: CSV, Excel or PDF (print)
`));
