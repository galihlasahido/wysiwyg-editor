import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { AIAssistant, Editor, createFetchProvider, defaultPlugins, type AIProvider } from '../src';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function setup(provider: AIProvider, html = '<p>hello wrold</p><p>second</p>') {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  const e = new Editor({ element: el, content: html, plugins: [...defaultPlugins, AIAssistant({ provider })] });
  editors.push(e);
  return e;
}
const select = (e: Editor, from: number, to: number) => e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, from, to)));
const panel = (e: Editor) => e.root.querySelector<HTMLElement>('.wy-ai-panel')!;
const click = (e: Editor, label: string) => [...panel(e).querySelectorAll('button')].find((b) => b.textContent === label)!.click();

describe('AI assistant', () => {
  it('previews the result and replaces the selection only when accepted', async () => {
    let seen: any;
    const e = setup(async (req) => ((seen = req), 'hello world'));
    select(e, 1, 12);
    expect(e.execute('ai', 'grammar')).toBe(true);
    await sleep(10);
    expect(seen).toMatchObject({ action: 'grammar', text: 'hello wrold' });
    expect(seen.instruction).toContain('grammar');
    expect(panel(e).textContent).toContain('hello world');
    expect(e.getHTML()).toBe('<p>hello wrold</p><p>second</p>'); // nothing applied yet
    click(e, 'Accept');
    expect(e.getHTML()).toBe('<p>hello world</p><p>second</p>');
    expect(panel(e).hidden).toBe(true);
    e.execute('undo');
    expect(e.getHTML()).toBe('<p>hello wrold</p><p>second</p>'); // one undo step
  });

  it('discard leaves the document untouched', async () => {
    const e = setup(async () => 'changed');
    select(e, 1, 6);
    e.execute('ai', 'improve');
    await sleep(10);
    click(e, 'Discard');
    expect(e.getHTML()).toBe('<p>hello wrold</p><p>second</p>');
    expect(panel(e).hidden).toBe(true);
  });

  it('streams chunks into the preview and aborts on cancel', async () => {
    let aborted = false;
    const e = setup(async function* ({ signal }) {
      signal.addEventListener('abort', () => (aborted = true));
      yield 'one ';
      await sleep(30);
      yield 'two';
      await sleep(200);
      yield ' three';
    });
    select(e, 1, 6);
    e.execute('ai', 'expand');
    await sleep(15);
    expect(panel(e).querySelector('.wy-ai-body')!.textContent).toBe('one ');
    await sleep(40);
    expect(panel(e).querySelector('.wy-ai-body')!.textContent).toBe('one two');
    click(e, 'Cancel');
    expect(aborted).toBe(true);
    await sleep(250);
    expect(panel(e).hidden).toBe(true); // late chunks are ignored
    expect(e.getHTML()).toBe('<p>hello wrold</p><p>second</p>');
  });

  it('inserts a summary below the selected block', async () => {
    const e = setup(async () => 'Short summary.');
    select(e, 1, 12);
    e.execute('ai', 'summarize');
    await sleep(10);
    click(e, 'Accept');
    expect(e.getHTML()).toBe('<p>hello wrold</p><p>Short summary.</p><p>second</p>');
  });

  it('turns Markdown output into blocks and never into raw HTML', async () => {
    const e = setup(async () => '# Title\n\nPara <img src=x onerror=alert(1)> [x](javascript:alert(1))\n\n- a\n- b');
    select(e, 1, 12);
    e.execute('ai', 'improve');
    await sleep(10);
    click(e, 'Accept');
    const html = e.getHTML();
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<ul>');
    // Model markup stays inert text: no <img>/<a> elements exist, and the "link" is not a link.
    expect(e.root.querySelector('.ProseMirror img')).toBeNull();
    expect(e.root.querySelector('.ProseMirror a')).toBeNull();
    expect(html).toContain('&lt;img');
  });

  it('keeps the target attached when the user edits above it while waiting', async () => {
    let release!: (s: string) => void;
    const e = setup(() => new Promise<string>((r) => (release = r)));
    select(e, 14, 20); // "second"
    e.execute('ai', 'improve');
    e.view.dispatch(e.view.state.tr.insertText('ZZZ ', 1)); // edit earlier in the document
    release('SECOND');
    await sleep(10);
    click(e, 'Accept');
    expect(e.getHTML()).toBe('<p>ZZZ hello wrold</p><p>SECOND</p>');
  });

  it('works on the whole document when nothing is selected', async () => {
    let text = '';
    const e = setup(async (r) => ((text = r.text), 'x'));
    e.execute('ai', 'summarize');
    await sleep(10);
    expect(text).toBe('hello wrold\n\nsecond');
  });

  it('shows errors, rejects unknown actions, and asks for input when an action needs it', async () => {
    const e = setup(async () => {
      throw new Error('boom');
    });
    select(e, 1, 6);
    e.execute('ai', 'improve');
    await sleep(10);
    expect(panel(e).dataset.state).toBe('error');
    expect(panel(e).textContent).toContain('boom');
    expect(e.execute('ai', 'nope')).toBe(false);
    expect(e.execute('ai', 'translate', '   ')).toBe(true); // explicit (even blank) input skips the prompt
  });

  it('refuses empty documents and empty model output', async () => {
    const e = setup(async () => '   ', '');
    expect(e.execute('ai', 'improve')).toBe(false);
    const f = setup(async () => '   ');
    select(f, 1, 6);
    f.execute('ai', 'improve');
    await sleep(10);
    expect(panel(f).dataset.state).toBe('error');
  });
});

describe('createFetchProvider', () => {
  it('posts the request and streams the response body', async () => {
    let body: any;
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('ab')); c.enqueue(new TextEncoder().encode('cd')); c.close(); } });
    const provider = createFetchProvider('/ai', { headers: { 'x-k': '1' }, fetchImpl: (async (_u: string, init: RequestInit) => ((body = JSON.parse(init.body as string)), new Response(stream))) as typeof fetch });
    const parts: string[] = [];
    for await (const p of provider({ action: 'a', instruction: 'i', text: 't', signal: new AbortController().signal }) as AsyncIterable<string>) parts.push(p);
    expect(parts.join('')).toBe('abcd');
    expect(body).toEqual({ action: 'a', instruction: 'i', text: 't' });
  });

  it('throws on a non-OK response', async () => {
    const provider = createFetchProvider('/ai', { fetchImpl: (async () => new Response('no', { status: 500 })) as typeof fetch });
    await expect((async () => { for await (const _ of provider({ action: 'a', instruction: 'i', text: 't', signal: new AbortController().signal }) as AsyncIterable<string>); })()).rejects.toThrow('500');
  });
});
