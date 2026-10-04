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
