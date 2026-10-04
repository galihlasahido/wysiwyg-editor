import { InputRule, inputRules } from 'prosemirror-inputrules';
import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin, type EditorState } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { askDialog } from '../dialog';
import type { Editor } from '../editor';
import { cleanRendered } from '../inert';
import type { EditorPlugin } from '../types';

/** The part of KaTeX this plugin uses, so any compatible renderer fits. */
export interface KatexLike {
  renderToString(tex: string, options?: Record<string, unknown>): string;
}

export interface EquationsOptions {
  /** KaTeX, or a function that loads it. Default: `import('katex')` (an optional peer dependency). */
  katex?: KatexLike | (() => Promise<KatexLike>);
  /** Replace the renderer entirely. Return HTML (scripts are removed from it). Throw to show an error. */
  render?: (tex: string, display: boolean) => string | Promise<string>;
  /** Extra KaTeX macros, e.g. `{ '\\RR': '\\mathbb{R}' }`. */
  macros?: Record<string, string>;
  /** Turn typed `$x^2$` into an equation. Default true. */
  inputRule?: boolean;
  /** Longest formula accepted, in characters. Default 5000. */
  maxLength?: number;
}

export const MATH_SNIPPETS: { label: string; value: string; title: string }[] = [
  { label: 'a⁄b', value: '\\frac{a}{b}', title: 'Fraction' },
  { label: '√', value: '\\sqrt{x}', title: 'Square root' },
  { label: 'xⁿ', value: 'x^{n}', title: 'Power' },
  { label: 'xᵢ', value: 'x_{i}', title: 'Subscript' },
  { label: '∑', value: '\\sum_{i=1}^{n} x_i', title: 'Sum' },
  { label: '∫', value: '\\int_{a}^{b} f(x)\\,dx', title: 'Integral' },
  { label: 'lim', value: '\\lim_{x \\to \\infty} f(x)', title: 'Limit' },
  { label: '( )', value: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}', title: 'Matrix' },
  { label: 'α β π', value: '\\alpha \\beta \\pi', title: 'Greek letters' },
  { label: '≤ ≥ ≠', value: '\\le \\ge \\ne', title: 'Comparisons' },
  { label: '∞', value: '\\infty', title: 'Infinity' },
  { label: '±', value: '\\pm', title: 'Plus or minus' },
];

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '');

export interface MathApi {
  /** Render a formula to HTML (cached). Rejects with the renderer's message when the formula is invalid. */
  renderHTML(tex: string, display: boolean): Promise<string>;
}

/**
 * Mathematics: inline `$…$` and display equations written in LaTeX and drawn by KaTeX. Insert from the toolbar or the
 * ribbon (a dialog with templates and a live preview), type `$x^2$`, double-click an equation to edit it. Load KaTeX's
 * stylesheet (`katex/dist/katex.min.css`) in your page.
 */
export function Equations(options: EquationsOptions = {}): EditorPlugin & MathApi {
  const maxLength = options.maxLength ?? 5000;
  let katexPromise: Promise<KatexLike> | null = null;
  const loadKatex = (): Promise<KatexLike> => {
    katexPromise ??= (async () => {
      const k = options.katex;
      if (typeof k === 'function') return k();
      if (k) return k;
      const mod = (await import('katex')) as unknown as { default?: KatexLike } & KatexLike;
      return mod.default ?? mod;
    })();
    return katexPromise;
  };
  const cache = new Map<string, string>();
  const renderHTML = async (tex: string, display: boolean): Promise<string> => {
    const key = `${display ? 'D' : 'I'}${tex}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let html: string;
    if (options.render) html = await options.render(tex, display);
    else {
      const katex = await loadKatex();
      html = katex.renderToString(tex, { displayMode: display, throwOnError: true, output: 'htmlAndMathml', trust: false, strict: 'warn', maxExpand: 1000, maxSize: 50, macros: { ...options.macros } });
    }
    html = cleanRendered(html);
    if (cache.size > 500) cache.clear();
    cache.set(key, html);
    return html;
  };

  /** Draw a formula into `host`; on error show the message. Returns false when the formula is invalid. */
  const draw = async (host: HTMLElement, tex: string, display: boolean): Promise<boolean> => {
    if (!tex.trim()) { host.textContent = display ? 'Empty equation' : '∅'; host.classList.add('is-empty'); host.classList.remove('is-error'); return true; }
    host.classList.remove('is-empty');
    try {
      host.innerHTML = await renderHTML(tex, display); // cleaned of scripts above; KaTeX is run with trust: false
      host.classList.remove('is-error');
      host.removeAttribute('title');
      return true;
    } catch (e) {
      host.textContent = tex;
      host.classList.add('is-error');
      host.title = e instanceof Error ? e.message.replace(/^KaTeX parse error: /, '') : 'Invalid formula';
      return false;
    }
  };

  class MathView implements NodeView {
    dom: HTMLElement;
    private token = 0;
    constructor(private node: PMNode, view: EditorView, private getPos: () => number | undefined, private display: boolean) {
      this.dom = document.createElement(display ? 'div' : 'span');
      this.dom.className = display ? 'wy-math wy-math-block' : 'wy-math';
      this.dom.contentEditable = 'false';
      this.dom.addEventListener('dblclick', () => { const pos = this.getPos(); if (pos !== undefined) { view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))); editorRef?.execute('editMath'); } });
      this.paint();
    }
    private paint() {
      const mine = ++this.token;
      const tex = this.node.attrs.tex as string;
      this.dom.setAttribute('role', 'math');
      this.dom.setAttribute('aria-label', tex || 'empty equation');
      void draw(this.dom, tex, this.display).then(() => { if (mine !== this.token) return; /* a newer paint owns the node now */ });
    }
    update(node: PMNode) {
      if (node.type !== this.node.type) return false;
      const changed = node.attrs.tex !== this.node.attrs.tex;
      this.node = node;
      if (changed) this.paint();
      return true;
    }
    selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
    deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
    ignoreMutation() { return true; }
    stopEvent(e: Event) { return e.type === 'dblclick'; }
    destroy() { this.token++; }
  }
  let editorRef: Editor | null = null;

  const edit = (e: Editor, initial: string, display: boolean, title: string, submit: string): Promise<string | null> =>
    askDialog(e.root, {
      title,
      label: 'LaTeX',
      description: display ? 'A display equation, centred on its own line.' : 'An equation inside a line of text.',
      value: initial,
      multiline: true,
      monospace: true,
      rows: 3,
      wide: true,
      snippets: MATH_SNIPPETS,
      submitLabel: submit,
      maxLength,
      placeholder: 'e.g. \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
      preview: async (value, host) => {
        host.className = 'wy-ask-preview';
        host.replaceChildren();
        const inner = document.createElement(display ? 'div' : 'span');
        host.append(inner);
        const ok = await draw(inner, value.trim(), true);
        if (!ok) { const err = document.createElement('div'); err.className = 'wy-preview-error'; err.textContent = inner.title || 'Invalid formula'; host.replaceChildren(err); }
      },
      validate: (v) => (v.length > maxLength ? 'This formula is too long.' : null),
    });

  const makeInline = (state: EditorState, tex: string) => state.schema.nodes.math_inline.create({ tex: clean(tex, maxLength) });
  const makeBlock = (state: EditorState, tex: string) => state.schema.nodes.math_block.create({ tex: clean(tex, maxLength) });

  return Object.assign({
    name: 'math',
    nodes: {
      math_inline: {
        group: 'inline',
        inline: true,
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { tex: { default: '' } },
        leafText: (n: PMNode) => n.attrs.tex,
        parseDOM: [{ tag: 'span[data-math]', getAttrs: (n: HTMLElement | string) => ({ tex: clean((n as HTMLElement).getAttribute('data-math'), maxLength) }) }],
        toDOM: (n: PMNode) => ['span', { class: 'wy-math', 'data-math': n.attrs.tex }, `\\(${n.attrs.tex}\\)`],
      },
      math_block: {
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { tex: { default: '' } },
        leafText: (n: PMNode) => n.attrs.tex,
        parseDOM: [{ tag: 'div[data-math-block]', getAttrs: (n: HTMLElement | string) => ({ tex: clean((n as HTMLElement).getAttribute('data-math-block'), maxLength) }) }],
        toDOM: (n: PMNode) => ['div', { class: 'wy-math wy-math-block', 'data-math-block': n.attrs.tex }, `\\[${n.attrs.tex}\\]`],
      },
    },
    setup(editor: Editor) {
      editorRef = editor;
      editor.extensions.math = { renderHTML };

      const insert = (e: Editor, tex: string, display: boolean) => {
        const { state, dispatch } = e.view;
        const node = display ? makeBlock(state, tex) : makeInline(state, tex);
        dispatch(state.tr.replaceSelectionWith(node, false).scrollIntoView());
        return true;
      };
      const ask = (e: Editor, display: boolean) => {
        const { state } = e.view;
        const selected = state.selection.empty ? '' : state.doc.textBetween(state.selection.from, state.selection.to, ' ');
        void edit(e, selected, display, display ? 'Insert display equation' : 'Insert equation', 'Insert').then((tex) => tex && e.execute('insertMath', tex, display));
        return true;
      };
      editor.registerCommand('insertMath', (e, tex?: string, display = false) => {
        if (tex === undefined) return ask(e, !!display);
        return tex.trim() ? insert(e, tex, !!display) : false;
      });
      editor.registerCommand('insertMathBlock', (e, tex?: string) => e.execute('insertMath', tex, true));
      editor.registerCommand('editMath', (e, tex?: string) => {
        const sel = e.view.state.selection;
        if (!(sel instanceof NodeSelection) || (sel.node.type.name !== 'math_inline' && sel.node.type.name !== 'math_block')) return false;
        const pos = sel.from;
        const display = sel.node.type.name === 'math_block';
        const apply = (value: string) => {
          const at = e.view.state.doc.nodeAt(pos);
          if (!at || at.type !== sel.node.type) return; // moved or removed while the dialog was open
          e.view.dispatch(e.view.state.tr.setNodeMarkup(pos, undefined, { tex: clean(value, maxLength) }));
        };
        if (tex !== undefined) { apply(tex); return true; }
        void edit(e, sel.node.attrs.tex, display, 'Edit equation', 'Save').then((value) => value && apply(value));
        return true;
      });

      const rules = options.inputRule === false ? [] : [
        // typing the closing $ of $x^2$ makes the equation; "costs $5 or $10" is left alone (no space before the closing $)
        new InputRule(/(?:^|[^\\$\w])\$([^$\s](?:[^$]*[^$\s])?)\$$/, (state, match, start, end) => {
          const tex = match[1];
          if (tex.length > maxLength) return null;
          // the typed closing $ is not in the document yet: the text before the cursor is "$" + tex
          return state.tr.replaceWith(end - tex.length - 1, end, makeInline(state, tex));
        }),
        // a line of just $$...$$ becomes a display equation
        new InputRule(/^\$\$([^$]+)\$\$$/, (state, match, start, end) => {
          const $s = state.doc.resolve(start);
          if ($s.parent.type.name !== 'paragraph' || start !== $s.start() || end !== $s.end()) return null; // only when it is the whole paragraph
          return state.tr.replaceWith($s.before(), $s.after(), makeBlock(state, match[1].trim()));
        }),
      ];
      return [
        ...(rules.length ? [inputRules({ rules })] : []),
        // node views are registered through a tiny plugin
        new Plugin({ props: { nodeViews: {
          math_inline: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new MathView(node, view, getPos, false),
          math_block: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new MathView(node, view, getPos, true),
        } } }),
      ];
    },
    toolbar: [
      { name: 'math', label: 'Equation', icon: '∑', command: 'insertMath' },
      { name: 'mathBlock', label: 'Display equation', icon: '∫', command: 'insertMathBlock' },
    ],
  } satisfies EditorPlugin, { renderHTML }) as EditorPlugin & MathApi;
}
