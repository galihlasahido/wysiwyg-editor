// Runs the complete demo examples (demo/full/*.ts) in a real browser against the dev server and reports page errors.
// Usage: pnpm dev --host 127.0.0.1   then   node scripts/run-full-examples.mjs [page-name ...]
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const IMPORT_MAP = {
  imports: {
    wysiwygido: `${BASE}/src/index.ts`,
    'wysiwygido/data-table': `${BASE}/src/data-table-app.ts`,
    'wysiwygido/spreadsheet': `${BASE}/src/spreadsheet-app.ts`,
    'wysiwygido/presentation': `${BASE}/src/presentation-app.ts`,
    'wysiwygido/collab': `${BASE}/src/collab.ts`,
    'wysiwygido/docx': `${BASE}/src/docx.ts`,
    'wysiwygido/pdf': `${BASE}/src/pdf.ts`,
    'wysiwygido/epub': `${BASE}/src/epub.ts`,
  },
};

const browser = await chromium.launch();
const probe = await browser.newPage();
await probe.goto(`${BASE}/demo/dialogs.html`);
const all = await probe.evaluate(async () => Object.entries((await import('/demo/full/index.ts')).examples).map(([name, ex]) => ({ name, ...ex })));
const want = process.argv.slice(2);
let failed = 0;
for (const ex of all.filter((e) => !want.length || want.includes(e.name))) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/favicon|Failed to load resource|WebSocket|Vite server/.test(m.text()) && errors.push(m.text()));
  const code = ex.code.replace(/^import\s+['"]wysiwygido\/style\.css['"];?\s*$/m, '');
  const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${BASE}/src/styles.css"><link rel="stylesheet" href="${BASE}/src/office.css">${ex.css ? `<style>${ex.css}</style>` : ''}<script type="importmap">${JSON.stringify(IMPORT_MAP)}</script></head><body>${ex.html ?? '<div id="editor"></div>'}<script type="module">${code.replace(/(from\s+|import\s+)(['"])((?:@[\w-]+\/)?(?!wysiwygido)[a-z][\w.-]*(?:\/[\w./-]+)?)\2/g, (_m, p, q, s) => `${p}${q}https://esm.sh/${s}${q}`)}</script></body></html>`;
  await page.route('**/__example.html', (r) => r.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`${BASE}/__example.html`);
  await page.waitForTimeout(1500);
  const mounted = await page.evaluate(() => document.querySelectorAll('.wy-editor, .wy-app, .wy-dt-root, wysiwyg-editor, .wy-code-editor').length);
  const ok = errors.length === 0 && mounted > 0;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${ex.name}${ok ? '' : `  mounted=${mounted} ${errors.slice(0, 2).join(' | ')}`}`);
  await page.close();
}
await browser.close();
process.exit(failed ? 1 : 0);
