import { test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { expect, openDemo } from './helpers';

type Deck = { getData(): { slides: { id: string; layout: string; notes: string; els: { id: string; type: string; x: number; y: number; w: number; h: number; rot?: number; html?: string; ph?: string; style?: Record<string, unknown> }[] }[]; theme: string; width: number }; current: number };
const data = (page: Page) => page.evaluate(() => (window as unknown as { deck: Deck }).deck.getData());
const ready = (page: Page) => page.waitForFunction(() => !!(window as unknown as { deck?: unknown }).deck);
const open = async (page: Page, mode: 'classic' | 'floating') => {
  await page.addInitScript((m) => { try { localStorage.removeItem(`wy-demo-presentation-${m}`); } catch { /* blocked */ } }, mode);
  const problems = await openDemo(page, `presentation-${mode}`, '.wy-pr-canvas');
  await ready(page);
  return problems;
};
/** Where a box is on the screen (the middle of it). */
const centre = async (page: Page, id: string) => {
  const r = await page.locator(`.wy-pr-stagebox .wy-pr-el[data-id="${id}"]`).boundingBox();
  return { x: r!.x + r!.width / 2, y: r!.y + r!.height / 2, box: r! };
};

for (const mode of ['classic', 'floating'] as const) {
  test(`presentation (${mode}): select, move, type, resize, rotate and undo`, async ({ page }) => {
    const problems = await open(page, mode);
    expect((await data(page)).slides).toHaveLength(6);
    // slide 2 has a title and a bullet list
    await page.locator('.wy-pr-thumb').nth(1).click();
    expect((await data(page)).slides[1].els.length).toBe(2);
    const title = (await data(page)).slides[1].els.find((e) => e.ph === 'title')!;
    const c = await centre(page, title.id);
    await page.mouse.click(c.x, c.y);
    await expect(page.locator('.wy-pr-selbox.is-single')).toHaveCount(1);
    // drag it down 60 screen pixels
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y + 30, { steps: 4 });
    await page.mouse.move(c.x, c.y + 60, { steps: 4 });
    await page.mouse.up();
    const moved = (await data(page)).slides[1].els.find((e) => e.id === title.id)!;
    expect(moved.y).toBeGreaterThan(title.y + 20);
    // one undo step brings it back
    await page.keyboard.press('ControlOrMeta+z');
    expect((await data(page)).slides[1].els.find((e) => e.id === title.id)!.y).toBe(title.y);
    // arrow keys nudge
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    const nudged = (await data(page)).slides[1].els.find((e) => e.id === title.id)!;
    expect(nudged.x).toBe(title.x + 1);
    expect(nudged.y).toBe(title.y + 10);
    // resize with the south-east handle
    const before = nudged;
    const h = await page.locator('.wy-pr-handle.h-se').boundingBox();
    await page.mouse.move(h!.x + h!.width / 2, h!.y + h!.height / 2);
    await page.mouse.down();
    await page.mouse.move(h!.x + 40, h!.y + 20, { steps: 5 });
    await page.mouse.up();
    const bigger = (await data(page)).slides[1].els.find((e) => e.id === title.id)!;
    expect(bigger.w).toBeGreaterThan(before.w);
    // rotate with the handle
    const rot = await page.locator('.wy-pr-rotate').boundingBox();
    const box = await centre(page, title.id);
    await page.mouse.move(rot!.x + rot!.width / 2, rot!.y + rot!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y, { steps: 6 });
    await page.mouse.up();
    expect(((await data(page)).slides[1].els.find((e) => e.id === title.id)!.rot ?? 0)).not.toBe(0);
    // type in the body: double-click, select all, type
    const body = (await data(page)).slides[1].els.find((e) => e.ph === 'body')!;
    const bc = await centre(page, body.id);
    await page.mouse.dblclick(bc.x, bc.y);
    await expect(page.locator('.wy-pr-content[contenteditable="true"]')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Only this');
    await page.keyboard.press('Escape');
    const typed = (await data(page)).slides[1].els.find((e) => e.id === body.id)!;
    expect(typed.html).toContain('Only this');
    expect(typed.html).not.toContain('Spreadsheet');
    expect(problems).toEqual([]);
  });
}

test('presentation: ribbon formatting on a selected box and on typed words', async ({ page }) => {
  const problems = await open(page, 'classic');
  await page.locator('.wy-pr-thumb').nth(1).click();
  const body = (await data(page)).slides[1].els.find((e) => e.ph === 'body')!;
  const c = await centre(page, body.id);
  await page.mouse.click(c.x, c.y);
  // bold on the whole box from the ribbon
  await page.locator('[data-control="bold"]').click();
  expect((await data(page)).slides[1].els.find((e) => e.id === body.id)!.style).toMatchObject({ b: 1 });
  await page.locator('[data-control="al-center"]').click();
  expect((await data(page)).slides[1].els.find((e) => e.id === body.id)!.style).toMatchObject({ align: 'center' });
  // a size from the select
  await page.locator('.wy-oc-panel:not([hidden]) select[aria-label="Font size"]').selectOption('40');
  expect((await data(page)).slides[1].els.find((e) => e.id === body.id)!.style).toMatchObject({ size: 40 });
  // bullets off
  await page.locator('[data-control="bullets"]').click();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'No list' }).click();
  expect((await data(page)).slides[1].els.find((e) => e.id === body.id)!.style?.bullets).toBeUndefined();
  // words inside the box: bold only the selected word
  await page.mouse.dblclick(c.x, c.y);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('alpha beta');
  await page.evaluate(() => {
    const c = document.querySelector('.wy-pr-content[contenteditable="true"]')!;
    const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    const t = w.nextNode()!;
    const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 5);
    const sel = getSelection()!; sel.removeAllRanges(); sel.addRange(r);
  });
  await page.locator('[data-control="italic"]').click();
  await page.keyboard.press('Escape');
  const html = (await data(page)).slides[1].els.find((e) => e.id === body.id)!.html!;
  expect(html).toMatch(/<i>alpha<\/i>/);
  expect(html).toContain('beta');
  expect(problems).toEqual([]);
});

test('presentation: slides, shapes, theme, undo, sorter', async ({ page }) => {
  const problems = await open(page, 'classic');
  await page.locator('.wy-pr-thumb').first().click();
  // new slide from the ribbon menu
  await page.locator('[data-control="newslide"]').click();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'Two Content' }).click();
  expect((await data(page)).slides).toHaveLength(7);
  expect(await page.evaluate(() => (window as any).deck.current)).toBe(1);
  expect((await data(page)).slides[1].layout).toBe('twoContent');
  // a shape
  await page.locator('[data-control="shapes2"]').click();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'Star' }).click();
  expect((await data(page)).slides[1].els.some((e) => e.type === 'shape')).toBe(true);
  // delete it with the keyboard
  await page.keyboard.press('Delete');
  expect((await data(page)).slides[1].els.some((e) => e.type === 'shape')).toBe(false);
  // theme from the Design tab
  await page.locator('#wy-oc-tab-design').click();
  await page.locator('[data-control="themes"]').click();
  await page.locator('.wy-oc-menu .wy-oc-item', { hasText: 'Paper' }).click();
  expect((await data(page)).theme).toBe('mono');
  // undo the theme, then the shape delete, shape and slide
  await page.locator('.wy-pr-canvas').focus();
  await page.keyboard.press('ControlOrMeta+z');
  expect((await data(page)).theme).toBe('ocean');
  // the sorter view shows every slide
  await page.locator('.wy-pr-vbtn', { hasText: 'Slide sorter' }).click();
  await expect(page.locator('.wy-pr-sorter .wy-pr-thumb')).toHaveCount(7);
  await page.locator('.wy-pr-sorter .wy-pr-thumb').nth(3).dblclick();
  await expect(page.locator('.wy-pr-canvas')).toBeVisible();
  expect(await page.evaluate(() => (window as any).deck.current)).toBe(3);
  expect(problems).toEqual([]);
});

test('presentation: the slide show moves with the keyboard and ends with Escape', async ({ page }) => {
  const problems = await open(page, 'floating');
  await page.locator('.wy-oc-toolbar [data-control="present"], .wy-oc-more-pop [data-control="present"]').first().click();
  const show = page.locator('.wy-pr-show');
  await expect(show).toBeVisible();
  await expect(page.locator('.wy-pr-counter')).toHaveText('1 / 6');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.wy-pr-counter')).toHaveText('2 / 6');
  await expect(show.locator('.wy-pr-host:not(.leaving) .wy-pr-slide')).toContainText('What shipped');
  await page.keyboard.press('End');
  await expect(page.locator('.wy-pr-counter')).toHaveText('6 / 6');
  await page.keyboard.press('p');
  await expect(show.locator('.wy-pr-notes')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(show).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('presentation: the export is one clean page and unsafe text does not survive', async ({ page }) => {
  await open(page, 'classic');
  const out = await page.evaluate(() => {
    const d = (window as any).deck;
    d.setData({ title: 'T', theme: 'office', slides: [{ layout: 'blank', els: [{ id: 'a', type: 'text', x: 0, y: 0, w: 300, h: 100, html: '<b onclick="x()">ok</b><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bad</a>' }, { id: 'b', type: 'image', x: 0, y: 0, w: 10, h: 10, src: 'javascript:alert(1)' }] }] });
    return { html: d.toHTML(), els: d.getData().slides[0].els };
  });
  expect(out.els).toHaveLength(1);
  expect(out.html).toContain('<b>ok</b>');
  expect(out.html).not.toMatch(/onclick|<img|alert\(1\)|javascript:/i);
  expect(out.html).toContain('@page');
});
