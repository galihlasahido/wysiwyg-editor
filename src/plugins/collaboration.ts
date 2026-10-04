import { keymap } from 'prosemirror-keymap';
import { redoCommand, undoCommand, yCursorPlugin, ySyncPlugin, yUndoPlugin, yUndoPluginKey } from 'y-prosemirror';
import { Plugin } from 'prosemirror-state';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';
import type { EditorPlugin } from '../types';

export interface CollaborationOptions {
  ydoc: Y.Doc;
  /** Name of the shared XML fragment holding the document. Default 'prosemirror'. */
  field?: string;
  /** Pass an Awareness to show remote cursors and selections. */
  awareness?: Awareness;
  user?: { name: string; color: string };
  /**
   * HTML to put in the shared document if it is empty when the editor is created. With a network
   * provider, only enable this on the client that creates the document, or wait until it has synced.
   */
  seed?: string;
}

/** Real-time co-editing over Yjs. Undo/redo become per-user (they only undo your own changes). */
export function Collaboration(options: CollaborationOptions): EditorPlugin {
  const fragment = options.ydoc.getXmlFragment(options.field ?? 'prosemirror');
  return {
    name: 'collaboration',
    setup(editor) {
      options.awareness?.setLocalStateField('user', options.user ?? { name: 'Anonymous', color: '#2563eb' });
      editor.registerCommand('undo', (e) => undoCommand(e.view.state, e.view.dispatch) !== false);
      editor.registerCommand('redo', (e) => redoCommand(e.view.state, e.view.dispatch) !== false);
      return [
        ySyncPlugin(fragment),
        yUndoPlugin(),
        keymap({ 'Mod-z': undoCommand, 'Mod-y': redoCommand, 'Shift-Mod-z': redoCommand }),
        ...(options.awareness ? [yCursorPlugin(options.awareness)] : []),
        new Plugin({
          view() {
            if (options.seed && fragment.length === 0) {
              setTimeout(() => {
                if (fragment.length !== 0) return;
                editor.replaceHTML(options.seed!);
                // The initial content must not be undoable.
                yUndoPluginKey.getState(editor.view.state)?.undoManager.clear();
              }, 0);
            }
            return {};
          },
        }),
      ];
    },
  };
}
