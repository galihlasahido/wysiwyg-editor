import type { Node as PMNode } from 'prosemirror-model';
import { NodeSelection, Plugin, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import { openDialog } from '../dialog';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';
import { touchesDoc } from './helpers';

const isCaptionNode = (n: PMNode) => n.type.name === 'caption' || n.type.name === 'xref' || n.type.name === 'caption_list';

export interface CaptionKind {
  /** `figure`, `table` … stored in the document. */
  id: string;
  /** The word before the number: "Figure", "Tabel". */
  label: string;
}

export interface CaptionsOptions {
  /** Default: Figure and Table. */
  kinds?: CaptionKind[];
  /** Text between the number and the caption, e.g. ". " or ": ". Default ". ". */
  separator?: string;
}

const DEFAULT_KINDS: CaptionKind[] = [{ id: 'figure', label: 'Figure' }, { id: 'table', label: 'Table' }];
const newId = () => `cap${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const ID = /^[\w-]{1,40}$/;

export interface CaptionEntry { id: string; kind: string; n: number; label: string; text: string; pos: number }

/** Every caption in document order with its number within its kind. */
export function collectCaptions(doc: PMNode, kinds: CaptionKind[]): CaptionEntry[] {
  const counters = new Map<string, number>();
  const out: CaptionEntry[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name !== 'caption') return;
    const kind = kinds.find((k) => k.id === n.attrs.kind) ?? kinds[0];
    const c = (counters.get(kind.id) ?? 0) + 1;
    counters.set(kind.id, c);
    out.push({ id: n.attrs.id, kind: kind.id, n: c, label: kind.label, text: n.textContent, pos });
  });
  return out;
}

/**
 * Numbered captions ("Figure 3. …", "Table 2. …"), cross-references that follow them ("see Figure 3") and a list of figures or tables.
 * Numbers are worked out from the order in the document and renumber as you add, delete or move captions; the derived text is also
 * saved in the HTML, so exports and printouts show it.
 */
export function Captions(options: CaptionsOptions = {}): EditorPlugin {
  const kinds = options.kinds ?? DEFAULT_KINDS;
  const sep = options.separator ?? '. ';
  const labelOf = (kindId: string, n: number) => `${(kinds.find((k) => k.id === kindId) ?? kinds[0]).label} ${n}`;

  /** Bring every derived value (caption numbers, cross-reference text, list entries) up to date. Returns null when nothing changed. */
  function refresh(state: EditorState): Transaction | null {
    const caps = collectCaptions(state.doc, kinds);
    const byId = new Map(caps.map((c) => [c.id, c]));
    let tr: Transaction | null = null;
    const apply = (pos: number, attrs: Record<string, unknown>) => { tr ??= state.tr; tr.setNodeMarkup(tr.mapping.map(pos), undefined, attrs); };
    state.doc.descendants((n, pos) => {
      if (n.type.name === 'caption') {
        const c = byId.get(n.attrs.id);
        if (c && n.attrs.n !== c.n) apply(pos, { ...n.attrs, n: c.n });
      } else if (n.type.name === 'xref') {
        const c = byId.get(n.attrs.target);
        const text = c ? labelOf(c.kind, c.n) : 'Missing reference';
        if (n.attrs.text !== text) apply(pos, { ...n.attrs, text });
      } else if (n.type.name === 'caption_list') {
        const items = JSON.stringify(caps.filter((c) => c.kind === n.attrs.kind).map((c) => ({ id: c.id, n: c.n, text: c.text })));
        if (n.attrs.items !== items) apply(pos, { ...n.attrs, items });
      }
    });
    return tr ? (tr as Transaction).setMeta('addToHistory', false) : null;
  }

  class CaptionView implements NodeView {
    dom: HTMLElement;
    contentDOM: HTMLElement;
    private label: HTMLElement;
    constructor(private node: PMNode) {
      this.dom = document.createElement('p');
      this.label = document.createElement('span');
      this.label.className = 'wy-caption-label';
      this.label.contentEditable = 'false';
      this.contentDOM = document.createElement('span');
      this.contentDOM.className = 'wy-caption-text';
      this.dom.append(this.label, this.contentDOM);
      this.paint();
    }
    private paint() {
      this.dom.className = `wy-caption wy-caption-${this.node.attrs.kind}`;
      this.dom.id = this.node.attrs.id;
      this.dom.setAttribute('data-caption', this.node.attrs.kind);
      this.label.textContent = `${labelOf(this.node.attrs.kind, this.node.attrs.n)}${sep}`;
    }
    update(node: PMNode) {
      if (node.type !== this.node.type) return false;
      this.node = node;
      this.paint();
      return true;
    }
    ignoreMutation(m: { target: Node }) { return m.target === this.label || this.label.contains(m.target); }
  }

  class XrefView implements NodeView {
    dom: HTMLElement;
    constructor(private node: PMNode, private view: EditorView) {
      this.dom = document.createElement('a');
      this.dom.className = 'wy-xref';
      this.dom.contentEditable = 'false';
      this.paint();
      this.dom.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById(this.node.attrs.target)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      });
    }
    private paint() {
      this.dom.textContent = this.node.attrs.text;
      this.dom.setAttribute('href', `#${this.node.attrs.target}`);
      this.dom.classList.toggle('is-missing', this.node.attrs.text === 'Missing reference');
    }
    update(node: PMNode) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
    selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
    deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
    ignoreMutation() { return true; }
    destroy() { void this.view; }
  }

  class ListView implements NodeView {
    dom: HTMLElement;
    constructor(private node: PMNode) {
      this.dom = document.createElement('div');
      this.dom.className = 'wy-caption-list';
      this.dom.contentEditable = 'false';
      this.paint();
    }
    private paint() {
      const kind = kinds.find((k) => k.id === this.node.attrs.kind) ?? kinds[0];
      const items = parseItems(this.node.attrs.items);
      this.dom.replaceChildren();
      const h = document.createElement('div');
      h.className = 'wy-caption-list-title';
      h.textContent = `List of ${kind.label.toLowerCase()}s`;
      this.dom.append(h);
      if (!items.length) { const none = document.createElement('div'); none.className = 'wy-caption-list-none'; none.textContent = `No ${kind.label.toLowerCase()}s yet. Add a caption to a ${kind.label.toLowerCase()}.`; this.dom.append(none); return; }
      for (const it of items) {
        const a = document.createElement('a');
        a.href = `#${it.id}`;
        a.className = 'wy-caption-list-item';
        a.textContent = `${kind.label} ${it.n}${sep}${it.text}`;
        a.addEventListener('click', (e) => { e.preventDefault(); document.getElementById(it.id)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); });
        this.dom.append(a);
      }
    }
    update(node: PMNode) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
    ignoreMutation() { return true; }
    stopEvent(e: Event) { return e.type === 'click'; }
  }

  const parseItems = (v: unknown): { id: string; n: number; text: string }[] => {
    try { const a = JSON.parse(String(v)); return Array.isArray(a) ? a.filter((x) => x && ID.test(x.id) && Number.isFinite(x.n)).map((x) => ({ id: x.id, n: Number(x.n), text: String(x.text ?? '').slice(0, 300) })).slice(0, 500) : []; } catch { return []; }
  };

  return {
    name: 'captions',
    nodes: {
      caption: {
        group: 'block',
        content: 'inline*',
        defining: true,
        attrs: { id: { default: '' }, kind: { default: 'figure' }, n: { default: 1 } },
        parseDOM: [
          { tag: 'span.wy-caption-label', ignore: true, priority: 80 }, // the printed "Figure 1. " is not part of the caption text
          { tag: 'p[data-caption]', priority: 60, contentElement: 'span.wy-caption-text', getAttrs: (d) => {
            const el = d as HTMLElement;
            const kind = el.getAttribute('data-caption') ?? '';
            return { kind: kinds.some((k) => k.id === kind) ? kind : kinds[0].id, id: ID.test(el.id) ? el.id : newId(), n: Number(el.getAttribute('data-n')) || 1 };
          } },
        ],
        toDOM: (n: PMNode) => ['p', { class: `wy-caption wy-caption-${n.attrs.kind}`, id: n.attrs.id, 'data-caption': n.attrs.kind, 'data-n': String(n.attrs.n) }, ['span', { class: 'wy-caption-label' }, `${labelOf(n.attrs.kind, n.attrs.n)}${sep}`], ['span', { class: 'wy-caption-text' }, 0]],
      },
      xref: {
        group: 'inline',
        inline: true,
        atom: true,
        selectable: true,
        attrs: { target: { default: '' }, text: { default: 'Missing reference' } },
        leafText: (n: PMNode) => n.attrs.text,
        parseDOM: [{ tag: 'a[data-xref]', getAttrs: (d) => { const t = (d as HTMLElement).getAttribute('data-xref') ?? ''; return ID.test(t) ? { target: t, text: (d as HTMLElement).textContent?.slice(0, 60) || 'Missing reference' } : false; } }],
        toDOM: (n: PMNode) => ['a', { class: 'wy-xref', href: `#${n.attrs.target}`, 'data-xref': n.attrs.target }, n.attrs.text],
      },
      caption_list: {
        group: 'block',
        atom: true,
        selectable: true,
        attrs: { kind: { default: 'figure' }, items: { default: '[]' } },
        parseDOM: [{ tag: 'div[data-caption-list]', getAttrs: (d) => { const kind = (d as HTMLElement).getAttribute('data-caption-list') ?? ''; return kinds.some((k) => k.id === kind) ? { kind, items: JSON.stringify(parseItems((d as HTMLElement).getAttribute('data-items'))) } : false; } }],
        toDOM: (n: PMNode) => {
          const kind = kinds.find((k) => k.id === n.attrs.kind) ?? kinds[0];
          return ['div', { class: 'wy-caption-list', 'data-caption-list': n.attrs.kind, 'data-items': n.attrs.items }, ['div', { class: 'wy-caption-list-title' }, `List of ${kind.label.toLowerCase()}s`], ...parseItems(n.attrs.items).map((it) => ['p', {}, ['a', { href: `#${it.id}` }, `${kind.label} ${it.n}${sep}${it.text}`]] as const)];
        },
      },
    },
    setup(editor: Editor) {
      const kindFor = (state: EditorState): string => {
        const sel = state.selection;
        if (sel instanceof NodeSelection && sel.node.type.name === 'image') return 'figure';
        const { $from } = sel;
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') return kinds.find((k) => k.id === 'table')?.id ?? kinds[0].id;
        let hasImage = false;
        $from.parent.forEach((c) => { if (c.type.name === 'image') hasImage = true; });
        return hasImage ? 'figure' : kinds[0].id;
      };
      editor.registerCommand('insertCaption', (e, kind?: string, text?: string) => {
        const { state, dispatch } = e.view;
        const k = kinds.find((x) => x.id === (kind ?? kindFor(state)))?.id ?? kinds[0].id;
        const { $from } = state.selection;
        // after the table, or after the block holding the picture; otherwise after the current block
        let depth = $from.depth;
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') depth = d;
        const at = depth > 0 ? $from.after(Math.max(1, depth === $from.depth ? $from.depth : depth)) : state.selection.to;
        const node = state.schema.nodes.caption.create({ id: newId(), kind: k }, text ? state.schema.text(text) : undefined);
        const tr = state.tr.insert(at, node);
        tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
        dispatch(tr.scrollIntoView());
        return true;
      });
      editor.registerCommand('insertCrossReference', (e, target?: string) => {
        const caps = collectCaptions(e.view.state.doc, kinds);
        if (!caps.length) return false;
        const place = (id: string) => {
          const c = caps.find((x) => x.id === id);
          if (!c) return false;
          const { state, dispatch } = e.view;
          dispatch(state.tr.replaceSelectionWith(state.schema.nodes.xref.create({ target: id, text: labelOf(c.kind, c.n) }), false).scrollIntoView());
          return true;
        };
        if (target) return place(target);
        const pick = document.createElement('select');
        pick.className = 'wy-xref-pick';
        pick.setAttribute('aria-label', 'Refer to');
        for (const c of caps) pick.add(new Option(`${c.label} ${c.n}${sep}${c.text.slice(0, 60)}`, c.id));
        const note = document.createElement('p');
        note.textContent = 'Choose the caption this text points to. The number follows it when captions are added, removed or moved.';
        const body = document.createElement('div');
        body.append(note, pick);
        openDialog(e.root, { title: 'Insert cross-reference', body, actions: [{ label: 'Cancel' }, { label: 'Insert', primary: true, onClick: () => void place(pick.value) }] });
        return true;
      });
      editor.registerCommand('insertCaptionList', (e, kind?: string) => {
        const { state, dispatch } = e.view;
        const k = kinds.find((x) => x.id === kind)?.id ?? kinds[0].id;
        dispatch(state.tr.replaceSelectionWith(state.schema.nodes.caption_list.create({ kind: k }), false).scrollIntoView());
        return true;
      });
      editor.extensions.captions = { list: () => collectCaptions(editor.view.state.doc, kinds) };
      return [
        new Plugin({
          // the numbers only change when a caption, reference or list is added, removed, moved or edited: not when typing elsewhere
          appendTransaction: (trs, _old, state) => (!trs.length || trs.some((t) => touchesDoc(t, isCaptionNode)) ? refresh(state) : null),
          view(view) {
            // a document loaded with stale numbers (or none) is brought up to date once
            queueMicrotask(() => { const tr = refresh(view.state); if (tr) view.dispatch(tr); });
            return {};
          },
          props: {
            nodeViews: {
              caption: (node: PMNode) => new CaptionView(node),
              xref: (node: PMNode, view: EditorView) => new XrefView(node, view),
              caption_list: (node: PMNode) => new ListView(node),
            },
          },
        }),
      ];
    },
    toolbar: [
      { name: 'caption', label: 'Insert caption', icon: '🏷', command: 'insertCaption' },
      { name: 'crossReference', label: 'Insert cross-reference', icon: '🔗', command: 'insertCrossReference' },
      { name: 'listOfFigures', label: 'List of figures', icon: '☰', command: 'insertCaptionList' },
    ],
  };
}
