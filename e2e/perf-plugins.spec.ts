import { test } from '@playwright/test';
test.skip(!process.env.PERF, 'performance measurement only');
test.setTimeout(600_000);
test('which plugins scale with the document', async ({ page }) => {
  await page.goto('demo/perf.html');
  await page.waitForFunction(() => !!(window as any).perfLab);
  const N = 10000;
  const base = await page.evaluate((n) => (window as any).perfLab.typing(n, []), N);
  console.log('PERF base', base.median, 'ms');
  const rows: [string, number][] = [];
  for (const name of base.names) {
    try {
      const r = await page.evaluate(([n, nm]) => (window as any).perfLab.typing(n, [nm]), [N, name] as const);
      rows.push([name, +(base.median - r.median).toFixed(2)]);
    } catch { /* a plugin the schema needs */ }
  }
  rows.sort((a, b) => b[1] - a[1]);
  console.log('PERF top', JSON.stringify(rows.slice(0, 12)));
});
