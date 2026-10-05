import type { Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

/** Documents up to this size (in positions, about 30 pages) are counted synchronously on every change. */
const SYNC_LIMIT = 30_000;

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
          let timer = 0;
          const recount = () => {
            timer = 0;
            last = view.state.doc;
            const s = getStats(last);
            base = `${s.words} word${s.words === 1 ? '' : 's'} · ${s.characters} characters`;
          };
          const render = () => {
            if (view.state.doc !== last) {
              // Counting reads the whole text, so on a big document it waits for a pause in typing instead of running on every key.
              if (last === null || view.state.doc.content.size <= SYNC_LIMIT) recount(); // the first count is always immediate
              else if (!timer) timer = window.setTimeout(() => { recount(); render(); }, 250);
            }
            const pages = editor.root.dataset.pages;
            bar.textContent = pages ? `${base} · ${pages} page${pages === '1' ? '' : 's'}` : base;
          };
          render();
          return { update: render, destroy: () => { window.clearTimeout(timer); bar.remove(); } };
        },
      }),
    ];
  },
};
