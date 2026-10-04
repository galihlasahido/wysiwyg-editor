import { Fragment, type Mark, type MarkType, type Node as PMNode, Slice } from 'prosemirror-model';
import { TextSelection, type Transaction, type EditorState } from 'prosemirror-state';
import { ReplaceStep } from 'prosemirror-transform';
import type { EditorPlugin } from '../types';

export interface Change { type: 'insertion' | 'deletion'; from: number; to: number; author: string; date: number; text: string }

export function getChanges(doc: PMNode, from = 0, to = doc.content.size): Change[] {
  const out: Change[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isInline) return;
    for (const m of node.marks) {
      if (m.type.name !== 'insertion' && m.type.name !== 'deletion') continue;
      const start = Math.max(pos, from);
      const end = Math.min(pos + node.nodeSize, to);
      const last = out[out.length - 1];
      if (last && last.type === m.type.name && last.to === start && last.author === m.attrs.author) {
        last.to = end;
        last.text += node.isText ? node.text!.slice(start - pos, end - pos) : '';
      } else {
        out.push({ type: m.type.name as Change['type'], from: start, to: end, author: m.attrs.author, date: m.attrs.date, text: node.isText ? node.text!.slice(start - pos, end - pos) : '' });
      }
    }
  });
  return out;
}

const attrs = { author: { default: 'Anonymous' }, date: { default: 0 } };
const markSpec = (tag: 'ins' | 'del', inclusive: boolean) => ({
  attrs,
  inclusive,
  parseDOM: [{ tag: `${tag}[data-author]`, getAttrs: (n: HTMLElement | string) => ({ author: (n as HTMLElement).getAttribute('data-author'), date: Number((n as HTMLElement).getAttribute('data-date')) || 0 }) }],
  toDOM: (m: Mark) => [tag, { class: tag === 'ins' ? 'wy-ins' : 'wy-del', 'data-author': m.attrs.author, 'data-date': String(m.attrs.date), title: `${m.attrs.author}${m.attrs.date ? ' · ' + new Date(m.attrs.date).toLocaleString() : ''}` }, 0] as const,
});

export interface TrackChangesOptions { author?: string; enabled?: boolean }

/**
 * Suggesting mode. While on, typing becomes an insertion mark and deleting becomes a deletion mark
 * instead of removing text. Limitation: only inline edits inside one paragraph are tracked; structural
 * edits (splitting/joining blocks, tables) are applied normally.
 */
export function TrackChanges(options: TrackChangesOptions = {}): EditorPlugin {
  let enabled = options.enabled ?? false;
  const author = options.author ?? 'Anonymous';

  const transform = (tr: Transaction, state: EditorState): Transaction => {
    if (!enabled || !tr.docChanged || tr.steps.length !== 1) return tr;
    const step = tr.steps[0];
    if (!(step instanceof ReplaceStep)) return tr;
    const { from, to, slice } = step as ReplaceStep & { from: number; to: number; slice: Slice };
    const ins = state.schema.marks.insertion as MarkType;
    const del = state.schema.marks.deletion as MarkType;
    const inlineOnly = slice.openStart === 0 && slice.openEnd === 0 && slice.content.content.every((n) => n.isInline);
    if (!inlineOnly) return tr;
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    if (from < to && !($from.sameParent($to) && $from.parent.inlineContent)) return tr;
    if (from === to && !$from.parent.inlineContent) return tr;

    const date = Date.now();
    const out = state.tr;
    // 1. Deletions: mark text as deleted, or really remove it when it is the author's own insertion.
    const realDeletes: [number, number][] = [];
    let allAlreadyDeleted = from < to;
    if (from < to) {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return;
        const a = Math.max(pos, from);
        const b = Math.min(pos + node.nodeSize, to);
        if (node.marks.some((m) => m.type === del)) return;
        allAlreadyDeleted = false;
        if (node.marks.some((m) => m.type === ins && m.attrs.author === author)) realDeletes.push([a, b]);
        else out.addMark(a, b, del.create({ author, date }));
      });
    }
    for (const [a, b] of realDeletes.reverse()) out.delete(a, b);
    // 2. Insertion goes after the (still present) deleted text.
    let cursor = out.mapping.map(to, 1);
    if (slice.size > 0) {
      const mark = ins.create({ author, date });
      const marked = Fragment.fromArray(slice.content.content.map((n) => n.mark(mark.addToSet(n.marks))));
      out.insert(cursor, marked);
      cursor += slice.size;
    } else if (from < to) {
      // Backspace (caret at `to`) moves left over the marked text; forward delete (caret at `from`) moves right.
      const head = state.selection.head;
      cursor = allAlreadyDeleted || realDeletes.length === 0 ? (head === to ? out.mapping.map(from) : out.mapping.map(to, 1)) : out.mapping.map(from);
    }
    out.setSelection(TextSelection.create(out.doc, Math.min(cursor, out.doc.content.size)));
    for (const key of ['addToHistory', 'paste', 'uiEvent'] as const) {
      const v = tr.getMeta(key);
      if (v !== undefined) out.setMeta(key, v);
    }
    if (tr.scrolledIntoView) out.scrollIntoView();
    return out;
  };

  return {
    name: 'track-changes',
    marks: { insertion: markSpec('ins', true), deletion: markSpec('del', false) },
    transformTransaction: transform,
    setup(editor) {
      const resolve = (e: typeof editor, accept: boolean, scope: 'selection' | 'all') => {
        const { state, dispatch } = e.view;
        const { from, to } = state.selection;
        const changes = scope === 'all' ? getChanges(state.doc) : getChanges(state.doc, from === to ? from : from, from === to ? to + 1 : to).filter((c) => from === to ? c.from <= from && c.to >= from : true);
        if (!changes.length) return false;
        const tr = state.tr.setMeta('wy-raw', true);
        const removals: [number, number][] = [];
        for (const c of changes) {
          const keepText = (c.type === 'insertion') === accept; // accept insertion / reject deletion keep the text
          if (keepText) tr.removeMark(c.from, c.to, state.schema.marks[c.type]);
          else removals.push([c.from, c.to]);
        }
        for (const [a, b] of removals.sort((x, y) => y[0] - x[0])) tr.delete(a, b);
        dispatch(tr);
        return true;
      };
      editor.registerCommand('toggleTracking', () => ((enabled = !enabled), editor.view.dispatch(editor.view.state.tr.setMeta('addToHistory', false)), true));
      editor.registerCommand('setTracking', (_e, on: boolean) => ((enabled = !!on), editor.view.dispatch(editor.view.state.tr.setMeta('addToHistory', false)), true));
      editor.registerCommand('acceptChange', (e) => resolve(e, true, 'selection'));
      editor.registerCommand('rejectChange', (e) => resolve(e, false, 'selection'));
      editor.registerCommand('acceptAll', (e) => resolve(e, true, 'all'));
      editor.registerCommand('rejectAll', (e) => resolve(e, false, 'all'));
    },
    toolbar: [
      { name: 'trackChanges', label: 'Suggesting mode', icon: '✎', command: 'toggleTracking', isActive: () => enabled },
      { name: 'acceptAll', label: 'Accept all changes', icon: '✔all', command: 'acceptAll' },
      { name: 'rejectAll', label: 'Reject all changes', icon: '✘all', command: 'rejectAll' },
    ],
  };
}
