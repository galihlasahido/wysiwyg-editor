import { beforeEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { createEditor } from '../src';

function make(content: string) {
  const el = document.createElement('div');
  document.body.append(el);
  return createEditor({ element: el, content });
}

function selectAll(editor: ReturnType<typeof make>) {
  const { state } = editor.view;
  editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, 1, state.doc.content.size - 1)));
}

describe('Editor', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('round-trips HTML', () => {
    expect(make('<p>Hello <strong>world</strong></p>').getHTML()).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('applies bold via command', () => {
    const e = make('<p>abc</p>');
    selectAll(e);
    e.execute('bold');
    expect(e.getHTML()).toBe('<p><strong>abc</strong></p>');
  });

  it('changes block to heading', () => {
    const e = make('<p>abc</p>');
    e.execute('heading', '2');
    expect(e.getHTML()).toBe('<h2>abc</h2>');
  });

  it('wraps in bullet list', () => {
    const e = make('<p>abc</p>');
    e.execute('bulletList');
    expect(e.getHTML()).toBe('<ul><li><p>abc</p></li></ul>');
  });

  it('inserts table', () => {
    const e = make('<p>abc</p>');
    e.execute('insertTable', 2, 2);
    expect(e.getHTML()).toContain('<table>');
  });

  it('drops unsafe link and image URLs', () => {
    const e = make('<p><a href="javascript:alert(1)">x</a><img src="javascript:alert(1)"></p>');
    expect(e.getHTML()).not.toContain('javascript:');
  });

  it('throws on unknown command', () => {
    expect(() => make('').execute('nope')).toThrow();
  });
});
