import { test } from '@playwright/test';
import { editorReady, expect, html, openDemo, placeCursor } from './helpers';

test('typing and keyboard formatting work', async ({ page }) => {
  const problems = await openDemo(page, 'feature-rich');
  await editorReady(page);
  await placeCursor(page, 'Lorem ipsum', true);
  await page.keyboard.press('ControlOrMeta+b');
  expect(await html(page)).toContain('<strong>Lorem ipsum');
  await page.keyboard.press('ControlOrMeta+b');
  await placeCursor(page, 'Lorem ipsum');
  await page.keyboard.type(' ADDED-BY-TEST');
  expect(await html(page)).toContain('ADDED-BY-TEST');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await html(page)).not.toContain('ADDED-BY-TEST');
  expect(problems).toEqual([]);
});

test('pasting from Word gives a real nested list, not a picture', async ({ page }) => {
  await openDemo(page, 'feature-rich');
  await editorReady(page);
  const result = await page.evaluate(() => {
    const ed = (window as any).editor;
    const sp = "<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp;&nbsp;&nbsp; </span>";
    const li = (lvl: number, mark: string, t: string) => `<p class=MsoListParagraphCxSpMiddle style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level${lvl} lfo1'><![if !supportLists]><span style='mso-list:Ignore'>${mark}${sp}</span><![endif]>${t}<o:p></o:p></p>`;
    const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta name=Generator content="Microsoft Word 15"></head><body><!--StartFragment--><p class=MsoNormal>Intro<o:p></o:p></p>${li(1, '1.', 'First')}${li(2, 'a.', 'Nested')}${li(1, '2.', 'Second')}<!--EndFragment--></body></html>`;
    ed.view.focus();
    ed.view.pasteHTML(word);
    const dom: HTMLElement = ed.view.dom;
    return { nested: dom.querySelectorAll('ol ol').length, type: dom.querySelector('ol ol')?.getAttribute('type'), images: dom.querySelectorAll('img[src^="data:"]').length, noise: /mso-|o:p/i.test(ed.getHTML()) };
  });
  expect(result).toEqual({ nested: 1, type: 'a', images: 0, noise: false });
});

test('the paged layout splits the document into pages with a header', async ({ page }) => {
  await openDemo(page, 'feature-rich');
  await expect(page.locator('.wy-page-header').first()).toBeVisible();
  expect(await page.locator('.wy-page-header').count()).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.wy-ruler').first()).toBeVisible();
});

test('a heading can become a bulleted or numbered item and stays a heading', async ({ page }) => {
  const problems = await openDemo(page, 'feature-rich');
  await editorReady(page);
  await page.waitForSelector('.wy-page-header');
  await placeCursor(page, 'Background');
  await page.getByRole('button', { name: 'Bulleted list' }).first().click();
  expect(await html(page)).toMatch(/<ul><li><h2>Background<\/h2>/);
  await page.getByRole('button', { name: 'Numbered list' }).first().click();                // the same item becomes a numbered one
  expect(await html(page)).toMatch(/<ol[^>]*><li><h2>Background<\/h2>/);
  await page.getByRole('button', { name: 'Numbered list' }).first().click();                // and back to a plain heading
  expect(await html(page)).toContain('<h2>Background</h2>');
  expect(await html(page)).not.toMatch(/<li><h2>Background/);
  expect(problems).toEqual([]);
});

test('the number of a numbered heading is as big as the heading', async ({ page }) => {
  const problems = await openDemo(page, 'feature-rich');
  await editorReady(page);
  await page.waitForSelector('.wy-page-header');
  await placeCursor(page, 'Project proposal');
  await page.getByRole('button', { name: 'Numbered list' }).first().click();
  const sizes = await page.evaluate(() => {
    const li = document.querySelector('.ProseMirror ol > li')!;
    const h = li.querySelector('h1')!;
    return { marker: parseFloat(getComputedStyle(li, '::marker').fontSize), heading: parseFloat(getComputedStyle(h).fontSize), weight: getComputedStyle(li, '::marker').fontWeight };
  });
  expect(sizes.marker).toBeCloseTo(sizes.heading, 0);                    // not the small body size
  expect(Number(sizes.weight)).toBeGreaterThanOrEqual(600);
  expect(problems).toEqual([]);
});

test('picture styles: pick a look from the gallery, see it, and clear it', async ({ page }) => {
  const problems = await openDemo(page, 'images', '.ProseMirror img');
  await page.locator('.ProseMirror img').first().click();
  await page.getByRole('tab', { name: 'Picture' }).click();                // the tab for a selected picture
  await page.getByRole('button', { name: 'Picture Styles' }).click();
  expect(await page.getByRole('menuitemradio').count()).toBe(28);
  await page.getByRole('menuitemradio', { name: 'Metal oval' }).click();
  const img = page.locator('.ProseMirror img').first();
  await expect(img).toHaveCSS('border-radius', /50%|[0-9.]+px/);
  expect(await img.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('8px');
  await page.getByRole('button', { name: 'Picture Styles' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Metal oval' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitem', { name: 'Clear Style' }).click();
  expect(await img.evaluate((e) => getComputedStyle(e).borderTopWidth)).toBe('0px');
  expect(problems).toEqual([]);
});
