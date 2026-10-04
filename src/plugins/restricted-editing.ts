import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { Plugin, type EditorState, type Transaction } from 'prosemirror-state';
import { Step } from 'prosemirror-transform';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

export interface RestrictedEditingOptions {
  /** Start in author mode: everything is editable and the lock commands work. Default false. */
  authorMode?: boolean;
}

/** Transactions with these metas are programmatic or remote (app code, collaboration, version restore): never blocked. */
const BYPASS_META = ['wy-raw', 'y-sync$'];

const cleanLabel = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : null);

/** Is `$pos` somewhere the user may edit? The innermost lock or region decides, so regions can sit inside locked sections. */
function editableAt($pos: ResolvedPos): boolean {
  for (let d = $pos.depth; d > 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === 'locked_section') return false;
    if (name === 'editable_region') return true;
  }
  return true;
}

/**
 * Check one changed range [from, to] of `doc`. Returns the position of the offending locked section, or null when the
 * edit is allowed. An edit is allowed when both ends are editable and no locked section is partly or wholly covered
 * by the range (so one cannot delete a lock by selecting across it).
 */
function violation(doc: PMNode, from: number, to: number): number | null {
  const size = doc.content.size;
  const a = Math.max(0, Math.min(from, size));
  const b = Math.max(a, Math.min(to, size));
  const $a = doc.resolve(a);
  const $b = doc.resolve(b);
  if (!editableAt($a) || !editableAt($b)) return lockedAncestor($a) ?? lockedAncestor($b) ?? 0;
  if (a === b) return null;
  let bad: number | null = null;
  doc.nodesBetween(a, b, (node, pos) => {
    if (bad !== null) return false;
    if (node.type.name === 'locked_section') {
      // The only locked section allowed to overlap the range is one that strictly contains it (the edit is inside a region).
      if (!(pos < a && pos + node.nodeSize > b)) bad = pos;
    }
    return bad === null;
  });
  return bad;
}

function lockedAncestor($pos: ResolvedPos): number | null {
  for (let d = $pos.depth; d > 0; d--) if ($pos.node(d).type.name === 'locked_section') return $pos.before(d);
  return null;
}

/** Ranges (in the document before the step) that a step changes. */
function stepRanges(step: Step): [number, number][] {
  const s = step as unknown as { from?: number; to?: number; pos?: number; gapFrom?: number; gapTo?: number };
  const out: [number, number][] = [];
  step.getMap().forEach((from, to) => out.push([from, to]));
  // Mark and attribute steps do not move positions, so they have an empty map: use their own range.
  if (!out.length && typeof s.from === 'number' && typeof s.to === 'number') out.push([s.from, s.to]);
  if (!out.length && typeof s.pos === 'number') out.push([s.pos, s.pos + 1]);
  return out;
}

/**
 * Restricted editing for templates and forms: `locked_section` blocks cannot be changed (a heading, a table of
 * contents, legal text), `editable_region` blocks inside them can, and everything else is ordinary editable text.
 * Enforced by rejecting transactions, so typing, pasting, dropping, deleting and find & replace are all covered.
 * In author mode the template author can create and remove locks and regions.
 */
export function RestrictedEditing(options: RestrictedEditingOptions = {}): EditorPlugin {
  let author = options.authorMode ?? false;
  let editor: Editor | null = null;
  const sync = () => {
    editor?.root.classList.toggle('wy-author-mode', author);
    editor?.toolbar.update(editor.view.state);
  };

  /** Briefly outline the locked section the user tried to change. */
  const flash = (pos: number) => {
    const dom = editor?.view.nodeDOM(pos);
    if (!(dom instanceof HTMLElement)) return;
    dom.classList.add('is-denied');
    setTimeout(() => dom.classList.remove('is-denied'), 500);
  };

  return {
    name: 'restricted-editing',
    nodes: {
      locked_section: {
        group: 'block',
        content: 'block+',
        defining: true,
        isolating: true,
        attrs: { label: { default: null } },
        parseDOM: [{ tag: 'section[data-locked]', getAttrs: (n) => ({ label: cleanLabel((n as HTMLElement).getAttribute('data-label')) }) }],
        toDOM: (n) => ['section', { class: 'wy-locked', 'data-locked': '', role: 'group', 'aria-label': n.attrs.label ?? 'Locked section', 'data-label': n.attrs.label ?? 'Locked' }, 0],
      },
      editable_region: {
        group: 'block',
        content: 'block+',
        defining: true,
        isolating: true,
        attrs: { label: { default: null } },
        parseDOM: [{ tag: 'div[data-editable-region]', getAttrs: (n) => ({ label: cleanLabel((n as HTMLElement).getAttribute('data-label')) }) }],
        toDOM: (n) => ['div', { class: 'wy-region', 'data-editable-region': '', role: 'group', 'aria-label': n.attrs.label ?? 'Fill in', 'data-label': n.attrs.label ?? 'Fill in' }, 0],
      },
    },
    setup(ed: Editor) {
      editor = ed;
      const safe = { readOnlySafe: true };
      const authorOnly = (fn: (e: Editor, ...a: any[]) => boolean) => (e: Editor, ...a: any[]) => (author ? fn(e, ...a) : false);
      const typeOf = (e: Editor, name: string) => e.schema.nodes[name];

      ed.registerCommand('setAuthorMode', (_e, on: boolean) => ((author = !!on), sync(), true), safe);
      ed.registerCommand('toggleAuthorMode', () => ((author = !author), sync(), true), safe);

      /** Wrap the top-level blocks touched by the selection in a locked section. */
      ed.registerCommand('lockBlocks', authorOnly((e, label?: string) => {
        const { state, dispatch } = e.view;
        const { $from, $to } = state.selection;
        if (lockedAncestor($from) !== null) return false; // already locked
        const start = state.doc.resolve($from.before(1));
        const end = state.doc.resolve($to.after(1));
        const range = start.blockRange(end);
        if (!range) return false;
        dispatch(state.tr.wrap(range, [{ type: typeOf(e, 'locked_section'), attrs: { label: cleanLabel(label) } }]).scrollIntoView());
        return true;
      }));
      ed.registerCommand('unlockBlocks', authorOnly((e) => {
        const { state, dispatch } = e.view;
        const pos = lockedAncestor(state.selection.$from);
        if (pos === null) return false;
        const node = state.doc.nodeAt(pos)!;
        dispatch(state.tr.replaceWith(pos, pos + node.nodeSize, node.content).scrollIntoView());
        return true;
      }));
      /** Wrap the blocks around the selection in a fill-in region. */
      ed.registerCommand('insertEditableRegion', authorOnly((e, label?: string) => {
        const { state, dispatch } = e.view;
        const { $from, $to } = state.selection;
        const range = $from.blockRange($to);
        if (!range) return false;
        if ($from.node(range.depth).type.name === 'editable_region') return false; // already inside one
        dispatch(state.tr.wrap(range, [{ type: typeOf(e, 'editable_region'), attrs: { label: cleanLabel(label) } }]).scrollIntoView());
        return true;
      }));
      ed.registerCommand('removeEditableRegion', authorOnly((e) => {
        const { state, dispatch } = e.view;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'editable_region') {
            dispatch(state.tr.replaceWith($from.before(d), $from.after(d), node.content).scrollIntoView());
            return true;
          }
        }
        return false;
      }));
      ed.registerCommand('setSectionLabel', authorOnly((e, label: string) => {
        const { state, dispatch } = e.view;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'locked_section' || node.type.name === 'editable_region') {
            dispatch(state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, label: cleanLabel(label) }));
            return true;
          }
        }
        return false;
      }));
      ed.extensions.restricted = { isAuthor: () => author };

      return [
        new Plugin({
          filterTransaction(tr: Transaction, _state: EditorState) {
            if (author || !tr.docChanged || BYPASS_META.some((m) => tr.getMeta(m))) return true;
            for (let i = 0; i < tr.steps.length; i++) {
              const doc = tr.docs[i]; // the document this step applies to
              for (const [from, to] of stepRanges(tr.steps[i])) {
                const bad = violation(doc, from, to);
                if (bad !== null) {
                  if (i === 0) flash(bad); // positions of later steps refer to a different document
                  return false;
                }
              }
            }
            return true;
          },
          view: () => ({ destroy: () => ((editor = null), void 0) }),
        }),
      ];
    },
    toolbar: [
      { name: 'authorMode', label: 'Template author mode', icon: 'T', command: 'toggleAuthorMode', isActive: () => author },
      { name: 'lockBlocks', label: 'Lock selected blocks', icon: '🔒', command: 'lockBlocks' },
      { name: 'unlockBlocks', label: 'Unlock section', icon: '🔓', command: 'unlockBlocks' },
      { name: 'editableRegion', label: 'Make a fill-in region', icon: '✎', command: 'insertEditableRegion' },
    ],
  };
}
