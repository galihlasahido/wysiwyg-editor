import { toggleMark } from 'prosemirror-commands';
import type { MarkType } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export { toggleMark };

const ALIGNS = ['left', 'center', 'right', 'justify'];

export function alignAttrs(dom: HTMLElement | string): { align: string | null } {
  const a = typeof dom === 'string' ? '' : dom.style.textAlign;
  return { align: ALIGNS.includes(a) ? a : null };
}

export function alignDOM(align: string | null): Record<string, string> {
  return align ? { style: `text-align: ${align}` } : {};
}
