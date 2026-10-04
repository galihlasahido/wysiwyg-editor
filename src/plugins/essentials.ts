import { baseKeymap } from 'prosemirror-commands';
import { dropCursor } from 'prosemirror-dropcursor';
import { gapCursor } from 'prosemirror-gapcursor';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { EditorPlugin } from '../types';
import { blockAttrDefs, blockAttrs, blockDOM } from './helpers';

/** Paragraphs, undo/redo, base keymap, cursors. */
export const Essentials: EditorPlugin = {
  name: 'essentials',
  priority: -100, // base keymap must be the fallback, after every other plugin's keys
  nodes: {
    paragraph: {
      content: 'inline*',
      group: 'block',
      attrs: blockAttrDefs(),
      parseDOM: [{ tag: 'p', getAttrs: blockAttrs }],
      toDOM: (n) => ['p', blockDOM(n.attrs), 0],
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
    // With collaboration, Yjs owns undo/redo (per-user), so ProseMirror's history must not be installed.
    const collab = editor.config.plugins.some((p) => p.name === 'collaboration');
    if (!collab) {
      editor.registerCommand('undo', (e) => undo(e.view.state, e.view.dispatch));
      editor.registerCommand('redo', (e) => redo(e.view.state, e.view.dispatch));
    }
    return [
      ...(collab ? [] : [history(), keymap({ 'Mod-z': undo, 'Mod-y': redo, 'Shift-Mod-z': redo })]),
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
