import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { CodeBlocks, Editor, defaultPlugins, resolveLanguage, simpleHighlight } from '../src';

const types = (code: string, lang: string) => simpleHighlight(code, lang).map((t) => `${t.type}:${code.slice(t.from, t.to)}`);

describe('simpleHighlight', () => {
  it('finds keywords, strings, numbers, calls, comments and literals in JS/TS', () => {
    expect(types('const x = 42; // hi\nfoo("a", true)', 'ts')).toEqual(['keyword:const', 'number:42', 'comment:// hi', 'function:foo', 'string:"a"', 'literal:true']);
    expect(types('/* c */ let s = `t`', 'javascript')).toEqual(['comment:/* c */', 'keyword:let', 'string:`t`']);
  });

  it('does not highlight inside strings or comments, and does not treat identifiers with digits as numbers', () => {
    expect(types('"const 1" // if', 'js')).toEqual(['string:"const 1"', 'comment:// if']);
    expect(types('x1 = a2', 'js')).toEqual([]);
  });

  it('handles escapes, unterminated strings and multi-line strings sensibly', () => {
    expect(types('"a\\"b" x', 'js')).toEqual(['string:"a\\"b"']);
    expect(types('"open\nconst', 'js')).toEqual(['string:"open', 'keyword:const']); // an unterminated string ends at the line
    expect(types('`a\nb` if', 'js')).toEqual(['string:`a\nb`', 'keyword:if']);
  });

  it('supports Python, JSON, CSS, HTML, shell and SQL', () => {
    expect(types('def f(x): # c\n    return None', 'python')).toEqual(['keyword:def', 'function:f', 'comment:# c', 'keyword:return', 'literal:None']);
    expect(types('"""doc"""', 'py')).toEqual(['string:"""doc"""']);
    expect(types('{"a": [1, true], "b": "x"}', 'json')).toEqual(['property:"a"', 'number:1', 'literal:true', 'property:"b"', 'string:"x"']);
    expect(types('a { color: #fff; width: 10px; } /* c */', 'css')).toEqual(['property:color', 'number:#fff', 'property:width', 'number:10px', 'comment:/* c */']);
    expect(types('<a href="x">t</a><!-- c -->', 'html')).toEqual(['tag:<a', 'attr:href', 'string:"x"', 'tag:>', 'tag:</a', 'tag:>', 'comment:<!-- c -->']);
    expect(types('if [ $HOME ]; then echo "$X" # c\nfi', 'bash')).toEqual(['keyword:if', 'variable:$HOME', 'keyword:then', 'keyword:echo', 'string:"$X"', 'comment:# c', 'keyword:fi']);
    expect(types('SELECT * FROM t -- c', 'sql')).toEqual(['keyword:SELECT', 'keyword:FROM', 'comment:-- c']);
  });

  it('returns nothing for plain text or unknown languages, and tokens never overlap', () => {
    expect(simpleHighlight('const x = 1', null)).toEqual([]);
    expect(simpleHighlight('const x = 1', 'klingon')).toEqual([]);
    const code = 'function f(a) {\n  return `x${a}` + "y" // z\n}\n';
    const toks = simpleHighlight(code, 'js');
    toks.forEach((t, i) => {
      expect(t.from).toBeLessThan(t.to);
      if (i) expect(t.from).toBeGreaterThanOrEqual(toks[i - 1].to);
    });
    expect(resolveLanguage('TypeScript')).toBe('js');
    expect(resolveLanguage(null)).toBe('plain');
  });

  it('is fast on large inputs and survives hostile input', () => {
    const big = 'const a = "x"; // c\n'.repeat(5000);
    const t0 = performance.now();
    simpleHighlight(big, 'js');
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(() => simpleHighlight('"'.repeat(5000) + '/*' + '\\'.repeat(5000), 'js')).not.toThrow();
  });
});

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
function make(html: string, options = {}) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  const e = new Editor({ element: el, content: html, plugins: [...defaultPlugins, CodeBlocks(options)] });
  editors.push(e);
  return e;
}
const caretIn = (e: Editor, offset: number) => {
  let start = 0;
  e.view.state.doc.descendants((n, p) => void (n.type.name === 'code_block' && (start = p + 1)));
  e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, start + offset)));
};
const key = (e: Editor, k: string, shift = false) => e.view.someProp('handleKeyDown', (f) => f(e.view, new KeyboardEvent('keydown', { key: k, shiftKey: shift })));
const codeText = (e: Editor) => {
  let t = '';
  e.view.state.doc.descendants((n) => void (n.type.name === 'code_block' && (t = n.textContent)));
  return t;
};

describe('code block language', () => {
  it('parses language from data-language and class="language-x", and ignores junk', () => {
    expect(make('<pre data-language="python"><code>x</code></pre>').getHTML()).toBe('<pre data-language="python"><code class="language-python">x</code></pre>');
    expect(make('<pre><code class="hljs language-ts">x</code></pre>').getHTML()).toContain('data-language="ts"');
    expect(make('<pre data-language="x&quot; onload=&quot;1"><code>x</code></pre>').getHTML()).toBe('<pre><code>x</code></pre>');
    expect(make('<pre><code>x</code></pre>').getHTML()).toBe('<pre><code>x</code></pre>'); // unchanged for plain blocks
  });

  it('exports and imports fenced code with its language', () => {
    const e = make('<pre data-language="typescript"><code>let a = 1</code></pre>');
    expect(e.getMarkdown()).toBe('```typescript\nlet a = 1\n```');
    e.setMarkdown('```Python extra\nprint(1)\n```\n\n```\nplain\n```');
    expect(e.getHTML()).toContain('data-language="python"');
    expect(e.getHTML()).toContain('<pre><code>plain</code></pre>');
    e.setMarkdown('```!!bad\nx\n```'); // the first word of the info string must look like a language id
    expect(e.getHTML()).toBe('<pre><code>x</code></pre>');
    e.setMarkdown('```not valid\nx\n```');
    expect(e.getHTML()).toContain('data-language="not"'); // CommonMark: the language is the first word
  });

  it('sets the language with a command and validates it', () => {
    const e = make('<pre><code>x</code></pre>');
    caretIn(e, 0);
    expect(e.execute('codeBlockLanguage', 'Go')).toBe(true);
    expect(e.getHTML()).toContain('data-language="go"');
    expect(e.execute('codeBlockLanguage', '"><img')).toBe(false);
    expect(e.execute('codeBlockLanguage', null)).toBe(true);
    expect(e.getHTML()).toBe('<pre><code>x</code></pre>');
    const p = make('<p>text</p>');
    expect(p.execute('codeBlockLanguage', 'go')).toBe(false); // not in a code block
  });

  it('starts a code block with ```lang + space', () => {
    const e = make('<p></p>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1)));
    // input rules run on typed text: emulate typing one character at a time
    for (const ch of '```ts ') e.view.someProp('handleTextInput', (f) => f(e.view, e.view.state.selection.from, e.view.state.selection.from, ch, () => e.view.state.tr.insertText(ch))) || e.view.dispatch(e.view.state.tr.insertText(ch));
    expect(e.getHTML()).toMatch(/<pre data-language="ts">/);
  });
});

describe('code block editing', () => {
  it('Tab inserts spaces, Shift+Tab removes them from every selected line', () => {
    const e = make('<pre><code>a\nb\nc</code></pre>', { tabSize: 2 });
    caretIn(e, 1);
    expect(key(e, 'Tab')).toBe(true);
    expect(codeText(e)).toBe('a  \nb\nc');
    // select all lines and indent them
    let start = 0;
    e.view.state.doc.descendants((n, p) => void (n.type.name === 'code_block' && (start = p + 1)));
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, start, start + codeText(e).length)));
    key(e, 'Tab');
    expect(codeText(e)).toBe('  a  \n  b\n  c');
    key(e, 'Tab', true);
    expect(codeText(e)).toBe('a  \nb\nc');
    key(e, 'Tab', true); // nothing left to remove from "b" and "c"
    expect(codeText(e)).toBe('a  \nb\nc'.replace('a  ', 'a  '));
  });

  it('Tab outside a code block is not handled by this plugin', () => {
    const e = make('<p>abc</p><pre><code>x</code></pre>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 2)));
    expect(codeText(e)).toBe('x');
    key(e, 'Tab');
    expect(e.getHTML()).toContain('<p>abc</p>'); // paragraph untouched
  });

  it('Enter keeps the indentation, adds one level after an opening bracket, and splits {} onto three lines', () => {
    const e = make('<pre><code>  foo(</code></pre>');
    caretIn(e, 6);
    expect(key(e, 'Enter')).toBe(true);
    expect(codeText(e)).toBe('  foo(\n    '); // one level deeper after "("
    const f = make('<pre><code>  x = 1</code></pre>');
    caretIn(f, 7);
    key(f, 'Enter');
    expect(codeText(f)).toBe('  x = 1\n  '); // same indent
    const g = make('<pre><code>if (a) {}</code></pre>');
    caretIn(g, 8); // between { and }
    key(g, 'Enter');
    expect(codeText(g)).toBe('if (a) {\n  \n}');
    expect(g.view.state.selection.from - 1).toBe('if (a) {\n  '.length); // caret on the indented middle line
  });

  it('Python-style colon opens an indent level too', () => {
    const e = make('<pre><code>def f():</code></pre>');
    caretIn(e, 8);
    key(e, 'Enter');
    expect(codeText(e)).toBe('def f():\n  ');
  });
});

describe('code block view and highlighting', () => {
  it('shows a header with language picker and Copy, and highlights tokens as decorations', () => {
    const e = make('<pre data-language="javascript"><code>const x = 1</code></pre>');
    const pre = e.root.querySelector('pre')!;
    expect(pre.querySelector('.wy-code-bar')).not.toBeNull();
    const sel = pre.querySelector<HTMLSelectElement>('.wy-code-lang')!;
    expect(sel.value).toBe('javascript');
    expect(pre.querySelector('.wy-tok-keyword')!.textContent).toBe('const');
    expect(pre.querySelector('.wy-tok-number')!.textContent).toBe('1');
    // the header is UI only: it never reaches the saved HTML
    expect(e.getHTML()).not.toContain('wy-code');
    expect(e.getHTML()).not.toContain('<select');
  });

  it('changing the language in the picker updates the document and the highlighting', () => {
    const e = make('<pre><code># comment\nSELECT 1</code></pre>');
    const sel = e.root.querySelector<HTMLSelectElement>('.wy-code-lang')!;
    expect(e.root.querySelector('.wy-tok')).toBeNull(); // plain text: nothing highlighted
    sel.value = 'python';
    sel.dispatchEvent(new Event('change'));
    expect(e.getHTML()).toContain('data-language="python"');
    expect(e.root.querySelector('.wy-tok-comment')!.textContent).toBe('# comment');
  });

  it('keeps an unknown language selectable and ignores the picker in read-only mode', () => {
    const e = make('<pre data-language="zig"><code>x</code></pre>');
    const sel = e.root.querySelector<HTMLSelectElement>('.wy-code-lang')!;
    expect(sel.value).toBe('zig');
    e.setReadOnly(true);
    sel.value = 'python';
    sel.dispatchEvent(new Event('change'));
    expect(e.getHTML()).toContain('data-language="zig"'); // the document did not change
    expect(sel.value).toBe('zig'); // and the picker went back
  });

  it('copies the code and reports failure', async () => {
    const e = make('<pre><code>a\nb</code></pre>');
    const copy = e.root.querySelector<HTMLButtonElement>('.wy-code-copy')!;
    let copied = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => void (copied = t) } });
    copy.click();
    await new Promise((r) => setTimeout(r, 5));
    expect(copied).toBe('a\nb');
    expect(copy.textContent).toBe('Copied!');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('no'); } } });
    copy.click();
    await new Promise((r) => setTimeout(r, 5));
    expect(copy.textContent).toBe('Copy failed');
  });

  it('runs custom header actions only for their languages', () => {
    const calls: [string, string | null][] = [];
    const e = make('<pre data-language="javascript"><code>1+1</code></pre><pre data-language="python"><code>2</code></pre>', {
      actions: [{ label: 'Run', languages: ['javascript'], run: (code: string, lang: string | null) => calls.push([code, lang]) }],
    });
    const [js, py] = [...e.root.querySelectorAll('pre')];
    expect(js.querySelector<HTMLButtonElement>('.wy-code-btn:not(.wy-code-copy)')!.hidden).toBe(false);
    expect(py.querySelector<HTMLButtonElement>('.wy-code-btn:not(.wy-code-copy)')!.hidden).toBe(true);
    js.querySelector<HTMLButtonElement>('.wy-code-btn:not(.wy-code-copy)')!.click();
    expect(calls).toEqual([['1+1', 'javascript']]);
  });

  it('accepts a custom highlighter', () => {
    const e = make('<pre><code>hello</code></pre>', { highlight: (code: string) => [{ from: 0, to: code.length, type: 'keyword' as const }] });
    expect(e.root.querySelector('.wy-tok-keyword')!.textContent).toBe('hello');
  });
});
