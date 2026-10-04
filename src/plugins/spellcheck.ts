import { Plugin } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

export interface SpellCheckOptions { lang?: string; enabled?: boolean }

/** Browser spell check (red squiggles) with an on/off toggle and a language hint. */
export function SpellCheck(options: SpellCheckOptions = {}): EditorPlugin {
  let enabled = options.enabled ?? true;
  return {
    name: 'spellcheck',
    setup(editor) {
      editor.registerCommand('toggleSpellcheck', (e) => {
        enabled = !enabled;
        e.view.dispatch(e.view.state.tr.setMeta('addToHistory', false)); // re-evaluate props.attributes
        return true;
      });
      editor.registerCommand('setLanguage', (e, lang: string) => {
        options = { ...options, lang };
        e.view.dispatch(e.view.state.tr.setMeta('addToHistory', false));
        return true;
      });
      return [
        new Plugin({
          props: {
            attributes: () => ({ spellcheck: String(enabled), ...(options.lang ? { lang: options.lang } : {}) }),
          },
        }),
      ];
    },
    toolbar: [{ name: 'spellcheck', label: 'Toggle spell check', icon: 'abc✓', command: 'toggleSpellcheck', isActive: () => enabled }],
  };
}
