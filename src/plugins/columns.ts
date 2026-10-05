import type { Node as PMNode } from 'prosemirror-model';
import { Selection, TextSelection } from 'prosemirror-state';
import { findWrapping } from 'prosemirror-transform';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

const clampCount = (n: unknown) => Math.min(4, Math.max(2, Math.round(Number(n)) || 2));
const RULES = ['none', 'solid'];

/**
 * Newspaper-style columns: a block that flows its content into 2–4 columns. `insertColumns` wraps the selected blocks (or adds an empty
 * block), `setColumns` changes the count, rule or gap, `removeColumns` unwraps. Word and Markdown export flow the content in one column.
 */
export function Columns(): EditorPlugin {
  return {
    name: 'columns',
    nodes: {
      columns: {
        group: 'block',
        content: 'block+',
        defining: true,
        isolating: true,
        attrs: { count: { default: 2 }, rule: { default: 'none' }, gap: { default: 28 } },
        parseDOM: [{
          tag: 'div[data-columns]',
          getAttrs: (d) => {
            const el = d as HTMLElement;
            return { count: clampCount(el.getAttribute('data-columns')), rule: RULES.includes(el.getAttribute('data-rule') ?? '') ? el.getAttribute('data-rule') : 'none', gap: Math.min(80, Math.max(8, Number(el.getAttribute('data-gap')) || 28)) };
          },
        }],
        toDOM: (n: PMNode) => ['div', { class: `wy-columns${n.attrs.rule === 'solid' ? ' has-rule' : ''}`, 'data-columns': String(n.attrs.count), 'data-rule': n.attrs.rule, 'data-gap': String(n.attrs.gap), style: `column-count:${n.attrs.count};column-gap:${n.attrs.gap}px` }, 0],
      },
    },
    setup(editor: Editor) {
      const find = (state = editor.view.state) => {
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'columns') return { node: $from.node(d), pos: $from.before(d) };
        return null;
      };
      editor.registerCommand('insertColumns', (e, count = 2) => {
        const { state, dispatch } = e.view;
        const type = state.schema.nodes.columns;
        const attrs = { count: clampCount(count) };
        const { $from, $to } = state.selection;
        const range = $from.blockRange($to);
        const wrap = range && findWrapping(range, type, attrs);
        if (range && wrap) {
          dispatch(state.tr.wrap(range, wrap).scrollIntoView());
          return true;
        }
        const node = type.createAndFill(attrs)!;
        const tr = state.tr.replaceSelectionWith(node, false);
        dispatch(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(tr.doc.content.size, state.selection.from + 2)))).scrollIntoView());
        return true;
      });
      editor.registerCommand('setColumns', (e, patch: { count?: number; rule?: string; gap?: number }) => {
        const f = find();
        if (!f) return false;
        const a = f.node.attrs;
        const next = {
          count: patch.count === undefined ? a.count : clampCount(patch.count),
          rule: patch.rule === undefined ? a.rule : RULES.includes(patch.rule) ? patch.rule : a.rule,
          gap: patch.gap === undefined ? a.gap : Math.min(80, Math.max(8, Math.round(Number(patch.gap)) || a.gap)),
        };
        e.view.dispatch(e.view.state.tr.setNodeMarkup(f.pos, undefined, next));
        return true;
      });
      editor.registerCommand('removeColumns', (e) => {
        const f = find();
        if (!f) return false;
        const { state, dispatch } = e.view;
        const tr = state.tr.replaceWith(f.pos, f.pos + f.node.nodeSize, f.node.content);
        dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(f.pos + 1, tr.doc.content.size)))).scrollIntoView());
        return true;
      });
      return [];
    },
    toolbar: [
      { name: 'columns2', label: 'Two columns', icon: '▥', command: 'insertColumns', args: [2] },
      { name: 'columns3', label: 'Three columns', icon: '☷', command: 'insertColumns', args: [3] },
      { name: 'columnsRemove', label: 'Remove columns', icon: '▭', command: 'removeColumns' },
    ],
  };
}
