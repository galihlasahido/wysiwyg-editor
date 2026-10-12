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

test('pasting a Word table and numbered list keeps cells and list items as tight as Word', async ({ page, browserName }) => {
  const problems = await openDemo(page, 'feature-rich');
  await editorReady(page);
  const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style>p.MsoNormal{margin:0cm}</style></head><body><!--StartFragment-->
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none'><tr><td valign=top style='border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'><p class=MsoNormal align=center style='text-align:center'>sfsf<o:p></o:p></p></td><td valign=top style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal>Jk<o:p></o:p></p></td></tr>
<tr><td valign=top style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal>J<o:p></o:p></p></td><td valign=top style='border:solid windowtext 1.0pt;padding:0cm 5.4pt'><p class=MsoNormal>Kj<o:p></o:p></p></td></tr></table>
<p class=MsoListParagraphCxSpFirst style='margin-bottom:0cm;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>1.<span>&nbsp;&nbsp;</span></span><![endif]>123<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='margin-bottom:0cm;text-indent:-18.0pt;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>2.<span>&nbsp;&nbsp;</span></span><![endif]>123<o:p></o:p></p><!--EndFragment--></body></html>`;
  // Firefox ignores clipboardData on a synthetic paste event, so there the content a paste produces is set directly: the spacing is a style rule either way.
  const m = await page.evaluate(async ([html, real]) => {
    const ed = (window as any).editor;
    ed.setHTML('<p></p>');
    ed.view.focus();
    if (real) {
      const dt = new DataTransfer();
      dt.setData('text/html', html);
      dt.setData('text/plain', 'x');
      ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    } else {
      ed.setHTML('<table><tr><td><p style="text-align: center">sfsf</p></td><td><p>Jk</p></td></tr><tr><td><p>J</p></td><td><p>Kj</p></td></tr></table><ol><li><p>123</p></li><li><p>123</p></li></ol>');
    }
    await new Promise((r) => setTimeout(r, 300));
    const dom: HTMLElement = ed.view.dom;
    const cs = (el: Element, k: string) => getComputedStyle(el).getPropertyValue(k);
    const tdp = dom.querySelector('td p')!;
    const lip = dom.querySelector('li p')!;
    return {
      cell: [cs(tdp, 'margin-top'), cs(tdp, 'margin-bottom')],
      item: [cs(lip, 'margin-top'), cs(lip, 'margin-bottom')],
      row: Math.round(dom.querySelector('tr')!.getBoundingClientRect().height),
      items: dom.querySelectorAll('li').length,
      cells: dom.querySelectorAll('td').length,
    };
  }, [word, browserName !== 'firefox'] as const);
  expect(m.cells).toBe(4);
  expect(m.items).toBe(2);
  expect(m.cell).toEqual(['0px', '0px']);
  expect(m.item).toEqual(['0px', '0px']);
  expect(m.row).toBeLessThan(36); // a one-line row was 71 px before
  // spacing a person sets on purpose still shows inside a cell
  const spaced = await page.evaluate(() => {
    const ed = (window as any).editor;
    ed.setHTML('<table><tr><td><p style="margin-bottom: 20pt">a</p></td></tr></table>');
    return getComputedStyle(ed.view.dom.querySelector('td p')).getPropertyValue('margin-bottom');
  });
  expect(parseFloat(spaced)).toBeGreaterThan(20);
  expect(problems).toEqual([]);
});

test('right-click in a table opens the table menu, and a one-cell table can be deleted', async ({ page }) => {
  await openDemo(page, 'feature-rich');
  await editorReady(page);
  await page.evaluate(() => {
    const ed = (window as any).editor;
    ed.setHTML('<p>x</p><table><tr><td><p>a</p></td><td><p>b</p></td></tr></table><p>y</p>');
  });
  const cell = page.locator('.wy-content td').first();
  await cell.click({ button: 'right' });
  const menu = page.locator('.wy-ctx').first();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Insert row below/ })).toBeVisible();
  await menu.getByRole('menuitem', { name: /Delete column/ }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('.wy-content td')).toHaveCount(1);
  // now a single cell: the menu's Delete column removes the whole table
  await page.locator('.wy-content td').first().click({ button: 'right' });
  await page.locator('.wy-ctx').getByRole('menuitem', { name: /Delete column/ }).click();
  await expect(page.locator('.wy-content table')).toHaveCount(0);
  // keyboard: Escape closes it
  await page.locator('.wy-content p').first().click({ button: 'right' });
  await expect(page.locator('.wy-ctx').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wy-ctx')).toHaveCount(0);
});

test('a cover page fills the whole first page and the text starts on the next one', async ({ page }) => {
  const problems = await openDemo(page, 'feature-rich');
  await editorReady(page);
  await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 60; c.height = 80;
    const g = c.getContext('2d')!; g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, 60, 80);
    (window as any).editor.execute('coverPage', c.toDataURL('image/png'), 'Cover');
  });
  const m = await page.evaluate(async () => {
    const ed = (window as any).editor;
    await new Promise((r) => setTimeout(r, 400));
    const card = ed.root.querySelector('.wy-content').getBoundingClientRect();
    const img = ed.view.dom.querySelector('.wy-cover img').getBoundingClientRect();
    const next = [...ed.view.dom.children].find((c: Element) => !c.matches('.wy-cover, .wy-page-header, .wy-page-end') && c.getBoundingClientRect().top > img.bottom - 1)!.getBoundingClientRect();
    const s = ed.extensions.pageSettings();
    const scale = card.width / s.width;
    return { w: img.width / scale, h: img.height / scale, left: (img.left - card.left) / scale, top: (img.top - card.top) / scale, pageW: s.width, pageH: s.height, nextTop: (next.top - card.top) / scale };
  });
  expect(Math.abs(m.w - m.pageW)).toBeLessThan(2);
  expect(Math.abs(m.h - m.pageH)).toBeLessThan(2);
  expect(Math.abs(m.left)).toBeLessThan(2);
  expect(Math.abs(m.top)).toBeLessThan(2);
  expect(m.nextTop).toBeGreaterThanOrEqual(m.pageH - 1); // the text begins on page 2
  expect(problems).toEqual([]);
});

test('Change case: the menu, and the keyboard shortcut', async ({ page }) => {
  await openDemo(page, 'feature-rich');
  await editorReady(page);
  await page.evaluate(() => { const ed = (window as any).editor; ed.setHTML('<p>hello world</p>'); ed.view.focus(); ed.execute('selectAll'); });
  await page.keyboard.press('ControlOrMeta+Alt+u');
  await expect(page.locator('.wy-content p').first()).toHaveText('HELLO WORLD');
  await page.keyboard.press('ControlOrMeta+Alt+s');
  await expect(page.locator('.wy-content p').first()).toHaveText('hello_world');
});

test('colour themes restyle the editor and the ribbon menu lists them', async ({ page }) => {
  const problems = await openDemo(page, 'themes');
  const bg = () => page.locator('.wy-editor').evaluate((el) => getComputedStyle(el).backgroundColor);
  const before = await bg();
  await page.getByRole('button', { name: 'Midnight', exact: true }).click();
  await expect(page.locator('.wy-editor')).toHaveAttribute('data-color-theme', 'midnight');
  expect(await bg()).not.toBe(before);
  await page.screenshot({ path: 'test-results/theme-midnight.png' });
  await page.getByRole('button', { name: 'Sepia', exact: true }).click();
  await page.screenshot({ path: 'test-results/theme-sepia.png' });
  await page.getByRole('tab', { name: 'View', exact: true }).click();
  await page.getByRole('button', { name: 'Themes' }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Nord' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('data table: search, sort, page, edit, export and convert', async ({ page }) => {
  const problems = await openDemo(page, 'data-table');
  const dt = page.locator('.wy-dt');
  await expect(dt.locator('tbody tr[data-row]')).toHaveCount(10);
  await page.screenshot({ path: 'test-results/data-table.png' });
  await dt.getByLabel('Search the table').fill('matcha');
  await expect(dt.locator('tbody tr[data-row]')).toHaveCount(5);
  await dt.getByLabel('Search the table').fill('');
  await dt.getByRole('button', { name: 'Stock' }).first().click();
  await dt.getByRole('button', { name: 'Stock' }).first().click();
  await expect(dt.locator('thead th[data-col="2"]')).toHaveAttribute('aria-sort', 'descending');
  await dt.getByRole('button', { name: 'Next page' }).click();
  await expect(dt.locator('.wy-dt-info').first()).toContainText('11–20 of 64');
  const first = dt.locator('tbody tr[data-row] td[data-col="0"]').first();
  await first.dblclick();
  await dt.locator('.wy-dt-edit').fill('Renamed product');
  await dt.locator('.wy-dt-edit').press('Enter');
  await expect(dt.locator('tbody td[data-col="0"]').first()).toHaveText('Renamed product');
  await dt.getByRole('button', { name: 'Export ▾' }).click();
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'Excel (.xlsx)' }).click()]);
  expect(file.suggestedFilename()).toBe('products.xlsx');
  await page.getByRole('button', { name: 'Convert to regular table' }).click();
  await expect(page.locator('.ProseMirror table:not(.wy-dt-table)')).toHaveCount(1);
  await expect(page.locator('.wy-dt')).toHaveCount(0);
  await page.getByRole('button', { name: 'Convert table back' }).click();
  await page.locator('.ProseMirror table td').first().click().catch(() => {});
  expect(problems).toEqual([]);
});

test('data table: groups, long tables, a server source and importing Excel', async ({ page }) => {
  const problems = await openDemo(page, 'data-table');

  // grouping
  await page.getByRole('button', { name: 'Group by category' }).click();
  await expect(page.locator('.wy-dt-group').first()).toBeVisible();
  const toggle = page.locator('.wy-dt-group [data-role="group-toggle"]').first();
  const before = await page.locator('.wy-dt tbody tr[data-row]').count();
  await toggle.click();
  expect(await page.locator('.wy-dt tbody tr[data-row]').count()).toBeLessThan(before);

  // 20,000 rows: only some are drawn, and the last one is reachable by scrolling
  await page.getByRole('button', { name: '20,000 rows (scrolls)' }).click();
  const big = page.locator('.wy-dt.is-virtual');
  await expect(big.locator('.wy-dt-info').first()).toContainText('20000');
  expect(await big.locator('tbody tr[data-row]').count()).toBeLessThan(120);
  await big.locator('.wy-dt-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(big.locator('tbody tr[data-row][data-row="19999"]')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/data-table-virtual.png' });

  // a server source: pages of 25, and the search is sent to the "server"
  await page.getByRole('button', { name: 'Load from a server' }).click();
  const remote = page.locator('.wy-dt').filter({ hasText: 'Orders (loaded 25 at a time)' });
  await expect(remote.locator('tbody tr[data-row]')).toHaveCount(25);
  await expect(remote.locator('.wy-dt-info').first()).toContainText('1–25 of 5000');
  await remote.getByRole('button', { name: 'Next page' }).click();
  await expect(remote.locator('.wy-dt-info').first()).toContainText('26–50 of 5000');
  await remote.getByLabel('Search the table').fill('Ada A.');
  await expect(remote.locator('.wy-dt-info').first()).not.toContainText('of 5000');
  await expect(remote.locator('tbody tr[data-row]').first()).toContainText('Ada A.');
  const [file] = await Promise.all([page.waitForEvent('download'), (async () => { await remote.getByRole('button', { name: 'Export ▾' }).click(); await page.getByRole('menuitem', { name: 'CSV' }).click(); })()]);
  expect(file.suggestedFilename()).toBe('orders-loaded-25-at-a-time.csv');

  // importing an Excel file made by a real spreadsheet program
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Import CSV or Excel…' }).click()]);
  await chooser.setFiles('e2e/fixtures/stock.xlsx');
  const imported = page.locator('.wy-dt').filter({ has: page.locator('.wy-dt-title', { hasText: /^stock$/ }) });
  await expect(imported.locator('tbody tr[data-row]')).toHaveCount(3);
  await expect(imported.locator('tbody tr').first()).toContainText('Oolong');
  await expect(imported.locator('tbody tr').nth(1)).toContainText('Feb 9, 2026');
  expect(problems).toEqual([]);
});

test('data table: formulas, highlights, details, views, resizing, reordering and charts', async ({ page }) => {
  const problems = await openDemo(page, 'data-table');
  const dt = page.locator('.wy-dt').first();

  // a formula column and highlight rules
  await expect(dt.locator('thead th[data-col="6"]')).toContainText('Stock value');
  await expect(dt.locator('tbody tr[data-row]').first().locator('td[data-col="6"]')).toContainText('$');
  await expect(dt.locator('td[data-look="red"]').first()).toBeVisible();
  await expect(dt.locator('td.wy-dt-barcell').first()).toBeVisible();

  // open a row
  await dt.locator('[data-role="detail-toggle"]').first().click();
  await expect(dt.locator('.wy-dt-detail').first()).toContainText('Product');
  await dt.locator('[data-role="detail-toggle"]').first().click();
  await expect(dt.locator('.wy-dt-detail')).toHaveCount(0);

  // reorder with the keyboard: the first product moves to second place
  const name = (n: number) => dt.locator('tbody tr[data-row]').nth(n).locator('td[data-col="0"]');
  const first = await name(0).textContent();
  const second = await name(1).textContent();
  await name(0).click();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(name(0)).toHaveText(second!);
  await expect(name(1)).toHaveText(first!);

  // resize with the mouse
  const th = dt.locator('thead th[data-col="1"]');
  const before = (await th.boundingBox())!.width;
  await th.hover();
  const grip = (await dt.locator('[data-role="resize"][data-col="1"]').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 90, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await dt.locator('thead th[data-col="1"]').boundingBox())!.width).toBeGreaterThan(before + 40);
  await page.screenshot({ path: 'test-results/data-table-phase4.png' });

  // a saved view
  await dt.getByRole('button', { name: 'Views ▾' }).click();
  await page.getByRole('menuitem', { name: 'Low stock', exact: true }).click();
  await expect(dt.locator('thead th[data-col="2"]')).toHaveAttribute('aria-sort', 'ascending');
  await expect(dt.locator('.wy-dt-info').first()).toContainText('filtered from 64');

  // a chart of what is shown, right after the table
  await dt.getByRole('button', { name: 'Options ▾' }).click();
  await page.getByRole('menuitem', { name: 'Chart of these rows: bar' }).click();
  await expect(page.locator('.wy-chart')).toHaveCount(1);
  expect(problems).toEqual([]);
});

test('data table on its own: no editor, edit, undo, theme and export', async ({ page }) => {
  const problems = await openDemo(page, 'data-table-standalone', '#table .wy-dt');
  expect(await page.locator('.ProseMirror').count()).toBe(0);
  const dt = page.locator('#table .wy-dt').first();
  await expect(dt.locator('tbody tr[data-row]')).toHaveCount(10);
  await page.screenshot({ path: 'test-results/data-table-standalone.png' });

  await dt.locator('tbody tr[data-row] td[data-col="0"]').first().dblclick();
  await dt.locator('.wy-dt-edit').fill('Edited customer');
  await dt.locator('.wy-dt-edit').press('Enter');
  await expect(dt.locator('tbody tr[data-row] td[data-col="0"]').first()).toHaveText('Edited customer');
  await expect(page.locator('.demo-log')).toContainText('Change 1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(dt.locator('tbody tr[data-row] td[data-col="0"]').first()).not.toHaveText('Edited customer');

  // right-click menu of its own
  await dt.locator('tbody tr[data-row] td[data-col="1"]').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Insert row below' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'nord', exact: true }).click();
  await expect(page.locator('#table .wy-dt-root')).toHaveAttribute('data-theme', 'dark');
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download .xlsx' }).click()]);
  expect(file.suggestedFilename()).toBe('customers.xlsx');

  await expect(page.locator('wysiwyg-data-table .wy-dt tbody tr[data-row]')).toHaveCount(3);
  expect(problems).toEqual([]);
});

test('data table: add, edit and delete in dialogs, guarded by role', async ({ page }) => {
  const problems = await openDemo(page, 'data-table-crud', '#table .wy-dt');
  const dt = page.locator('#table .wy-dt');
  await expect(dt.getByRole('button', { name: 'New…' })).toHaveCount(0);           // a guest may only look
  await expect(dt.locator('button[data-role="row-action"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Eka (editor)' }).click();
  await expect(dt.getByRole('button', { name: 'New…' })).toBeVisible();
  await expect(dt.locator('tbody tr[data-row]').first().getByRole('button', { name: 'Delete' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Adi (admin)' }).click();

  await dt.getByRole('button', { name: 'New…' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Title').fill('');
  await dlg.getByRole('button', { name: 'Add' }).click();
  await expect(dlg.getByRole('alert')).toHaveText('A ticket needs a title.');       // the server said no
  await dlg.getByLabel('Title').fill('Printer on fire');
  await dlg.getByRole('button', { name: 'Add' }).click();
  await expect(dlg).toHaveCount(0);
  await dt.getByLabel('Search the table').fill('Printer on fire');
  await expect(dt.locator('tbody tr[data-row]')).toHaveCount(1);
  await expect(dt.locator('tbody tr[data-row] td[data-col="0"]')).toHaveText('2,000');   // the id the server made

  await dt.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog').getByLabel('Title').fill('Printer replaced');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await dt.getByLabel('Search the table').fill('Printer replaced');                 // the old search no longer matches the new title
  await expect(dt.locator('tbody tr[data-row] td[data-col="1"]')).toHaveText('Printer replaced');

  await dt.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await expect(page.getByRole('dialog')).toContainText('Printer replaced');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(dt.locator('tbody tr[data-row]')).toHaveCount(0);
  expect(problems).toEqual([]);
});
