import { keymap } from 'prosemirror-keymap';
import { liftListItem, sinkListItem, splitListItem, wrapInList } from 'prosemirror-schema-list';
import { Plugin } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

/** Checklist. Items render as `<li data-task data-checked>`; the checkbox is drawn with CSS. */
export const TaskList: EditorPlugin = {
  name: 'task-list',
  nodes: {
    task_list: { content: 'task_item+', group: 'block', parseDOM: [{ tag: 'ul[data-task-list]' }], toDOM: () => ['ul', { 'data-task-list': '' }, 0] },
    task_item: {
      content: 'paragraph block*',
      defining: true,
      attrs: { checked: { default: false } },
      parseDOM: [{ tag: 'li[data-task]', getAttrs: (n) => ({ checked: (n as HTMLElement).getAttribute('data-checked') === 'true' }) }],
      toDOM: (n) => ['li', { 'data-task': '', 'data-checked': String(n.attrs.checked) }, 0],
    },
  },
  setup(editor) {
    const { task_list, task_item } = editor.schema.nodes;
    editor.registerCommand('taskList', (e) => {
      const { state, dispatch } = e.view;
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === task_item) return liftListItem(task_item)(state, dispatch);
      return wrapInList(task_list)(state, dispatch);
    });
    return [
      keymap({ Enter: splitListItem(task_item), Tab: sinkListItem(task_item), 'Shift-Tab': liftListItem(task_item) }),
      new Plugin({
        props: {
          handleClickOn(view, _pos, node, nodePos, event) {
            if (node.type !== task_item) return false;
            const li = view.nodeDOM(nodePos) as HTMLElement | null;
            if (!li || event.clientX - li.getBoundingClientRect().left > 24) return false;
            view.dispatch(view.state.tr.setNodeMarkup(nodePos, undefined, { checked: !node.attrs.checked }));
            return true;
          },
        },
      }),
    ];
  },
  toolbar: [
    { name: 'taskList', label: 'Checklist', icon: '☑', command: 'taskList', isActive: (s) => { const { $from } = s.selection; for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'task_item') return true; return false; } },
  ],
};
