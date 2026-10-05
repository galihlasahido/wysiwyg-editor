import { toggleMark } from 'prosemirror-commands';
import type { MarkType, Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type EditorState, type Transaction } from 'prosemirror-state';
import { AddMarkStep, AttrStep, DocAttrStep, RemoveMarkStep, ReplaceAroundStep, ReplaceStep, type Step } from 'prosemirror-transform';

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


/** Does this node, or anything inside [from, to] of `doc`, match? Looks only at the nearest common parent of the range, not the whole document. */
function rangeTouches(doc: PMNode, from: number, to: number, match: (n: PMNode) => boolean): boolean {
  from = Math.max(0, Math.min(from, doc.content.size));
  to = Math.max(from, Math.min(to, doc.content.size));
  const $f = doc.resolve(from);
  const d = $f.sharedDepth(to);
  for (let k = d; k > 0; k--) if (match($f.node(k))) return true; // an edit inside a matching node (typing in a heading)
  let hit = false;
  const base = $f.start(d);
  $f.node(d).nodesBetween(from - base, to - base, (n) => {
    if (match(n)) hit = true;
    return !hit;
  });
  return hit;
}

/**
 * Whether a transaction added, removed, changed or edited the inside of a node for which `match` is true. Plugins that derive something from
 * the whole document (numbers, an outline, notes) use it to skip their full scan on the keystrokes that cannot change the result: typing in
 * an ordinary paragraph touches nothing and costs a lookup near the cursor instead of a pass over the document. When in doubt (an unknown kind
 * of step) it says yes, so a plugin always errs towards recomputing.
 */
export function touchesDoc(tr: Transaction, match: (n: PMNode) => boolean): boolean {
  if (!tr.docChanged) return false;
  for (let i = 0; i < tr.steps.length; i++) {
    const step: Step = tr.steps[i];
    const before = tr.docs[i];
    const after = i + 1 < tr.docs.length ? tr.docs[i + 1] : tr.doc;
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      if (rangeTouches(after, step.from, step.to, match) || rangeTouches(before, step.from, step.to, match)) return true;
    } else if (step instanceof AttrStep) {
      if (rangeTouches(before, step.pos, step.pos + 1, match) || rangeTouches(after, step.pos, step.pos + 1, match)) return true;
    } else if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      let hit = false;
      step.getMap().forEach((oStart, oEnd, nStart, nEnd) => {
        if (!hit && (rangeTouches(before, oStart, oEnd, match) || rangeTouches(after, nStart, nEnd, match))) hit = true;
      });
      if (hit) return true;
      if (step instanceof ReplaceAroundStep && (rangeTouches(before, step.from, step.from + 1, match) || rangeTouches(after, step.from, step.from + 1, match))) return true;
    } else if (!(step instanceof DocAttrStep)) {
      return true; // a kind of step this does not know: assume it matters
    }
  }
  return false;
}

/**
 * An index of the nodes that matter to a plugin (headings, footnotes…), kept in the editor state. It is rebuilt with `scan` only when a
 * transaction touches a matching node; otherwise the stored positions are mapped through the change. `rev` increases whenever the content
 * of the index changed, so a view can skip redrawing. `mapItem` moves an item's positions through an unrelated change.
 */
export function docIndex<T>(name: string, match: (n: PMNode) => boolean, scan: (doc: PMNode) => T[], mapItem: (item: T, map: Transaction['mapping']) => T) {
  type S = { items: T[]; rev: number };
  const key = new PluginKey<S>(name);
  const plugin = new Plugin<S>({
    key,
    state: {
      init: (_c, st) => ({ items: scan(st.doc), rev: 0 }),
      apply(tr, v, _old, st) {
        if (!tr.docChanged) return v;
        if (touchesDoc(tr, match)) return { items: scan(st.doc), rev: v.rev + 1 };
        return { items: v.items.map((i) => mapItem(i, tr.mapping)), rev: v.rev };
      },
    },
  });
  return { key, plugin, get: (state: EditorState): S => key.getState(state)! };
}
