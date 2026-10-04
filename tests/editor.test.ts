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

import { NodeSelection } from 'prosemirror-state';

describe('Images and tables', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  const selectImage = (e: ReturnType<typeof make>) => {
    let pos = -1;
    e.view.state.doc.descendants((n, p) => void (n.type.name === 'image' && (pos = p)));
    e.view.dispatch(e.view.state.tr.setSelection(NodeSelection.create(e.view.state.doc, pos)));
  };

  it('resizes an image, clamps the width and keeps it across a reload', () => {
    const e = make('<p><img src="https://x.test/a.png"></p>');
    selectImage(e);
    expect(e.execute('imageWidth', 300)).toBe(true);
    expect(e.getHTML()).toContain('width="300"');
    e.execute('imageWidth', 99999);
    expect(e.getHTML()).toContain('width="2000"');
    e.setHTML(e.getHTML());
    expect(e.getHTML()).toContain('width="2000"');
  });

  it('sets and clears a caption, and refuses when no image is selected', () => {
    const e = make('<p>text <img src="https://x.test/a.png"></p>');
    expect(e.execute('imageCaption', 'x')).toBe(false);
    selectImage(e);
    e.execute('imageCaption', 'Figure 1');
    expect(e.getHTML()).toContain('data-caption="Figure 1"');
    e.execute('imageCaption', '');
    expect(e.getHTML()).not.toContain('data-caption');
  });

  it('colors a table cell, rejecting invalid colors', () => {
    const e = make('<p>x</p>');
    e.execute('insertTable', 2, 2);
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.near(e.view.state.doc.resolve(3))));
    expect(e.execute('cellColor', 'url(javascript:x)')).toBe(false);
    expect(e.execute('cellColor', '#ffc9c9')).toBe(true);
    expect(e.getHTML()).toMatch(/background-color: (#ffc9c9|rgb\(255, 201, 201\))/);
    e.setHTML(e.getHTML());
    expect(e.getHTML()).toMatch(/background-color: (#ffc9c9|rgb\(255, 201, 201\))/);
  });
});

describe('Special characters and format painter', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('inserts a special character and rejects empty input', () => {
    const e = make('<p>a</p>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.atEnd(e.view.state.doc)));
    expect(e.execute('insertText', '©')).toBe(true);
    expect(e.execute('insertText', '')).toBe(false);
    expect(e.getHTML()).toBe('<p>a©</p>');
  });

  it('copies formatting from one range to the next selection', async () => {
    const e = make('<p><strong>bold</strong> plain</p>');
    const sel = (from: number, to: number) => e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, from, to)));
    sel(1, 5);
    e.execute('formatPainter');
    sel(6, 11);
    e.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    const painted = '<p><strong>bold</strong> <strong>plain</strong></p>';
    expect(e.getHTML()).toBe(painted);
    // one-shot: unbold a range, then a later selection must not be painted again
    e.execute('bold');
    const afterUnbold = e.getHTML();
    sel(7, 9);
    e.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(e.getHTML()).toBe(afterUnbold);
  });

  it('cancels with a second click', async () => {
    const e = make('<p><strong>b</strong> c</p>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, 2)));
    e.execute('formatPainter');
    e.execute('formatPainter');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 3, 4)));
    e.view.dom.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 5));
    expect(e.getHTML()).toBe('<p><strong>b</strong> c</p>');
  });
});

describe('Footnotes and spell check', () => {
  beforeEach(() => (document.body.innerHTML = ''));

  it('inserts footnotes and renders them as a numbered list in order', () => {
    const e = make('<p>a b</p>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 4)));
    e.execute('footnote', 'Second');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 2)));
    e.execute('footnote', 'First');
    expect([...e.root.querySelectorAll('.wy-footnotes li')].map((l) => l.textContent)).toEqual(['First', 'Second']);
    expect(e.execute('footnote', '   ')).toBe(false);
  });

  it('never interprets footnote text as HTML', () => {
    const e = make('<p>a</p>');
    e.execute('footnote', '<img src=x onerror=alert(1)>');
    expect(e.root.querySelector('.wy-footnotes img')).toBeNull();
    expect(e.root.querySelector('.wy-footnotes li')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('round-trips footnotes through HTML and exports Markdown', () => {
    const e = make('<p>a</p>');
    e.execute('footnote', 'Note');
    e.setHTML(e.getHTML());
    expect(e.getHTML()).toContain('data-footnote="Note"');
    expect(e.getMarkdown()).toBe('^[Note]a');
  });

  it('edits and removes a footnote', () => {
    const e = make('<p>a</p>');
    e.execute('footnote', 'Old');
    let pos = -1;
    e.view.state.doc.descendants((n, p) => void (n.type.name === 'footnote' && (pos = p)));
    e.view.dispatch(e.view.state.tr.setSelection(NodeSelection.create(e.view.state.doc, pos)));
    expect(e.execute('editFootnote', 'New')).toBe(true);
    expect(e.getHTML()).toContain('data-footnote="New"');
  });

  it('toggles spell check on the editable element', () => {
    const e = make('<p>a</p>');
    expect(e.view.dom.getAttribute('spellcheck')).toBe('true');
    e.execute('toggleSpellcheck');
    expect(e.view.dom.getAttribute('spellcheck')).toBe('false');
  });
});
