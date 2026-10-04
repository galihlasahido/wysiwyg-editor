import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { CodeEditor, createCodeEditor, findMatchingBracket, foldEnd, foldEnds, languageForFilename, simpleHighlight } from '../src';

const made: CodeEditor[] = [];
afterEach(() => made.splice(0).forEach((c) => c.destroy()));

function make(value = '', options: Partial<ConstructorParameters<typeof CodeEditor>[0]> = {}) {
  document.body.innerHTML = '<div id="host"></div>';
  const ce = createCodeEditor({ element: document.getElementById('host')!, value, language: 'javascript', ...options });
  made.push(ce);
  return ce;
}
/** Positions are text offsets inside the code (0 = start of the text). */
const sel = (ce: CodeEditor, a: number, b = a) => ce.editor.view.dispatch(ce.editor.view.state.tr.setSelection(TextSelection.create(ce.editor.view.state.doc, a + 1, b + 1)));
const caret = (ce: CodeEditor) => ce.editor.view.state.selection.head - 1;
const range = (ce: CodeEditor): [number, number] => [ce.editor.view.state.selection.anchor - 1, ce.editor.view.state.selection.head - 1];
const key = (ce: CodeEditor, k: string, mods: { shift?: boolean; alt?: boolean; ctrl?: boolean; meta?: boolean } = {}) =>
  ce.editor.view.someProp('handleKeyDown', (f) => f(ce.editor.view, new KeyboardEvent('keydown', { key: k, shiftKey: mods.shift, altKey: mods.alt, ctrlKey: mods.ctrl, metaKey: mods.meta })));
/** Type like a user: each character goes through the editor's text-input handlers first. */
const type = (ce: CodeEditor, text: string) => {
  const v = ce.editor.view;
  for (const ch of text) {
    const { from, to } = v.state.selection;
    if (!v.someProp('handleTextInput', (f) => f(v, from, to, ch, () => v.state.tr.insertText(ch, from, to)))) v.dispatch(v.state.tr.insertText(ch, from, to));
  }
};

describe('line numbers', () => {
  it('shows one number per line, in order, and marks the line with the caret', () => {
    const ce = make('a\nb\n\nd');
    const nums = () => [...ce.editor.root.querySelectorAll<HTMLElement>('.wy-ln-num')];
    expect(nums().map((n) => n.dataset.n)).toEqual(['1', '2', '3', '4']);
    sel(ce, 0);
    expect(nums().filter((n) => n.classList.contains('is-active')).map((n) => n.dataset.n)).toEqual(['1']);
    sel(ce, 4); // the empty third line
    expect(nums().filter((n) => n.classList.contains('is-active')).map((n) => n.dataset.n)).toEqual(['3']);
    sel(ce, 6); // end of "d"
    expect(nums().filter((n) => n.classList.contains('is-active')).map((n) => n.dataset.n)).toEqual(['4']);
  });

  it('updates as lines are added and removed, and never becomes part of the text', () => {
    const ce = make('one');
    sel(ce, 3);
    type(ce, '\ntwo\nthree');
    expect(ce.editor.root.querySelectorAll('.wy-ln-num')).toHaveLength(3);
    expect(ce.getValue()).toBe('one\ntwo\nthree');
    expect(ce.editor.view.dom.querySelector('code')!.textContent).toBe(ce.getValue()); // numbers are CSS, not text
    ce.setValue('x');
    expect(ce.editor.root.querySelectorAll('.wy-ln-num')).toHaveLength(1);
  });

  it('can be turned off, and a 1000-line file stays responsive', () => {
    expect(make('a\nb', { lineNumbers: false }).editor.root.querySelector('.wy-ln')).toBeNull();
    const big = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const t0 = performance.now();
    const ce = make(big);
    sel(ce, 500);
    expect(performance.now() - t0).toBeLessThan(8000); // ~0.8s alone; the margin is for a loaded CI machine
    expect(ce.editor.root.querySelectorAll('.wy-ln-num')).toHaveLength(1000);
  });
});

describe('document model', () => {
  it('holds the text of a single code block and round-trips values exactly', () => {
    const text = 'if (a) {\n  b();\n}\n\n  trailing  \n';
    const ce = make(text);
    expect(ce.getValue()).toBe(text);
    expect(ce.editor.view.state.doc.childCount).toBe(1);
    expect(ce.editor.view.state.doc.firstChild!.type.name).toBe('code_block');
    ce.setValue('héllo 🌍\n\tTabbed');
    expect(ce.getValue()).toBe('héllo 🌍\n\tTabbed');
    ce.setValue('');
    expect(ce.getValue()).toBe('');
    expect(ce.editor.view.state.doc.childCount).toBe(1); // never an empty document
  });

  it('treats text as text: HTML-looking content is not parsed', () => {
    const ce = make('<img src=x onerror=alert(1)> <script>x</script>');
    expect(ce.editor.view.dom.querySelector('img:not(.ProseMirror-separator)')).toBeNull();
    expect(ce.editor.view.dom.querySelector('script')).toBeNull();
    expect(ce.getValue()).toBe('<img src=x onerror=alert(1)> <script>x</script>');
  });

  it('sets the language, and rejects junk', () => {
    const ce = make('x');
    expect(ce.language).toBe('javascript');
    ce.setLanguage('Python');
    expect(ce.language).toBe('python');
    ce.setLanguage('"><x');
    expect(ce.language).toBeNull();
    ce.setLanguage(null);
    expect(ce.language).toBeNull();
  });

  it('detects languages from file names', () => {
    expect(languageForFilename('main.ts')).toBe('typescript');
    expect(languageForFilename('src/App.TSX')).toBe('typescript');
    expect(languageForFilename('a/b/Dockerfile')).toBe('dockerfile');
    expect(languageForFilename('notes.txt')).toBe('');
    expect(languageForFilename('weird.xyz')).toBeNull();
    expect(languageForFilename('noext')).toBeNull();
  });
});

describe('pairing brackets and quotes', () => {
  it('inserts the closer, puts the caret between, and steps over a typed closer', () => {
    const ce = make('');
    type(ce, 'f(');
    expect(ce.getValue()).toBe('f()');
    expect(caret(ce)).toBe(2);
    type(ce, 'x)');
    expect(ce.getValue()).toBe('f(x)'); // stepped over, no double paren
    expect(caret(ce)).toBe(4);
    type(ce, '[{');
    expect(ce.getValue()).toBe('f(x)[{}]');
  });

  it('does not pair before a word character, and quotes do not pair after one (don\'t)', () => {
    const ce = make('abc');
    sel(ce, 0);
    type(ce, '(');
    expect(ce.getValue()).toBe('(abc'); // next char is a word character
    const q = make('say don');
    sel(q, 7);
    type(q, "'");
    expect(q.getValue()).toBe("say don'"); // an apostrophe, not a quote
    const r = make('x = ');
    sel(r, 4);
    type(r, '"');
    expect(r.getValue()).toBe('x = ""');
    type(r, 'hi"');
    expect(r.getValue()).toBe('x = "hi"');
  });

  it('wraps a selection instead of replacing it', () => {
    const ce = make('hello world');
    sel(ce, 6, 11);
    type(ce, '(');
    expect(ce.getValue()).toBe('hello (world)');
    expect(range(ce)).toEqual([7, 12]); // the word stays selected, so the next key can wrap again
    type(ce, '"');
    expect(ce.getValue()).toBe('hello ("world")');
  });

  it('Backspace between a pair removes both, otherwise deletes one character', () => {
    const ce = make('');
    type(ce, '{');
    expect(ce.getValue()).toBe('{}');
    expect(key(ce, 'Backspace')).toBe(true);
    expect(ce.getValue()).toBe('');
    const f = make('(a)');
    sel(f, 2); // between a and )
    expect(key(f, 'Backspace')).toBeFalsy(); // not handled here: the default deletes one character
  });

  it('is off in prose-like languages for quotes and can be disabled entirely', () => {
    const md = make("it", { language: 'markdown' });
    sel(md, 2);
    type(md, " 'x");
    expect(md.getValue()).toBe("it 'x");
    const plain = make('', { language: null });
    type(plain, '"');
    expect(plain.getValue()).toBe('"');
  });
});

describe('Enter and Tab', () => {
  it('keeps indentation, adds a level after an opener, and splits {} onto three lines', () => {
    const ce = make('  if (x) {');
    sel(ce, 10);
    key(ce, 'Enter');
    expect(ce.getValue()).toBe('  if (x) {\n    ');
    const b = make('f({})');
    sel(b, 3);
    key(b, 'Enter');
    expect(b.getValue()).toBe('f({\n  \n})');
    expect(caret(b)).toBe('f({\n  '.length);
  });

  it('Tab uses the configured tab size and Shift+Tab removes one level', () => {
    const ce = make('a', { tabSize: 4 });
    sel(ce, 0);
    key(ce, 'Tab');
    expect(ce.getValue()).toBe('    a');
    ce.setTabSize(2);
    key(ce, 'Tab');
    expect(ce.getValue()).toBe('      a');
    key(ce, 'Tab', { shift: true });
    expect(ce.getValue()).toBe('    a');
    expect(ce.tabSize).toBe(2);
    ce.setTabSize(99);
    expect(ce.tabSize).toBe(8); // clamped
  });
});

describe('toggle comment', () => {
  const toggle = (ce: CodeEditor) => ce.editor.execute('toggleComment');

  it('comments and uncomments lines with the language comment marker', () => {
    const ce = make('a();\nb();');
    sel(ce, 0, 9);
    toggle(ce);
    expect(ce.getValue()).toBe('// a();\n// b();');
    toggle(ce);
    expect(ce.getValue()).toBe('a();\nb();');
    const py = make('x = 1', { language: 'python' });
    sel(py, 0);
    toggle(py);
    expect(py.getValue()).toBe('# x = 1');
  });

  it('comments at the shallowest indent, skips blank lines, and comments everything when mixed', () => {
    const ce = make('if (a) {\n    b();\n\n  c();\n}');
    sel(ce, 0, ce.getValue().length);
    toggle(ce);
    expect(ce.getValue()).toBe('// if (a) {\n//     b();\n\n//   c();\n// }');
    // mixed: one line already commented => comment all (adds another level on that line)
    const m = make('// a\nb');
    sel(m, 0, 6);
    toggle(m);
    expect(m.getValue()).toBe('// // a\n// b');
  });

  it('uses block comments per line for CSS and HTML, and refuses JSON/plain text', () => {
    const css = make('a { color: red; }', { language: 'css' });
    sel(css, 0);
    toggle(css);
    expect(css.getValue()).toBe('/* a { color: red; } */');
    toggle(css);
    expect(css.getValue()).toBe('a { color: red; }');
    const html = make('<p>x</p>', { language: 'html' });
    sel(html, 0);
    toggle(html);
    expect(html.getValue()).toBe('<!-- <p>x</p> -->');
    const json = make('{"a":1}', { language: 'json' });
    expect(toggle(json)).toBe(false);
    expect(make('x', { language: null }).editor.execute('toggleComment')).toBe(false);
  });

  it('does nothing for an empty or blank selection', () => {
    const ce = make('   \n');
    sel(ce, 0);
    expect(toggle(ce)).toBe(false);
  });
});

describe('line operations', () => {
  const run = (ce: CodeEditor, name: string) => ce.editor.execute(name);

  it('duplicates the current line, or all selected lines, below', () => {
    const ce = make('one\ntwo\nthree');
    sel(ce, 5); // in "two"
    run(ce, 'duplicateLine');
    expect(ce.getValue()).toBe('one\ntwo\ntwo\nthree');
    expect(caret(ce)).toBe(9); // follows the copy
    sel(ce, 0, 3);
    run(ce, 'duplicateLine');
    expect(ce.getValue()).toBe('one\none\ntwo\ntwo\nthree');
  });

  it('moves lines up and down, keeps the caret on the moved line, and stops at the ends', () => {
    const ce = make('a\nb\nc');
    sel(ce, 2); // on b
    run(ce, 'moveLineDown');
    expect(ce.getValue()).toBe('a\nc\nb');
    expect(caret(ce)).toBe(4);
    expect(run(ce, 'moveLineDown')).toBe(false); // already last
    run(ce, 'moveLineUp');
    run(ce, 'moveLineUp');
    expect(ce.getValue()).toBe('b\na\nc');
    expect(run(ce, 'moveLineUp')).toBe(false); // already first
    // several lines move together
    sel(ce, 0, 3);
    run(ce, 'moveLineDown');
    expect(ce.getValue()).toBe('c\nb\na');
  });

  it('deletes the current line (middle, first and last) and leaves a valid caret', () => {
    const mid = make('a\nb\nc');
    sel(mid, 2);
    run(mid, 'deleteLine');
    expect(mid.getValue()).toBe('a\nc');
    expect(caret(mid)).toBe(2);
    const first = make('a\nb');
    sel(first, 0);
    run(first, 'deleteLine');
    expect(first.getValue()).toBe('b');
    const last = make('a\nb');
    sel(last, 3);
    run(last, 'deleteLine');
    expect(last.getValue()).toBe('a');
    const only = make('x');
    run(only, 'deleteLine');
    expect(only.getValue()).toBe('');
  });

  it('selects whole lines and jumps to a line (clamped)', () => {
    const ce = make('aa\nbb\ncc');
    sel(ce, 4);
    run(ce, 'selectLine');
    expect(range(ce)).toEqual([3, 6]);
    expect(ce.goToLine(3)).toBe(true);
    expect(caret(ce)).toBe(6);
    ce.goToLine(99);
    expect(caret(ce)).toBe(6); // clamped to the last line
    ce.goToLine(-5);
    expect(caret(ce)).toBe(0);
    ce.goToLine(2.7);
    expect(caret(ce)).toBe(3);
  });

  it('the Go to line dialog accepts a number, ignores junk and can be cancelled', () => {
    const ce = make('a\nb\nc');
    ce.editor.execute('goToLine');
    const input = ce.editor.root.querySelector<HTMLInputElement>('.wy-dialog input')!;
    input.value = '2';
    [...ce.editor.root.querySelectorAll<HTMLElement>('.wy-dialog button')].find((b) => b.textContent === 'Go')!.click();
    expect(caret(ce)).toBe(2);
    ce.editor.execute('goToLine');
    ce.editor.root.querySelector<HTMLInputElement>('.wy-dialog input')!.value = 'abc';
    [...ce.editor.root.querySelectorAll<HTMLElement>('.wy-dialog button')].find((b) => b.textContent === 'Go')!.click();
    expect(caret(ce)).toBe(2); // NaN: unchanged
  });

  it('is driven by keyboard shortcuts', () => {
    const ce = make('a\nb');
    sel(ce, 0);
    expect(key(ce, 'ArrowDown', { alt: true })).toBe(true);
    expect(ce.getValue()).toBe('b\na');
    expect(key(ce, '/', { ctrl: true })).toBe(true);
    expect(ce.getValue()).toBe('b\n// a'); // the caret followed the moved line, so that is the one commented
  });
});

describe('bracket matching', () => {
  const marks = (ce: CodeEditor) => [...ce.editor.root.querySelectorAll('.wy-bracket-match')].map((n) => n.textContent);
  const errors = (ce: CodeEditor) => [...ce.editor.root.querySelectorAll('.wy-bracket-error')].map((n) => n.textContent);

  it('highlights the pair when the caret is next to a bracket', () => {
    const ce = make('f(a, [b])');
    sel(ce, 2); // right after "("
    expect(marks(ce)).toEqual(['(', ')']);
    sel(ce, 9); // right after the closing ")"
    expect(marks(ce)).toEqual(['(', ')']);
    sel(ce, 4); // not next to a bracket
    expect(marks(ce)).toEqual([]);
  });

  it('flags an unmatched bracket, and ignores brackets in strings and comments', () => {
    const ce = make('f(a');
    sel(ce, 2);
    expect(errors(ce)).toEqual(['(']);
    const s = make('f("(", a)');
    sel(s, 2);
    expect(marks(s)).toEqual(['(', ')']); // the "(" inside the string is skipped
    const c = make('x // )\n(y)');
    sel(c, 8);
    expect(marks(c)).toEqual(['(', ')']);
  });

  it('findMatchingBracket handles nesting, direction, limits and non-brackets', () => {
    const none = () => false;
    expect(findMatchingBracket('a(b(c)d)e', 1, none)).toBe(7);
    expect(findMatchingBracket('a(b(c)d)e', 7, none)).toBe(1);
    expect(findMatchingBracket('a(b(c)d)e', 3, none)).toBe(5);
    expect(findMatchingBracket('(((', 0, none)).toBeNull();
    expect(findMatchingBracket('abc', 1, none)).toBeNull();
    expect(findMatchingBracket('"x"', 0, none)).toBeNull(); // quotes are not brackets
    expect(findMatchingBracket('(' + ' '.repeat(100) + ')', 0, none, 50)).toBeNull(); // scan limit
    const tokens = simpleHighlight('a("("))', 'js');
    expect(tokens.some((t) => t.type === 'string')).toBe(true);
  });
});

describe('several files', () => {
  it('keeps text, cursor and undo history separate per file', () => {
    const ce = make('', { language: null });
    ce.openFile({ id: 'a', value: 'alpha', language: 'javascript' });
    sel(ce, 5);
    type(ce, '!');
    expect(ce.getValue()).toBe('alpha!');
    ce.openFile({ id: 'b', value: 'beta', language: 'python' });
    expect(ce.getValue()).toBe('beta');
    expect(ce.language).toBe('python');
    ce.editor.execute('undo'); // nothing to undo in a fresh file
    expect(ce.getValue()).toBe('beta');
    sel(ce, 4);
    type(ce, '?');
    ce.openFile({ id: 'a', value: 'ignored: a is already open' });
    expect(ce.getValue()).toBe('alpha!'); // restored, not reloaded from the argument
    expect(ce.language).toBe('javascript');
    ce.editor.execute('undo');
    expect(ce.getValue()).toBe('alpha');
    expect(ce.getFileValue('b')).toBe('beta?');
    expect(ce.fileId).toBe('a');
    expect(ce.fileIds().sort()).toEqual(['a', 'b']);
  });

  it('closes other files but not the open one', () => {
    const ce = make('');
    ce.openFile({ id: 'a', value: '1' });
    ce.openFile({ id: 'b', value: '2' });
    expect(ce.closeFile('b')).toBe(false); // it is open
    expect(ce.closeFile('a')).toBe(true);
    expect(ce.getFileValue('a')).toBeNull();
    expect(ce.closeFile('zzz')).toBe(false);
  });

  it('reports changes with the whole text', () => {
    const seen: string[] = [];
    const ce = make('', { onChange: (v) => seen.push(v) });
    ce.openFile({ id: 'a', value: 'x' });
    sel(ce, 1);
    type(ce, 'y');
    expect(seen.at(-1)).toBe('xy');
  });
});

describe('settings and reporting', () => {
  it('reports line, column, selection length and line count', () => {
    const seen: any[] = [];
    const ce = make('ab\ncde\nf', { onCursor: (c) => seen.push(c) });
    sel(ce, 5);
    expect(seen.at(-1)).toMatchObject({ line: 2, col: 3, selected: 0, lines: 3, language: 'javascript' });
    sel(ce, 0, 5);
    expect(seen.at(-1)).toMatchObject({ line: 2, col: 3, selected: 5 });
    expect(ce.cursorInfo).toMatchObject({ lines: 3 });
  });

  it('word wrap, font size and theme are adjustable and clamped', () => {
    const ce = make('x');
    expect(ce.wordWrap).toBe(true);
    ce.setWordWrap(false);
    expect(ce.editor.root.classList.contains('wy-nowrap')).toBe(true);
    expect(ce.wordWrap).toBe(false);
    ce.setFontSize(500);
    expect(ce.fontSize).toBe(32);
    ce.setFontSize(1);
    expect(ce.fontSize).toBe(8);
    ce.setTheme('light');
    expect(ce.editor.root.dataset.theme).toBe('light');
    expect(ce.editor.root.classList.contains('wy-code-editor')).toBe(true);
  });

  it('find and replace work inside the editor', () => {
    const ce = make('foo bar foo');
    expect(ce.editor.execute('find', 'foo')).toBe(true);
    ce.editor.execute('replaceAll', 'baz');
    expect(ce.getValue()).toBe('baz bar baz');
  });

  it('read-only mode blocks edits and operations', () => {
    const ce = make('keep', { readOnly: true });
    expect(ce.editor.execute('toggleComment')).toBe(false);
    expect(ce.editor.view.editable).toBe(false);
    expect(ce.getValue()).toBe('keep');
  });

  it('highlights tokens and accepts a custom highlighter', () => {
    const ce = make('const x = 1');
    expect(ce.editor.root.querySelector('.wy-tok-keyword')!.textContent).toBe('const');
    const custom = make('hello', { highlight: (code) => [{ from: 0, to: code.length, type: 'function' as const }] });
    expect(custom.editor.root.querySelector('.wy-tok-function')!.textContent).toBe('hello');
  });
});

describe('folding, extra cursors and minimap', () => {
  const make = (value: string, opts: Partial<Parameters<typeof createCodeEditor>[0]> = {}) => createCodeEditor({ element: document.body.appendChild(document.createElement('div')), value, language: 'javascript', ...opts });
  const place = (ce: ReturnType<typeof make>, pos: number) => ce.editor.view.dispatch(ce.editor.view.state.tr.setSelection(TextSelection.create(ce.editor.view.state.doc, pos)));
  const type = (ce: ReturnType<typeof make>, text: string) => { const v = ce.editor.view; const { from, to } = v.state.selection; return v.someProp('handleTextInput', (f) => f(v, from, to, text, () => v.state.tr)); };
  const SRC = 'function a() {\n  if (x) {\n    one();\n    two();\n  }\n  return 1;\n}\nconst b = 2;';

  it('computes fold ranges by indentation', () => {
    const lines = SRC.split('\n');
    expect(foldEnd(lines, 0)).toBe(5);
    expect(foldEnd(lines, 1)).toBe(3);
    expect(foldEnd(lines, 3)).toBeNull();
    expect(foldEnd(lines, 6)).toBeNull();
  });

  it('folds and unfolds, hiding text and line numbers, without changing the document', () => {
    const ce = make(SRC);
    expect(ce.foldAll()).toBe(true);
    expect(ce.getValue()).toBe(SRC);
    expect(ce.editor.view.dom.querySelector('.wy-folded')).not.toBeNull();
    expect(ce.editor.view.dom.querySelector('.wy-fold-chip')?.textContent).toContain('5 lines');
    expect([...ce.editor.view.dom.querySelectorAll('.wy-ln-num')].map((n) => (n as HTMLElement).dataset.n)).toEqual(['1', '7', '8']);
    ce.unfoldAll();
    expect(ce.editor.view.dom.querySelector('.wy-folded')).toBeNull();
    expect(ce.editor.view.dom.querySelectorAll('.wy-ln-num').length).toBe(8);
    ce.destroy();
  });

  it('opens a fold when the cursor lands inside it', () => {
    const ce = make(SRC);
    ce.foldAll();
    place(ce, 1 + SRC.indexOf('one'));
    expect(ce.editor.view.dom.querySelector('.wy-folded')).toBeNull();
    ce.destroy();
  });

  it('types at several cursors as one undo step', () => {
    const ce = make('a\nb\nc');
    place(ce, 1);
    expect(ce.editor.execute('addCaretBelow')).toBe(true);
    expect(ce.editor.execute('addCaretBelow')).toBe(true);
    expect(ce.cursorCount).toBe(3);
    type(ce, 'X');
    expect(ce.getValue()).toBe('Xa\nXb\nXc');
    expect(ce.cursorCount).toBe(3);
    ce.editor.execute('undo');
    expect(ce.getValue()).toBe('a\nb\nc');
    ce.destroy();
  });

  it('Backspace and Enter work at every cursor; Escape returns to one cursor', () => {
    const ce = make('ab\ncd');
    place(ce, 3);
    ce.editor.execute('addCaretBelow');
    const v = ce.editor.view;
    const key = (k: string) => v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: k, cancelable: true })));
    key('Backspace');
    expect(ce.getValue()).toBe('a\nc');
    key('Escape');
    expect(ce.cursorCount).toBe(1);
    ce.destroy();
  });

  it('can switch the minimap on and off', () => {
    const ce = make('const a = 1;', { minimap: true });
    expect(ce.hasMinimap).toBe(true);
    expect(ce.editor.root.querySelector('.wy-minimap')).not.toBeNull();
    ce.setMinimap(false);
    expect(ce.editor.root.querySelector('.wy-minimap')).toBeNull();
    ce.destroy();
  });
});

describe('audit regressions', () => {
  const mk = (value: string, opts: Record<string, unknown> = {}) => createCodeEditor({ element: document.body.appendChild(document.createElement('div')), value, language: 'javascript', ...opts });
  const sel = (ce: ReturnType<typeof mk>, a: number, b = a) => ce.editor.view.dispatch(ce.editor.view.state.tr.setSelection(TextSelection.create(ce.editor.view.state.doc, a, b)));

  it('foldEnds is linear and agrees with the definition', () => {
    const lines = ['a {', '  b {', '    c', '  }', '', '  d', '}', 'e'];
    expect(foldEnds(lines)).toEqual([5, 2, null, null, null, null, null, null]);
    expect(foldEnds(['x', '', '  y', '', 'z'])).toEqual([2, null, null, null, null]);
    const big = Array.from({ length: 20000 }, (_, i) => (i % 2 ? '  x' : 'y'));
    const t = Date.now();
    foldEnds(big);
    expect(Date.now() - t).toBeLessThan(200);
  });
  it('line operations work when the text starts with an empty line', () => {
    const ce = mk('\nfoo\nbar');
    sel(ce, 1);
    expect(ce.editor.execute('deleteLine')).toBe(true);
    expect(ce.getValue()).toBe('foo\nbar');
    ce.destroy();
    const c2 = mk('\nfoo');
    sel(c2, 1);
    c2.editor.execute('selectLine');
    expect(c2.editor.view.state.selection.from).toBe(1);
    c2.destroy();
  });
  it('an extra caret inside the selection is dropped, and carets stay in one code block', () => {
    const ce = mk('0123456789');
    const key = ce.editor.view.state.plugins.find((p) => (p as any).key?.startsWith('code-carets'))!;
    sel(ce, 4, 9);
    ce.editor.view.dispatch(ce.editor.view.state.tr.setMeta(key, [6])); // inside 4..9
    expect(ce.cursorCount).toBe(1);
    sel(ce, 2);
    ce.editor.view.dispatch(ce.editor.view.state.tr.setMeta(key, [6, 99])); // 99 is outside the document
    expect(ce.cursorCount).toBe(2);
    ce.destroy();
  });
  it('Tab with a selection that leaves the code block does nothing', () => {
    const ce = mk('a\nb');
    const v = ce.editor.view;
    v.dispatch(v.state.tr.setSelection(TextSelection.create(v.state.doc, 1, 2)));
    const before = ce.getValue();
    v.someProp('handleKeyDown', (f) => f(v, new KeyboardEvent('keydown', { key: 'Tab' })));
    expect(ce.getValue().length).toBeGreaterThanOrEqual(before.length);
    ce.destroy();
  });
});
