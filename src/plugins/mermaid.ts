import { NodeSelection, Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { askDialog } from '../dialog';
import type { Editor } from '../editor';
import { cleanRendered } from '../inert';
import type { EditorPlugin } from '../types';

/** The part of Mermaid this plugin uses. */
export interface MermaidLike {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ svg: string }>;
}

export interface MermaidOptions {
  /** Mermaid, or a function that loads it: `() => import('mermaid')` (an optional peer dependency you install). A module with a `default` export is accepted too. */
  mermaid?: MermaidLike | (() => Promise<MermaidLike | { default: MermaidLike }>);
  /** Extra Mermaid configuration. `securityLevel` stays 'strict' whatever you pass. */
  config?: Record<string, unknown>;
  /** Longest diagram source accepted, in characters. Default 20000. */
  maxLength?: number;
}

export const MERMAID_TEMPLATES: { label: string; value: string; title: string; replace: true }[] = [
  { label: 'Flowchart', title: 'Flowchart', replace: true, value: 'flowchart TD\n  A[Start] --> B{Is it ready?}\n  B -- Yes --> C[Ship it]\n  B -- No --> D[Fix it]\n  D --> B' },
  { label: 'Sequence', title: 'Sequence diagram', replace: true, value: 'sequenceDiagram\n  participant U as User\n  participant S as Server\n  U->>S: Request\n  S-->>U: Response' },
  { label: 'Class', title: 'Class diagram', replace: true, value: 'classDiagram\n  class Animal {\n    +String name\n    +speak()\n  }\n  Animal <|-- Dog\n  Animal <|-- Cat' },
  { label: 'State', title: 'State diagram', replace: true, value: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Published\n  Review --> Draft\n  Published --> [*]' },
  { label: 'ER', title: 'Entity relationship', replace: true, value: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE_ITEM : contains' },
  { label: 'Gantt', title: 'Gantt chart', replace: true, value: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Design :a1, 2026-01-05, 7d\n  Implement :after a1, 14d' },
  { label: 'Pie', title: 'Pie chart', replace: true, value: 'pie title Pets\n  "Dogs" : 386\n  "Cats" : 85\n  "Rats" : 15' },
  { label: 'Mindmap', title: 'Mind map', replace: true, value: 'mindmap\n  root((Editor))\n    Plugins\n      Math\n      Mermaid\n    Core' },
];

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '');
let uid = 0;

export interface MermaidApi {
  /** Render diagram source to sanitised SVG (cached, one at a time). Rejects with Mermaid's message when the source is invalid. */
  renderSVG(code: string, dark?: boolean): Promise<string>;
}

/**
 * Diagrams written as text with Mermaid: flowcharts, sequence, class, state, ER, Gantt, pie, mind maps and more.
 * Insert one from the toolbar or ribbon (a dialog with starter templates and a live preview), double-click to edit.
 * Rendering follows the page's light or dark colours. The SVG is cleaned of scripts before it is shown.
 */
export function Mermaid(options: MermaidOptions = {}): EditorPlugin & MermaidApi {
  const maxLength = options.maxLength ?? 20000;
  let mermaidPromise: Promise<MermaidLike> | null = null;
  const load = (): Promise<MermaidLike> => {
    mermaidPromise ??= (async () => {
      const m = options.mermaid;
      if (typeof m === 'function') {
        const mod = await m();
        return 'default' in mod && mod.default ? mod.default : (mod as MermaidLike); // `import('mermaid')` gives a module with a default export
      }
      if (m) return m;
      throw new Error("Mermaid is not set up. Pass it when you add the plugin: Mermaid({ mermaid: () => import('mermaid') }) and install the \"mermaid\" package.");
    })();
    return mermaidPromise;
  };
  // Mermaid keeps global state and measures text in the page, so renders run one after another.
  let queue: Promise<unknown> = Promise.resolve();
  const cache = new Map<string, string>();
  const renderSVG = (code: string, dark = false): Promise<string> => {
    const key = `${dark ? 'd' : 'l'}\u0000${code}`;
    const hit = cache.get(key);
    if (hit !== undefined) return Promise.resolve(hit);
    const job = queue.then(async () => {
      const mermaid = await load();
      mermaid.initialize({
        startOnLoad: false,
        theme: dark ? 'dark' : 'default',
        htmlLabels: false, // labels as SVG text: no foreignObject, so the output can be cleaned reliably
        flowchart: { htmlLabels: false },
        ...options.config,
        securityLevel: 'strict', // never lowered, whatever the config says
      });
      const id = `wy-mmd-${++uid}`;
      try {
        const { svg } = await mermaid.render(id, code);
        const out = cleanRendered(svg);
        if (cache.size > 100) cache.clear();
        cache.set(key, out);
        return out;
      } finally {
        document.getElementById(`d${id}`)?.remove(); // Mermaid leaves its scratch element behind when a diagram is invalid
        document.getElementById(id)?.remove();
      }
    });
    queue = job.catch(() => {});
    return job;
  };

  const isDark = (el: Element) => {
    const m = /\d+(\.\d+)?/g;
    const [r, g, b] = (getComputedStyle(el).color.match(m) ?? ['0', '0', '0']).map(Number);
    return (r * 299 + g * 587 + b * 114) / 1000 > 140; // light text means a dark page
  };
  const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 6).join('\n').slice(0, 600);
  let editorRef: Editor | null = null;
  let relayout = 0;
  const relayoutSoon = () => { if (!relayout) relayout = requestAnimationFrame(() => { relayout = 0; window.dispatchEvent(new Event('resize')); }); }; // the paged layout re-measures

  class MermaidView implements NodeView {
    dom: HTMLElement;
    private out = document.createElement('div');
    private token = 0;
    private watcher: MutationObserver | null = null;
    constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
      this.dom = document.createElement('figure');
      this.dom.className = 'wy-mermaid';
      this.dom.contentEditable = 'false';
      this.out.className = 'wy-mermaid-out';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'wy-mermaid-edit';
      edit.textContent = 'Edit diagram';
      edit.addEventListener('click', () => this.edit());
      this.dom.append(this.out, edit);
      this.dom.addEventListener('dblclick', () => this.edit());
      // follow the theme: repaint when the editor's colour scheme changes
      const root = view.dom.closest('.wy-editor');
      if (root) { this.watcher = new MutationObserver(() => this.paint()); this.watcher.observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-page', 'class'] }); }
      this.paint();
    }
    private edit() {
      const pos = this.getPos();
      if (pos === undefined) return;
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      editorRef?.execute('editMermaid');
    }
    private paint() {
      const mine = ++this.token;
      const code = this.node.attrs.code as string;
      this.dom.setAttribute('role', 'img');
      this.dom.setAttribute('aria-label', `Diagram: ${code.split('\n')[0].slice(0, 60)}`);
      if (!code.trim()) { this.out.textContent = 'Empty diagram'; this.out.className = 'wy-mermaid-out is-empty'; return; }
      void renderSVG(code, isDark(this.view.dom)).then(
        (svg) => { if (mine !== this.token) return; this.out.className = 'wy-mermaid-out'; this.out.innerHTML = svg; relayoutSoon(); },
        (e) => { if (mine !== this.token) return; this.out.className = 'wy-mermaid-out is-error'; const pre = document.createElement('pre'); pre.textContent = message(e); this.out.replaceChildren(pre); relayoutSoon(); },
      );
    }
    update(node: PMNode) {
      if (node.type !== this.node.type) return false;
      const changed = node.attrs.code !== this.node.attrs.code;
      this.node = node;
      if (changed) this.paint();
      return true;
    }
    selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
    deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
    ignoreMutation() { return true; }
    stopEvent(e: Event) { return e.type === 'dblclick' || (e.target as HTMLElement).closest?.('.wy-mermaid-edit') !== null; }
    destroy() { this.token++; this.watcher?.disconnect(); }
  }

  const ask = (e: Editor, initial: string, title: string, submit: string): Promise<string | null> =>
    askDialog(e.root, {
      title,
      label: 'Mermaid source',
      description: 'Describe the diagram as text. Start from a template, then change it.',
      value: initial,
      multiline: true,
      monospace: true,
      rows: 9,
      wide: true,
      snippets: MERMAID_TEMPLATES,
      submitLabel: submit,
      maxLength,
      placeholder: 'flowchart TD\n  A --> B',
      preview: async (value, host) => {
        host.replaceChildren();
        if (!value.trim()) return;
        try {
          host.innerHTML = await renderSVG(value, isDark(e.view.dom));
        } catch (err) {
          const pre = document.createElement('pre');
          pre.className = 'wy-preview-error';
          pre.textContent = message(err);
          host.replaceChildren(pre);
        }
      },
    });

  return Object.assign({
    name: 'mermaid',
    nodes: {
      mermaid_diagram: {
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { code: { default: '' } },
        leafText: (n: PMNode) => n.attrs.code,
        parseDOM: [{ tag: 'figure[data-mermaid]', getAttrs: (n: HTMLElement | string) => ({ code: clean((n as HTMLElement).getAttribute('data-mermaid'), maxLength) }) }],
        // Readers without scripts still get the source, in a <pre class="mermaid">.
        toDOM: (n: PMNode) => ['figure', { class: 'wy-mermaid', 'data-mermaid': n.attrs.code }, ['pre', { class: 'mermaid' }, n.attrs.code]],
      },
    },
    setup(editor: Editor) {
      editorRef = editor;
      editor.extensions.mermaid = { renderSVG };
      editor.registerCommand('insertMermaid', (e, code?: string) => {
        const { state, dispatch } = e.view;
        if (code === undefined) {
          void ask(e, MERMAID_TEMPLATES[0].value, 'Insert diagram', 'Insert').then((value) => value && e.execute('insertMermaid', value));
          return true;
        }
        const text = clean(code, maxLength);
        if (!text.trim()) return false;
        const tr = state.tr.replaceSelectionWith(state.schema.nodes.mermaid_diagram.create({ code: text }), false);
        dispatch(tr.scrollIntoView());
        return true;
      });
      editor.registerCommand('editMermaid', (e, code?: string) => {
        const sel = e.view.state.selection;
        if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'mermaid_diagram') return false;
        const pos = sel.from;
        const apply = (value: string) => {
          const at = e.view.state.doc.nodeAt(pos);
          if (!at || at.type.name !== 'mermaid_diagram') return; // moved or removed while the dialog was open
          e.view.dispatch(e.view.state.tr.setNodeMarkup(pos, undefined, { code: clean(value, maxLength) }));
        };
        if (code !== undefined) { apply(code); return true; }
        void ask(e, sel.node.attrs.code, 'Edit diagram', 'Save').then((value) => value && apply(value));
        return true;
      });
      return [new Plugin({ props: { nodeViews: { mermaid_diagram: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new MermaidView(node, view, getPos) } } })];
    },
    toolbar: [{ name: 'mermaid', label: 'Diagram (Mermaid)', icon: '⬡', command: 'insertMermaid' }],
  } satisfies EditorPlugin, { renderSVG }) as EditorPlugin & MermaidApi;
}

