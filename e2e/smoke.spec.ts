import { readdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { SANDBOX_NOISE, expect } from './helpers';

// Every demo page must load and settle without a script error or a console error (this also exercises the Content-Security-Policy).
const pages = readdirSync('demo').filter((f) => f.endsWith('.html') && !f.startsWith('_') && f !== 'icons.html').map((f) => f.replace('.html', ''));

for (const name of pages) {
  test(`demo/${name} loads without errors`, async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !SANDBOX_NOISE.test(m.text())) problems.push(`console: ${m.text()}`); });
    await page.goto(`demo/${name}.html`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(600);
    expect(await page.locator('#app, #editor, .wy-editor, main').count()).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
}
