import { lift, setBlockType, wrapIn } from 'prosemirror-commands';
import type { EditorState } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

function hasAncestor(state: EditorState, name: string): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === name) return true;
  return false;
}

/** Block quote, code block and horizontal rule. */
export const Blocks: EditorPlugin = {
  name: 'blocks',
  nodes: {
    blockquote: { content: 'block+', group: 'block', defining: true, parseDOM: [{ tag: 'blockquote' }], toDOM: () => ['blockquote', 0] },
    code_block: {
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM: () => ['pre', ['code', 0]],
    },
    horizontal_rule: { group: 'block', parseDOM: [{ tag: 'hr' }], toDOM: () => ['hr'] },
  },
  setup(editor) {
    const { blockquote, code_block, paragraph, horizontal_rule } = editor.schema.nodes;
    editor.registerCommand('blockQuote', (e) =>
      hasAncestor(e.view.state, 'blockquote') ? lift(e.view.state, e.view.dispatch) : wrapIn(blockquote)(e.view.state, e.view.dispatch),
    );
    editor.registerCommand('codeBlock', (e) => {
      const isCode = e.view.state.selection.$from.parent.type === code_block;
      return setBlockType(isCode ? paragraph : code_block)(e.view.state, e.view.dispatch);
    });
    editor.registerCommand('horizontalRule', (e) => {
      const { state, dispatch } = e.view;
      dispatch(state.tr.replaceSelectionWith(horizontal_rule.create()).scrollIntoView());
      return true;
    });
  },
  toolbar: [
    { name: 'blockQuote', label: 'Block quote', icon: '❝', command: 'blockQuote', isActive: (s) => hasAncestor(s, 'blockquote') },
    { name: 'codeBlock', label: 'Code block', icon: '{ }', command: 'codeBlock', isActive: (s) => s.selection.$from.parent.type.name === 'code_block' },
    { name: 'horizontalRule', label: 'Horizontal line', icon: '―', command: 'horizontalRule' },
  ],
};
