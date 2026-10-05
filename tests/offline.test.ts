import { afterEach, describe, expect, it } from 'vitest';
import { Autosave, Comments, MemoryDraftStore, Offline, createEditor, defaultPlugins, type Draft } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const make = (store: MemoryDraftStore, opts: Record<string, unknown> = {}, extra: any[] = [], content = '<p>server copy</p>') => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Offline({ id: 'post-1', store, delayMs: 10, ...opts }), ...extra] });
};

describe('Offline drafts', () => {
  it('writes a draft after changes and offers to restore it in the next session', async () => {
    const store = new MemoryDraftStore();
    const a = make(store);
    await flush();
    a.view.dispatch(a.view.state.tr.insertText('UNSAVED ', 1));
    await flush(60);
    expect((await store.get('post-1'))!.html).toBe('<p>UNSAVED server copy</p>');
    a.destroy(); // the tab is closed

    const b = make(store); // the page opens again with the server's copy
    await flush(40);
    const banner = b.root.querySelector('.wy-draft-banner') as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('Unsaved changes');
    expect(b.getHTML()).toBe('<p>server copy</p>'); // not applied without asking
    (banner.querySelector('.wy-btn-primary') as HTMLButtonElement).click();
    expect(b.getHTML()).toBe('<p>UNSAVED server copy</p>');
    expect(banner.hidden).toBe(true);
    b.execute('undo'); // restoring is one undo step
    expect(b.getHTML()).toBe('<p>server copy</p>');
  });

  it('Discard removes the draft; an identical draft is not offered; shouldRestore can veto', async () => {
    const store = new MemoryDraftStore();
    await store.put('post-1', { html: '<p>old draft</p>', comments: [], savedAt: 1 });
    const a = make(store);
    await flush(40);
    (a.root.querySelector('.wy-draft-banner button:not(.wy-btn-primary)') as HTMLButtonElement).click();
    await flush();
    expect(await store.get('post-1')).toBeNull();

    await store.put('post-1', { html: '<p>server copy</p>', comments: [], savedAt: 1 });
    const b = make(store);
    await flush(40);
    expect((b.root.querySelector('.wy-draft-banner') as HTMLElement).hidden).toBe(true);

    await store.put('post-1', { html: '<p>stale</p>', comments: [], savedAt: 1 });
    const c = make(store, { shouldRestore: (d: Draft) => d.savedAt > 100 });
    await flush(40);
    expect((c.root.querySelector('.wy-draft-banner') as HTMLElement).hidden).toBe(true);
  });

  it('confirm: false restores silently', async () => {
    const store = new MemoryDraftStore();
    await store.put('post-1', { html: '<p>from last time</p>', comments: [], savedAt: 5 });
    const e = make(store, { confirm: false });
    await flush(40);
    expect(e.getHTML()).toBe('<p>from last time</p>');
  });

  it('a successful save removes the draft, but the "saved" Autosave announces at startup does not', async () => {
    const store = new MemoryDraftStore();
    await store.put('post-1', { html: '<p>precious draft</p>', comments: [], savedAt: 5 });
    const saves: string[] = [];
    const e = make(store, {}, [Autosave({ save: async (html) => void saves.push(html), delayMs: 10 })]);
    await flush(40);
    expect(await store.get('post-1')).not.toBeNull(); // still there: the startup "saved" must not delete it
    (e.root.querySelector('.wy-draft-banner .wy-btn-primary') as HTMLButtonElement).click(); // restore it
    await flush(80); // the restore is a change: Autosave saves it, then the draft is no longer needed
    expect(saves.at(-1)).toBe('<p>precious draft</p>');
    expect(await store.get('post-1')).toBeNull();
  });

  it('keeps comment threads in the draft and restores them', async () => {
    const store = new MemoryDraftStore();
    const comments = Comments({ author: 'Ana' });
    const a = make(store, {}, [comments]);
    a.view.dispatch(a.view.state.tr.setSelection((await import('prosemirror-state')).TextSelection.create(a.view.state.doc, 1, 7)));
    a.execute('addComment', 'a note');
    await flush(60);
    expect((await store.get('post-1'))!.comments).toHaveLength(1);
    a.destroy();
    const c2 = Comments({ author: 'Ana' });
    const b = make(store, { confirm: false }, [c2]);
    await flush(60);
    expect(c2.store.list()[0]).toMatchObject({ text: 'a note' });
    expect(b.getHTML()).toContain('data-comment-id');
  });

  it('shows an offline notice, and discardDraft / saveDraft are commands', async () => {
    const store = new MemoryDraftStore();
    const e = make(store);
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    window.dispatchEvent(new Event('offline'));
    expect((e.root.querySelector('.wy-offline') as HTMLElement).hidden).toBe(false);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    window.dispatchEvent(new Event('online'));
    expect((e.root.querySelector('.wy-offline') as HTMLElement).hidden).toBe(true);
    e.execute('saveDraft');
    await flush();
    expect(await store.get('post-1')).not.toBeNull();
    e.execute('discardDraft');
    await flush();
    expect(await store.get('post-1')).toBeNull();
  });
});
