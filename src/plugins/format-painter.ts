import type { Mark } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

/** Copy the formatting at the cursor, then apply it to the next text you select. */
export const FormatPainter: EditorPlugin = {
  name: 'format-painter',
  setup(editor) {
    let painted: readonly Mark[] | null = null;
    const button = () => editor.root.querySelector<HTMLElement>('[aria-label="Format painter"]');

    editor.registerCommand('formatPainter', (e) => {
      if (painted) {
        painted = null; // second click cancels
      } else {
        const { $from, from, empty } = e.view.state.selection;
        painted = empty ? e.view.state.storedMarks || $from.marks() : e.view.state.doc.nodeAt(from)?.marks ?? [];
      }
      button()?.classList.toggle('is-active', !!painted);
      return true;
    });

    const apply = () => {
      const { state, dispatch } = editor.view;
      const { from, to, empty } = state.selection;
      if (!painted || empty) return;
      const tr = state.tr;
      for (const type of Object.values(state.schema.marks)) tr.removeMark(from, to, type);
      for (const mark of painted) tr.addMark(from, to, mark);
      dispatch(tr);
      painted = null;
      button()?.classList.remove('is-active');
    };

    return [new Plugin({ props: { handleDOMEvents: { mouseup: () => (setTimeout(apply), false) } } })];
  },
  toolbar: [{ name: 'formatPainter', label: 'Format painter', icon: '🖌', command: 'formatPainter' }],
};
