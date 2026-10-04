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
      attrs: { order: { default: 1 } },
      parseDOM: [{ tag: 'ol', getAttrs: (n) => ({ order: Number((n as HTMLElement).getAttribute('start') ?? 1) }) }],
      toDOM: (n) => (n.attrs.order === 1 ? ['ol', 0] : ['ol', { start: n.attrs.order }, 0]),
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
