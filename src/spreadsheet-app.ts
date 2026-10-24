/**
 * A spreadsheet on its own: no editor, no ProseMirror. `createSpreadsheet({ element })` gives an Excel-style grid — formulas, formats,
 * sheets, sort and filter, fill, undo, CSV, a formula bar — with the menus as a classic ribbon or as a floating card. It is the
 * stand-alone entry `wysiwygido/spreadsheet`.
 */
import './styles.css';
import './office.css';
import { Chrome, popMenu, type ChromeSpec, type Control, type MenuEntry } from './office-chrome';
import { cellRef, colName } from './grid-formulas';
import { createFormulaBar, attachSuggest } from './formula-bar';
import { observeSize } from './resize';
import { GridView } from './spreadsheet-view';
import {
  Workbook, formatNumber, normRange, parseDelimited, parseRangeRef, rangeRef, seriesFor,
  type CellData, type CellStyle, type NumFmt, type Range, type Sheet, type WorkbookData, type SheetData,
} from './spreadsheet-model';
import { defaultThemes, themeVars, type Theme } from './plugins/themes';

export { Workbook, parseDelimited, parseRangeRef, rangeRef, seriesFor, formatNumber, normRange, cellRef, colName };
export { evaluateGrid, createEvaluator, shiftFormula, mapFormulaRefs } from './grid-formulas';
export type { CellData, CellStyle, NumFmt, Range, Sheet, SheetData, WorkbookData };
export { defaultThemes, themeVars };
export type { Theme };

/** What sits above the grid: the ribbon, the floating card, only its menus, only the formula editor, or nothing. */
export type MenuMode = 'classic' | 'floating' | 'menubar' | 'formula' | 'none';
const MENU_MODES: MenuMode[] = ['classic', 'floating', 'menubar', 'formula', 'none'];

export interface SpreadsheetOptions {
  /** Where the spreadsheet goes. Its content is replaced. */
  element: HTMLElement;
  /** The workbook (`{ sheets: [{ name, cells: { A1: { v: '1' }, … } }] }`, or its JSON text). Default: one empty sheet. */
  data?: WorkbookData | string | null;
  /**
   * What sits above the grid. `'classic'`: the tabbed ribbon. `'floating'`: a rounded card with a menu bar and a one-row toolbar.
   * `'menubar'`: the card with only the drop-down menus. `'formula'`: only the formula editor. `'none'`: nothing but the grid (the
   * formula editor still follows `formulaBar`). Default `'classic'`.
   */
  menu?: MenuMode;
  /** `'light'`, `'dark'`, `'auto'` (follow the system), a colour theme name or a theme object. Default `'light'`. */
  theme?: 'light' | 'dark' | 'auto' | string | Theme;
  themes?: Theme[];
  /** The document name shown in the header. */
  title?: string | false;
  /** Called when the person renames the document (this makes the name editable). */
  onTitle?: (title: string) => void;
  /** Your own controls at the right of the header: avatars, a Share button… */
  end?: HTMLElement;
  /** Nothing can be changed; selecting, copying, sorting views and export still work. */
  readOnly?: boolean;
  /** CSS height of the whole spreadsheet. Default `'640px'`. */
  height?: string;
  /** Show the formula bar, the sheet tabs and the status bar (all default true). */
  formulaBar?: boolean;
  sheetTabs?: boolean;
  statusBar?: boolean;
  gridlines?: boolean;
  headings?: boolean;
  /** ISO currency code for the currency format (default `USD`) and the language for numbers and dates. */
  currency?: string;
  locale?: string;
  /** Save the workbook. The header shows Saving… and Saved. Reject to signal failure (retried). */
  save?: (data: WorkbookData) => Promise<void> | void;
  /** Keep the workbook in `localStorage` under this key and load it again next time (when no `data` is given). */
  storageKey?: string;
  /** Wait this long after the last change before saving (default 800 ms). */
  saveDelayMs?: number;
  /** Called after every change with the workbook as it now is. */
  onChange?: (data: WorkbookData) => void;
  /** The ribbon tab shown first (`'file'`, `'home'`, `'insert'`, `'formulas'`, `'data'`, `'view'`). */
  initialTab?: string;
}

export interface Spreadsheet {
  readonly el: HTMLElement;
  readonly workbook: Workbook;
  readonly view: GridView;
  getData(): WorkbookData;
  setData(data: WorkbookData | string): void;
  /** The text of a cell as typed (`=A1+B1`), by name (`'B3'`) on the current sheet. */
  getRaw(ref: string): string;
  /** The value of a cell: a number, text, or an error such as `#DIV/0!`. */
  getValue(ref: string): string | number | boolean;
  /** Type `text` into a cell, as a person would. */
  setValue(ref: string, text: string): void;
  select(ref: string): void;
  toCSV(range?: string): string;
  importCSV(text: string, name?: string): void;
  undo(): void;
  redo(): void;
  setMenu(menu: MenuMode): void;
  /** Show or hide the formula editor under the menus. */
  setFormulaBar(on: boolean): void;
  setTheme(theme: NonNullable<SpreadsheetOptions['theme']>): void;
  setReadOnly(on: boolean): void;
  focus(): void;
  /** `'import'`: `{ name, rows, truncated }` after a CSV was read (`truncated`: rows or columns past the sheet's limits were left out). `'error'`: `{ message }` for a file that was not read. */
  on(event: 'change' | 'select' | 'save' | 'import' | 'error', fn: (payload: unknown) => void): () => void;
  destroy(): void;
}

const FONTS = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48];
const FORMATS: { label: string; value: NumFmt }[] = [{ label: 'General', value: 'general' }, { label: 'Number', value: 'number' }, { label: 'Currency', value: 'currency' }, { label: 'Percent', value: 'percent' }, { label: 'Date', value: 'date' }, { label: 'Text', value: 'text' }];
const FUNCTIONS: Record<string, string[]> = {
  Math: ['SUM', 'PRODUCT', 'ROUND', 'ABS', 'SQRT', 'POWER', 'MOD', 'INT'],
  Statistical: ['AVERAGE', 'MEDIAN', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'COUNTIF', 'SUMIF'],
  Logical: ['IF', 'AND', 'OR', 'NOT'],
  Text: ['CONCAT', 'LEN', 'UPPER', 'LOWER', 'TRIM', 'LEFT', 'RIGHT'],
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A file name from a title: no path characters, control or direction-override characters, no leading dots. */
const safeName = (t: string, fallback: string): string => t.replace(/[\\/:*?\x22<>|\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]+/g, '').replace(/^[.\s]+/, '').trim().slice(0, 80) || fallback;

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = el('a');
  a.href = url; a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The largest CSV the Import command reads (the sheet holds at most 20,000 rows anyway). */
const MAX_IMPORT = 50 * 1024 * 1024;

export function createSpreadsheet(options: SpreadsheetOptions): Spreadsheet {
  const o = options;
  let menuMode: MenuMode = MENU_MODES.includes(o.menu as MenuMode) ? (o.menu as MenuMode) : 'classic';
  let readOnly = !!o.readOnly;
  let showFormulaBar = o.formulaBar !== false;
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const emit = (ev: string, p: unknown) => { for (const f of [...(listeners.get(ev) ?? [])]) { try { f(p); } catch (e) { console.error(`Spreadsheet "${ev}" listener failed`, e); } } };

  let initial: WorkbookData | null = null;
  const parse = (d: WorkbookData | string | null | undefined): WorkbookData | null => {
    if (typeof d === 'string') { try { return JSON.parse(d) as WorkbookData; } catch { return null; } }
    return d ?? null;
  };
  initial = parse(o.data);
  if (!initial && o.storageKey) { try { const raw = localStorage.getItem(o.storageKey); if (raw) initial = parse(raw); } catch { /* storage blocked */ } }
  const wb = new Workbook(initial, { currency: o.currency, locale: o.locale });

  // ---- structure
  const root = el('div', 'wy-app wy-ss-app');
  root.style.height = o.height ?? '640px';
  const applyTheme = (t: NonNullable<SpreadsheetOptions['theme']>) => {
    const all = [...defaultThemes, ...(o.themes ?? [])];
    root.removeAttribute('style');
    root.style.height = o.height ?? '640px';
    const sys = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    let mode: 'light' | 'dark' = 'light';
    if (t === 'auto') mode = sys?.matches ? 'dark' : 'light';
    else if (t === 'dark' || t === 'light') mode = t;
    else {
      const th = typeof t === 'string' ? all.find((x) => x.name === t) : t;
      if (th) { mode = th.palette.mode ?? 'light'; for (const [k, v] of Object.entries(themeVars(th.palette))) root.style.setProperty(k, v); }
    }
    root.dataset.theme = mode;
  };
  applyTheme(o.theme ?? 'light');
  let sysQuery: MediaQueryList | null = null;
  const onSys = () => { if (o.theme === 'auto') applyTheme('auto'); };
  if (o.theme === 'auto' && typeof matchMedia === 'function') { sysQuery = matchMedia('(prefers-color-scheme: dark)'); sysQuery.addEventListener?.('change', onSys); }

  const view = new GridView(wb, {
    readOnly, gridlines: o.gridlines, headings: o.headings,
    onSelect: () => { syncBars(); chrome?.refresh(); emit('select', { range: view.range }); },
    onEdit: (text) => { fbarUi.setEditing(text !== null); if (text === null) syncBars(); else if (formulaInput.value !== text) formulaInput.value = text; refreshStatus(); },
    onContext: (x, y, zone) => openContext(x, y, zone),
    onFilter: (col, anchor) => openFilter(col, anchor),
  });
  const sh = (): Sheet => wb.sheet;
  const rg = (): Range => normRange(view.range);

  // formula bar
  const insertText = (text: string) => {
    if (readOnly) return;
    if (!view.isEditing) view.startEdit(undefined, 'bar');
    const field = view.editingFrom === 'cell' ? view.editorEl : formulaInput;
    if (!field.value.trimStart().startsWith('=')) field.value = '=';
    field.focus();
    const at = field.selectionStart ?? field.value.length;
    field.setRangeText(text, at, field.selectionEnd ?? at, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const nameList = (): MenuEntry[] => {
    const s = sh(); const u = s.used(); const r = view.active.r; const c = view.active.c;
    const go = (r0: number, c0: number, r1: number, c1: number) => () => { view.select({ r0, c0, r1, c1 }, { r: r0, c: c0 }); view.focus(); };
    return [
      { label: 'Go to A1', onClick: go(0, 0, 0, 0) },
      ...(u.row >= 0 ? [{ label: `Data range (A1:${cellRef(u.col, u.row)})`, onClick: go(0, 0, u.row, u.col) }, { label: `Last cell (${cellRef(u.col, u.row)})`, onClick: go(u.row, u.col, u.row, u.col) }] : []),
      '-',
      { label: `Column ${colName(c)}`, onClick: go(0, c, s.rows - 1, c) },
      { label: `Row ${r + 1}`, onClick: go(r, 0, r, s.cols - 1) },
      { label: 'Whole sheet', onClick: go(0, 0, s.rows - 1, s.cols - 1) },
    ];
  };
  const fbarUi = createFormulaBar({ root, confirm: () => view.commit(0, 0), cancel: () => { view.cancelEdit(); view.focus(); }, nameList, insert: insertText });
  const fbar = fbarUi.el;
  const nameBox = fbarUi.nameBox;
  const formulaInput = fbarUi.input;
  nameBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const r = parseRangeRef(nameBox.value); if (r) { view.select(r, { r: r.r0, c: r.c0 }); } else syncBars(); view.focus(); }
    else if (e.key === 'Escape') { syncBars(); view.focus(); }
  });
  nameBox.addEventListener('focus', () => nameBox.select());
  formulaInput.addEventListener('focus', () => { if (!readOnly && !view.isEditing) view.startEdit(undefined, 'bar'); });
  formulaInput.addEventListener('input', () => { if (!view.isEditing) view.startEdit(undefined, 'bar'); view.setEditText(formulaInput.value); });
  // Alt+Enter adds a line, as in Excel; Enter confirms
  formulaInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.altKey) { e.preventDefault(); insertText('\n'); }
    else if (e.key === 'Enter') { e.preventDefault(); view.commit(1, 0); }
    else if (e.key === 'Escape') { e.preventDefault(); view.cancelEdit(); }
    else if (e.key === 'Tab') { e.preventDefault(); view.commit(0, e.shiftKey ? -1 : 1); }
  });
  formulaInput.addEventListener('blur', () => { if (view.editingFrom === 'bar') window.setTimeout(() => { if (view.editingFrom === 'bar' && document.activeElement !== formulaInput) view.commit(0, 0); }, 0); });

  const syncBars = () => {
    const r = rg();
    const multi = r.r0 !== r.r1 || r.c0 !== r.c1;
    if (document.activeElement !== nameBox) nameBox.value = multi ? rangeRef(r) : cellRef(view.active.c, view.active.r);
    if (!view.isEditing) formulaInput.value = wb.raw(sh(), view.active.r, view.active.c);
    fbarUi.setReadOnly(readOnly);
    refreshStatus();
  };

  // sheet tabs and status bar
  const tabs = el('div', 'wy-ss-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Sheets');
  const status = el('div', 'wy-ss-status');
  const sum = el('div', 'wy-ss-summary');
  sum.setAttribute('role', 'status');
  const zoomBox = el('div', 'wy-ss-zoom');
  const zoomOut = el('button', 'wy-ss-zbtn', '−'); zoomOut.type = 'button'; zoomOut.title = 'Zoom out'; zoomOut.setAttribute('aria-label', 'Zoom out');
  const zoomIn = el('button', 'wy-ss-zbtn', '+'); zoomIn.type = 'button'; zoomIn.title = 'Zoom in'; zoomIn.setAttribute('aria-label', 'Zoom in');
  const zoomRange = el('input', 'wy-ss-zrange'); zoomRange.type = 'range'; zoomRange.min = '50'; zoomRange.max = '200'; zoomRange.step = '10'; zoomRange.value = '100'; zoomRange.setAttribute('aria-label', 'Zoom');
  const zoomText = el('span', 'wy-ss-ztext', '100%');
  zoomBox.append(zoomOut, zoomRange, zoomIn, zoomText);
  status.append(el('span', 'wy-ss-ready', 'Ready'), sum, zoomBox);
  const setZoom = (pct: number) => { const p = Math.max(50, Math.min(200, Math.round(pct / 10) * 10)); view.setZoom(p / 100); zoomRange.value = String(p); zoomText.textContent = `${p}%`; chrome?.refresh(); };
  zoomRange.addEventListener('input', () => setZoom(Number(zoomRange.value)));
  zoomOut.addEventListener('click', () => setZoom(Number(zoomRange.value) - 10));
  zoomIn.addEventListener('click', () => setZoom(Number(zoomRange.value) + 10));

  const refreshStatus = () => {
    const s = wb.summary(sh(), rg());
    const f = (n: number) => n.toLocaleString(wb.locale, { maximumFractionDigits: 2 });
    sum.textContent = s.numbers > 1 ? `Average: ${f(s.sum / s.numbers)}    Count: ${s.count}    Sum: ${f(s.sum)}` : s.count > 1 ? `Count: ${s.count}` : '';
  };

  const renderTabs = () => {
    tabs.replaceChildren();
    wb.sheets.forEach((s, i) => {
      const b = el('button', `wy-ss-tab${i === wb.active ? ' is-active' : ''}`, s.name);
      b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(i === wb.active)); b.tabIndex = i === wb.active ? 0 : -1;
      b.addEventListener('click', () => { if (view.isEditing) view.commit(0, 0); wb.setActive(i); view.clearClipboard(); view.select({ r0: 0, c0: 0, r1: 0, c1: 0 }); view.focus(); });
      b.addEventListener('dblclick', () => renameSheet(s, b));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); popMenu(root, { x: e.clientX, y: e.clientY }, [
        { label: 'Rename', onClick: () => renameSheet(s, b), disabled: readOnly },
        { label: 'Duplicate', onClick: () => wb.duplicateSheet(s), disabled: readOnly },
        { label: 'Delete', onClick: () => { wb.deleteSheet(s); }, disabled: readOnly || wb.sheets.length < 2 },
      ], { onRun: () => view.focus() }); });
      b.addEventListener('keydown', (e) => {
        const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1;
        if (to >= 0 && to < wb.sheets.length) { e.preventDefault(); wb.setActive(to); (tabs.children[to] as HTMLElement).focus(); }
      });
      tabs.append(b);
    });
    if (!readOnly) {
      const add = el('button', 'wy-ss-tab-add', '+'); add.type = 'button'; add.title = 'New sheet'; add.setAttribute('aria-label', 'New sheet');
      add.addEventListener('click', () => { wb.addSheet(); view.select({ r0: 0, c0: 0, r1: 0, c1: 0 }); view.focus(); });
      tabs.append(add);
    }
  };

  const renameSheet = (s: Sheet, anchor: HTMLElement) => {
    if (readOnly) return;
    const input = el('input', 'wy-ss-tab-input');
    input.value = s.name; input.setAttribute('aria-label', 'Sheet name');
    anchor.replaceWith(input);
    input.focus(); input.select();
    let done = false;
    const finish = (ok: boolean) => { if (done) return; done = true; if (ok) wb.renameSheet(s, input.value); renderTabs(); view.focus(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
    input.addEventListener('blur', () => finish(true));
  };

  // ---- commands
  const style = (): CellStyle => wb.styleAt(sh(), rg());
  const patch = (p: Partial<Record<keyof CellStyle, unknown>>) => { if (!readOnly) wb.patchStyle(sh(), rg(), p); };
  const toggle = (f: 'b' | 'i' | 'u' | 's' | 'wrap') => patch({ [f]: style()[f] ? undefined : 1 });
  const decimalsOf = (): number => {
    const s = style();
    if (s.dec !== undefined) return s.dec;
    if (s.fmt === 'percent') return 0;
    if (s.fmt === 'currency' || s.fmt === 'number') return 2;
    const t = wb.display(sh(), view.active.r, view.active.c).text;
    const m = /\.(\d+)/.exec(t);
    return m ? m[1].length : 0;
  };
  const insertRows = (below: boolean) => { const r = rg(); wb.insertRows(sh(), below ? r.r1 + 1 : r.r0, r.r1 - r.r0 + 1); };
  const insertCols = (right: boolean) => { const r = rg(); wb.insertCols(sh(), right ? r.c1 + 1 : r.c0, r.c1 - r.c0 + 1); };
  const deleteRows = () => { const r = rg(); wb.deleteRows(sh(), r.r0, r.r1 - r.r0 + 1); view.select({ r0: Math.min(r.r0, sh().rows - 1), r1: Math.min(r.r0, sh().rows - 1), c0: 0, c1: sh().cols - 1 }, { r: Math.min(r.r0, sh().rows - 1), c: view.active.c }); };
  const deleteCols = () => { const r = rg(); wb.deleteCols(sh(), r.c0, r.c1 - r.c0 + 1); view.select({ c0: Math.min(r.c0, sh().cols - 1), c1: Math.min(r.c0, sh().cols - 1), r0: 0, r1: sh().rows - 1 }, { r: view.active.r, c: Math.min(r.c0, sh().cols - 1) }); };
  /** Sort the selection by the column of the active cell; a single cell sorts its whole block of data. */
  const sortBy = (asc: boolean) => {
    if (readOnly) return;
    let r = rg();
    const single = r.r0 === r.r1 && r.c0 === r.c1;
    if (single) r = dataRegion(view.active.r, view.active.c);
    const first = wb.raw(sh(), r.r0, view.active.c);
    const second = wb.raw(sh(), r.r0 + 1, view.active.c);
    const header = r.r1 > r.r0 && first !== '' && Number.isNaN(Number(first)) && second !== '' && !Number.isNaN(Number(second)) || sh().filter?.row === r.r0;
    wb.sortRange(sh(), r, Math.max(r.c0, Math.min(r.c1, view.active.c)), asc, !!header);
  };
  /** The block of filled cells around a cell (what Ctrl+A would pick in Excel). */
  const dataRegion = (row: number, col: number): Range => {
    const s = sh();
    const filled = (r: number, c: number) => r >= 0 && c >= 0 && r < s.rows && c < s.cols && wb.raw(s, r, c) !== '';
    let r0 = row; let r1 = row; let c0 = col; let c1 = col;
    let grown = true;
    while (grown) {
      grown = false;
      for (let c = c0 - 1; c <= c1 + 1; c++) { if (filled(r0 - 1, c)) { r0--; grown = true; break; } }
      for (let c = c0 - 1; c <= c1 + 1; c++) { if (filled(r1 + 1, c)) { r1++; grown = true; break; } }
      for (let r = r0 - 1; r <= r1 + 1; r++) { if (filled(r, c0 - 1)) { c0--; grown = true; break; } }
      for (let r = r0 - 1; r <= r1 + 1; r++) { if (filled(r, c1 + 1)) { c1++; grown = true; break; } }
    }
    return { r0, r1, c0, c1 };
  };
  const toggleFilter = () => {
    if (readOnly) return;
    if (sh().filter) { wb.setFilter(sh(), null); return; }
    const r = rg();
    const single = r.r0 === r.r1 && r.c0 === r.c1;
    wb.setFilter(sh(), single ? dataRegion(view.active.r, view.active.c) : r);
  };
  const autoSum = (fn: string) => {
    if (readOnly) return;
    const s = sh(); const r = rg();
    const numeric = (rr: number, cc: number) => rr >= 0 && cc >= 0 && wb.raw(s, rr, cc) !== '' && !wb.error(s, rr, cc) && typeof wb.value(s, rr, cc) === 'number';
    if (r.r0 !== r.r1 || r.c0 !== r.c1) {
      // a block is selected: the results go in the row under it
      wb.transact('autosum', () => { for (let c = r.c0; c <= r.c1; c++) wb.input(s, r.r1 + 1, c, `=${fn}(${cellRef(c, r.r0)}:${cellRef(c, r.r1)})`); });
      view.moveTo(r.r1 + 1, r.c0);
      return;
    }
    const { r: row, c: col } = view.active;
    let top = row - 1;
    while (numeric(top, col)) top--;
    if (top < row - 1) { wb.input(s, row, col, `=${fn}(${cellRef(col, top + 1)}:${cellRef(col, row - 1)})`); view.refresh(); return; }
    let left = col - 1;
    while (numeric(row, left)) left--;
    if (left < col - 1) { wb.input(s, row, col, `=${fn}(${cellRef(left + 1, row)}:${cellRef(col - 1, row)})`); view.refresh(); return; }
    view.startEdit(`=${fn}(`);
  };
  const insertFunction = (name: string) => { if (!readOnly) { view.focus(); if (view.isEditing) return; view.startEdit(`=${name}(`); } };

  const importFile = () => {
    const input = el('input');
    input.type = 'file'; input.accept = '.csv,.tsv,.txt,text/csv,text/plain';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > MAX_IMPORT) { emit('error', { message: `The file is larger than ${MAX_IMPORT / 1048576} MB` }); return; }
      const s = wb.importCSV(await f.text(), f.name.replace(/\.[^.]+$/, '') || 'Imported');
      emit('import', { name: s.name, rows: wb.lastImport.rows, truncated: wb.lastImport.truncated });
      view.select({ r0: 0, c0: 0, r1: 0, c1: 0 });
    });
    input.click();
  };
  const printSheet = () => {
    const s = sh(); const u = s.used();
    const frame = el('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');   // the printed copy runs no script
    document.body.append(frame);
    const esc = (t: string) => t.replace(/[&<>\x22]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);
    let rows = '';
    for (let r = 0; r <= u.row; r++) {
      if (s.hidden.has(r)) continue;
      rows += '<tr>';
      for (let c = 0; c <= u.col; c++) {
        const st = wb.style(s, r, c); const d = wb.display(s, r, c);
        const css = [st.b && 'font-weight:bold', st.i && 'font-style:italic', st.u && 'text-decoration:underline', st.color && `color:${st.color}`, st.bg && `background:${st.bg}`, `text-align:${st.align ?? (d.number ? 'right' : 'left')}`].filter(Boolean).join(';');
        rows += `<td style="${css}">${esc(d.text)}</td>`;
      }
      rows += '</tr>';
    }
    const doc = frame.contentDocument!;
    doc.open();
    doc.write(`<!doctype html><title>${esc(s.name)}</title><style>body{font:12px system-ui,sans-serif}table{border-collapse:collapse}td{border:1px solid #bbb;padding:2px 6px;white-space:nowrap}</style><table>${rows}</table>`);
    doc.close();
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    setTimeout(() => frame.remove(), 2000);
  };

  // ---- find and replace
  const findPanel = el('div', 'wy-ss-find');
  findPanel.hidden = true;
  findPanel.setAttribute('role', 'dialog'); findPanel.setAttribute('aria-label', 'Find and replace');
  const findIn = el('input'); findIn.placeholder = 'Find'; findIn.setAttribute('aria-label', 'Find');
  const repIn = el('input'); repIn.placeholder = 'Replace with'; repIn.setAttribute('aria-label', 'Replace with');
  const mkBtn = (t: string, fn: () => void) => { const b = el('button', 'wy-ss-fbtn2', t); b.type = 'button'; b.addEventListener('click', fn); return b; };
  const findInfo = el('span', 'wy-ss-find-info');
  const closeFind = () => { findPanel.hidden = true; view.focus(); };
  const matches = (text: string) => { const q = findIn.value.toLowerCase(); return q !== '' && text.toLowerCase().includes(q); };
  const findNext = (dir: 1 | -1 = 1): boolean => {
    const s = sh();
    if (findIn.value === '') return false;
    const total = s.rows * s.cols;
    let idx = view.active.r * s.cols + view.active.c;
    for (let i = 0; i < total; i++) {
      idx = (idx + dir + total) % total;
      const r = Math.floor(idx / s.cols); const c = idx % s.cols;
      if (s.hidden.has(r) || wb.raw(s, r, c) === '') continue;
      if (matches(wb.display(s, r, c).text) || matches(wb.raw(s, r, c))) { view.moveTo(r, c); findInfo.textContent = `${cellRef(c, r)}`; return true; }
    }
    findInfo.textContent = 'No match';
    return false;
  };
  const replaceIn = (text: string) => text.replace(new RegExp(findIn.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), () => repIn.value);
  const replaceOne = () => {
    const s = sh(); const { r, c } = view.active;
    if (readOnly) return;
    if (matches(wb.raw(s, r, c))) { wb.input(s, r, c, replaceIn(wb.raw(s, r, c))); view.refresh(); }
    findNext(1);
  };
  const replaceAll = () => {
    if (readOnly || findIn.value === '') return;
    const s = sh(); let n = 0;
    wb.transact('replace', () => {
      for (const [k, d] of [...s.cells]) { if (d.v && matches(d.v)) { const [r, c] = k.split(',').map(Number); wb.input(s, r, c, replaceIn(d.v)); n++; } }
    });
    findInfo.textContent = `${n} replaced`;
  };
  findIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); findNext(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });
  repIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });
  const findClose = mkBtn('×', closeFind); findClose.setAttribute('aria-label', 'Close'); findClose.title = 'Close';
  findPanel.append(findIn, repIn, mkBtn('Next', () => findNext(1)), mkBtn('Previous', () => findNext(-1)), mkBtn('Replace', replaceOne), mkBtn('Replace all', replaceAll), findInfo, findClose);
  const openFind = () => { findPanel.hidden = false; findIn.focus(); findIn.select(); };

  // ---- filter pop-up
  const openFilter = (col: number, anchor: HTMLElement) => {
    const s = sh(); const f = s.filter;
    if (!f || readOnly) return;
    const last = f.r1;
    const values = wb.distinctValues(s, col, f.row + 1, last);
    const hidden = new Set(f.hide[col] ?? []);
    const layer = el('div', 'wy-oc-layer');
    const box = el('div', 'wy-oc-menu wy-ss-filter');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', `Filter column ${colName(col)}`);
    const asc = el('button', 'wy-oc-item', 'Sort A → Z'); asc.type = 'button';
    const desc = el('button', 'wy-oc-item', 'Sort Z → A'); desc.type = 'button';
    const search = el('input', 'wy-ss-fsearch'); search.placeholder = 'Search'; search.setAttribute('aria-label', 'Search values');
    const list = el('div', 'wy-ss-flist');
    const all = el('label', 'wy-ss-fitem'); const allBox = el('input'); allBox.type = 'checkbox'; all.append(allBox, document.createTextNode('(Select all)'));
    const boxes: { v: string; b: HTMLInputElement; row: HTMLElement }[] = [];
    for (const v of values) {
      const row = el('label', 'wy-ss-fitem'); const b = el('input'); b.type = 'checkbox'; b.checked = !hidden.has(v);
      row.append(b, document.createTextNode(v === '' ? '(Blanks)' : v)); list.append(row); boxes.push({ v, b, row });
    }
    const syncAll = () => { const on = boxes.filter((x) => !x.row.hidden); allBox.checked = on.length > 0 && on.every((x) => x.b.checked); allBox.indeterminate = !allBox.checked && on.some((x) => x.b.checked); };
    syncAll();
    for (const x of boxes) x.b.addEventListener('change', syncAll);
    allBox.addEventListener('change', () => { for (const x of boxes) if (!x.row.hidden) x.b.checked = allBox.checked; syncAll(); });
    search.addEventListener('input', () => { const q = search.value.toLowerCase(); for (const x of boxes) x.row.hidden = q !== '' && !x.v.toLowerCase().includes(q); syncAll(); });
    const actions = el('div', 'wy-ss-factions');
    const ok = el('button', 'wy-ss-fbtn2 is-primary', 'OK'); ok.type = 'button';
    const cancel = el('button', 'wy-ss-fbtn2', 'Cancel'); cancel.type = 'button';
    actions.append(cancel, ok);
    box.append(asc, desc, el('div', 'wy-oc-sep'), search, all, list, actions);
    layer.append(box); root.append(layer);
    const r = anchor.getBoundingClientRect();
    box.style.left = `${Math.max(4, Math.min(r.left, document.documentElement.clientWidth - 240))}px`;
    box.style.top = `${Math.min(r.bottom + 2, document.documentElement.clientHeight - 360)}px`;
    const close = () => { layer.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', key, true); view.focus(); };
    const out = (e: Event) => { if (!layer.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    document.addEventListener('mousedown', out, true); document.addEventListener('keydown', key, true);
    const sortCol = (a: boolean) => { close(); wb.sortRange(s, { r0: f.row, r1: last, c0: f.c0, c1: f.c1 }, col, a, true); };
    asc.addEventListener('click', () => sortCol(true)); desc.addEventListener('click', () => sortCol(false));
    cancel.addEventListener('click', close);
    ok.addEventListener('click', () => { const off = boxes.filter((x) => !x.b.checked).map((x) => x.v); close(); wb.setFilterValues(s, col, off); });
    search.focus();
  };

  // ---- context menu
  const clipEntries = (): MenuEntry[] => [
    { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', disabled: readOnly, onClick: () => view.copyCommand(true) },
    { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => view.copyCommand(false) },
    { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', disabled: readOnly, onClick: () => { void view.pasteCommand('all'); } },
    { label: 'Paste values only', disabled: readOnly, onClick: () => { void view.pasteCommand('values'); } },
    { label: 'Paste formats only', disabled: readOnly, onClick: () => { void view.pasteCommand('formats'); } },
  ];
  const openContext = (x: number, y: number, zone: 'cell' | 'col' | 'row') => {
    const r = rg();
    const nRows = r.r1 - r.r0 + 1; const nCols = r.c1 - r.c0 + 1;
    const entries: MenuEntry[] = [...clipEntries(), '-'];
    if (zone !== 'col') entries.push({ label: nRows > 1 ? `Insert ${nRows} rows above` : 'Insert row above', icon: 'rowAbove', disabled: readOnly, onClick: () => insertRows(false) }, { label: nRows > 1 ? `Insert ${nRows} rows below` : 'Insert row below', icon: 'rowBelow', disabled: readOnly, onClick: () => insertRows(true) });
    if (zone !== 'row') entries.push({ label: nCols > 1 ? `Insert ${nCols} columns left` : 'Insert column left', icon: 'colLeft', disabled: readOnly, onClick: () => insertCols(false) }, { label: nCols > 1 ? `Insert ${nCols} columns right` : 'Insert column right', icon: 'colRight', disabled: readOnly, onClick: () => insertCols(true) });
    entries.push('-');
    if (zone !== 'col') entries.push({ label: nRows > 1 ? `Delete ${nRows} rows` : 'Delete row', icon: 'delRow', disabled: readOnly || nRows >= sh().rows, onClick: deleteRows });
    if (zone !== 'row') entries.push({ label: nCols > 1 ? `Delete ${nCols} columns` : 'Delete column', icon: 'delCol', disabled: readOnly || nCols >= sh().cols, onClick: deleteCols });
    entries.push({ label: 'Clear contents', icon: 'clear', shortcut: 'Del', disabled: readOnly, onClick: () => wb.clear(sh(), r, 'values') }, '-',
      { label: 'Sort A → Z', icon: 'sortAsc', disabled: readOnly, onClick: () => sortBy(true) }, { label: 'Sort Z → A', icon: 'sortDesc', disabled: readOnly, onClick: () => sortBy(false) });
    if (zone === 'row') entries.push('-', { label: 'Hide rows', onClick: () => wb.hideRows(sh(), r.r0, r.r1, true), disabled: readOnly }, { label: 'Unhide rows', onClick: () => wb.hideRows(sh(), Math.max(0, r.r0 - 1), r.r1 + 1, false), disabled: readOnly });
    popMenu(root, { x, y }, entries, { label: 'Cell menu', onRun: () => view.focus() });
  };

  // ---- the menus
  const btn = (id: string, label: string | undefined, ic: string, onClick: () => void, extra: { title?: string; active?: () => boolean; size?: 'large' | 'small'; edit?: boolean } = {}): Control => ({
    kind: 'button', id, label, icon: ic, title: extra.title ?? label, size: extra.size, onClick, active: extra.active, disabled: extra.edit === false ? undefined : () => readOnly,
  });
  const menu = (id: string, label: string | undefined, ic: string, entries: () => MenuEntry[], size?: 'large' | 'small', title?: string): Control => ({ kind: 'menu', id, label, icon: ic, entries, size, title: title ?? label });
  const toggleItem = (label: string, f: 'b' | 'i' | 'u' | 's', shortcut?: string): MenuEntry => ({ label, shortcut, checked: !!style()[f], disabled: readOnly, onClick: () => toggle(f) });
  const numFmtEntries = (): MenuEntry[] => FORMATS.map((f) => ({ label: f.label, checked: (style().fmt ?? 'general') === f.value, disabled: readOnly, onClick: () => patch({ fmt: f.value === 'general' ? undefined : f.value, dec: undefined }) }));
  const alignEntries = (): MenuEntry[] => [
    ...(['left', 'center', 'right'] as const).map((a) => ({ label: `Align ${a}`, icon: a === 'left' ? 'alignLeft' : a === 'center' ? 'alignCenter' : 'alignRight', checked: style().align === a, disabled: readOnly, onClick: () => patch({ align: style().align === a ? undefined : a }) })),
    '-',
    ...(['top', 'middle', 'bottom'] as const).map((a) => ({ label: `Align ${a}`, icon: a === 'top' ? 'alignTop' : a === 'middle' ? 'alignMiddle' : 'alignBottom', checked: style().valign === a, disabled: readOnly, onClick: () => patch({ valign: a === 'bottom' ? undefined : a }) })),
  ];
  const borderEntries = (): MenuEntry[] => ([['All borders', 'all'], ['Outer borders', 'outer'], ['Top border', 'top'], ['Bottom border', 'bottom'], ['Left border', 'left'], ['Right border', 'right'], ['No borders', 'none']] as const).map(([label, k]) => ({ label, disabled: readOnly, onClick: () => wb.setBorders(sh(), rg(), k) }));
  const sumEntries = (): MenuEntry[] => [['Sum', 'SUM'], ['Average', 'AVERAGE'], ['Count numbers', 'COUNT'], ['Max', 'MAX'], ['Min', 'MIN']].map(([label, fn]) => ({ label, disabled: readOnly, onClick: () => autoSum(fn) }));
  const functionEntries = (): MenuEntry[] => Object.entries(FUNCTIONS).map(([cat, names]) => ({ label: cat, items: names.map((n) => ({ label: n, disabled: readOnly, onClick: () => insertFunction(n) })) }));
  const freezeEntries = (): MenuEntry[] => [
    { label: 'Freeze top row', onClick: () => wb.setFreeze(sh(), 1, 0), checked: sh().freezeRows === 1 && sh().freezeCols === 0 },
    { label: 'Freeze first column', onClick: () => wb.setFreeze(sh(), 0, 1), checked: sh().freezeRows === 0 && sh().freezeCols === 1 },
    { label: 'Freeze panes at the selection', onClick: () => wb.setFreeze(sh(), view.active.r, view.active.c) },
    { label: 'Unfreeze panes', onClick: () => wb.setFreeze(sh(), 0, 0), disabled: !sh().freezeRows && !sh().freezeCols },
  ];
  const clearEntries = (): MenuEntry[] => [
    { label: 'Clear all', disabled: readOnly, onClick: () => wb.clear(sh(), rg(), 'all') },
    { label: 'Clear formats', disabled: readOnly, onClick: () => wb.clear(sh(), rg(), 'formats') },
    { label: 'Clear contents', shortcut: 'Del', disabled: readOnly, onClick: () => wb.clear(sh(), rg(), 'values') },
  ];
  const fillEntries = (): MenuEntry[] => [
    { label: 'Down', shortcut: 'Ctrl+D', disabled: readOnly, onClick: () => view.fillEdge('down') },
    { label: 'Right', shortcut: 'Ctrl+R', disabled: readOnly, onClick: () => view.fillEdge('right') },
  ];
  const sortEntries = (): MenuEntry[] => [
    { label: 'Sort A → Z', icon: 'sortAsc', disabled: readOnly, onClick: () => sortBy(true) },
    { label: 'Sort Z → A', icon: 'sortDesc', disabled: readOnly, onClick: () => sortBy(false) },
    '-',
    { label: sh().filter ? 'Turn filter off' : 'Turn filter on', icon: 'filter', disabled: readOnly, onClick: toggleFilter },
  ];
  const insertEntries = (): MenuEntry[] => [
    { label: 'Row above', icon: 'rowAbove', disabled: readOnly, onClick: () => insertRows(false) }, { label: 'Row below', icon: 'rowBelow', disabled: readOnly, onClick: () => insertRows(true) },
    { label: 'Column left', icon: 'colLeft', disabled: readOnly, onClick: () => insertCols(false) }, { label: 'Column right', icon: 'colRight', disabled: readOnly, onClick: () => insertCols(true) },
    '-', { label: 'New sheet', icon: 'sheetAdd', disabled: readOnly, onClick: () => { wb.addSheet(); view.select({ r0: 0, c0: 0, r1: 0, c1: 0 }); } },
  ];
  const deleteEntries = (): MenuEntry[] => [
    { label: 'Delete rows', icon: 'delRow', disabled: readOnly, onClick: deleteRows }, { label: 'Delete columns', icon: 'delCol', disabled: readOnly, onClick: deleteCols },
    '-', { label: 'Delete sheet', disabled: readOnly || wb.sheets.length < 2, onClick: () => { wb.deleteSheet(sh()); } },
  ];
  const fileEntries = (): MenuEntry[] => [
    { label: 'Import CSV…', icon: 'openFile', disabled: readOnly, onClick: importFile },
    { label: 'Download CSV', icon: 'download', onClick: () => download(wb.toCSV(sh()), `${safeName(sh().name, 'sheet')}.csv`, 'text/csv') },
    { label: 'Download JSON', onClick: () => download(JSON.stringify(wb.toJSON(), null, 2), 'spreadsheet.json', 'application/json') },
    '-', { label: 'Print', icon: 'print', shortcut: 'Ctrl+P', onClick: printSheet },
  ];
  const pasteEntries = (): MenuEntry[] => [
    { label: 'Paste', disabled: readOnly, onClick: () => { void view.pasteCommand('all'); } },
    { label: 'Paste values only', disabled: readOnly, onClick: () => { void view.pasteCommand('values'); } },
    { label: 'Paste formats only', disabled: readOnly, onClick: () => { void view.pasteCommand('formats'); } },
  ];
  const zoomOptions = [50, 75, 90, 100, 110, 125, 150, 175, 200].map((p) => ({ label: `${p}%`, value: String(p) }));

  const fontSel = (): Control => ({ kind: 'select', id: 'font', title: 'Font', width: 120, options: () => [{ label: 'Default', value: '' }, ...FONTS.map((f) => ({ label: f, value: f }))], value: () => style().font ?? '', onChange: (v) => patch({ font: v || undefined }), disabled: () => readOnly });
  const sizeSel = (): Control => ({ kind: 'select', id: 'size', title: 'Font size', width: 62, options: () => SIZES.map((n) => ({ label: String(n), value: String(n) })), value: () => String(style().size ?? 11), onChange: (v) => patch({ size: Number(v) === 11 ? undefined : Number(v) }), disabled: () => readOnly });
  const fmtSel = (): Control => ({ kind: 'select', id: 'numfmt', title: 'Number format', width: 100, options: () => FORMATS, value: () => style().fmt ?? 'general', onChange: (v) => patch({ fmt: v === 'general' ? undefined : v, dec: undefined }), disabled: () => readOnly });
  const fontColor = (): Control => ({ kind: 'color', id: 'fontcolor', title: 'Text colour', icon: 'fontColor', value: () => style().color ?? '#000000', onPick: (c) => patch({ color: c ?? undefined }), disabled: () => readOnly });
  const fillColor = (): Control => ({ kind: 'color', id: 'fillcolor', title: 'Fill colour', icon: 'fillColor', value: () => style().bg ?? null, onPick: (c) => patch({ bg: c ?? undefined }), disabled: () => readOnly });
  const B = (id: string, label: string, ic: string, f: 'b' | 'i' | 'u' | 's', key: string): Control => btn(id, undefined, ic, () => toggle(f), { title: `${label} (${key})`, active: () => !!style()[f] });
  const undoRedo = (): Control[] => [
    { kind: 'button', id: 'undo', icon: 'undo', title: 'Undo (Ctrl+Z)', onClick: () => wb.undo(), disabled: () => !wb.canUndo || readOnly },
    { kind: 'button', id: 'redo', icon: 'redo', title: 'Redo (Ctrl+Y)', onClick: () => wb.redo(), disabled: () => !wb.canRedo || readOnly },
  ];
  const sep: Control = { kind: 'sep' };
  const zoomSel = (): Control => ({ kind: 'select', id: 'zoom', title: 'Zoom', width: 76, options: () => zoomOptions, value: () => String(Math.round(view.zoom * 100)), onChange: (v) => setZoom(Number(v)) });

  const spec = (): ChromeSpec => ({
    tabs: [
      { id: 'file', label: 'File', groups: [
        { label: 'Open and save', controls: [menu('file-import', 'Import', 'openFile', () => [{ label: 'Import CSV…', disabled: readOnly, onClick: importFile }], 'large'), menu('file-download', 'Download', 'download', () => fileEntries().slice(1, 3), 'large')] },
        { label: 'Print', controls: [btn('print', 'Print', 'print', printSheet, { size: 'large', edit: false })] },
      ] },
      { id: 'home', label: 'Home', groups: [
        { label: 'Undo', controls: undoRedo() },
        { label: 'Clipboard', controls: [menu('paste', 'Paste', 'paste', pasteEntries, 'large'), btn('cut', 'Cut', 'cut', () => view.copyCommand(true)), btn('copy', 'Copy', 'copy', () => view.copyCommand(false), { edit: false })] },
        { label: 'Font', controls: [fontSel(), sizeSel(), sep, B('bold', 'Bold', 'bold', 'b', 'Ctrl+B'), B('italic', 'Italic', 'italic', 'i', 'Ctrl+I'), B('underline', 'Underline', 'underline', 'u', 'Ctrl+U'), B('strike', 'Strikethrough', 'strike', 's', ''), sep, menu('borders', undefined, 'borders', borderEntries, 'small', 'Borders'), fillColor(), fontColor()] },
        { label: 'Alignment', controls: [
          btn('al-left', undefined, 'alignLeft', () => patch({ align: style().align === 'left' ? undefined : 'left' }), { title: 'Align left', active: () => style().align === 'left' }),
          btn('al-center', undefined, 'alignCenter', () => patch({ align: style().align === 'center' ? undefined : 'center' }), { title: 'Center', active: () => style().align === 'center' }),
          btn('al-right', undefined, 'alignRight', () => patch({ align: style().align === 'right' ? undefined : 'right' }), { title: 'Align right', active: () => style().align === 'right' }),
          sep,
          btn('al-top', undefined, 'alignTop', () => patch({ valign: style().valign === 'top' ? undefined : 'top' }), { title: 'Align top', active: () => style().valign === 'top' }),
          btn('al-mid', undefined, 'alignMiddle', () => patch({ valign: style().valign === 'middle' ? undefined : 'middle' }), { title: 'Align middle', active: () => style().valign === 'middle' }),
          btn('al-bot', undefined, 'alignBottom', () => patch({ valign: style().valign === 'bottom' ? undefined : 'bottom' }), { title: 'Align bottom', active: () => style().valign === 'bottom' }),
          sep, btn('wrap', undefined, 'wrap', () => toggle('wrap'), { title: 'Wrap text', active: () => !!style().wrap }),
        ] },
        { label: 'Number', controls: [fmtSel(), sep, btn('currency', undefined, 'currency', () => patch({ fmt: 'currency', dec: undefined }), { title: 'Currency' }), btn('percent', undefined, 'percent', () => patch({ fmt: 'percent', dec: undefined }), { title: 'Percent (Ctrl+Shift+5)' }), btn('comma', ',', '', () => patch({ fmt: 'number', dec: undefined }), { title: 'Number with separators' }), btn('dec-more', undefined, 'decimalMore', () => patch({ dec: Math.min(10, decimalsOf() + 1) }), { title: 'More decimals' }), btn('dec-less', undefined, 'decimalLess', () => patch({ dec: Math.max(0, decimalsOf() - 1) }), { title: 'Fewer decimals' })] },
        { label: 'Cells', controls: [menu('insert-cells', 'Insert', 'sheetAdd', insertEntries, 'large'), menu('delete-cells', 'Delete', 'delRow', deleteEntries, 'large')] },
        { label: 'Editing', controls: [menu('autosum', 'AutoSum', 'sum', sumEntries, 'large'), menu('fill', 'Fill', 'rowBelow', fillEntries, 'small'), menu('clear', 'Clear', 'clear', clearEntries, 'small'), menu('sort', 'Sort & Filter', 'filter', sortEntries, 'large'), btn('find', 'Find', 'find', openFind, { size: 'large', edit: false })] },
      ] },
      { id: 'insert', label: 'Insert', groups: [
        { label: 'Rows and columns', controls: [btn('i-row-a', 'Row above', 'rowAbove', () => insertRows(false), { size: 'large' }), btn('i-row-b', 'Row below', 'rowBelow', () => insertRows(true), { size: 'large' }), btn('i-col-l', 'Column left', 'colLeft', () => insertCols(false), { size: 'large' }), btn('i-col-r', 'Column right', 'colRight', () => insertCols(true), { size: 'large' })] },
        { label: 'Sheets', controls: [btn('i-sheet', 'New sheet', 'sheetAdd', () => { wb.addSheet(); view.select({ r0: 0, c0: 0, r1: 0, c1: 0 }); }, { size: 'large' })] },
        { label: 'Functions', controls: [menu('i-fn', 'Function', 'function', functionEntries, 'large')] },
      ] },
      { id: 'formulas', label: 'Formulas', groups: [
        { label: 'Function library', controls: [menu('f-autosum', 'AutoSum', 'sum', sumEntries, 'large'), ...Object.keys(FUNCTIONS).map((cat): Control => menu(`f-${cat}`, cat, 'function', () => FUNCTIONS[cat].map((n) => ({ label: n, disabled: readOnly, onClick: () => insertFunction(n) })), 'large'))] },
        { label: 'Auditing', controls: [btn('showf', 'Show formulas', 'code', () => { view.setOptions({ showFormulas: !view.showFormulas }); }, { size: 'large', active: () => view.showFormulas, edit: false })] },
      ] },
      { id: 'data', label: 'Data', groups: [
        { label: 'Sort and filter', controls: [btn('d-asc', 'Sort A → Z', 'sortAsc', () => sortBy(true), { size: 'large' }), btn('d-desc', 'Sort Z → A', 'sortDesc', () => sortBy(false), { size: 'large' }), btn('d-filter', 'Filter', 'filter', toggleFilter, { size: 'large', active: () => !!sh().filter })] },
        { label: 'Data', controls: [menu('d-import', 'Import CSV', 'openFile', () => [{ label: 'Import CSV…', disabled: readOnly, onClick: importFile }], 'large'), btn('d-csv', 'Download CSV', 'download', () => download(wb.toCSV(sh()), `${safeName(sh().name, 'sheet')}.csv`, 'text/csv'), { size: 'large', edit: false })] },
      ] },
      { id: 'view', label: 'View', groups: [
        { label: 'Show', controls: [
          btn('v-grid', 'Gridlines', 'grid', () => view.setOptions({ gridlines: !view.gridlines }), { size: 'large', active: () => view.gridlines, edit: false }),
          btn('v-head', 'Headings', 'table', () => view.setOptions({ headings: !view.headings }), { size: 'large', active: () => view.headings, edit: false }),
          btn('v-bar', 'Formula bar', 'function', () => { showFormulaBar = !showFormulaBar; applyFormulaBar(); }, { size: 'large', active: () => showFormulaBar, edit: false }),
        ] },
        { label: 'Zoom', controls: [zoomSel()] },
        { label: 'Window', controls: [menu('v-freeze', 'Freeze Panes', 'freeze', freezeEntries, 'large')] },
      ] },
    ],
    menus: [
      { label: 'File', entries: fileEntries },
      { label: 'Edit', entries: () => [
        { label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', disabled: !wb.canUndo || readOnly, onClick: () => wb.undo() },
        { label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Y', disabled: !wb.canRedo || readOnly, onClick: () => wb.redo() }, '-',
        ...clipEntries(), '-',
        { label: 'Find and replace', icon: 'find', shortcut: 'Ctrl+F', onClick: openFind },
        { label: 'Select all', shortcut: 'Ctrl+A', onClick: () => view.selectAll() },
        { label: 'Clear', items: clearEntries() },
      ] },
      { label: 'View', entries: () => [
        { label: 'Freeze', items: freezeEntries() }, '-',
        { label: 'Gridlines', checked: view.gridlines, onClick: () => view.setOptions({ gridlines: !view.gridlines }) },
        { label: 'Headings', checked: view.headings, onClick: () => view.setOptions({ headings: !view.headings }) },
        { label: 'Formula bar', checked: showFormulaBar, onClick: () => { showFormulaBar = !showFormulaBar; applyFormulaBar(); } },
        { label: 'Show formulas', checked: view.showFormulas, onClick: () => view.setOptions({ showFormulas: !view.showFormulas }) }, '-',
        { label: 'Zoom', items: zoomOptions.map((z) => ({ label: z.label, checked: Number(z.value) === Math.round(view.zoom * 100), onClick: () => setZoom(Number(z.value)) })) },
      ] },
      { label: 'Insert', entries: () => [...insertEntries(), '-', { label: 'Function', items: functionEntries() }] },
      { label: 'Format', entries: () => [
        toggleItem('Bold', 'b', 'Ctrl+B'), toggleItem('Italic', 'i', 'Ctrl+I'), toggleItem('Underline', 'u', 'Ctrl+U'), toggleItem('Strikethrough', 's'), '-',
        { label: 'Number', items: numFmtEntries() }, { label: 'Align', items: alignEntries() }, { label: 'Borders', items: borderEntries() },
        { label: 'Wrap text', checked: !!style().wrap, disabled: readOnly, onClick: () => toggle('wrap') }, '-',
        { label: 'Clear formatting', disabled: readOnly, onClick: () => wb.clear(sh(), rg(), 'formats') },
      ] },
      { label: 'Data', entries: () => [...sortEntries(), '-', { label: 'Hide rows', disabled: readOnly, onClick: () => wb.hideRows(sh(), rg().r0, rg().r1, true) }, { label: 'Show all rows', disabled: readOnly, onClick: () => wb.hideRows(sh(), 0, sh().rows - 1, false) }] },
    ],
    toolbar: [
      ...undoRedo(), sep, zoomSel(), sep,
      btn('currency', undefined, 'currency', () => patch({ fmt: 'currency', dec: undefined }), { title: 'Format as currency' }),
      btn('percent', undefined, 'percent', () => patch({ fmt: 'percent', dec: undefined }), { title: 'Format as percent' }),
      btn('dec-less', undefined, 'decimalLess', () => patch({ dec: Math.max(0, decimalsOf() - 1) }), { title: 'Fewer decimals' }),
      btn('dec-more', undefined, 'decimalMore', () => patch({ dec: Math.min(10, decimalsOf() + 1) }), { title: 'More decimals' }),
      fmtSel(), sep, fontSel(), sizeSel(), sep,
      B('bold', 'Bold', 'bold', 'b', 'Ctrl+B'), B('italic', 'Italic', 'italic', 'i', 'Ctrl+I'), B('underline', 'Underline', 'underline', 'u', 'Ctrl+U'), B('strike', 'Strikethrough', 'strike', 's', ''), sep,
      fontColor(), fillColor(), menu('borders', undefined, 'borders', borderEntries, 'small', 'Borders'), sep,
      menu('align', undefined, 'alignLeft', alignEntries, 'small', 'Alignment'), btn('wrap', undefined, 'wrap', () => toggle('wrap'), { title: 'Wrap text', active: () => !!style().wrap }), sep,
      btn('filter', undefined, 'filter', toggleFilter, { title: 'Filter', active: () => !!sh().filter }), menu('autosum', undefined, 'sum', sumEntries, 'small', 'Functions'),
    ],
  });

  // ---- mount
  let chrome: Chrome | null = null;
  const body = el('div', 'wy-ss-body');
  /** The formula editor shows when asked for, and always in the `'formula'` layout. */
  const applyFormulaBar = () => { fbar.hidden = menuMode === 'formula' ? false : !showFormulaBar; };
  const mountChrome = () => {
    chrome?.destroy();
    chrome = null;
    const card = menuMode === 'floating' || menuMode === 'menubar';
    root.classList.toggle('is-floating', card || menuMode === 'formula');
    root.dataset.menu = menuMode;
    applyFormulaBar();
    if (menuMode === 'formula' || menuMode === 'none') return;
    chrome = new Chrome(spec(), { mode: menuMode === 'classic' ? 'classic' : 'floating', toolbar: menuMode !== 'menubar', title: o.title, onTitle: o.onTitle, end: o.end, root, focus: () => view.focus(), initialTab: o.initialTab ?? 'home', label: 'Spreadsheet menu' });
    root.prepend(chrome.el);
    chrome.refresh();
    if (saveStatus) chrome.setStatus(saveStatus);
  };
  body.append(fbar, view.el, findPanel);
  const suggests = [attachSuggest(formulaInput, body, () => undefined), attachSuggest(view.editorEl, body, () => undefined)];
  root.append(body);
  if (o.sheetTabs !== false) root.append(tabs);
  if (o.statusBar !== false) root.append(status);
  applyFormulaBar();
  o.element.replaceChildren(root);

  // ---- saving
  let saveStatus = '';
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving = false; let dirty = false; let failures = 0;
  const setSave = (s: string) => { saveStatus = s; chrome?.setStatus(s); emit('save', { status: s }); };
  const persist = async () => {
    if (saving) return;
    if (!dirty) return;
    dirty = false; saving = true;
    setSave('saving');
    try {
      const data = wb.toJSON();
      if (o.storageKey) { try { localStorage.setItem(o.storageKey, JSON.stringify(data)); } catch { /* full or blocked */ } }
      await o.save?.(data);
      failures = 0;
      saving = false;
      if (dirty) { void persist(); return; }
      setSave('saved');
    } catch (e) {
      saving = false; dirty = true; failures++;
      setSave('error');
      saveTimer = setTimeout(() => void persist(), Math.min(30000, 1000 * 2 ** failures));
      console.error('Spreadsheet save failed', e);
    }
  };
  const wantsSave = !!(o.save || o.storageKey);
  const offChange = wb.on((e) => {
    renderTabs();
    syncBars();
    chrome?.refresh();
    if (e.label === 'load') return;
    emit('change', wb.toJSON());
    o.onChange?.(wb.toJSON());
    if (wantsSave) { dirty = true; setSave('unsaved'); clearTimeout(saveTimer); saveTimer = setTimeout(() => void persist(), o.saveDelayMs ?? 800); }
  });

  mountChrome();
  renderTabs();
  syncBars();
  view.el.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === 'f' || e.key === 'F') && !e.shiftKey) { e.preventDefault(); openFind(); }
    else if (mod && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); printSheet(); }
    else if (mod && (e.key === 's' || e.key === 'S') && wantsSave) { e.preventDefault(); void persist(); }
  });
  // the controls follow the selection; a typed letter must not keep the focus in the ribbon
  const stopSize = observeSize(root, () => { view.refresh(); chrome?.relayout(); });
  if (wantsSave) setSave('saved');
  if (readOnly) root.classList.add('is-readonly');

  const refOf = (ref: string) => { const p = parseRangeRef(ref); if (!p) throw new Error(`Not a cell name: ${ref}`); return p; };
  const api: Spreadsheet = {
    el: root, workbook: wb, view,
    getData: () => wb.toJSON(),
    setData(d) { const p = parse(d); wb.load(p); view.clearClipboard(); view.select({ r0: 0, c0: 0, r1: 0, c1: 0 }); },
    getRaw(ref) { const p = refOf(ref); return wb.raw(sh(), p.r0, p.c0); },
    getValue(ref) { const p = refOf(ref); return wb.error(sh(), p.r0, p.c0) ?? wb.value(sh(), p.r0, p.c0); },
    setValue(ref, text) { const p = refOf(ref); wb.input(sh(), p.r0, p.c0, text); },
    select(ref) { const p = refOf(ref); view.select(p, { r: p.r0, c: p.c0 }); },
    toCSV(range) { return wb.toCSV(sh(), range ? refOf(range) : undefined); },
    importCSV(text, name) { wb.importCSV(text, name); view.select({ r0: 0, c0: 0, r1: 0, c1: 0 }); },
    undo: () => { wb.undo(); }, redo: () => { wb.redo(); },
    setMenu(m) { if (m === menuMode || !MENU_MODES.includes(m)) return; menuMode = m; mountChrome(); },
    setFormulaBar(on) { showFormulaBar = on; applyFormulaBar(); chrome?.refresh(); },
    setTheme(t) { applyTheme(t); },
    setReadOnly(on) { readOnly = on; view.setOptions({ readOnly: on }); root.classList.toggle('is-readonly', on); renderTabs(); syncBars(); chrome?.refresh(); },
    focus: () => view.focus(),
    on(event, fn) { let s = listeners.get(event); if (!s) listeners.set(event, (s = new Set())); s.add(fn); return () => s!.delete(fn); },
    destroy() { clearTimeout(saveTimer); offChange(); stopSize(); sysQuery?.removeEventListener?.('change', onSys); chrome?.destroy(); for (const x of suggests) x.destroy(); view.destroy(); root.remove(); listeners.clear(); },
  };
  return api;
}
