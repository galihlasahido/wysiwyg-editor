import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { EditorPlugin } from '../types';
import { getOutline } from './outline';

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

    class TocView implements NodeView {
      dom = document.createElement('div');
      constructor(private view: EditorView) {
        this.dom.className = 'wy-toc';
        this.dom.setAttribute('data-toc', '');
        this.dom.setAttribute('contenteditable', 'false');
        views.add(this);
        this.render(view.state.doc);
      }
      render(doc: PMNode) {
        const items = getOutline(doc);
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
        for (const item of items) {
          const a = document.createElement('a');
          a.className = 'wy-toc-item';
          a.style.paddingLeft = `${(item.level - 1) * 16}px`;
          a.textContent = item.text;
          a.addEventListener('mousedown', (e) => e.preventDefault());
          a.addEventListener('click', () => {
            const { state } = this.view;
            this.view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(item.pos + 1))));
            (this.view.nodeDOM(item.pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
          });
          nodes.push(a);
        }
        this.dom.replaceChildren(...nodes);
      }
      update(node: PMNode) {
        return node.type.name === 'toc';
      }
      stopEvent() { return true; }
      ignoreMutation() { return true; }
      destroy() { views.delete(this); }
    }

    editor.registerCommand('insertToc', (e) => {
      const { state, dispatch } = e.view;
      dispatch(state.tr.replaceSelectionWith(state.schema.nodes.toc.create()).scrollIntoView());
      return true;
    });

    return [
      new Plugin({
        props: { nodeViews: { toc: (_n, view) => new TocView(view) } },
        view() {
          let last: PMNode | null = null;
          return {
            update(view) {
              if (view.state.doc === last) return;
              last = view.state.doc;
              for (const v of views) v.render(last);
            },
          };
        },
      }),
    ];
  },
  toolbar: [{ name: 'toc', label: 'Insert table of contents', icon: '☰ᵀ', command: 'insertToc' }],
};
