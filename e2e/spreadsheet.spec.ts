import { test } from '@playwright/test';
import { expect, openDemo } from './helpers';

type Sheet = { getRaw(r: string): string; getValue(r: string): string | number; setValue(r: string, t: string): void; select(r: string): void; getData(): { sheets: { name: string }[] }; toCSV(): string };
const sheetReady = (page: import('@playwright/test').Page) => page.waitForFunction(() => !!(window as unknown as { sheet?: unknown }).sheet);
const raw = (page: import('@playwright/test').Page, ref: string) => page.evaluate((r) => (window as unknown as { sheet: Sheet }).sheet.getRaw(r), ref);
const value = (page: import('@playwright/test').Page, ref: string) => page.evaluate((r) => (window as unknown as { sheet: Sheet }).sheet.getValue(r), ref);
const cell = (page: import('@playwright/test').Page, ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  const c = m[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return page.locator(`.wy-ss-c[data-r="${Number(m[2]) - 1}"][data-c="${c}"]`);
};
const clear = async (page: import('@playwright/test').Page, key: string) => { await page.goto('demo/spreadsheet-classic.html'); await page.evaluate((k) => localStorage.removeItem(k), key); };

for (const mode of ['classic', 'floating'] as const) {
  test(`spreadsheet (${mode}): type, formulas, undo, bold, sort`, async ({ page }) => {
    await page.goto(`demo/spreadsheet-${mode}.html`);
    await page.evaluate((m) => localStorage.removeItem(`wy-demo-spreadsheet-${m}`), mode);
    const problems = await openDemo(page, `spreadsheet-${mode}`, '.wy-ss-grid');
    await sheetReady(page);
    // click a cell, type, Enter moves down
    await cell(page, 'I2').click();
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await page.keyboard.type('=I2*3');
    await page.keyboard.press('Enter');
    expect(await raw(page, 'I2')).toBe('5');
    expect(await raw(page, 'I3')).toBe('=I2*3');
    expect(await value(page, 'I3')).toBe(15);
    await expect(cell(page, 'I3')).toHaveText('15');
    // the formula bar shows the formula of the active cell
    await cell(page, 'I3').click();
    await expect(page.locator('.wy-ss-formula')).toHaveValue('=I2*3');
    await expect(page.locator('.wy-ss-name')).toHaveValue('I3');
    // edit through the formula bar
    await page.locator('.wy-ss-formula').click();
    await page.locator('.wy-ss-formula').fill('=I2*4');
    await page.keyboard.press('Enter');
    expect(await value(page, 'I3')).toBe(20);
    // undo
    await page.locator('.wy-ss-grid').focus();
    await page.keyboard.press('ControlOrMeta+z');
    expect(await value(page, 'I3')).toBe(15);
    // bold with the keyboard
    await cell(page, 'A2').click();
    await page.keyboard.press('ControlOrMeta+b');
    await expect(cell(page, 'A2')).toHaveCSS('font-weight', '700');
    // arrow keys and Delete
    await cell(page, 'I2').click();
    await page.keyboard.press('Delete');
    expect(await raw(page, 'I2')).toBe('');
    await expect(cell(page, 'I3')).toHaveText('0');
    // the status bar sums a selection
    await cell(page, 'B2').click();
    await cell(page, 'B4').click({ modifiers: ['Shift'] });
    await expect(page.locator('.wy-ss-summary')).toContainText('Sum: 3,600');
    expect(problems).toEqual([]);
  });
}

test('spreadsheet: ribbon buttons, number formats, insert rows, sort and the filter', async ({ page }) => {
  await clear(page, 'wy-demo-spreadsheet-classic');
  const problems = await openDemo(page, 'spreadsheet-classic', '.wy-ss-grid');
  await sheetReady(page);
  // select Rent..Food column cells and make them bold from the ribbon
  await cell(page, 'B2').click();
  await page.locator('[data-control="bold"]').click();
  await expect(cell(page, 'B2')).toHaveCSS('font-weight', '700');
  // a number format from the ribbon select
  await cell(page, 'A2').click();
  await page.locator('.wy-oc-panel:not([hidden]) select[aria-label="Number format"]').selectOption('percent');
  await page.evaluate(() => (window as any).sheet.setValue('A2', '0.25'));
  // insert a row above row 3: the totals formula follows
  await cell(page, 'A3').click();
  await page.locator('#wy-oc-tab-insert').click();
  await page.locator('[data-control="i-row-a"]').click();
  expect(await raw(page, 'B15')).toBe('=SUM(B2:B14)');
  expect(await raw(page, 'A3')).toBe('');
  // undo from the ribbon
  await page.locator('#wy-oc-tab-home').click();
  await page.locator('[data-control="undo"]').click();
  expect(await raw(page, 'B14')).toBe('=SUM(B2:B13)');
  // sort Total descending from the Data tab
  await page.evaluate(() => (window as any).sheet.view.select({ r0: 1, c0: 0, r1: 12, c1: 6 }, { r: 1, c: 5 }));
  await page.locator('#wy-oc-tab-data').click();
  await page.locator('[data-control="d-desc"]').click();
  expect(await raw(page, 'A2')).toBe('Jul');
  // the filter shows an arrow on the header cells and hides rows
  await cell(page, 'A1').click();
  await page.locator('[data-control="d-filter"]').click();
  await expect(page.locator('.wy-ss-fbtn').first()).toBeVisible();
  await page.locator('.wy-ss-fbtn[data-filter="0"]').click();
  await page.locator('.wy-ss-filter label.wy-ss-fitem', { hasText: 'Dec' }).locator('input').uncheck();
  await page.locator('.wy-ss-filter .is-primary').click();
  await expect(cell(page, 'A2')).toHaveText('Jul');
  expect(await page.evaluate(() => (window as any).sheet.workbook.sheet.hidden.size)).toBe(1);
  expect(problems).toEqual([]);
});

test('spreadsheet: floating menu bar, drop-down and copy / paste between cells', async ({ page }) => {
  await page.goto('demo/spreadsheet-floating.html');
  await page.evaluate(() => localStorage.removeItem('wy-demo-spreadsheet-floating'));
  const problems = await openDemo(page, 'spreadsheet-floating', '.wy-ss-grid');
  await sheetReady(page);
  expect(await page.locator('.wy-oc-menu-btn').allTextContents()).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Data']);
  // Insert > Row below
  await cell(page, 'A5').click();
  await page.locator('.wy-oc-menu-btn', { hasText: 'Insert' }).click();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'Row below' }).click();
  expect(await raw(page, 'A6')).toBe('');
  expect(await raw(page, 'A7')).toBe('May');
  // copy and paste a formula: it moves with the cells
  await cell(page, 'F2').click();
  await page.keyboard.press('ControlOrMeta+c');
  await cell(page, 'I2').click();
  await page.keyboard.press('ControlOrMeta+v');
  expect(await raw(page, 'I2')).toBe('=SUM(E2:H2)');
  // typing text starts editing; Escape cancels
  await cell(page, 'K1').click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Escape');
  expect(await raw(page, 'K1')).toBe('');
  // fill handle: drag Ctrl+D copies down
  await cell(page, 'K1').click();
  await page.keyboard.type('x');
  await page.keyboard.press('Tab');
  await cell(page, 'K1').click();
  await cell(page, 'K3').click({ modifiers: ['Shift'] });
  await page.keyboard.press('ControlOrMeta+d');
  expect(await raw(page, 'K3')).toBe('x');
  // File menu has the downloads
  await page.locator('.wy-oc-menu-btn', { hasText: 'File' }).click();
  await expect(page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'Download CSV' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});

test('spreadsheet: a long sheet scrolls and only draws what is visible', async ({ page }) => {
  await page.goto('demo/spreadsheet-classic.html');
  await page.evaluate(() => localStorage.removeItem('wy-demo-spreadsheet-classic'));
  await openDemo(page, 'spreadsheet-classic', '.wy-ss-grid');
  await sheetReady(page);
  await page.evaluate(() => { const s = (window as any).sheet; s.setValue('A5000', 'far away'); });
  const count = await page.locator('.wy-ss-c').count();
  expect(count).toBeLessThan(600);
  await page.locator('.wy-ss-grid').evaluate((e) => { e.scrollTop = 24 * 4990; });
  await expect(page.locator('.wy-ss-c', { hasText: 'far away' })).toBeVisible();
});

test('spreadsheet: formula editor suggests functions, shows the syntax and the menu can be switched', async ({ page }) => {
  await page.goto('demo/spreadsheet-classic.html');
  await page.evaluate(() => localStorage.removeItem('wy-demo-spreadsheet-classic'));
  const problems = await openDemo(page, 'spreadsheet-classic', '.wy-ss-grid');
  await sheetReady(page);
  await cell(page, 'I2').click();
  await page.locator('.wy-ss-formula').click();
  await page.keyboard.type('=su');
  await expect(page.locator('.wy-ss-sg').first()).toHaveText(/SUM/);
  await page.keyboard.press('Tab');
  await expect(page.locator('.wy-ss-formula')).toHaveValue('=SUM(');
  await expect(page.locator('.wy-ss-hint:not([hidden])')).toContainText('number1');
  await page.keyboard.type('B2:B4)');
  await page.locator('.wy-ss-fb').nth(1).click(); // confirm
  expect(await raw(page, 'I2')).toBe('=SUM(B2:B4)');
  expect(await value(page, 'I2')).toBe(3600);
  // the function list inserts a name
  await cell(page, 'I3').click();
  await page.locator('.wy-ss-fx').click();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'Logical' }).hover();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: /^IF$/ }).click();
  await expect(page.locator('.wy-ss-formula')).toHaveValue('=IF(');
  await page.keyboard.press('Escape');
  // the menu choices
  for (const [mode, ribbon, bar] of [['formula', 0, 1], ['menubar', 0, 1], ['none', 0, 1], ['classic', 1, 1]] as const) {
    await page.selectOption('select[aria-label=Menu]', mode);
    await expect(page.locator('.wy-oc-tabs')).toHaveCount(ribbon);
    await expect(page.locator('.wy-ss-fbar')).toHaveCount(bar);
  }
  await page.locator('.demo-menu-picker input[type=checkbox]').uncheck();
  await expect(page.locator('.wy-ss-fbar')).toBeHidden();
  expect(problems).toEqual([]);
});
