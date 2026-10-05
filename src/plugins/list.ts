import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import type { EditorState } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

function inList(state: EditorState, name: string): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === name) return true;
  return false;
}

export const List: EditorPlugin = {
  name: 'list',
  nodes: {
    bullet_list: { content: 'list_item+', group: 'block', parseDOM: [{ tag: 'ul' }], toDOM: () => ['ul', 0] },
    ordered_list: {
      content: 'list_item+',
      group: 'block',
      // `type` is how the numbers look: 1, a, A, i or I (the HTML <ol type>). Word lists often use a. b. c. and i. ii. iii.
      attrs: { order: { default: 1 }, type: { default: '1' } },
      parseDOM: [{ tag: 'ol', getAttrs: (n) => {
        const el = n as HTMLElement;
        const start = Number(el.getAttribute('start') ?? 1);
        const type = el.getAttribute('type') ?? '1';
        return { order: Number.isFinite(start) && start >= 0 && start < 100000 ? Math.round(start) : 1, type: ['1', 'a', 'A', 'i', 'I'].includes(type) ? type : '1' };
      } }],
      toDOM: (n) => ['ol', { ...(n.attrs.order === 1 ? {} : { start: n.attrs.order }), ...(n.attrs.type === '1' ? {} : { type: n.attrs.type }) }, 0],
    },
    list_item: { content: 'paragraph block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
  },
  setup(editor) {
    const { bullet_list, ordered_list, list_item } = editor.schema.nodes;
    const toggle = (type: typeof bullet_list) => (e: typeof editor) => {
      const { state, dispatch } = e.view;
      if (inList(state, type.name)) return liftListItem(list_item)(state, dispatch);
      return wrapInList(type)(state, dispatch);
    };
    editor.registerCommand('bulletList', toggle(bullet_list));
    editor.registerCommand('orderedList', toggle(ordered_list));
    editor.registerCommand('indent', (e) => sinkListItem(list_item)(e.view.state, e.view.dispatch));
    editor.registerCommand('outdent', (e) => liftListItem(list_item)(e.view.state, e.view.dispatch));
    return [
      keymap({
        Enter: splitListItem(list_item),
        Tab: sinkListItem(list_item),
        'Shift-Tab': liftListItem(list_item),
      }),
    ];
  },
  toolbar: [
    { name: 'bulletList', label: 'Bulleted list', icon: '• ≡', command: 'bulletList', isActive: (s) => inList(s, 'bullet_list') },
    { name: 'orderedList', label: 'Numbered list', icon: '1. ≡', command: 'orderedList', isActive: (s) => inList(s, 'ordered_list') },
    { name: 'outdent', label: 'Decrease indent', icon: '⇤', command: 'outdent' },
    { name: 'indent', label: 'Increase indent', icon: '⇥', command: 'indent' },
  ],
};
