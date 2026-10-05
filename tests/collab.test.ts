import { beforeEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Comments, Editor, defaultPlugins } from '../src';

function make(content: string, comments = Comments({ author: 'Ana' })) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  const editor = new Editor({ element: el, content, plugins: [...defaultPlugins, comments] });
  return { editor, comments };
}
const select = (e: Editor, from: number, to: number) => e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, from, to)));

describe('read-only mode', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('blocks commands and editing but not safe commands', () => {
    const { editor: e } = make('<p>abc</p>');
    e.setReadOnly(true);
    expect(e.view.editable).toBe(false);
    select(e, 1, 4);
    expect(e.execute('bold')).toBe(false);
    expect(e.getHTML()).toBe('<p>abc</p>');
    expect(e.execute('addComment', 'ok')).toBe(true); // commenting is allowed
    e.setReadOnly(false);
    expect(e.view.editable).toBe(true);
  });
});

describe('Comments', () => {
  it('adds a comment on the selection and shows it in the panel', () => {
    const { editor: e, comments } = make('<p>hello world</p>');
    expect(e.execute('addComment', 'nice')).toBe(false); // empty selection
    select(e, 1, 6);
    expect(e.execute('addComment', ' nice ')).toBe(true);
    const [t] = comments.store.list();
    expect(t).toMatchObject({ author: 'Ana', text: 'nice', resolved: false });
    expect(e.getHTML()).toContain(`data-comment-id="${t.id}"`);
    expect(e.root.querySelector('.wy-comment-text')!.textContent).toBe('nice');
    expect(e.root.querySelector('.wy-comment-quote')!.textContent).toBe('hello');
  });

  it('replies, resolves and deletes (removing the mark)', () => {
    const { editor: e, comments } = make('<p>hello</p>');
    select(e, 1, 6);
    e.execute('addComment', 'q');
    const id = comments.store.list()[0].id;
    expect(e.execute('replyComment', id, 'answer')).toBe(true);
    expect(e.execute('replyComment', id, '  ')).toBe(false);
    expect(comments.store.get(id)!.replies).toHaveLength(1);
    e.execute('resolveComment', id);
    expect(comments.store.get(id)!.resolved).toBe(true);
    e.execute('deleteComment', id);
    expect(comments.store.list()).toHaveLength(0);
    expect(e.getHTML()).toBe('<p>hello</p>');
  });

  it('supports overlapping comments and survives an HTML round trip', () => {
    const { editor: e, comments } = make('<p>abcdef</p>');
    select(e, 1, 5);
    e.execute('addComment', 'one');
    select(e, 3, 7);
    e.execute('addComment', 'two');
    expect(comments.store.list()).toHaveLength(2);
    e.setHTML(e.getHTML());
    expect(e.root.querySelectorAll('.wy-comment-card')).toHaveLength(2);
  });

  it('hides threads whose text was deleted and escapes user text', () => {
    const { editor: e, comments } = make('<p>abc</p>');
    select(e, 1, 4);
    e.execute('addComment', '<img src=x onerror=alert(1)>');
    expect(e.root.querySelector('.wy-comments img')).toBeNull();
    e.view.dispatch(e.view.state.tr.delete(1, 4));
    expect(e.root.querySelectorAll('.wy-comment-card')).toHaveLength(0);
    expect(comments.store.list()).toHaveLength(1); // kept in the store so an undo can restore it
  });

  it('notifies subscribers and round-trips through JSON', () => {
    const seen: number[] = [];
    const { editor: e, comments } = make('<p>abc</p>', Comments({ onChange: (t) => seen.push(t.length) }));
    select(e, 1, 4);
    e.execute('addComment', 'x');
    expect(seen).toEqual([1]);
    const json = JSON.parse(JSON.stringify(comments.store.toJSON()));
    comments.store.load([]);
    comments.store.load(json);
    expect(comments.store.list()).toHaveLength(1);
  });
});

import { TrackChanges, getChanges } from '../src';

describe('Track changes', () => {
  const setup = (html: string, author = 'Ana') => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    document.body.append(el);
    const e = new Editor({ element: el, content: html, plugins: [...defaultPlugins, TrackChanges({ author, enabled: true })] });
    return e;
  };
  const caret = (e: Editor, pos: number) => e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, pos)));
  const plain = (e: Editor) => e.getHTML().replace(/<(ins|del)[^>]*>/g, '[$1:').replace(/<\/(ins|del)>/g, ']');

  it('marks typed text as an insertion and puts the caret after it', () => {
    const e = setup('<p>ab</p>');
    caret(e, 2);
    e.view.dispatch(e.view.state.tr.insertText('X', 2));
    expect(plain(e)).toBe('<p>a[ins:X]b</p>');
    expect(e.view.state.selection.from).toBe(3);
    e.view.dispatch(e.view.state.tr.insertText('Y', 3));
    expect(getChanges(e.view.state.doc)).toMatchObject([{ type: 'insertion', text: 'XY', author: 'Ana' }]);
  });

  it('marks deleted text instead of removing it, and backspace moves over it', () => {
    const e = setup('<p>abc</p>');
    caret(e, 3);
    e.view.dispatch(e.view.state.tr.delete(2, 3)); // Backspace over "b"
    expect(plain(e)).toBe('<p>a[del:b]c</p>');
    expect(e.view.state.selection.from).toBe(2);
    e.view.dispatch(e.view.state.tr.delete(2, 3)); // Backspace over the already-deleted char changes nothing
    expect(plain(e)).toBe('<p>a[del:b]c</p>');
  });

  it('really deletes the author’s own insertion', () => {
    const e = setup('<p>ab</p>');
    e.view.dispatch(e.view.state.tr.insertText('X', 2));
    e.view.dispatch(e.view.state.tr.delete(2, 3));
    expect(e.getHTML()).toBe('<p>ab</p>');
  });

  it('replacing a selection deletes the old text (marked) and inserts the new', () => {
    const e = setup('<p>abc</p>');
    e.view.dispatch(e.view.state.tr.insertText('Z', 2, 3)); // overwrite "b"
    expect(plain(e)).toBe('<p>a[del:b][ins:Z]c</p>');
  });

  it('accepts and rejects changes', () => {
    const e = setup('<p>abc</p>');
    e.view.dispatch(e.view.state.tr.insertText('Z', 2, 3));
    e.execute('rejectAll');
    expect(e.getHTML()).toBe('<p>abc</p>');
    e.view.dispatch(e.view.state.tr.insertText('Z', 2, 3));
    e.execute('acceptAll');
    expect(e.getHTML()).toBe('<p>aZc</p>');
    expect(e.execute('acceptAll')).toBe(false);
  });

  it('accepts only the change at the caret', () => {
    const e = setup('<p>abcd</p>');
    e.view.dispatch(e.view.state.tr.insertText('X', 2));
    e.view.dispatch(e.view.state.tr.insertText('Y', 5));
    caret(e, 2);
    e.execute('acceptChange');
    expect(plain(e)).toBe('<p>aXbc[ins:Y]d</p>');
  });

  it('does not track when switched off, and leaves block-level edits alone', () => {
    const e = setup('<p>ab</p><p>cd</p>');
    e.execute('toggleTracking');
    e.view.dispatch(e.view.state.tr.insertText('X', 2));
    expect(e.getHTML()).toBe('<p>aXb</p><p>cd</p>');
    e.execute('toggleTracking');
    e.view.dispatch(e.view.state.tr.delete(4, 6)); // joins paragraphs: structural, applied untracked
    expect(e.getHTML()).not.toContain('<del');
  });

  it('round-trips deletions too (not as plain strikethrough)', () => {
    const e = setup('<p>abc</p>');
    e.view.dispatch(e.view.state.tr.delete(2, 3));
    expect(getChanges(e.view.state.doc)).toMatchObject([{ type: 'deletion', text: 'b' }]);
    e.setHTML(e.getHTML());
    expect(getChanges(e.view.state.doc)).toMatchObject([{ type: 'deletion', text: 'b', author: 'Ana' }]);
    expect(e.getHTML()).toContain('<del');
    expect(e.getHTML()).not.toContain('<s>');
    // a plain <del> without review data is still just strikethrough
    e.setHTML('<p>x<del>y</del></p>');
    expect(getChanges(e.view.state.doc)).toHaveLength(0);
    expect(e.getHTML()).toContain('<s>y</s>');
  });

  it('round-trips marks through HTML', () => {
    const e = setup('<p>a</p>');
    e.view.dispatch(e.view.state.tr.insertText('X', 2));
    e.setHTML(e.getHTML());
    expect(getChanges(e.view.state.doc)[0]).toMatchObject({ type: 'insertion', author: 'Ana' });
  });
});

import { Versions, localStorageVersions } from '../src';

describe('Versions', () => {
  const setup = (html: string, v = Versions({ author: 'Ana' })) => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    document.body.append(el);
    return { e: new Editor({ element: el, content: html, plugins: [...defaultPlugins, v] }), v };
  };

  it('saves, lists newest first, and skips a save when nothing changed', () => {
    const { e, v } = setup('<p>one</p>');
    expect(e.execute('saveVersion', 'First')).toBe(true);
    expect(e.execute('saveVersion', 'Dup')).toBe(false);
    e.setHTML('<p>two</p>');
    e.execute('saveVersion', 'Second');
    expect(v.store.list().map((x) => x.label)).toEqual(['Second', 'First']);
  });

  it('restores a version, snapshots the current state first, and the restore is undoable', () => {
    const { e, v } = setup('<p>one</p>');
    e.execute('saveVersion', 'First');
    e.setHTML('<p>two</p>');
    const id = v.store.list().find((x) => x.label === 'First')!.id;
    expect(e.execute('restoreVersion', id)).toBe(true);
    expect(e.getHTML()).toBe('<p>one</p>');
    expect(v.store.list()[0].label).toBe('Before restore of "First"');
    expect(v.store.list()[0].html).toBe('<p>two</p>');
    e.execute('undo');
    expect(e.getHTML()).toBe('<p>two</p>');
  });

  it('rejects unknown ids, deletes, and caps the number of versions', () => {
    const { e, v } = setup('<p>0</p>', Versions({ max: 2 }));
    expect(e.execute('restoreVersion', 'nope')).toBe(false);
    for (const n of [1, 2, 3]) (e.setHTML(`<p>${n}</p>`), e.execute('saveVersion', `v${n}`));
    expect(v.store.list().map((x) => x.label)).toEqual(['v3', 'v2']);
    expect(e.execute('deleteVersion', v.store.list()[0].id)).toBe(true);
    expect(v.store.list()).toHaveLength(1);
  });

  it('persists across editors via localStorage persistence', () => {
    localStorage.clear();
    const a = setup('<p>x</p>', Versions({ persistence: localStorageVersions('k') }));
    a.e.execute('saveVersion', 'Keep');
    const b = setup('<p>y</p>', Versions({ persistence: localStorageVersions('k') }));
    expect(b.v.store.list().map((x) => x.label)).toEqual(['Keep']);
  });

  it('auto-saves after changes settle', async () => {
    const { e, v } = setup('<p>a</p>', Versions({ autoSaveMs: 20 }));
    e.view.dispatch(e.view.state.tr.insertText('b', 2));
    await new Promise((r) => setTimeout(r, 60));
    expect(v.store.list().map((x) => x.label)).toEqual(['Autosave']);
  });
});

import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { Collaboration, linkDocs } from '../src/collab';

describe('Collaboration (Yjs)', () => {
  const peer = (ydoc: Y.Doc, seed?: string, awareness?: Awareness, name = 'u') => {
    const el = document.createElement('div');
    document.body.append(el);
    return new Editor({ element: el, plugins: [...defaultPlugins, Collaboration({ ydoc, seed, awareness, user: { name, color: '#f00' } })] });
  };
  const flush = () => new Promise((r) => setTimeout(r, 10));

  it('propagates edits between two editors in both directions', async () => {
    document.body.innerHTML = '';
    const a = new Y.Doc();
    const b = new Y.Doc();
    linkDocs(a, b);
    const ea = peer(a, '<p>hello</p>');
    await flush();
    const eb = peer(b);
    await flush();
    expect(eb.getHTML()).toBe('<p>hello</p>');
    ea.view.dispatch(ea.view.state.tr.insertText('A', 1));
    await flush();
    expect(eb.getHTML()).toBe('<p>Ahello</p>');
    eb.view.dispatch(eb.view.state.tr.insertText('B', eb.view.state.doc.content.size - 1));
    await flush();
    expect(ea.getHTML()).toBe('<p>AhelloB</p>');
  });

  it('merges concurrent edits made while disconnected', async () => {
    document.body.innerHTML = '';
    const a = new Y.Doc();
    const b = new Y.Doc();
    const unlink = linkDocs(a, b);
    const ea = peer(a, '<p>abc</p>');
    await flush();
    const eb = peer(b);
    await flush();
    unlink();
    ea.view.dispatch(ea.view.state.tr.insertText('X', 1));
    eb.view.dispatch(eb.view.state.tr.insertText('Y', 4));
    await flush();
    linkDocs(a, b);
    await flush();
    expect(ea.getHTML()).toBe(eb.getHTML());
    expect(ea.getHTML()).toBe('<p>XabcY</p>');
  });

  it('undo only reverts the local user’s own changes', async () => {
    document.body.innerHTML = '';
    const a = new Y.Doc();
    const b = new Y.Doc();
    linkDocs(a, b);
    const ea = peer(a, '<p>abc</p>');
    await flush();
    const eb = peer(b);
    await flush();
    ea.view.dispatch(ea.view.state.tr.insertText('X', 1));
    await flush();
    eb.view.dispatch(eb.view.state.tr.insertText('Y', 5));
    await flush();
    expect(ea.getHTML()).toBe('<p>XabcY</p>');
    ea.execute('undo');
    await flush();
    expect(ea.getHTML()).toBe('<p>abcY</p>'); // A's X is gone, B's Y is kept
    expect(eb.getHTML()).toBe('<p>abcY</p>');
  });

  it('does not seed a document that already has content', async () => {
    document.body.innerHTML = '';
    const a = new Y.Doc();
    const b = new Y.Doc();
    linkDocs(a, b);
    peer(a, '<p>first</p>');
    await flush();
    const eb = peer(b, '<p>second</p>');
    await flush();
    expect(eb.getHTML()).toBe('<p>first</p>');
  });

  it('shares presence through awareness', async () => {
    document.body.innerHTML = '';
    const a = new Y.Doc();
    const aw = new Awareness(a);
    peer(a, '<p>x</p>', aw, 'Ana');
    expect(aw.getLocalState()?.user).toMatchObject({ name: 'Ana' });
  });
});

import { Mentions, type MentionItem } from '../src';

describe('Mentions', () => {
  const people = [{ id: 'u1', label: 'Ana Lee' }, { id: 'u2', label: 'Andre' }, { id: 'u3', label: 'Bob' }];
  const flush = () => new Promise((r) => setTimeout(r, 5));
  const setup = (search: (q: string) => MentionItem[] | Promise<MentionItem[]> = (q) => people.filter((p) => p.label.toLowerCase().includes(q.toLowerCase()))) => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    document.body.append(el);
    return new Editor({ element: el, content: '<p>hi</p>', plugins: [...defaultPlugins, Mentions({ search })] });
  };
  const type = (e: Editor, text: string) => e.view.dispatch(e.view.state.tr.insertText(text, e.view.state.selection.from));
  const key = (e: Editor, k: string) => e.view.someProp('handleKeyDown', (f) => f(e.view, new KeyboardEvent('keydown', { key: k })));

  it('shows suggestions while typing after @ and filters them', async () => {
    const e = setup();
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.atEnd(e.view.state.doc)));
    type(e, ' @an');
    await flush();
    expect([...e.root.querySelectorAll('.wy-mention-item')].map((n) => n.textContent)).toEqual(['Ana Lee', 'Andre']);
  });

  it('inserts the highlighted suggestion with Enter, using arrow keys to move', async () => {
    const e = setup();
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.atEnd(e.view.state.doc)));
    type(e, ' @an');
    await flush();
    expect(key(e, 'ArrowDown')).toBe(true);
    expect(key(e, 'Enter')).toBe(true);
    expect(e.getHTML()).toBe('<p>hi <span class="wy-mention" data-mention-id="u2">@Andre</span> </p>');
    expect(e.root.querySelector('.wy-mention-popup')!.hasAttribute('hidden')).toBe(true);
    expect(e.getMarkdown()).toBe('hi @Andre ');
  });

  it('closes on Escape and does not trigger inside words like emails', async () => {
    const e = setup();
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.atEnd(e.view.state.doc)));
    type(e, ' @b');
    await flush();
    const popup = e.root.querySelector('.wy-mention-popup')!;
    expect(popup.hasAttribute('hidden')).toBe(false);
    expect(key(e, 'Escape')).toBe(true);
    expect(popup.hasAttribute('hidden')).toBe(true);
    const e2 = setup();
    e2.view.dispatch(e2.view.state.tr.setSelection(TextSelection.atEnd(e2.view.state.doc)));
    type(e2, 'a@b');
    await flush();
    expect(e2.root.querySelectorAll('.wy-mention-item')).toHaveLength(0);
  });

  it('ignores stale async results and survives a failing search', async () => {
    let calls = 0;
    const e = setup(async (q) => {
      const n = ++calls;
      await new Promise((r) => setTimeout(r, n === 1 ? 30 : 1)); // first (older) request answers last
      return [{ id: `r${n}`, label: `result-${q}` }];
    });
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.atEnd(e.view.state.doc)));
    type(e, ' @a');
    type(e, 'b');
    await new Promise((r) => setTimeout(r, 60));
    expect([...e.root.querySelectorAll('.wy-mention-item')].map((n) => n.textContent)).toEqual(['result-ab']);
    const bad = setup(() => Promise.reject(new Error('down')));
    bad.view.dispatch(bad.view.state.tr.setSelection(TextSelection.atEnd(bad.view.state.doc)));
    type(bad, ' @x');
    await flush();
    expect(bad.root.querySelectorAll('.wy-mention-item')).toHaveLength(0);
  });

  it('inserts programmatically, validates input, and round-trips HTML', () => {
    const e = setup();
    expect(e.execute('insertMention', { id: '', label: 'x' })).toBe(false);
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.atEnd(e.view.state.doc)));
    expect(e.execute('insertMention', { id: 'u3', label: 'Bob' })).toBe(true);
    e.setHTML(e.getHTML());
    expect(e.getHTML()).toContain('data-mention-id="u3">@Bob</span>');
  });
});

describe('Comments shared through collaboration', () => {
  const peer = (ydoc: Y.Doc, seed?: string, author = 'u', initial: any[] = []) => {
    const el = document.createElement('div');
    document.body.append(el);
    const comments = Comments({ author, initial });
    const editor = new Editor({ element: el, plugins: [...defaultPlugins, Collaboration({ ydoc, seed, user: { name: author, color: '#f00' } }), comments] });
    return { editor, comments };
  };
  const flush = () => new Promise((r) => setTimeout(r, 15));
  const setup = async () => {
    document.body.innerHTML = '';
    const a = new Y.Doc();
    const b = new Y.Doc();
    const unlink = linkDocs(a, b);
    const A = peer(a, '<p>hello world</p>', 'Ana');
    await flush();
    const B = peer(b, undefined, 'Budi');
    await flush();
    return { A, B, a, b, unlink };
  };

  it('a comment added by one editor appears in the other (thread and highlight)', async () => {
    const { A, B } = await setup();
    A.editor.view.dispatch(A.editor.view.state.tr.setSelection(TextSelection.create(A.editor.view.state.doc, 1, 6)));
    A.editor.execute('addComment', 'Please check this');
    await flush();
    expect(B.comments.store.list()).toHaveLength(1);
    expect(B.comments.store.list()[0]).toMatchObject({ author: 'Ana', text: 'Please check this' });
    expect(B.editor.getHTML()).toContain('data-comment-id');
    expect(B.editor.root.querySelectorAll('.wy-comment-card')).toHaveLength(1);
  });

  it('replies, resolve and delete travel both ways', async () => {
    const { A, B } = await setup();
    A.editor.view.dispatch(A.editor.view.state.tr.setSelection(TextSelection.create(A.editor.view.state.doc, 1, 6)));
    A.editor.execute('addComment', 'q');
    await flush();
    const id = A.comments.store.list()[0].id;
    B.editor.execute('replyComment', id, 'answer from Budi');
    await flush();
    expect(A.comments.store.get(id)!.replies.map((r) => r.text)).toEqual(['answer from Budi']);
    A.editor.execute('resolveComment', id, true);
    await flush();
    expect(B.comments.store.get(id)!.resolved).toBe(true);
    A.editor.execute('deleteComment', id);
    await flush();
    expect(B.comments.store.list()).toHaveLength(0);
  });

  it('two replies written at the same moment are both kept', async () => {
    const { A, B, unlink, a, b } = await setup();
    A.editor.view.dispatch(A.editor.view.state.tr.setSelection(TextSelection.create(A.editor.view.state.doc, 1, 6)));
    A.editor.execute('addComment', 'q');
    await flush();
    const id = A.comments.store.list()[0].id;
    unlink(); // both offline
    A.editor.execute('replyComment', id, 'reply A');
    B.editor.execute('replyComment', id, 'reply B');
    linkDocs(a, b);
    await flush();
    const texts = (s: typeof A) => s.comments.store.get(id)!.replies.map((r) => r.text).sort();
    expect(texts(A)).toEqual(['reply A', 'reply B']);
    expect(texts(B)).toEqual(['reply A', 'reply B']);
  });

  it('threads loaded from a database are shared once, not duplicated by a second editor', async () => {
    document.body.innerHTML = '';
    const a = new Y.Doc();
    const b = new Y.Doc();
    linkDocs(a, b);
    const saved = [{ id: 'c1', author: 'Ana', text: 'saved', createdAt: 1, resolved: false, replies: [{ author: 'B', text: 'r', createdAt: 2 }] }];
    const A = peer(a, '<p>x</p>', 'Ana', structuredClone(saved));
    await flush();
    const B = peer(b, undefined, 'Budi', structuredClone(saved)); // the same threads, loaded from the same database row
    await flush();
    expect(A.comments.store.list()).toHaveLength(1);
    expect(B.comments.store.list()).toHaveLength(1);
    expect(B.comments.store.list()[0].replies).toHaveLength(1);
    expect(new Set(A.comments.store.list()[0].replies.map((r) => r.id)).size).toBe(1);
  });
});
