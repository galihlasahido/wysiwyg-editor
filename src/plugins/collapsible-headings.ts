import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Editor } from '../editor';
import type { ContextMenuEntry, EditorPlugin } from '../types';

/** How far left of a heading the arrow sits, in pixels from its edge (clicks in this strip toggle the section). */
const GUTTER = 40;
/** The same, for a heading in a list item: the arrow sits left of the number or bullet. */
const LIST_GUTTER = 90;

interface FoldState {
  /** Positions of the headings (top level of the document) whose section is hidden. */
  folded: number[];
  decorations: DecorationSet;
}

const key = new PluginKey<FoldState>('collapsible-headings');

const isHeading = (n: PMNode | null | undefined): n is PMNode => !!n && n.type.name === 'heading';

/** A heading that can be folded: one at the top level of the document, or the first block of a list item (a numbered or bulleted heading). */
function foldable(doc: PMNode, pos: number): boolean {
  if (!isHeading(doc.nodeAt(pos))) return false;
  const $p = doc.resolve(pos);
  return $p.depth === 0 || ($p.parent.type.name === 'list_item' && $p.index() === 0);
}

/**
 * The blocks under the heading at `pos`: from just after it to the next heading of the same or a higher level (or the end). For a heading
 * in a list item, what follows it inside that item (its text and nested lists).
 */
function sectionOf(doc: PMNode, pos: number): { from: number; to: number } | null {
  const heading = doc.nodeAt(pos);
  if (!isHeading(heading) || !foldable(doc, pos)) return null;
  const from = pos + heading.nodeSize;
  const $p = doc.resolve(pos);
  if ($p.depth > 0) return { from, to: Math.max(from, $p.end()) };
  let to = from;
  let at = from;
  for (let i = doc.resolve(from).index(0); i < doc.childCount; i++) {
    const child = doc.child(i);
    if (isHeading(child) && child.attrs.level <= heading.attrs.level) break;
    at += child.nodeSize;
    to = at;
  }
  return { from, to };
}

/** The foldable headings with their positions. */
function headingsOf(doc: PMNode): { pos: number; level: number }[] {
  const out: { pos: number; level: number }[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name === 'heading') { if (foldable(doc, pos)) out.push({ pos, level: n.attrs.level }); return false; }
    return !n.isTextblock;
  });
  return out;
}

function build(doc: PMNode, folded: number[]): DecorationSet {
  if (!folded.length) return DecorationSet.empty;
  const decos: Decoration[] = [];
  let hiddenUntil = 0;
  for (const pos of [...folded].sort((a, b) => a - b)) {
    const heading = doc.nodeAt(pos);
    if (!isHeading(heading)) continue;
    // a folded heading inside another folded section is itself hidden; it keeps its own state for when the outer one opens
    if (pos >= hiddenUntil) decos.push(Decoration.node(pos, pos + heading.nodeSize, { class: 'wy-heading-folded' }));
    const s = sectionOf(doc, pos);
    if (!s) continue;
    let at = s.from;
    while (at < s.to) {
      const n = doc.nodeAt(at)!;
      if (at >= hiddenUntil) decos.push(Decoration.node(at, at + n.nodeSize, { class: 'wy-heading-hidden' }));
      at += n.nodeSize;
    }
    hiddenUntil = Math.max(hiddenUntil, s.to);
  }
  return DecorationSet.create(doc, decos);
}

/** The folded headings that hide `pos`, if any (a position in a hidden block). */
function hidingHeadings(state: EditorState, pos: number): number[] {
  const fs = key.getState(state);
  if (!fs?.folded.length) return [];
  const out: number[] = [];
  for (const h of fs.folded) {
    const s = sectionOf(state.doc, h);
    if (s && pos >= s.from && pos < s.to) out.push(h);
  }
  return out;
}

const foldedPositions = (state: EditorState) => key.getState(state)?.folded ?? [];

function setFolded(state: EditorState, next: number[], tr: Transaction = state.tr): Transaction {
  return tr.setMeta(key, { set: [...new Set(next)] }).setMeta('addToHistory', false);
}

/** The heading a command acts on: the one the cursor is in, else the nearest one above it. */
function headingAt(state: EditorState): number | null {
  const { $from } = state.selection;
  if ($from.depth === 0) return null;
  if (isHeading($from.parent) && foldable(state.doc, $from.before())) return $from.before();
  const top = $from.before(1);
  if (isHeading(state.doc.nodeAt(top))) return top;
  let found: number | null = null;
  state.doc.forEach((n, offset) => { if (offset < top && isHeading(n)) found = offset; });
  return found;
}

/** Folds, unfolds or toggles (`fold` undefined) the section of the heading at `pos`. False when there is no such heading. */
function toggleAt(state: EditorState, pos: number, fold: boolean | undefined, dispatch?: (tr: Transaction) => void): boolean {
  const heading = state.doc.nodeAt(pos);
  if (!isHeading(heading) || !foldable(state.doc, pos)) return false;
  const now = foldedPositions(state);
  const isFolded = now.includes(pos);
  const want = fold ?? !isFolded;
  if (want === isFolded) return true;
  if (dispatch) {
    let tr = setFolded(state, want ? [...now, pos] : now.filter((p) => p !== pos));
    if (want) {
      // the cursor inside the part that disappears moves to the end of the heading, so it does not reopen the section at once
      const s = sectionOf(state.doc, pos);
      const head = state.selection.head;
      if (s && head >= s.from && head < s.to) tr = tr.setSelection(TextSelection.near(state.doc.resolve(pos + heading.nodeSize - 1), -1));
    }
    dispatch(tr);
  }
  return true;
}

/**
 * Collapse and expand the text under a heading, like the arrow next to a heading in Word. A small arrow appears left of every
 * top-level heading (on hover, always on touch screens); a click hides everything up to the next heading of the same or a higher level
 * and shows "…" after the title. Nothing is removed: the document, undo, export and print are unchanged, and a cursor that moves into
 * hidden text (search, undo, the outline) opens the section.
 *
 * Commands: `toggleHeadingFold`, `collapseHeadings`, `expandHeadings`, `showHeadingLevel(n)` (only the headings down to level `n`
 * are shown, as "Show Level" in Word: the headings of level `n` and deeper are collapsed), `isHeadingFolded`. Shortcuts: Mod-Alt-ArrowUp collapses, Mod-Alt-ArrowDown expands.
 */
export const CollapsibleHeadings: EditorPlugin = {
  name: 'collapsibleHeadings',
  requires: ['heading'],
  setup(editor: Editor) {
    editor.registerCommand('toggleHeadingFold', (e) => {
      const pos = headingAt(e.view.state);
      return pos === null ? false : toggleAt(e.view.state, pos, undefined, (tr) => e.view.dispatch(tr));
    }, { readOnlySafe: true });
    editor.registerCommand('collapseHeadings', (e, level?: number) => {
      const state = e.view.state;
      const all = headingsOf(state.doc).filter((h) => level === undefined || h.level >= level);
      if (!all.length && level === undefined) return false;
      let tr = setFolded(state, level === undefined ? all.map((h) => h.pos) : all.map((h) => h.pos));
      const head = state.selection.head;
      // the cursor goes to the nearest visible heading when its text gets hidden
      const hidden = all.some((h) => { const s = sectionOf(state.doc, h.pos); return s && head >= s.from && head < s.to; });
      if (hidden) {
        const before = [...all].reverse().find((h) => h.pos < head) ?? all[0];
        const node = state.doc.nodeAt(before.pos)!;
        tr = tr.setSelection(TextSelection.near(state.doc.resolve(before.pos + node.nodeSize - 1), -1));
      }
      e.view.dispatch(tr);
      return true;
    }, { readOnlySafe: true });
    editor.registerCommand('expandHeadings', (e) => {
      const state = e.view.state;
      if (!foldedPositions(state).length) return true;
      e.view.dispatch(setFolded(state, []));
      return true;
    }, { readOnlySafe: true });
    editor.registerCommand('showHeadingLevel', (e, level: number) => {
      const n = Math.max(1, Math.min(6, Math.round(Number(level)) || 1));
      const state = e.view.state;
      // headings above the level are open, the level and deeper are closed
      const heads = headingsOf(state.doc);
      const fold = heads.filter((h) => h.level >= n).map((h) => h.pos);
      const sel = state.selection.head;
      let tr = setFolded(state, fold);
      const inside = fold.some((p) => { const s = sectionOf(state.doc, p); return s && sel >= s.from && sel < s.to; });
      if (inside) {
        const before = [...heads].reverse().find((h) => h.pos < sel);
        if (before) tr = tr.setSelection(TextSelection.near(state.doc.resolve(before.pos + state.doc.nodeAt(before.pos)!.nodeSize - 1), -1));
      }
      e.view.dispatch(tr);
      return true;
    }, { readOnlySafe: true });
    editor.registerCommand('isHeadingFolded', (e) => { const p = headingAt(e.view.state); return p !== null && foldedPositions(e.view.state).includes(p); }, { readOnlySafe: true });

    const plugin = new Plugin<FoldState>({
      key,
      state: {
        init: (_c, st) => ({ folded: [], decorations: build(st.doc, []) }),
        apply(tr, value, _old, state) {
          const meta = tr.getMeta(key) as { set?: number[] } | undefined;
          let folded = value.folded;
          if (tr.docChanged && folded.length) {
            // move the positions along with the edits; a heading that is gone (or no longer a top-level heading) is forgotten
            folded = folded.map((p) => tr.mapping.map(p, 1)).filter((p, i, all) => foldable(state.doc, p) && all.indexOf(p) === i);
          }
          if (meta?.set) folded = meta.set;
          if (folded === value.folded && !tr.docChanged) return value;
          return { folded, decorations: build(state.doc, folded) };
        },
      },
      props: {
        decorations: (state) => key.getState(state)?.decorations,
        handleDOMEvents: {
          mousedown(view: EditorView, event: Event) {
            const e = event as MouseEvent;
            if (e.button !== 0) return false;
            const target = e.target;
            if (!(target instanceof HTMLElement) || !/^H[1-6]$/.test(target.tagName)) return false;
            const inList = target.parentElement?.tagName === 'LI';
            if (target.parentElement !== view.dom && !inList) return false;
            const rect = target.getBoundingClientRect();
            // the arrow is drawn outside the heading's box, in the margin, so it is the strip just left of it (further left in a list, past the number)
            const reach = inList ? LIST_GUTTER : GUTTER;
            if (e.clientX >= rect.left || e.clientX < rect.left - reach) return false;
            const pos = view.posAtDOM(target, 0) - 1;
            if (!toggleAt(view.state, pos, undefined, (tr) => view.dispatch(tr))) return false;
            e.preventDefault();
            return true;
          },
        },
      },
      view(view) {
        view.dom.classList.add('wy-collapsible');
        return { destroy: () => view.dom.classList.remove('wy-collapsible') };
      },
      // a cursor that lands in hidden text (search, undo, a link, the outline) opens the section(s) that hide it
      appendTransaction(trs, _old, state) {
        if (!foldedPositions(state).length) return null;
        if (!trs.some((t) => t.selectionSet || t.docChanged)) return null;
        if (trs.some((t) => t.getMeta(key)?.set)) return null; // the command chose the selection itself
        const { anchor, head } = state.selection;
        const open = new Set([...hidingHeadings(state, head), ...hidingHeadings(state, anchor)]);
        if (!open.size) return null;
        return setFolded(state, foldedPositions(state).filter((p) => !open.has(p)));
      },
    });

    return [plugin];
  },
  keymap: {
    'Mod-Alt-ArrowUp': 'toggleHeadingFold',
    'Mod-Alt-ArrowDown': 'expandHeadings',
  },
  contextMenuOrder: 20,
  contextMenu({ editor, event, state }): ContextMenuEntry[] {
    const target = event?.target instanceof HTMLElement ? event.target : null;
    const hit = target?.closest<HTMLElement>('h1, h2, h3, h4, h5, h6');
    const onHeading = !!hit && (hit.parentElement === editor.view.dom || hit.parentElement?.tagName === 'LI');
    const has = headingsOf(state.doc).length > 0;
    if (!onHeading && !has) return [];
    const folded = foldedPositions(state);
    const items: ContextMenuEntry[] = [];
    if (onHeading) {
      const pos = editor.view.posAtDOM(hit!, 0) - 1;
      const isFolded = folded.includes(pos);
      items.push({ label: isFolded ? 'Expand section' : 'Collapse section', readOnly: true, run: () => { toggleAt(editor.view.state, pos, undefined, (tr) => editor.view.dispatch(tr)); } });
    }
    if (has) {
      items.push({ label: 'Collapse all headings', readOnly: true, run: () => { editor.execute('collapseHeadings'); } });
      if (folded.length) items.push({ label: 'Expand all headings', readOnly: true, run: () => { editor.execute('expandHeadings'); } });
    }
    return [...items, '-'];
  },
  ribbon: [{
    tab: 'view',
    after: 'show',
    group: {
      id: 'headingFolds',
      label: 'Headings',
      controls: [{
        kind: 'menu', id: 'collapseHeadings', label: 'Collapse', icon: 'navigation', need: 'collapseHeadings', size: 'large',
        entries: () => [
          { label: 'Collapse all headings', command: 'collapseHeadings' },
          { label: 'Expand all headings', command: 'expandHeadings' },
          { label: 'Show level', heading: true },
          { label: 'Level 1 only', command: 'showHeadingLevel', args: [1] },
          { label: 'Levels 1 to 2', command: 'showHeadingLevel', args: [2] },
          { label: 'Levels 1 to 3', command: 'showHeadingLevel', args: [3] },
        ],
      }],
    },
  }],
};
