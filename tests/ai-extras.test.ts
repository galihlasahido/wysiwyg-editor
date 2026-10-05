import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { AIAssistant, TrackChanges, createEditor, defaultPlugins, type AIProvider } from '../src';
import { wordEdits } from '../src/plugins/ai-extras';

const roots: HTMLElement[] = [];
afterEach(() => { roots.splice(0).forEach((r) => r.remove()); vi.useRealTimers(); });
const make = (content: string, provider: AIProvider, ai: object = {}, track = true) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, ...(track ? [TrackChanges({ author: 'Me' })] : []), AIAssistant({ provider, ...ai })] });
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('wordEdits', () => {
  it('finds deleted and inserted words by offset', () => {
    const e = wordEdits('i recieve teh report', 'I receive the report')!;
    expect(e.del).toEqual([[0, 1], [2, 9], [10, 13]]);
    expect(e.ins.map((x) => x[1])).toEqual(['I', 'receive', 'the']);
    expect(wordEdits('same text', 'same text')).toEqual({ del: [], ins: [] });
  });
  it('gives up on huge inputs instead of hanging', () => {
    expect(wordEdits('a '.repeat(2000), 'b '.repeat(2000))).toBeNull();
  });
});

describe('inline suggestions', () => {
  const setup = (reply = ' and then it ended.', ai = {}) => {
    const provider = vi.fn<AIProvider>(async () => reply);
    const ed = make('<p>The story begins on a quiet morning</p>', provider, { inline: { delayMs: 10, minChars: 5 }, ...ai });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    return { ed, provider };
  };
  it('shows ghost text after a pause and Tab accepts it as real text', async () => {
    const { ed, provider } = setup();
    ed.view.dispatch(ed.view.state.tr.insertText('.', ed.view.state.selection.from)); // typing triggers it
    await tick(60);
    expect(provider).toHaveBeenCalled();
    expect(provider.mock.calls[0][0].action).toBe('complete');
    const ghost = ed.view.dom.querySelector('.wy-ghost')!;
    expect(ghost.textContent).toBe(' and then it ended.');
    expect(ed.view.state.doc.textContent).toBe('The story begins on a quiet morning.'); // not in the document yet
    expect(ed.execute('acceptAISuggestion')).toBe(true);
    expect(ed.view.state.doc.textContent).toBe('The story begins on a quiet morning. and then it ended.');
    expect(ed.view.dom.querySelector('.wy-ghost')).toBeNull();
    ed.destroy();
  });
  it('typing or moving dismisses it; Esc dismisses it; the toggle turns it off', async () => {
    const { ed, provider } = setup();
    ed.view.dispatch(ed.view.state.tr.insertText('!', ed.view.state.selection.from));
    await tick(60);
    expect(ed.view.dom.querySelector('.wy-ghost')).not.toBeNull();
    ed.view.dispatch(ed.view.state.tr.insertText('x', ed.view.state.selection.from));
    expect(ed.view.dom.querySelector('.wy-ghost')).toBeNull();
    await tick(60);
    expect(ed.execute('dismissAISuggestion')).toBe(true);
    ed.execute('toggleAISuggestions');
    provider.mockClear();
    ed.view.dispatch(ed.view.state.tr.insertText('y', ed.view.state.selection.from));
    await tick(60);
    expect(provider).not.toHaveBeenCalled();
    ed.destroy();
  });
  it('shows only plain text: one line, markup stays text, capped length; nothing for short paragraphs or code', async () => {
    const { ed } = setup('<img src=x onerror=alert(1)>\nsecond line', { inline: { delayMs: 10, minChars: 5, maxChars: 12 } });
    ed.view.dispatch(ed.view.state.tr.insertText('.', ed.view.state.selection.from));
    await tick(60);
    const g = ed.view.dom.querySelector('.wy-ghost')!;
    expect(g.querySelector('img')).toBeNull();
    expect(g.textContent!.length).toBeLessThanOrEqual(13);
    expect(g.textContent).not.toContain('second');
    ed.destroy();
    const short = make('<p>Hi</p>', vi.fn(async () => 'x'), { inline: { delayMs: 10 } });
    short.view.dispatch(short.view.state.tr.setSelection(TextSelection.atEnd(short.view.state.doc)).insertText('!', 3));
    await tick(60);
    expect(short.view.dom.querySelector('.wy-ghost')).toBeNull();
    short.destroy();
  });
  it('is off unless asked for', async () => {
    const provider = vi.fn<AIProvider>(async () => 'x');
    const ed = make('<p>A paragraph long enough to suggest from</p>', provider);
    ed.view.dispatch(ed.view.state.tr.insertText('.', 5));
    await tick(60);
    expect(provider).not.toHaveBeenCalled();
    ed.destroy();
  });
});

describe('review as tracked changes', () => {
  it('proposes fixes as insertions and deletions that can be rejected to restore the text', async () => {
    const fixes: Record<string, string> = { 'i recieve teh report.': 'I receive the report.', 'All good here.': 'All good here.' };
    const ed = make('<p>i recieve teh report.</p><p>All good here.</p>', async ({ text }) => fixes[text] ?? text);
    const events: unknown[] = [];
    ed.on('ai-review', (e) => events.push(e));
    expect(ed.execute('aiReview')).toBe(true);
    await tick(120);
    expect(events).toEqual([{ changed: 1, skipped: 0 }]);
    expect(ed.view.dom.querySelectorAll('ins').length).toBeGreaterThan(0);
    expect(ed.view.dom.querySelectorAll('del').length).toBeGreaterThan(0);
    const html = ed.getHTML();
    expect(html).toContain('All good here.'); // untouched paragraph
    ed.execute('acceptAll');
    expect(ed.view.state.doc.child(0).textContent).toBe('I receive the report.');
    ed.execute('undo');
    ed.execute('rejectAll');
    expect(ed.view.state.doc.child(0).textContent).toBe('i recieve teh report.');
    ed.destroy();
  });
  it('skips a paragraph edited while the model was working, and ignores multi-line replies', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ed = make('<p>first one</p><p>second one</p>', async ({ text }) => { await gate; return text === 'first one' ? 'First one!' : 'a\nb'; });
    const events: any[] = [];
    ed.on('ai-review', (e) => events.push(e));
    ed.execute('aiReview');
    ed.view.dispatch(ed.view.state.tr.insertText('X', 2)); // edit the first paragraph meanwhile
    release();
    await tick(120);
    expect(events[0]).toEqual({ changed: 0, skipped: 1 });
    expect(ed.view.state.doc.child(1).textContent).toBe('second one');
    ed.destroy();
  });
  it('needs the TrackChanges plugin, and cancel leaves the document alone', async () => {
    const ed = make('<p>text</p>', async () => 'other', {}, false);
    const msgs: string[] = [];
    ed.on('ai-status', (e: any) => msgs.push(e.message));
    expect(ed.execute('aiReview')).toBe(false);
    expect(msgs[0]).toMatch(/TrackChanges/);
    ed.destroy();
    const ed2 = make('<p>text</p>', async () => { await tick(50); return 'other'; });
    ed2.execute('aiReview');
    (ed2.root.querySelector('.wy-aic-bar button') as HTMLElement).click();
    await tick(120);
    expect(ed2.view.state.doc.textContent).toBe('text');
    expect(ed2.view.dom.querySelector('ins, del')).toBeNull();
    expect(ed2.root.querySelector('.wy-aic-bar')).toBeNull();
    ed2.destroy();
  });
});

describe('chat', () => {
  it('sends the question with the document as context and shows the reply as text', async () => {
    const calls: any[] = [];
    const ed = make('<p>The cat sat.</p>', async (req) => { calls.push(req); return 'It is about a **cat**.'; }, { chat: true });
    ed.execute('aiChat');
    const input = ed.root.querySelector('.wy-aic-chat textarea') as HTMLTextAreaElement;
    input.value = 'What is this about?';
    (ed.root.querySelector('.wy-aic-form') as HTMLFormElement).requestSubmit();
    await tick(40);
    expect(calls[0].action).toBe('chat');
    expect(calls[0].text).toContain('The cat sat.');
    expect(calls[0].instruction).toContain('What is this about?');
    expect(ed.root.querySelector('.wy-aic-msg.is-assistant .wy-aic-text')!.textContent).toBe('It is about a **cat**.');
    ed.destroy();
  });
  it('replies are never markup; Insert puts them in the document as Markdown without raw HTML', async () => {
    const ed = make('<p>Intro</p>', async () => 'Hello <img src=x onerror=alert(1)> **bold**', { chat: true });
    ed.execute('aiChat', 'say hi');
    await tick(40);
    expect(ed.root.querySelector('.wy-aic-chat img')).toBeNull();
    (ed.root.querySelector('.wy-aic-msg.is-assistant .wy-btn') as HTMLElement).click();
    expect(ed.view.dom.querySelector('img:not(.ProseMirror-separator)')).toBeNull();
    expect(ed.view.dom.querySelector('strong, b')!.textContent).toBe('bold');
    ed.destroy();
  });
  it('shows an error when the provider fails and keeps working', async () => {
    let n = 0;
    const ed = make('<p>x</p>', async () => { if (n++ === 0) throw new Error('boom'); return 'fine'; }, { chat: true });
    ed.execute('aiChat', 'one');
    await tick(40);
    expect(ed.root.querySelector('.wy-aic-msg.is-error')!.textContent).toBe('boom');
    ed.execute('aiChat', 'two');
    await tick(40);
    expect(ed.root.querySelector('.wy-aic-msg.is-assistant .wy-aic-text')!.textContent).toBe('fine');
    ed.destroy();
  });
  it('has no chat command unless enabled', () => {
    const ed = make('<p>x</p>', async () => 'y');
    expect(ed.hasCommand('aiChat')).toBe(false);
    ed.destroy();
  });
});
