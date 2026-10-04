import type { EditorState } from 'prosemirror-state';
import type { EditorPlugin, ToolbarButton } from '../types';

const defs = [
  { value: 'left', icon: '⯇≡', label: 'Align left' },
  { value: 'center', icon: '≡', label: 'Center' },
  { value: 'right', icon: '≡⯈', label: 'Align right' },
  { value: 'justify', icon: '☰', label: 'Justify' },
];

function current(state: EditorState): string | null {
  return state.selection.$from.parent.attrs.align ?? null;
}

export const Alignment: EditorPlugin = {
  name: 'alignment',
  setup(editor) {
    editor.registerCommand('align', (e, value: string) => {
      const { state, dispatch } = e.view;
      const { from, to } = state.selection;
      const tr = state.tr;
      let changed = false;
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (node.isTextblock && 'align' in node.type.spec.attrs!) {
          // Clicking the active alignment again resets it.
          const next = node.attrs.align === value ? null : value;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, align: next });
          changed = true;
        }
      });
      if (changed) dispatch(tr);
      return changed;
    });
  },
  toolbar: defs.map(
    (d): ToolbarButton => ({
      name: `align-${d.value}`,
      label: d.label,
      icon: d.icon,
      command: 'align',
      args: [d.value],
      isActive: (s) => current(s) === d.value,
    }),
  ),
};
