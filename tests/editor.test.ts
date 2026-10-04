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

  it('aligns text', () => {
    const e = make('<p>abc</p>');
    e.execute('align', 'center');
    expect(e.getHTML()).toMatch(/^<p style="text-align: center;?">abc<\/p>$/);
  });

  it('applies text color', () => {
    const e = make('<p>abc</p>');
    selectAll(e);
    e.execute('textColor', '#e03131');
    expect(e.getHTML()).toMatch(/color: (#e03131|rgb\(224, 49, 49\))/);
    // Survives a reload even when the browser normalises it to rgb().
    e.setHTML(e.getHTML());
    expect(e.getHTML()).toMatch(/color: (#e03131|rgb\(224, 49, 49\))/);
  });

  it('exports and imports Markdown', () => {
    const e = make('<h1>Title</h1><p>a <strong>b</strong> <em>c</em></p><ul><li><p>x</p></li></ul>');
    const md = e.getMarkdown();
    expect(md).toBe('# Title\n\na **b** _c_\n\n- x');
    e.setMarkdown(md);
    expect(e.getHTML()).toBe('<h1>Title</h1><p>a <strong>b</strong> <em>c</em></p><ul><li><p>x</p></li></ul>');
  });

  it('ignores raw HTML and unsafe links in Markdown', () => {
    const e = make('');
    e.setMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))');
    expect(e.getHTML()).not.toContain('<script');
    expect(e.getHTML()).not.toContain('<a');
  });

  it('Enter in a list creates a new list item', () => {
    const e = make('<ul><li><p>a</p></li></ul>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.atEnd(e.view.state.doc)));
    const ev = new KeyboardEvent('keydown', { key: 'Enter' });
    e.view.someProp('handleKeyDown', (f) => f(e.view, ev));
    expect(e.getHTML()).toBe('<ul><li><p>a</p></li><li><p></p></li></ul>');
  });

  it('sets font size and family and survives reload', () => {
    const e = make('<p>abc</p>');
    selectAll(e);
    e.execute('fontSize', '24');
    e.execute('fontFamily', 'Georgia');
    e.setHTML(e.getHTML());
    expect(e.getHTML()).toContain('font-size: 24px');
    expect(e.getHTML()).toMatch(/font-family: (&quot;|'|")?Georgia/);
  });

  it('sets line spacing and keeps alignment', () => {
    const e = make('<p>abc</p>');
    e.execute('align', 'center');
    e.execute('lineHeight', '2');
    expect(e.getHTML()).toMatch(/text-align: center; line-height: 2/);
  });

  it('creates and toggles a checklist, exporting to Markdown', () => {
    const e = make('<p>todo</p>');
    e.execute('taskList');
    expect(e.getHTML()).toContain('data-task');
    const { state } = e.view;
    let pos = -1;
    state.doc.descendants((n, p) => { if (n.type.name === 'task_item') pos = p; });
    e.view.dispatch(state.tr.setNodeMarkup(pos, undefined, { checked: true }));
    expect(e.getMarkdown()).toBe('- [x] todo');
  });

  it('keeps checklists as checklists across an HTML round trip', () => {
    const e = make('<ul data-task-list><li data-task data-checked="true"><p>a</p></li></ul>');
    expect(e.getHTML()).toBe('<ul data-task-list=""><li data-task="" data-checked="true"><p>a</p></li></ul>');
    expect(e.getMarkdown()).toBe('- [x] a');
  });
});

import { findMatches } from '../src';

describe('Find & replace', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('finds matches across formatting boundaries, case-insensitively by default', () => {
    const e = make('<p>Hello <strong>wor</strong>ld, hello again</p>');
    expect(findMatches(e.view.state.doc, 'hello')).toHaveLength(2);
    expect(findMatches(e.view.state.doc, 'hello', true)).toHaveLength(1);
    expect(findMatches(e.view.state.doc, 'world')).toHaveLength(1);
    expect(findMatches(e.view.state.doc, '')).toHaveLength(0);
  });

  it('replaces the current match and all matches', () => {
    const e = make('<p>cat dog cat</p><p>cat</p>');
    expect(e.execute('find', 'cat')).toBe(true);
    e.execute('replace', 'bird');
    expect(e.getHTML()).toBe('<p>bird dog cat</p><p>cat</p>');
    e.execute('replaceAll', 'fish');
    expect(e.getHTML()).toBe('<p>bird dog fish</p><p>fish</p>');
  });

  it('reports no match', () => {
    expect(make('<p>abc</p>').execute('find', 'zzz')).toBe(false);
  });
});

describe('Word count', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('counts words across blocks and ignores extra whitespace', () => {
    const e = make('<p>Hello  world</p><p>again</p>');
    expect(e.getStats()).toEqual({ words: 3, characters: 17, charactersNoSpaces: 15 });
  });

  it('is zero for an empty document and updates the status bar', () => {
    const e = make('');
    expect(e.getStats().words).toBe(0);
    e.setHTML('<p>one two</p>');
    e.view.dispatch(e.view.state.tr.insertText('!', 1)); // trigger a plugin view update
    expect(e.root.querySelector('.wy-statusbar')!.textContent).toContain('2 words');
  });
});
