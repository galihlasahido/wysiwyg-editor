import { createSpreadsheet } from '../src/spreadsheet-app';
import { codePanel } from './samples';
import { expensesWorkbook, menuPicker } from './spreadsheet-kit';

const host = document.getElementById('sheet')!;
const sheet = createSpreadsheet({
  element: host,
  data: expensesWorkbook(),
  menu: 'classic',
  title: 'Yearly expenses',
  storageKey: 'wy-demo-spreadsheet-classic',
  height: '78vh',
});
menuPicker(host, sheet, 'classic');
(window as unknown as { sheet: typeof sheet }).sheet = sheet;
document.querySelector('.demo-main')!.append(codePanel(`
import { createSpreadsheet } from 'wysiwygido/spreadsheet';
import 'wysiwygido/style.css';

const sheet = createSpreadsheet({
  element,
  menu: 'classic',                     // 'classic' ribbon, 'floating' card, 'menubar' (drop-down menus only), 'formula' (formula editor only) or 'none'
  data: { sheets: [{ name: 'Sheet1', cells: { A1: { v: 'Item' }, B1: { v: '12' }, B2: { v: '=B1*2' } } }] },
  title: 'Yearly expenses',          // header of the floating card
  save: (data) => fetch('/api/book', { method: 'PUT', body: JSON.stringify(data) }),
});
sheet.setValue('C1', '=SUM(B1:B2)');
sheet.getValue('C1');             // 36
sheet.toCSV();
`));
