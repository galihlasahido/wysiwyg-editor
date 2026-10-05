import { test } from '@playwright/test';

// Not part of the normal run: PERF=1 pnpm e2e e2e/perf.spec.ts --project=chromium
test.skip(!process.env.PERF, 'performance measurement only');
test.setTimeout(300_000);

for (const [blocks, paged] of [[500, false], [2000, false], [5000, false], [10000, false], [20000, false], [2000, true]] as const) {
  test(`perf ${blocks} blocks${paged ? ' paged' : ''}`, async ({ page }) => {
    await page.goto('demo/perf.html');
    await page.waitForFunction(() => !!(window as any).perfLab);
    const r = await page.evaluate(([b, p]) => (window as any).perfLab.run(b, p), [blocks, paged] as const);
    console.log('PERF', JSON.stringify(r));
  });
}
