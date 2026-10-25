import { test } from '@playwright/test';
import { expect, openDemo } from './helpers';

type Sheet = { select(r: string): void; getData(): { sheets: { merges?: string[]; cf?: unknown[]; charts?: { x: number; y: number; type: string; title: string }[] }[] } };
const sheetReady = (page: import('@playwright/test').Page) => page.waitForFunction(() => !!(window as unknown as { sheet?: unknown }).sheet);
const data = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { sheet: Sheet }).sheet.getData().sheets[0]);
const select = (page: import('@playwright/test').Page, ref: string) => page.evaluate((r) => (window as unknown as { sheet: Sheet }).sheet.select(r), ref);

test('spreadsheet: merge cells, conditional formatting and a chart from the ribbon', async ({ page }) => {
  await page.goto('demo/spreadsheet-classic.html');
  await page.evaluate(() => localStorage.removeItem('wy-demo-spreadsheet-classic'));
  const problems = await openDemo(page, 'spreadsheet-classic', '.wy-ss-grid');
  await sheetReady(page);

  // merge K1:L2 from the Alignment group, then undo
  await select(page, 'K1:L2');
  await page.locator('[data-control="merge"]').click();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: /^Merge cells$/ }).click();
  expect((await data(page)).merges).toEqual(['K1:L2']);
  await expect(page.locator('.wy-ss-c.is-merged')).toHaveCount(1);
  await page.keyboard.press('ControlOrMeta+z');
  expect((await data(page)).merges).toBeUndefined();

  // highlight the totals above 2000
  await select(page, 'F2:F13');
  await page.locator('[data-control="cf"]').click();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'Highlight cells' }).hover();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'Greater than' }).click();
  await page.locator('.wy-ss-dialog input[name="a"]').fill('2000');
  await page.locator('.wy-ss-dialog button[type="submit"]').click();
  expect((await data(page)).cf).toHaveLength(1);
  const bg = (r: number) => page.locator(`.wy-ss-c[data-r="${r}"][data-c="5"]`).evaluate((n) => (n as HTMLElement).style.backgroundColor);
  expect(await bg(7)).not.toBe('');     // F8: 2,572
  expect(await bg(1)).toBe('');         // F2: 1,710

  // a chart of the whole table from Insert > Chart
  await page.locator('.wy-oc-tab', { hasText: 'Insert' }).click();
  await select(page, 'A1:C13');
  await page.locator('[data-control="i-chart"]').click();
  await page.locator('.wy-ss-dialog input[name="title"]').fill('Rent and food');
  await page.locator('.wy-ss-dialog button[type="submit"]').click();
  await expect(page.locator('.wy-ss-chart svg')).toHaveCount(1);
  await expect(page.locator('.wy-ss-chart')).toContainText('Rent and food');
  const before = (await data(page)).charts![0];
  const box = (await page.locator('.wy-ss-chart').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 160, box.y + 130, { steps: 4 });
  await page.mouse.up();
  const after = (await data(page)).charts![0];
  expect(after.x).toBeGreaterThan(before.x + 40);
  expect(after.y).toBeGreaterThan(before.y + 30);
  await page.keyboard.press('Delete');
  expect((await data(page)).charts).toBeUndefined();
  expect(problems).toEqual([]);
});
