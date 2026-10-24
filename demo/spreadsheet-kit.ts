import type { WorkbookData } from '../src/spreadsheet-app';

const head = { b: 1 as const, bg: '#dbeafe', color: '#1e3a8a', align: 'center' as const };
const cur = { fmt: 'currency' as const };

function budget() {
  const rows = [['Rent', 14700, 14850], ['Food', 5400, 5401], ['Travel', 2000, 1990], ['Fun', 1500, 1445]];
  const cells: Record<string, { v?: string; s?: Record<string, unknown> }> = {};
  ['Category', 'Planned', 'Actual', 'Difference', 'Status'].forEach((t, c) => { cells[`${'ABCDE'[c]}1`] = { v: t, s: head }; });
  rows.forEach(([n, p, a], i) => {
    const r = i + 2;
    cells[`A${r}`] = { v: String(n) }; cells[`B${r}`] = { v: String(p), s: cur }; cells[`C${r}`] = { v: String(a), s: cur };
    cells[`D${r}`] = { v: `=C${r}-B${r}`, s: cur }; cells[`E${r}`] = { v: `=IF(D${r}>0,"Over","OK")`, s: { align: 'center' } };
  });
  cells.A6 = { v: 'Total', s: { b: 1, bt: 1 } };
  for (const c of 'BCD') cells[`${c}6`] = { v: `=SUM(${c}2:${c}5)`, s: { ...cur, b: 1, bt: 1 } };
  return cells;
}

/** A small year of expenses, with totals, a second sheet that sums the first, and a few formats. */
export function expensesWorkbook(): WorkbookData {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const rent = [1200, 1200, 1200, 1200, 1200, 1200, 1250, 1250, 1250, 1250, 1250, 1250];
  const food = [420, 390, 455, 410, 430, 468, 502, 475, 440, 430, 461, 520];
  const travel = [0, 150, 80, 0, 320, 90, 640, 210, 0, 120, 0, 380];
  const fun = [90, 60, 140, 75, 110, 95, 180, 130, 85, 100, 120, 260];
  const cells: Record<string, { v?: string; s?: Record<string, unknown> }> = {};
  ['Month', 'Rent', 'Food', 'Travel', 'Fun', 'Total', 'Share of year'].forEach((t, c) => { cells[`${'ABCDEFG'[c]}1`] = { v: t, s: head }; });
  months.forEach((m, i) => {
    const r = i + 2;
    cells[`A${r}`] = { v: m };
    cells[`B${r}`] = { v: String(rent[i]), s: cur };
    cells[`C${r}`] = { v: String(food[i]), s: cur };
    cells[`D${r}`] = { v: String(travel[i]), s: cur };
    cells[`E${r}`] = { v: String(fun[i]), s: cur };
    cells[`F${r}`] = { v: `=SUM(B${r}:E${r})`, s: { ...cur, b: 1 } };
    cells[`G${r}`] = { v: `=F${r}/$F$14`, s: { fmt: 'percent', dec: 1 } };
  });
  cells.A14 = { v: 'Total', s: { b: 1, bt: 1 } };
  for (const c of 'BCDEF') cells[`${c}14`] = { v: `=SUM(${c}2:${c}13)`, s: { ...cur, b: 1, bt: 1, bg: '#f1f5f9' } };
  cells.G14 = { v: '=SUM(G2:G13)', s: { fmt: 'percent', dec: 0, b: 1, bt: 1 } };
  cells.A16 = { v: 'Average month', s: { b: 1 } }; cells.F16 = { v: '=AVERAGE(F2:F13)', s: cur };
  cells.A17 = { v: 'Biggest month', s: { b: 1 } }; cells.F17 = { v: '=MAX(F2:F13)', s: cur };
  cells.A18 = { v: 'Months over budget', s: { b: 1 } }; cells.F18 = { v: '=COUNTIF(F2:F13,">2200")' };
  return {
    sheets: [
      { name: 'Expenses', rows: 100, cols: 12, cells, colWidths: { 0: 130, 6: 120 }, freezeRows: 1 },
      { name: 'Budget', rows: 60, cols: 10, cells: budget(), colWidths: { 0: 140, 1: 110, 2: 110, 3: 110, 4: 90 } },
    ],
  };
}

type MenuSheet = { setMenu(m: 'classic' | 'floating' | 'menubar' | 'formula' | 'none'): void; setFormulaBar(on: boolean): void };

/** A row above the spreadsheet to choose what sits over the grid: the ribbon, the floating card, its menus only, the formula editor only. */
export function menuPicker(host: HTMLElement, sheet: MenuSheet, current: 'classic' | 'floating' | 'menubar' | 'formula' | 'none'): void {
  const bar = document.createElement('div');
  bar.className = 'demo-menu-picker';
  bar.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 10px;font:13px system-ui,sans-serif';
  const label = document.createElement('label');
  label.textContent = 'Menu ';
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Menu');
  for (const [v, t] of [['classic', 'Ribbon'], ['floating', 'Floating card (menus + toolbar)'], ['menubar', 'Drop-down menus only'], ['formula', 'Formula editor only'], ['none', 'None']]) select.add(new Option(t, v, false, v === current));
  select.addEventListener('change', () => sheet.setMenu(select.value as typeof current));
  label.append(select);
  const fl = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox'; box.checked = true;
  box.addEventListener('change', () => sheet.setFormulaBar(box.checked));
  fl.append(box, ' Formula editor');
  bar.append(label, fl);
  host.before(bar);
}
