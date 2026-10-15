import { keymap } from 'prosemirror-keymap';
import { Plugin, type EditorState, type Transaction } from 'prosemirror-state';
import { addRowAfter, goToNextCell, isInTable } from 'prosemirror-tables';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

const inside = (state: EditorState, names: RegExp) => {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if (names.test($from.node(d).type.name)) return true;
  return false;
};

/**
 * The Tab key, as in Word: in a paragraph or heading it indents (Shift+Tab takes the indent back), in a table it moves to the next cell
 * (and adds a row after the last one), in a list it changes the level, in a code block it indents the code. Without this, Tab moves the
 * focus out of the editor, which is what a browser does with a key nobody handles.
 *
 * A key that never lets you leave would trap keyboard users, so **Escape, then Tab** moves the focus on: the Tab straight after an
 * Escape is left to the browser. Typing, clicking or any other key puts the Tab back to work. Leave this plugin out of `plugins` to keep
 * the browser's behaviour everywhere.
 */
export const TabKey: EditorPlugin = {
  name: 'tabKey',
  priority: -20, // after the lists, task lists and code blocks, which handle Tab inside themselves
  setup(editor: Editor) {
    let release = false;
    const run = (forward: boolean) => (state: EditorState, dispatch?: (tr: Transaction) => void): boolean => {
      if (editor.isReadOnly) return false;
      if (release) { release = false; return false; }          // Escape was pressed: let the focus move on
      if (isInTable(state)) {
        if (goToNextCell(forward ? 1 : -1)(state, dispatch)) return true;
        if (forward && addRowAfter(state, dispatch)) {            // the last cell: a new row, and into it (Word does the same)
          if (dispatch) goToNextCell(1)(editor.view.state, (tr) => editor.view.dispatch(tr));
          return true;
        }
        return true;
      }
      if (inside(state, /_list$|^list_item$|^task_item$/)) return true;   // the list's own Tab did what it can; do not leave the editor from inside a list
      const { $from } = state.selection;
      if (!$from.parent.isTextblock) return false;                         // a selected picture, a data table…: the browser's behaviour
      const command = forward ? 'indentMore' : 'indentLess';
      return editor.hasCommand(command) ? (editor.execute(command), true) : false;   // the indent commands come with the Office plugin
    };
    return [
      keymap({ Tab: run(true), 'Shift-Tab': run(false) }),
      new Plugin({
        props: {
          handleKeyDown(_view, event) {
            if (event.key === 'Escape') release = true;
            else if (event.key !== 'Tab' && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) release = false;
            return false;
          },
          handleDOMEvents: { mousedown: () => { release = false; return false; } },
        },
      }),
    ];
  },
};
