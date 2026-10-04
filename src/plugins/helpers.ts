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
export const LINE_HEIGHTS = ['1', '1.15', '1.5', '2', '2.5', '3'];

export function blockAttrDefs() {
  return { align: { default: null }, lineHeight: { default: null } };
}

export function blockAttrs(dom: HTMLElement | string): { align: string | null; lineHeight: string | null } {
  if (typeof dom === 'string') return { align: null, lineHeight: null };
  const a = dom.style.textAlign;
  const lh = dom.style.lineHeight;
  return { align: ALIGNS.includes(a) ? a : null, lineHeight: LINE_HEIGHTS.includes(lh) ? lh : null };
}

export function blockDOM(attrs: { align?: string | null; lineHeight?: string | null }): Record<string, string> {
  const css = [attrs.align && `text-align: ${attrs.align}`, attrs.lineHeight && `line-height: ${attrs.lineHeight}`].filter(Boolean);
  return css.length ? { style: css.join('; ') } : {};
}
