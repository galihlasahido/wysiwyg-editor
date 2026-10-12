// Browser compatibility probe. Usage: node probe.cjs <playwright-core dir> <browser> <outfile>
// Written with only long-standing Playwright calls so that old Playwright releases (and so old browsers) can run it.
const path = require('node:path');
const fs = require('node:fs');
const [, , pwDir, browserName, outFile, baseUrl = 'http://127.0.0.1:4173/'] = process.argv;
const pw = require(path.resolve(pwDir));

const NOISE = /Blocked script execution in 'about:(blank|srcdoc)'|youtube|vimeo|openstreetmap|Failed to load resource|favicon/i;
const FEATURES = {
  'Object.hasOwn': 'typeof Object.hasOwn === "function"',
  'Array.at': 'typeof [].at === "function"',
  'Array.findLast': 'typeof [].findLast === "function"',
  'structuredClone': 'typeof structuredClone === "function"',
  'crypto.randomUUID': 'typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"',
  'String.replaceAll': 'typeof "".replaceAll === "function"',
  'ResizeObserver': 'typeof ResizeObserver === "function"',
  'DecompressionStream': 'typeof DecompressionStream === "function"',
  'CSS color-mix()': 'CSS.supports("color", "color-mix(in srgb, red, blue)")',
  'CSS :has()': 'CSS.supports("selector(:has(a))")',
  'CSS :is()': 'CSS.supports("selector(:is(a))")',
  'CSS @layer': 'typeof CSSLayerBlockRule === "function"',
  'CSS aspect-ratio': 'CSS.supports("aspect-ratio", "1/1")',
  'CSS inset': 'CSS.supports("inset", "0")',
  'CSS gap in flex': 'CSS.supports("gap", "1px")',
  'Intl.Segmenter': 'typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"',
  'BroadcastChannel': 'typeof BroadcastChannel === "function"',
  'clipboard API': 'typeof navigator.clipboard === "object"',
};

async function open(browser, name, wait) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e).split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push('console: ' + m.text().split('\n')[0]); });
  await page.route(/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com|www\.openstreetmap\.org)\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
  let loaded = true;
  try { await page.goto(baseUrl + 'demo/' + name + '.html', { timeout: 20000 }); await page.waitForSelector(wait, { timeout: 12000 }); }
  catch (e) { loaded = false; errors.push('load: ' + String(e.message).split('\n')[0]); }
  return { ctx, page, errors, loaded };
}

const steps = [];
async function step(name, fn) {
  const t = { name, ok: false, note: '' };
  for (let attempt = 0; attempt < 2 && !t.ok; attempt++) {   // one retry: a slow old browser can lose a race with the page's own redraw
    try { const r = await fn(); t.ok = r === undefined || r === true || (r && r.ok !== false); t.note = r && r.note ? r.note : ''; }
    catch (e) { t.note = String(e && e.message || e).split('\n')[0].slice(0, 200); }
    if (t.ok && attempt) t.note = (t.note ? t.note + ' ' : '') + '(passed on the second try)';
    if (!t.ok && attempt === 0) await new Promise((r) => setTimeout(r, 600));
  }
  steps.push(t);
}

(async () => {
  const launch = { chromium: pw.chromium, firefox: pw.firefox, webkit: pw.webkit }[browserName];
  const browser = await launch.launch({ headless: true });
  const out = { browser: browserName, version: browser.version(), playwright: require(path.resolve(pwDir, 'package.json')).version, features: {}, steps };

  // 1. platform features
  {
    const { ctx, page } = await open(browser, 'headless', 'body');
    for (const [k, expr] of Object.entries(FEATURES)) out.features[k] = await page.evaluate('(function(){try{return !!(' + expr + ')}catch(e){return false}})()').catch(() => false);
    await ctx.close();
  }

  // 2. every one of these demo pages must load and settle without a script error
  const pages = [['feature-rich', '.ProseMirror'], ['data-table', '.wy-dt'], ['data-table-standalone', '#table .wy-dt'], ['themes', '.ProseMirror'], ['markdown', '.ProseMirror, .wy-editor'], ['spreadsheet', '.ProseMirror, .wy-editor'], ['charts', '.ProseMirror'], ['slides', '.ProseMirror, .wy-editor'], ['web-component', 'body'], ['mobile', '.ProseMirror'], ['contract-form', '.ProseMirror'], ['collab-realtime', '.ProseMirror']];
  for (const [name, wait] of pages) {
    await step('loads: ' + name, async () => {
      const { ctx, page, errors, loaded } = await open(browser, name, wait);
      await page.waitForTimeout(700);
      await ctx.close();
      return { ok: loaded && errors.length === 0, note: errors.slice(0, 2).join(' | ') };
    });
  }

  // 3. editing in the main demo
  {
    const { ctx, page, errors } = await open(browser, 'feature-rich', '.ProseMirror');
    await page.waitForFunction('!!window.editor', null, { timeout: 15000 }).catch(() => {});
    await page.waitForSelector('.wy-page-header', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);                       // the paged layout redraws the document once after it opens; slow browsers need a moment
    const place = (text, select) => page.evaluate(([t, sel]) => {
      const dom = window.editor.view.dom;
      const p = [...dom.querySelectorAll('p, h1, h2, li')].find((x) => x.textContent.includes(t));
      const r = document.createRange();
      if (sel) r.selectNodeContents(p); else { r.selectNodeContents(p); r.collapse(false); }
      dom.focus(); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    }, [text, select]).then(() => page.waitForTimeout(250));   // let the editor read the selection before keys arrive
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    await step('bold shortcut', async () => { await place('Lorem ipsum', true); await page.keyboard.press(mod + '+b'); const ok = (await page.evaluate('window.editor.getHTML()')).includes('<strong>Lorem ipsum'); await page.keyboard.press(mod + '+b'); return ok; });
    await step('typing text', async () => { await place('Lorem ipsum'); await page.keyboard.type(' COMPAT-TYPED'); return (await page.evaluate('window.editor.getHTML()')).includes('COMPAT-TYPED'); });
    await step('undo', async () => { await page.keyboard.press(mod + '+z'); return !(await page.evaluate('window.editor.getHTML()')).includes('COMPAT-TYPED'); });
    await step('paged layout', async () => (await page.$$('.wy-page-header')).length >= 2);
    await step('ruler and toolbar drawn', async () => !!(await page.$('.wy-ruler')) && (await page.$$('button')).length > 10);
    await step('HTML round trip', async () => { const h = await page.evaluate('(function(){var h=window.editor.getHTML();window.editor.setHTML(h);return window.editor.getHTML()===h})()'); return h; });
    await step('Markdown export', async () => (await page.evaluate('window.editor.getMarkdown()')).length > 50);
    await step('no script errors while editing', async () => ({ ok: errors.length === 0, note: errors.slice(0, 2).join(' | ') }));
    await ctx.close();
  }

  // 4. the data table inside the editor
  {
    const { ctx, page, errors } = await open(browser, 'data-table', '.wy-dt');
    await step('data table: 10 rows shown', async () => (await page.$$('.wy-dt tbody tr[data-row]')).length === 10);
    await step('data table: search', async () => { await page.fill('.wy-dt [aria-label="Search the table"]', 'matcha'); await page.waitForTimeout(500); return (await page.$$('.wy-dt tbody tr[data-row]')).length === 5; });
    await step('data table: sort and page', async () => {
      await page.fill('.wy-dt [aria-label="Search the table"]', ''); await page.waitForTimeout(500);
      await page.click('.wy-dt [aria-label="Next page"]'); await page.waitForTimeout(200);
      return /11–20 of 64/.test(await page.textContent('.wy-dt .wy-dt-info'));
    });
    await step('data table: edit a cell', async () => {
      await page.dblclick('.wy-dt tbody tr[data-row] td[data-col="0"]');
      await page.fill('.wy-dt-edit', 'Renamed product'); await page.press('.wy-dt-edit', 'Enter');
      return (await page.textContent('.wy-dt tbody tr[data-row] td[data-col="0"]')).trim() === 'Renamed product';
    });
    await step('data table: table colours (color-mix) computed', async () => {
      const c = await page.evaluate('getComputedStyle(document.querySelector(".wy-dt-table thead th")).backgroundColor');
      return { ok: !!c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent', note: c };
    });
    await step('no script errors in the data table', async () => ({ ok: errors.length === 0, note: errors.slice(0, 2).join(' | ') }));
    await ctx.close();
  }

  // 5. the data table without the editor
  {
    const { ctx, page, errors } = await open(browser, 'data-table-standalone', '#table .wy-dt');
    await step('stand-alone table: 10 rows, no editor', async () => (await page.$$('#table .wy-dt tbody tr[data-row]')).length === 10 && !(await page.$('.ProseMirror')));
    await step('stand-alone table: edit and undo', async () => {
      await page.dblclick('#table .wy-dt tbody tr[data-row] td[data-col="0"]');
      await page.fill('.wy-dt-edit', 'Edited customer'); await page.press('.wy-dt-edit', 'Enter');
      const edited = (await page.textContent('#table .wy-dt tbody tr[data-row] td[data-col="0"]')).trim() === 'Edited customer';
      await page.click('button:text-is("Undo")');
      return edited && (await page.textContent('#table .wy-dt tbody tr[data-row] td[data-col="0"]')).trim() !== 'Edited customer';
    });
    await step('stand-alone table: theme', async () => { await page.click('button:text-is("nord")'); return (await page.getAttribute('#table .wy-dt-root', 'data-theme')) === 'dark'; });
    await step('stand-alone table: Excel export', async () => {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click('button:text-is("Download .xlsx")')]);
      return (dl.suggestedFilename() || '').endsWith('.xlsx');
    });
    await step('no script errors in the stand-alone table', async () => ({ ok: errors.length === 0, note: errors.slice(0, 2).join(' | ') }));
    await ctx.close();
  }

  // 6. highlight colours (rules) must show, with or without color-mix()
  {
    const { ctx, page, errors } = await open(browser, 'data-table-finance', '.wy-dt');
    await step('data table: highlight rules are coloured', async () => {
      const c = await page.evaluate('(function(){var e=document.querySelector(".wy-dt-table td[data-look=red]");return e?getComputedStyle(e).backgroundColor:"none"})()');
      return { ok: !!c && c !== 'none' && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent', note: c };
    });
    await step('data table: progress bars drawn', async () => {
      const c = await page.evaluate('(function(){var e=document.querySelector(".wy-dt-barcell");return e?getComputedStyle(e).backgroundImage:"none"})()');
      return { ok: /gradient/.test(c), note: c.slice(0, 60) };
    });
    await step('no script errors in the budget table', async () => ({ ok: errors.length === 0, note: errors.slice(0, 2).join(' | ') }));
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  const bad = out.steps.filter((s) => !s.ok);
  console.log(browserName, out.version, 'pw' + out.playwright, bad.length ? 'FAIL ' + bad.length + '/' + out.steps.length : 'all ' + out.steps.length + ' ok');
})().catch((e) => { fs.writeFileSync(outFile, JSON.stringify({ browser: browserName, fatal: String(e && e.message || e).split('\n')[0] }, null, 1)); console.log(browserName, 'FATAL', String(e.message).split('\n')[0]); });
