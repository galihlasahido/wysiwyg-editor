import type { EditorPlugin } from '../types';

/** Per-paragraph text direction (LTR / RTL) for mixed-direction documents. */
export const Direction: EditorPlugin = {
  name: 'direction',
  setup(editor) {
    editor.registerCommand('direction', (e, dir: 'ltr' | 'rtl' | null) => {
      if (dir !== 'ltr' && dir !== 'rtl' && dir !== null) return false;
      const { state, dispatch } = e.view;
      const tr = state.tr;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.isTextblock && 'dir' in node.type.spec.attrs!) tr.setNodeMarkup(pos, undefined, { ...node.attrs, dir: node.attrs.dir === dir ? null : dir }); // same value again clears it
      });
      if (!tr.docChanged) return false;
      dispatch(tr);
      return true;
    });
  },
  toolbar: [
    { name: 'direction-ltr', label: 'Left-to-right text', icon: '¶⇒', command: 'direction', args: ['ltr'], isActive: (s) => s.selection.$from.parent.attrs.dir === 'ltr' },
    { name: 'direction-rtl', label: 'Right-to-left text', icon: '⇐¶', command: 'direction', args: ['rtl'], isActive: (s) => s.selection.$from.parent.attrs.dir === 'rtl' },
  ],
};
