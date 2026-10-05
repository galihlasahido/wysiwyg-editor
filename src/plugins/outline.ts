import type { Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { TextSelection } from 'prosemirror-state';
import type { EditorPlugin } from '../types';
import { docIndex } from './helpers';

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
    let panelEl: HTMLElement | null = null;
    const headings = docIndex<OutlineItem>('outline-headings', (n) => n.type.name === 'heading', getOutline, (i, m) => ({ ...i, pos: m.map(i.pos) }));
    editor.registerCommand('toggleOutline', () => (panelEl ? ((panelEl.hidden = !panelEl.hidden), true) : false), { readOnlySafe: true });
    return [
      headings.plugin,
      new Plugin({
        view(view) {
          const aside = document.createElement('aside');
          panelEl = aside;
          aside.className = 'wy-outline';
          aside.setAttribute('aria-label', 'Document outline');
          editor.body.prepend(aside);
          let rev = -1;
          const render = () => {
            const now = headings.get(view.state).rev;
            if (now === rev) return; // no heading changed
            rev = now;
            aside.replaceChildren();
            const title = document.createElement('div');
            title.className = 'wy-outline-title';
            title.textContent = 'Outline';
            aside.append(title);
            const items = headings.get(view.state).items;
            if (!items.length) {
              const hint = document.createElement('div');
              hint.className = 'wy-outline-empty';
              hint.textContent = 'Headings appear here';
              aside.append(hint);
            }
            items.forEach((item, index) => {
              const b = document.createElement('button');
              b.type = 'button';
              b.className = 'wy-outline-item';
              b.style.paddingLeft = `${8 + (item.level - 1) * 12}px`;
              b.textContent = item.text;
              b.addEventListener('click', () => {
                const { state } = view;
                const at = headings.get(state).items[index] ?? item; // the position as it is now
                view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(at.pos + 1))));
                (view.nodeDOM(at.pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
                view.focus();
              });
              aside.append(b);
            });
          };
          render();
          return { update: render, destroy: () => aside.remove() };
        },
      }),
    ];
  },
};
