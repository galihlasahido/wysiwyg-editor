import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Equations, createEditor, defaultPlugins } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content = '<p>hello</p>', opts = {}) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Equations(opts)] });
};
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('Equations (KaTeX)', () => {
  it('renders an inline formula with real KaTeX and keeps the LaTeX in the HTML', async () => {
    const ed = make('<p>Area <span data-math="\\pi r^2"></span> done</p>');
    await flush(60);
    expect(ed.view.dom.querySelector('.wy-math .katex')).not.toBeNull();
    expect(ed.getHTML()).toContain('data-math="\\pi r^2"');
    ed.destroy();
  });
  it('renders display equations and exposes MathML for screen readers', async () => {
    const ed = make('<div data-math-block="\\frac{a}{b}"></div>');
    await flush(60);
    expect(ed.view.dom.querySelector('.wy-math-block .katex-display')).not.toBeNull();
    expect(ed.view.dom.querySelector('.wy-math-block math')).not.toBeNull();
    ed.destroy();
  });
  it('shows an invalid formula as text with the error as its title, and never throws', async () => {
    const ed = make('<p><span data-math="\\frac{"></span></p>');
    await flush(60);
    const node = ed.view.dom.querySelector('.wy-math')!;
    expect(node.classList.contains('is-error')).toBe(true);
    expect(node.textContent).toBe('\\frac{');
    expect(node.getAttribute('title')).toBeTruthy();
    ed.destroy();
  });
  it('insertMath with text inserts a node; blank text is refused; editMath changes it', async () => {
    const ed = make();
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    expect(ed.execute('insertMath', '   ')).toBe(false);
    expect(ed.execute('insertMath', 'x^2')).toBe(true);
    expect(ed.execute('insertMathBlock', 'E=mc^2')).toBe(true);
    expect(ed.getHTML()).toContain('data-math="x^2"');
    expect(ed.getHTML()).toContain('data-math-block="E=mc^2"');
    let pos = -1;
    ed.view.state.doc.descendants((n, p) => { if (n.type.name === 'math_inline') pos = p; });
    ed.view.dispatch(ed.view.state.tr.setSelection(NodeSelection.create(ed.view.state.doc, pos)));
    expect(ed.execute('editMath', 'y^3')).toBe(true);
    expect(ed.getHTML()).toContain('data-math="y^3"');
    ed.destroy();
  });
  it('insertMath without text opens a dialog with templates and a live preview', async () => {
    const ed = make();
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    ed.execute('insertMath');
    await flush(60);
    const ta = ed.root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta).not.toBeNull();
    expect(ed.root.querySelectorAll('.wy-ask-snippets button').length).toBeGreaterThan(5);
    (ed.root.querySelector('.wy-ask-snippets button') as HTMLButtonElement).click(); // the fraction template
    expect(ta.value).toContain('\\frac');
    await flush(300);
    expect(ed.root.querySelector('.wy-ask-preview .katex')).not.toBeNull();
    (ed.root.querySelector('form') as HTMLFormElement).requestSubmit();
    await flush(60);
    expect(ed.getHTML()).toContain('data-math="\\frac{a}{b}"');
    ed.destroy();
  });
  it('typing $x^2$ makes an equation, but prices like $5 and $10 are left alone', () => {
    const ed = make('<p></p>');
    const type = (text: string) => { for (const ch of text) { const { from, to } = ed.view.state.selection; if (!ed.view.someProp('handleTextInput', (f) => f(ed.view, from, to, ch, () => ed.view.state.tr))) ed.view.dispatch(ed.view.state.tr.insertText(ch, from, to)); } };
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    type('costs $5 and $10 then $a+b$');
    const html = ed.getHTML();
    expect(html).toContain('data-math="a+b"');
    expect(html).toContain('costs $5 and $10 then');
    ed.destroy();
  });
  it('sanitises hostile attributes and refuses scripts from a custom renderer', async () => {
    const ed = make('<p><span data-math="x" onclick="alert(1)"></span></p>', { render: async () => '<span onclick="alert(1)">ok<script>alert(2)</script><svg><foreignObject><div>x</div></foreignObject></svg></span>' });
    await flush(60);
    const dom = ed.view.dom.querySelector('.wy-math')!;
    expect(dom.innerHTML).not.toMatch(/onclick|<script|foreignObject/i);
    expect(dom.textContent).toContain('ok');
    expect(ed.getHTML()).not.toContain('onclick');
    ed.destroy();
  });
  it('limits the length of a formula', () => {
    const ed = make('<p></p>', { maxLength: 10 });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    ed.execute('insertMath', 'a'.repeat(50));
    expect(ed.getHTML()).toContain(`data-math="${'a'.repeat(10)}"`);
    ed.destroy();
  });
});
