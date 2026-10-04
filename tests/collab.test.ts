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
import { Collaboration, linkDocs } from '../src';

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
