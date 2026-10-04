import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { EditorPlugin } from '../types';

/** Paragraphs, undo/redo, base keymap, cursors. */
export const Essentials: EditorPlugin = {
  name: 'essentials',
  nodes: {
    paragraph: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
  },
  setup(editor) {
    editor.registerCommand('undo', (e) => undo(e.view.state, e.view.dispatch));
    editor.registerCommand('redo', (e) => redo(e.view.state, e.view.dispatch));
    return [
      history(),
      keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo }),
      keymap(baseKeymap),
      dropCursor(),
      gapCursor(),
    ];
  },
  toolbar: [
    { name: 'undo', label: 'Undo', icon: '↶', command: 'undo' },
    { name: 'redo', label: 'Redo', icon: '↷', command: 'redo' },
  ],
};
