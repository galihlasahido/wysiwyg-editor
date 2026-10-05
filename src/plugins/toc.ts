import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { EditorPlugin } from '../types';
import { docIndex } from './helpers';
import { getOutline, type OutlineItem } from './outline';

/** Table of contents block, generated from headings and kept up to date as the document changes. */
export const TableOfContents: EditorPlugin = {
  name: 'toc',
  nodes: {
    toc: {
      group: 'block',
      atom: true,
      selectable: true,
      parseDOM: [{ tag: 'div[data-toc]' }],
      toDOM: () => ['div', { 'data-toc': '', class: 'wy-toc' }],
    },
  },
  setup(editor) {
    const views = new Set<TocView>();
    // Headings are indexed once and only re-read when a change touches a heading, so typing in a paragraph does not scan the document.
    const headings = docIndex<OutlineItem>('toc-headings', (n) => n.type.name === 'heading', getOutline, (i, m) => ({ ...i, pos: m.map(i.pos) }));

    class TocView implements NodeView {
      dom = document.createElement('div');
      constructor(private view: EditorView) {
        this.dom.className = 'wy-toc';
        this.dom.setAttribute('data-toc', '');
        this.dom.setAttribute('contenteditable', 'false');
        views.add(this);
        this.render();
      }
      render() {
        const items = headings.get(this.view.state).items;
        const title = document.createElement('div');
        title.className = 'wy-toc-title';
        title.textContent = 'Table of contents';
        const nodes: HTMLElement[] = [title];
        if (!items.length) {
          const empty = document.createElement('div');
          empty.className = 'wy-toc-empty';
          empty.textContent = 'Add headings to build the table of contents.';
          nodes.push(empty);
        }
        items.forEach((_item, index) => {
          const a = document.createElement('a');
          a.className = 'wy-toc-item';
          a.style.paddingLeft = `${(_item.level - 1) * 16}px`;
          a.textContent = _item.text;
          a.addEventListener('mousedown', (e) => e.preventDefault());
          a.addEventListener('click', () => {
            const { state } = this.view;
            const at = headings.get(state).items[index]; // the position as it is now, not when the list was drawn
            if (!at) return;
            this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at.pos + 1))));
            (this.view.nodeDOM(at.pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
          });
          nodes.push(a);
        });
        this.dom.replaceChildren(...nodes);
      }
      update(node: PMNode) {
        return node.type.name === 'toc';
      }
      stopEvent() { return true; }
      ignoreMutation() { return true; }
      destroy() { views.delete(this); }
    }

    editor.registerCommand('updateToc', (e) => {
      for (const v of views) v.render();
      return views.size > 0;
    });
    editor.registerCommand('removeToc', (e) => {
      const { state, dispatch } = e.view;
      const tr = state.tr;
      const spots: number[] = [];
      state.doc.descendants((n, pos) => void (n.type.name === 'toc' && spots.push(pos)));
      for (const pos of spots.reverse()) tr.delete(pos, pos + 1);
      if (!tr.docChanged) return false;
      dispatch(tr);
      return true;
    });
    editor.registerCommand('insertToc', (e) => {
      const { state, dispatch } = e.view;
      dispatch(state.tr.replaceSelectionWith(state.schema.nodes.toc.create()).scrollIntoView());
      return true;
    });

    return [
      headings.plugin,
      new Plugin({
        props: { nodeViews: { toc: (_n, view) => new TocView(view) } },
        view() {
          let rev = -1;
          return {
            update(view) {
              const now = headings.get(view.state).rev;
              if (now === rev) return; // no heading changed
              rev = now;
              for (const v of views) v.render();
            },
          };
        },
      }),
    ];
  },
  toolbar: [{ name: 'toc', label: 'Insert table of contents', icon: '☰ᵀ', command: 'insertToc' }],
};
