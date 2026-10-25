import { test } from '@playwright/test';
import { expect, openDemo } from './helpers';

type Api = {
  getData(): { slides: { els: { html?: string }[] }[] };
  toPptx(): Promise<Blob>;
  loadPptx(file: Blob): Promise<{ skipped: string[] }>;
  setData(d: unknown): void;
};

test('presentation: export to .pptx and open it again', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.removeItem('wy-demo-presentation-classic'); } catch { /* blocked */ } });
  await openDemo(page, 'presentation-classic', '.wy-pr-canvas');
  await page.waitForFunction(() => !!(window as unknown as { deck?: unknown }).deck);

  const before = await page.evaluate(() => {
    const d = (window as unknown as { deck: Api }).deck.getData();
    return { slides: d.slides.length, text: d.slides.flatMap((s) => s.els).map((e) => (e.html ?? '').replace(/<[^>]*>/g, ' ')).join(' ').replace(/\s+/g, ' ').trim() };
  });
  expect(before.slides).toBeGreaterThan(1);

  const result = await page.evaluate(async () => {
    const deck = (window as unknown as { deck: Api }).deck;
    const blob = await deck.toPptx();
    // replace the deck with a one-slide deck, then open the exported file
    deck.setData({ width: 1280, height: 720, theme: 'office', slides: [{ layout: 'blank', els: [], notes: '' }] });
    const mid = deck.getData().slides.length;
    const info = await deck.loadPptx(blob);
    const d = deck.getData();
    return { size: blob.size, mid, skipped: info.skipped, slides: d.slides.length, text: d.slides.flatMap((s) => s.els).map((e) => (e.html ?? '').replace(/<[^>]*>/g, ' ')).join(' ').replace(/\s+/g, ' ').trim() };
  });
  expect(result.size).toBeGreaterThan(1000);
  expect(result.mid).toBe(1);
  expect(result.skipped).toEqual([]);
  expect(result.slides).toBe(before.slides);
  expect(result.text).toBe(before.text);
  await expect(page.locator('.wy-pr-thumb')).toHaveCount(before.slides);
});
