import { expect, type Page } from '@playwright/test';

/** Browsers log this when a sandboxed preview frame (sandbox="" on purpose) meets a script: it is the sandbox working, not a bug. */
export const SANDBOX_NOISE = /Blocked script execution in 'about:(blank|srcdoc)'/;

/** Third-party embeds (YouTube, Vimeo, OpenStreetMap) are replaced by an empty page: tests must not depend on, or fail because of, other people's sites. */
export const stubEmbedHosts = (page: Page) => page.route(/^https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com|www\.openstreetmap\.org)\//, (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));

/** Open a demo page and fail the test on any uncaught error or console error (CSP violations included). */
export async function openDemo(page: Page, name: string, waitFor = '.ProseMirror, .wy-editor'): Promise<string[]> {
  const problems: string[] = [];
  await stubEmbedHosts(page);
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !SANDBOX_NOISE.test(m.text())) problems.push(`console: ${m.text()}`); });
  await page.goto(`demo/${name}.html`);
  await page.waitForSelector(waitFor, { timeout: 15_000 });
  return problems;
}

/** The demo's editor, exposed as window.editor by the demos that are driven from tests. */
export const editorReady = (page: Page) => page.waitForFunction(() => !!(window as unknown as { editor?: unknown }).editor, undefined, { timeout: 15_000 });

export const html = (page: Page) => page.evaluate(() => (window as unknown as { editor: { getHTML(): string } }).editor.getHTML());

/** Put the cursor at the end of the first paragraph that contains `text` (or select it when `select`). */
export async function placeCursor(page: Page, text: string, select = false) {
  await page.evaluate(([t, sel]) => {
    const ed = (window as any).editor;
    const dom: HTMLElement = ed.view.dom;
    const p = [...dom.querySelectorAll('p, h1, h2, li')].find((x) => x.textContent!.includes(t as string))!;
    const node = p.firstChild!;
    const range = document.createRange();
    if (sel) range.selectNodeContents(p); else { range.setStart(node, (node.textContent ?? '').length); range.collapse(true); }
    dom.focus();
    const s = getSelection()!;
    s.removeAllRanges();
    s.addRange(range);
  }, [text, select] as const);
}

export { expect };
