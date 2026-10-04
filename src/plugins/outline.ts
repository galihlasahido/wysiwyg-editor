import type { Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

export interface OutlineItem { level: number; text: string; pos: number }

export function getOutline(doc: PMNode): OutlineItem[] {
  const items: OutlineItem[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading' && node.textContent.trim()) items.push({ level: node.attrs.level, text: node.textContent, pos });
  });
  return items;
}

/** Document outline sidebar built from headings; click to jump. */
export const Outline: EditorPlugin = {
  name: 'outline',
  setup(editor) {
    return [
      new Plugin({
        view(view) {
          const aside = document.createElement('aside');
          aside.className = 'wy-outline';
          aside.setAttribute('aria-label', 'Document outline');
          editor.body.prepend(aside);
          let last: PMNode | null = null;
          const render = () => {
            if (view.state.doc === last) return;
            last = view.state.doc;
            aside.replaceChildren();
            const title = document.createElement('div');
            title.className = 'wy-outline-title';
            title.textContent = 'Outline';
            aside.append(title);
            const items = getOutline(view.state.doc);
            if (!items.length) {
              const hint = document.createElement('div');
              hint.className = 'wy-outline-empty';
              hint.textContent = 'Headings appear here';
              aside.append(hint);
            }
            for (const item of items) {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'wy-outline-item';
              b.style.paddingLeft = `${8 + (item.level - 1) * 12}px`;
              b.textContent = item.text;
              b.addEventListener('click', () => {
                const { state } = view;
                view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(item.pos + 1))));
                (view.nodeDOM(item.pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
                view.focus();
              });
              aside.append(b);
            }
          };
          render();
          return { update: render, destroy: () => aside.remove() };
        },
      }),
    ];
  },
};
