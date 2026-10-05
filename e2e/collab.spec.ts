import { test } from '@playwright/test';
import { expect, openDemo } from './helpers';

test('two editors stay in sync, show each other, and share comments', async ({ page }) => {
  const problems = await openDemo(page, 'collab-realtime');
  const editors = page.locator('.ProseMirror');
  await expect(editors).toHaveCount(2);
  // presence: each editor lists both people
  await expect(page.locator('.wy-presence').first().locator('button')).toHaveCount(2);

  await editors.first().click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' TYPED-IN-ANA');
  await expect(editors.nth(1)).toContainText('TYPED-IN-ANA');

  // a comment written in Ana's editor appears in Bob's
  await page.evaluate(() => {
    const dom = document.querySelectorAll('.ProseMirror')[0] as HTMLElement;
    const p = dom.querySelector('p')!;
    const r = document.createRange(); r.setStart(p.firstChild!, 0); r.setEnd(p.firstChild!, 4);
    dom.focus(); const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
  });
  await page.locator('.wy-toolbar button[aria-label="Add comment"]').first().click();
  await page.locator('form.wy-ask textarea').fill('Seen from Bob?');
  await page.keyboard.press('ControlOrMeta+Enter');
  const bobComments = page.locator('.wy-editor').nth(1).locator('.wy-comment-text');
  await expect(bobComments).toHaveText('Seen from Bob?');
  expect(problems).toEqual([]);
});
