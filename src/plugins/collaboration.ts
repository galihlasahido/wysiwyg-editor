import { keymap } from 'prosemirror-keymap';
import { redoCommand, relativePositionToAbsolutePosition, undoCommand, yCursorPlugin, ySyncPlugin, ySyncPluginKey, yUndoPlugin, yUndoPluginKey } from 'y-prosemirror';
import { createRelativePositionFromJSON } from 'yjs';
import { avatar } from '../dialog';
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
  /**
   * Show who is in the document: a row of avatars (needs `awareness`). Click one to scroll to where that person is working.
   * Default true when `awareness` is given.
   */
  presence?: boolean;
}

/** Real-time co-editing over Yjs. Undo/redo become per-user (they only undo your own changes). */
export function Collaboration(options: CollaborationOptions): EditorPlugin & { ydoc: Y.Doc } {
  const fragment = options.ydoc.getXmlFragment(options.field ?? 'prosemirror');
  return {
    name: 'collaboration',
    ydoc: options.ydoc, // lets the Comments plugin share its threads through the same document
    setup(editor) {
      options.awareness?.setLocalStateField('user', options.user ?? { name: 'Anonymous', color: '#2563eb' });
      editor.registerCommand('undo', (e) => undoCommand(e.view.state, e.view.dispatch) !== false);
      editor.registerCommand('redo', (e) => redoCommand(e.view.state, e.view.dispatch) !== false);
      return [
        ySyncPlugin(fragment),
        yUndoPlugin(),
        keymap({ 'Mod-z': undoCommand, 'Mod-y': redoCommand, 'Shift-Mod-z': redoCommand }),
        ...(options.awareness ? [yCursorPlugin(options.awareness)] : []),
        ...(options.awareness && options.presence !== false ? [presenceView(editor, options.awareness)] : []),
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


interface PeerState { user?: { name?: string; color?: string }; cursor?: { head?: unknown } | null }

/** The "who is here" bar: one avatar per connected person, kept current from the awareness states. */
function presenceView(editor: import('../editor').Editor, awareness: Awareness): Plugin {
  return new Plugin({
    view(view) {
      const bar = document.createElement('div');
      bar.className = 'wy-presence';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', editor.t('presence', 'People in this document'));
      editor.root.insertBefore(bar, editor.body);

      /** Scroll to a person's cursor. Their position is a Yjs relative position; map it into this document first. */
      const jump = (clientId: number) => {
        const state = awareness.getStates().get(clientId) as PeerState | undefined;
        const head = state?.cursor?.head;
        const sync = ySyncPluginKey.getState(view.state);
        if (!head || !sync) return;
        try {
          const pos = relativePositionToAbsolutePosition(sync.doc, sync.type, createRelativePositionFromJSON(head as never), sync.binding.mapping);
          if (pos === null) return;
          const at = view.domAtPos(Math.min(pos, view.state.doc.content.size));
          const el = (at.node.nodeType === 1 ? at.node : at.node.parentElement) as HTMLElement | null;
          el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
          el?.classList.add('wy-peer-flash');
          setTimeout(() => el?.classList.remove('wy-peer-flash'), 1200);
        } catch { /* the cursor points into text this editor has not received yet */ }
      };

      const render = () => {
        const people: { id: number; name: string; color: string; me: boolean; has: boolean }[] = [];
        awareness.getStates().forEach((s, id) => {
          const st = s as PeerState;
          if (!st.user?.name) return;
          people.push({ id, name: st.user.name, color: st.user.color ?? '#2563eb', me: id === awareness.clientID, has: !!st.cursor?.head });
        });
        people.sort((a, b) => Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
        bar.replaceChildren(...people.map((p) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = `wy-peer${p.me ? ' is-me' : ''}`;
          b.title = p.me ? `${p.name} (you)` : p.has ? `${p.name}: go to their cursor` : p.name;
          b.setAttribute('aria-label', b.title);
          b.disabled = p.me || !p.has;
          const a = avatar(p.name, 26);
          a.style.background = p.color;
          a.style.boxShadow = `0 0 0 2px var(--wy-bg, #fff), 0 0 0 4px ${p.color}`;
          b.append(a);
          b.addEventListener('click', () => jump(p.id));
          return b;
        }));
        bar.hidden = people.length < 2; // alone in the document: nothing to show
        const count = people.length;
        bar.dataset.count = String(count);
      };
      awareness.on('change', render);
      render();
      return { destroy: () => { awareness.off('change', render); bar.remove(); } };
    },
  });
}
