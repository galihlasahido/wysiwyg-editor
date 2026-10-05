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
