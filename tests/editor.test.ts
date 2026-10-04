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
