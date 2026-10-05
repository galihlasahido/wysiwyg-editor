import { test } from '@playwright/test';
import { editorReady, expect, html, openDemo } from './helpers';

test('comments open in a modal and are added to the document', async ({ page }) => {
  await openDemo(page, 'feature-rich');
  await editorReady(page);
  await page.evaluate(() => {
    const ed = (window as any).editor;
    const p = [...ed.view.dom.querySelectorAll('p')].find((x: Element) => x.textContent!.includes('Lorem'))!;
    const r = document.createRange(); r.setStart(p.firstChild!, 0); r.setEnd(p.firstChild!, 11);
    ed.view.dom.focus(); const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
  });
  await page.evaluate(() => (window as any).editor.execute('addComment'));
  const dialog = page.locator('form.wy-ask');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.wy-ask-quote')).toContainText('Lorem ipsum');
  await dialog.locator('textarea').fill('Please cite a source');
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.wy-comment-text')).toHaveText('Please cite a source');
  expect(await html(page)).toContain('data-comment-id');
});

test('locked sections refuse edits and fill-in regions accept them', async ({ page }) => {
  await openDemo(page, 'restricted-editing');
  await editorReady(page);
  const out = await page.evaluate(async () => {
    const ed = (window as any).editor;
    const dom: HTMLElement = ed.view.dom;
    const settle = () => new Promise((r) => setTimeout(r, 250)); // ProseMirror reads typed text after the browser's input event
    const type = async (el: Element, text: string) => {
      const t = el.firstChild!; const r = document.createRange(); r.setStart(t, 1); r.collapse(true);
      dom.focus(); const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
      document.execCommand('insertText', false, text);
      await settle();
    };
    const before = ed.getHTML();
    await type(dom.querySelector('.wy-locked h1')!, 'ZZ');
    const lockedUnchanged = ed.getHTML() === before;
    await type(dom.querySelector('.wy-region p')!, 'QQ');
    return { lockedUnchanged, regionChanged: ed.getHTML().includes('QQ') };
  });
  expect(out).toEqual({ lockedUnchanged: true, regionChanged: true });
});

test('equations (KaTeX) and diagrams (Mermaid) render', async ({ page }) => {
  const problems = await openDemo(page, 'math-diagrams');
  await expect(page.locator('.wy-math .katex').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.wy-mermaid-out svg').first()).toBeVisible({ timeout: 20_000 });
  expect(await page.locator('.wy-mermaid-out.is-error').count()).toBe(0);
  expect(problems).toEqual([]);
});

test('a .docx can be created from code', async ({ page }) => {
  await openDemo(page, 'export-word-pdf');
  await editorReady(page);
  const out = await page.evaluate(async () => {
    const blob: Blob = await (window as any).editor.exportDocx();
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    return { size: blob.size, zip: String.fromCharCode(head[0], head[1]) };
  });
  expect(out.zip).toBe('PK'); // a zip container, as a .docx is
  expect(out.size).toBeGreaterThan(2000);
});

test('the code editor shows line numbers, folds and runs', async ({ page }) => {
  await openDemo(page, 'code-editor');
  await expect(page.locator('.wy-ln-num').first()).toBeVisible();
  const lines = await page.locator('.wy-ln-num').count();
  expect(lines).toBeGreaterThan(5);
  await page.evaluate(() => (window as any).ce.foldAll());
  await expect(page.locator('.wy-fold-chip').first()).toBeVisible();
  expect(await page.locator('.wy-ln-num').count()).toBeLessThan(lines);
  await page.evaluate(() => (window as any).ce.unfoldAll());
  await page.getByRole('button', { name: /Run/ }).first().click();
  await expect(page.locator('.panel-body pre').first()).toContainText('first primes', { timeout: 15_000 });
});

test('the image editor crops, rotates and saves', async ({ page }) => {
  await openDemo(page, 'image-editor', '#app');
  await page.getByRole('button', { name: /sample picture/i }).click();
  const editor = page.locator('.wy-ie');
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Apply crop' }).click();
  await editor.locator('.wy-ie-tool', { hasText: 'Rotate' }).click();
  await editor.getByRole('button', { name: /90°/ }).last().click();
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.ie-result figure')).toHaveCount(2);
  await expect(page.locator('.ie-result figcaption').last()).toContainText('px');
});

test('<wysiwyg-editor> is a form control', async ({ page }) => {
  const problems = await openDemo(page, 'web-component', 'wysiwyg-editor .ProseMirror');
  await page.locator('wysiwyg-editor .ProseMirror').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' TYPED-IN-ELEMENT');
  await page.getByRole('button', { name: 'Submit' }).click();
  const sent = await page.locator('#sent').innerText();
  expect(JSON.parse(sent)).toMatchObject({ title: 'Hello from a form' });
  expect(JSON.parse(sent).body).toContain('TYPED-IN-ELEMENT');
  await page.getByRole('button', { name: 'Reset' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
  expect(JSON.parse(await page.locator('#sent').innerText()).body).not.toContain('TYPED-IN-ELEMENT');
  expect(problems).toEqual([]);
});

test('form fields work inside a locked contract and report what is missing', async ({ page }) => {
  const problems = await openDemo(page, 'contract-form');
  await page.getByRole('button', { name: 'Check the form' }).click();
  await expect(page.locator('#answers')).toContainText('Still required: payment, start, accept');
  await page.locator('.wy-locked .wy-field input[type=checkbox]').check();
  await page.locator('.wy-field select').selectOption('Card');
  await page.locator('.wy-field input[type=date]').fill('2026-10-05');
  await page.getByRole('button', { name: 'Check the form' }).click();
  const answers = JSON.parse(await page.locator('#answers').innerText());
  expect(answers).toEqual({ accept: true, payment: 'Card', start: '2026-10-05' });
  // read-only "fill in only" mode: the controls still work
  await page.getByRole('button', { name: 'Fill-in only' }).click();
  await page.locator('.wy-field input[type=checkbox]').uncheck();
  await page.getByRole('button', { name: 'Check the form' }).click();
  expect(await page.locator('#answers').innerText()).toContain('Still required: accept');
  expect(problems).toEqual([]);
});

test('a chart is drawn from a table and exported to Word as a picture', async ({ page }) => {
  const problems = await openDemo(page, 'charts');
  await page.locator('.wy-editor td, .ProseMirror td').first().click();
  await page.getByRole('button', { name: 'Bar chart from table' }).click();
  await expect(page.locator('.wy-chart svg')).toHaveCount(2);
  const media = await page.evaluate(async () => {
    const blob: Blob = await (window as any).editor.exportDocx();
    return new TextDecoder('latin1').decode(new Uint8Array(await blob.arrayBuffer())).includes('word/media/');
  });
  expect(media).toBe(true);
  expect(problems).toEqual([]);
});

test('ribbon menus do not offer commands whose plugin is not installed', async ({ page }) => {
  const problems = await openDemo(page, 'feature-rich');
  await page.getByRole('tab', { name: 'Insert' }).click();
  await page.getByRole('button', { name: /^Picture/ }).first().click();
  await expect(page.locator('.wy-menu .wy-menu-item').first()).toBeVisible();
  await expect(page.locator('.wy-menu .wy-menu-item', { hasText: 'Diagram (Mermaid)' })).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a PDF opens as editable text and the document exports as a valid EPUB', async ({ page }) => {
  const problems = await openDemo(page, 'pdf-epub');
  await editorReady(page);
  await page.getByRole('button', { name: 'Load the sample PDF' }).click();
  await expect(page.locator('#status')).toHaveText('PDF imported.', { timeout: 20_000 });
  await expect(page.locator('.ProseMirror h1')).toHaveText('Field Report 2026');
  await expect(page.locator('.ProseMirror h2')).toHaveText('Findings');
  await expect(page.locator('.ProseMirror li')).toHaveCount(3);
  await expect(page.locator('.ProseMirror p', { hasText: 'volunteers in three regions' })).toContainText('summarises the results of the spring survey. The numbers');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download EPUB' }).click()]);
  expect(download.suggestedFilename()).toBe('My book.epub');
  const bytes = await (await import('node:fs/promises')).readFile((await download.path())!);
  expect(bytes.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
  expect(bytes.toString('latin1')).toContain('application/epub+zip');
  expect(problems).toEqual([]);
});

test('columns lay out side by side and the .docx has real Word columns', async ({ page }) => {
  const problems = await openDemo(page, 'columns');
  await editorReady(page);
  const box = page.locator('.ProseMirror .wy-columns');
  const ps = box.locator('p');
  const a = await ps.nth(0).boundingBox();
  const b = await ps.nth(1).boundingBox();
  expect(b!.x).toBeGreaterThan(a!.x + a!.width / 2); // the second paragraph starts in the second column
  await page.getByRole('button', { name: '3 columns' }).click(); // the cursor is outside: nothing changes, no error
  await page.locator('.ProseMirror p', { hasText: 'Select blocks' }).click();
  await page.getByRole('button', { name: 'Whole page in 2 columns' }).click();
  await expect(page.locator('.ProseMirror .wy-columns')).toHaveCount(1);
  const ok = await page.evaluate(async () => {
    const blob: Blob = await (window as any).editor.exportDocx();
    return blob.size > 1000;
  });
  expect(ok).toBe(true); // the section XML itself is checked in the unit tests
  expect(problems).toEqual([]);
});

test('AI: ghost text with Tab, review as tracked changes, chat', async ({ page }) => {
  const problems = await openDemo(page, 'ai');
  await editorReady(page);
  // ghost text appears after a pause at the end of a paragraph and Tab accepts it
  const last = page.locator('.ProseMirror p').last();
  await page.evaluate(() => { const v = (window as any).editor.view; v.focus(); const sel = v.state.selection; v.dispatch(v.state.tr.setSelection(sel.constructor.atEnd(v.state.doc))); });
  await page.keyboard.type(' We are ready for the next quarter.', { delay: 5 });
  await expect(page.locator('.wy-ghost')).toBeVisible({ timeout: 5000 });
  await page.keyboard.press('Tab');
  await expect(page.locator('.wy-ghost')).toHaveCount(0);
  await expect(last).toContainText('next update');
  // review
  await page.getByRole('button', { name: 'AI review as tracked changes' }).click();
  await expect(page.locator('.ProseMirror ins').first()).toBeVisible({ timeout: 8000 });
  expect(await page.locator('.ProseMirror del').count()).toBeGreaterThan(0);
  // chat
  await page.getByRole('button', { name: 'AI chat' }).click();
  await page.getByLabel('Your message').fill('What is this about?');
  await page.getByLabel('Your message').press('Enter');
  await expect(page.locator('.wy-aic-msg.is-assistant .wy-aic-text')).toContainText('short update', { timeout: 8000 });
  expect(problems).toEqual([]);
});

test('proofreading: underlines, a click offers suggestions, applying one fixes the word', async ({ page }) => {
  const problems = await openDemo(page, 'proofreading');
  await editorReady(page);
  await expect(page.locator('.wy-proof-spelling').first()).toBeVisible({ timeout: 8000 });
  await page.locator('.wy-proof-spelling', { hasText: 'recieve' }).click();
  await expect(page.locator('.wy-proof-menu .wy-proof-msg')).toContainText('recieve');
  await page.locator('.wy-proof-suggest', { hasText: 'receive' }).click();
  await expect(page.locator('.ProseMirror')).toContainText('definately receive teh');
  await expect(page.locator('.wy-proof-spelling', { hasText: 'recieve' })).toHaveCount(0);
  expect(problems).toEqual([]);
});
