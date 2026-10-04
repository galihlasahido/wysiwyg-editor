import type { Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

export interface Stats { words: number; characters: number; charactersNoSpaces: number }

export function getStats(doc: PMNode): Stats {
  // Blocks are separated by a space so "a</p><p>b" counts as two words.
  const text = doc.textBetween(0, doc.content.size, ' ', ' ');
  const trimmed = text.trim();
  return {
    words: trimmed ? trimmed.split(/\s+/).length : 0,
    characters: text.length,
    charactersNoSpaces: text.replace(/\s/g, '').length,
  };
}

/** Status bar with word/character count (and page count when the paged view is on). */
export const WordCount: EditorPlugin = {
  name: 'word-count',
  setup(editor) {
    return [
      new Plugin({
        view(view) {
          const bar = document.createElement('div');
          bar.className = 'wy-statusbar';
          bar.setAttribute('aria-live', 'off');
          editor.root.append(bar);
          let last: PMNode | null = null;
          let base = '';
          const render = () => {
            if (view.state.doc !== last) {
              last = view.state.doc;
              const s = getStats(last);
              base = `${s.words} word${s.words === 1 ? '' : 's'} · ${s.characters} characters`;
            }
            const pages = editor.root.dataset.pages;
            bar.textContent = pages ? `${base} · ${pages} page${pages === '1' ? '' : 's'}` : base;
          };
          render();
          return { update: render, destroy: () => bar.remove() };
        },
      }),
    ];
  },
};
