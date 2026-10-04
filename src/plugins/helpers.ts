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

/** Paragraph-level formatting shared by paragraphs and headings. Lengths: indents in px, spacing in pt. */
export interface BlockAttrs {
  align: string | null;
  lineHeight: string | null;
  dir: string | null;
  indentLeft: number | null;
  indentRight: number | null;
  /** First-line indent; negative means a hanging indent. */
  firstLine: number | null;
  spaceBefore: number | null;
  spaceAfter: number | null;
}

export function blockAttrDefs() {
  return {
    align: { default: null },
    lineHeight: { default: null },
    dir: { default: null },
    indentLeft: { default: null },
    indentRight: { default: null },
    firstLine: { default: null },
    spaceBefore: { default: null },
    spaceAfter: { default: null },
  };
}

/** Parse "12px" / "6pt" into a number within [min, max]; anything else is dropped (no CSS injection). */
function length(value: string, unit: 'px' | 'pt', min: number, max: number): number | null {
  const m = new RegExp(`^(-?\\d+(?:\\.\\d+)?)${unit}$`).exec(value.trim());
  if (!m) return null;
  const n = Math.round(parseFloat(m[1]) * 100) / 100;
  return n >= min && n <= max && n !== 0 ? n : null;
}

export function blockAttrs(dom: HTMLElement | string): BlockAttrs {
  const none: BlockAttrs = { align: null, lineHeight: null, dir: null, indentLeft: null, indentRight: null, firstLine: null, spaceBefore: null, spaceAfter: null };
  if (typeof dom === 'string') return none;
  const a = dom.style.textAlign;
  const lh = dom.style.lineHeight;
  const dir = dom.getAttribute('dir');
  return {
    align: ALIGNS.includes(a) ? a : null,
    lineHeight: LINE_HEIGHTS.includes(lh) ? lh : null,
    dir: dir === 'rtl' || dir === 'ltr' ? dir : null,
    indentLeft: length(dom.style.marginLeft, 'px', 0, 1500),
    indentRight: length(dom.style.marginRight, 'px', 0, 1500),
    firstLine: length(dom.style.textIndent, 'px', -1500, 1500),
    spaceBefore: length(dom.style.marginTop, 'pt', 0, 400),
    spaceAfter: length(dom.style.marginBottom, 'pt', 0, 400),
  };
}

export function blockDOM(attrs: Partial<BlockAttrs>): Record<string, string> {
  const css = [
    attrs.align && `text-align: ${attrs.align}`,
    attrs.lineHeight && `line-height: ${attrs.lineHeight}`,
    attrs.indentLeft && `margin-left: ${attrs.indentLeft}px`,
    attrs.indentRight && `margin-right: ${attrs.indentRight}px`,
    attrs.firstLine && `text-indent: ${attrs.firstLine}px`,
    attrs.spaceBefore && `margin-top: ${attrs.spaceBefore}pt`,
    attrs.spaceAfter && `margin-bottom: ${attrs.spaceAfter}pt`,
  ].filter(Boolean);
  return { ...(css.length ? { style: css.join('; ') } : {}), ...(attrs.dir ? { dir: attrs.dir } : {}) };
}
