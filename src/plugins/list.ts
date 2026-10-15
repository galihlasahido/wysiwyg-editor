import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import type { EditorState } from 'prosemirror-state';
import type { ContextMenuEntry, EditorPlugin } from '../types';

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
    list_item: { content: 'listLead block*', defining: true, parseDOM: [{ tag: 'li' }], toDOM: () => ['li', 0] },
  },
  setup(editor) {
    const { bullet_list, ordered_list, list_item } = editor.schema.nodes;
    const toggle = (type: typeof bullet_list) => (e: typeof editor) => {
      const { state, dispatch } = e.view;
      if (inList(state, type.name)) return liftListItem(list_item)(state, dispatch);
      return wrapInList(type)(state, dispatch);
    };
    /** The nearest list around the selection, whatever its kind. */
    const nearestList = (state: EditorState) => {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d);
        if (n.type === bullet_list || n.type === ordered_list) return { node: n, pos: $from.before(d) };
      }
      return null;
    };
    /** Bulleted or numbered: inside a list of the other kind it converts the list, inside the same kind it removes the list, elsewhere it makes one. */
    const setList = (type: typeof bullet_list) => (e: typeof editor) => {
      const { state, dispatch } = e.view;
      const list = nearestList(state);
      if (list && list.node.type !== type) { dispatch(state.tr.setNodeMarkup(list.pos, type, type === ordered_list ? { order: 1, type: '1' } : null)); return true; }
      return toggle(type)(e);
    };
    editor.registerCommand('bulletList', setList(bullet_list));
    editor.registerCommand('orderedList', setList(ordered_list));
    /** Numbering style of the numbered list around the cursor: 1, a, A, i or I. */
    editor.registerCommand('listStyle', (e, kind: string) => {
      const list = nearestList(e.view.state);
      if (!list || list.node.type !== ordered_list || !['1', 'a', 'A', 'i', 'I'].includes(kind)) return false;
      e.view.dispatch(e.view.state.tr.setNodeMarkup(list.pos, undefined, { ...list.node.attrs, type: kind }));
      return true;
    });
    editor.registerCommand('restartNumbering', (e) => {
      const list = nearestList(e.view.state);
      if (!list || list.node.type !== ordered_list || list.node.attrs.order === 1) return false;
      e.view.dispatch(e.view.state.tr.setNodeMarkup(list.pos, undefined, { ...list.node.attrs, order: 1 }));
      return true;
    });
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
  contextMenuOrder: 10,
  contextMenu({ editor, closest, readonly }) {
    const bullet = closest('bullet_list');
    const ordered = closest('ordered_list');
    const task = closest('task_list');
    if (readonly || (!bullet && !ordered && !task)) return [];
    const kind = (ordered ? ordered : null)?.node.attrs.type ?? '1';
    const items: ContextMenuEntry[] = [
      { label: 'Bulleted list', command: 'bulletList', checked: !!bullet, icon: '•' },
      { label: 'Numbered list', command: 'orderedList', checked: !!ordered, icon: '1.' },
      ...(editor.hasCommand('taskList') ? [{ label: 'Checklist', command: 'taskList', checked: !!task, icon: '☑' } as ContextMenuEntry] : []),
      '-',
      { label: 'Increase indent', command: 'indent', icon: '⇥' },
      { label: 'Decrease indent', command: 'outdent', icon: '⇤' },
    ];
    if (ordered) {
      items.push('-', {
        label: 'Numbering style',
        items: [['1', '1, 2, 3'], ['a', 'a, b, c'], ['A', 'A, B, C'], ['i', 'i, ii, iii'], ['I', 'I, II, III']].map(([v, label]) => ({ label, command: 'listStyle', args: [v], checked: kind === v })),
      }, { label: 'Restart numbering at 1', command: 'restartNumbering', disabled: ordered.node.attrs.order === 1 });
    }
    return items;
  },
  toolbar: [
    { name: 'bulletList', label: 'Bulleted list', icon: '• ≡', command: 'bulletList', isActive: (s) => inList(s, 'bullet_list') },
    { name: 'orderedList', label: 'Numbered list', icon: '1. ≡', command: 'orderedList', isActive: (s) => inList(s, 'ordered_list') },
    { name: 'outdent', label: 'Decrease indent', icon: '⇤', command: 'outdent' },
    { name: 'indent', label: 'Increase indent', icon: '⇥', command: 'indent' },
  ],
};
