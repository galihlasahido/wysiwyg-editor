import type { EditorState, Transaction } from 'prosemirror-state';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';
import type { BlockAttrs } from './helpers';

const num = (v: unknown, min: number, max: number): number | null | undefined => {
  if (v === undefined) return undefined; // not part of this change
  if (v === null || v === 0) return null;
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v * 100) / 100)) : undefined;
};

/** Apply attribute changes to every textblock in the selection (that supports them). */
export function setBlockAttrs(editor: Editor, patch: Partial<BlockAttrs>): boolean {
  const { state, dispatch } = editor.view;
  const tr: Transaction = state.tr;
  state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
    if (!node.isTextblock || !('indentLeft' in node.type.spec.attrs!)) return;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
  });
  if (!tr.docChanged) return false;
  dispatch(tr);
  return true;
}

/** Attributes of the paragraph at the cursor (what the ruler and the Layout tab display). */
export function currentBlock(state: EditorState): Partial<BlockAttrs> {
  const parent = state.selection.$from.parent;
  return parent.isTextblock ? (parent.attrs as Partial<BlockAttrs>) : {};
}

/** Paragraph indents (left, right, first line / hanging) and spacing (before / after). */
export const ParagraphFormat: EditorPlugin = {
  name: 'paragraph-format',
  setup(editor) {
    editor.registerCommand('paragraphIndent', (e, v: { left?: number | null; right?: number | null; firstLine?: number | null }) => {
      const patch: Partial<BlockAttrs> = {};
      const l = num(v.left, 0, 1500);
      const r = num(v.right, 0, 1500);
      const f = num(v.firstLine, -1500, 1500);
      if (l !== undefined) patch.indentLeft = l;
      if (r !== undefined) patch.indentRight = r;
      if (f !== undefined) patch.firstLine = f;
      return Object.keys(patch).length ? setBlockAttrs(e, patch) : false;
    });
    editor.registerCommand('paragraphSpacing', (e, v: { before?: number | null; after?: number | null }) => {
      const patch: Partial<BlockAttrs> = {};
      const b = num(v.before, 0, 400);
      const a = num(v.after, 0, 400);
      if (b !== undefined) patch.spaceBefore = b;
      if (a !== undefined) patch.spaceAfter = a;
      return Object.keys(patch).length ? setBlockAttrs(e, patch) : false;
    });
  },
};
