import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { Equations, Mermaid, createEditor, defaultPlugins, type MermaidLike } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function fake() {
  const calls: { id: string; text: string; config: Record<string, unknown> }[] = [];
  let config: Record<string, unknown> = {};
  let active = 0;
  let maxActive = 0;
  const m: MermaidLike = {
    initialize: (c) => { config = c; },
    async render(id, text) {
      active++; maxActive = Math.max(maxActive, active);
      await flush(5);
      active--;
      calls.push({ id, text, config });
      if (text.includes('BAD')) throw new Error('Parse error on line 2:\nunexpected BAD');
      return { svg: `<svg viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(3)"><text>${text.split('\n')[0]}</text></a></svg>` };
    },
  };
  return { m, calls, maxActive: () => maxActive };
}
const make = (content: string, opts = {}) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  const f = fake();
  const ed = createEditor({ element: el, content, plugins: [...defaultPlugins, Mermaid({ mermaid: f.m, ...opts })] });
  return { ed, f };
};

describe('Mermaid', () => {
  it('renders a diagram, strips scripts from the SVG and keeps the source in the HTML', async () => {
    const { ed } = make('<figure data-mermaid="flowchart TD\n A-->B"></figure>');
    await flush(60);
    const out = ed.view.dom.querySelector('.wy-mermaid-out')!;
    expect(out.querySelector('svg')).not.toBeNull();
    expect(out.innerHTML).not.toMatch(/onload|<script|foreignObject|javascript:/i);
    expect(ed.getHTML()).toContain('data-mermaid="flowchart TD');
    expect(ed.getHTML()).toContain('<pre class="mermaid">'); // readers without scripts still get the source
    ed.destroy();
  });
  it('forces securityLevel strict and turns off HTML labels, whatever the config says', async () => {
    const { ed, f } = make('<figure data-mermaid="graph TD\n A-->B"></figure>', { config: { securityLevel: 'loose', theme: 'forest' } });
    await flush(60);
    expect(f.calls[0].config.securityLevel).toBe('strict');
    expect(f.calls[0].config.htmlLabels).toBe(false);
    expect(f.calls[0].config.theme).toBe('forest'); // other settings still apply
    ed.destroy();
  });
  it('shows Mermaid errors in place instead of throwing, and renders one diagram at a time', async () => {
    const { ed, f } = make('<figure data-mermaid="graph TD\n A-->B"></figure><figure data-mermaid="BAD"></figure><figure data-mermaid="pie\n &quot;a&quot;:1"></figure>');
    await flush(120);
    const outs = [...ed.view.dom.querySelectorAll('.wy-mermaid-out')];
    expect(outs[1].classList.contains('is-error')).toBe(true);
    expect(outs[1].textContent).toContain('unexpected BAD');
    expect(outs[0].querySelector('svg')).not.toBeNull();
    expect(outs[2].querySelector('svg')).not.toBeNull();
    expect(f.maxActive()).toBe(1);
    ed.destroy();
  });
  it('insertMermaid with code adds a node; blank is refused; editMermaid changes it', async () => {
    const { ed } = make('<p>x</p>');
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    expect(ed.execute('insertMermaid', '  ')).toBe(false);
    expect(ed.execute('insertMermaid', 'pie\n "a" : 1')).toBe(true);
    expect(ed.getHTML()).toContain('data-mermaid="pie');
    let pos = -1;
    ed.view.state.doc.descendants((n, p) => { if (n.type.name === 'mermaid_diagram') pos = p; });
    ed.view.dispatch(ed.view.state.tr.setSelection(NodeSelection.create(ed.view.state.doc, pos)));
    expect(ed.execute('editMermaid', 'graph LR\n A-->B')).toBe(true);
    expect(ed.getHTML()).toContain('data-mermaid="graph LR');
    ed.destroy();
  });
  it('the dialog offers starter templates that replace the text, and previews the result', async () => {
    const { ed } = make('<p>x</p>');
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    ed.execute('insertMermaid');
    await flush(60);
    const ta = ed.root.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.value).toContain('flowchart');
    const seq = [...ed.root.querySelectorAll('.wy-ask-snippets button')].find((b) => b.textContent === 'Sequence') as HTMLButtonElement;
    seq.click();
    expect(ta.value.startsWith('sequenceDiagram')).toBe(true);
    expect(ta.value).not.toContain('flowchart');
    await flush(300);
    expect(ed.root.querySelector('.wy-ask-preview svg')).not.toBeNull();
    (ed.root.querySelector('form') as HTMLFormElement).requestSubmit();
    await flush(60);
    expect(ed.getHTML()).toContain('data-mermaid="sequenceDiagram');
    ed.destroy();
  });
  it('round-trips through Markdown as a ```mermaid fence', () => {
    const { ed } = make('<p>intro</p><figure data-mermaid="graph TD\n A-->B"></figure>');
    const md = ed.getMarkdown();
    expect(md).toContain('```mermaid\ngraph TD\n A-->B\n```');
    ed.setMarkdown(md);
    expect(ed.getHTML()).toContain('data-mermaid="graph TD');
    ed.destroy();
  });
  it('limits the source length', () => {
    const { ed } = make('<p>x</p>', { maxLength: 20 });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    ed.execute('insertMermaid', 'a'.repeat(100));
    expect(ed.getHTML()).toContain(`data-mermaid="${'a'.repeat(20)}"`);
    ed.destroy();
  });
});

describe('Equations and Mermaid together', () => {
  it('exports both to Markdown', () => {
    const el = document.body.appendChild(document.createElement('div'));
    roots.push(el);
    const ed = createEditor({ element: el, content: '<p>Euler <span data-math="e^{i\\pi}+1=0"></span></p><div data-math-block="\\sum_i x_i"></div>', plugins: [...defaultPlugins, Equations()] });
    const md = ed.getMarkdown();
    expect(md).toContain('$e^{i\\pi}+1=0$');
    expect(md).toContain('$$\n\\sum_i x_i\n$$');
    ed.destroy();
  });
});
