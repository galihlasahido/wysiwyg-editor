import { Plugin, PluginKey } from 'prosemirror-state';
import type { Editor } from '../editor';
import { hasIcon, icon } from '../icons';
import type { EditorPlugin } from '../types';

export interface SlashCommand {
  id: string;
  label: string;
  /** Extra words that also match, e.g. "h1 title". */
  keywords?: string;
  icon?: string;
  command: string;
  args?: unknown[];
}

export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { id: 'h1', label: 'Heading 1', keywords: 'title h1', icon: 'bold', command: 'heading', args: ['1'] },
  { id: 'h2', label: 'Heading 2', keywords: 'subtitle h2', icon: 'bold', command: 'heading', args: ['2'] },
  { id: 'h3', label: 'Heading 3', keywords: 'h3', icon: 'bold', command: 'heading', args: ['3'] },
  { id: 'p', label: 'Paragraph', keywords: 'text normal', icon: 'align-left', command: 'heading', args: ['paragraph'] },
  { id: 'ul', label: 'Bulleted list', keywords: 'bullets unordered', icon: 'bulletList', command: 'bulletList' },
  { id: 'ol', label: 'Numbered list', keywords: 'ordered', icon: 'orderedList', command: 'orderedList' },
  { id: 'todo', label: 'To-do list', keywords: 'checklist task checkbox', icon: 'taskList', command: 'taskList' },
  { id: 'quote', label: 'Quote', keywords: 'blockquote', icon: 'blockQuote', command: 'blockQuote' },
  { id: 'code', label: 'Code block', keywords: 'pre snippet', icon: 'codeBlock', command: 'codeBlock' },
  { id: 'hr', label: 'Divider', keywords: 'line rule separator', icon: 'horizontalRule', command: 'horizontalRule' },
  { id: 'table', label: 'Table', keywords: 'grid', icon: 'insertTable', command: 'insertTable', args: [3, 3] },
  { id: 'image', label: 'Image from URL', keywords: 'picture photo', icon: 'image', command: 'image' },
  { id: 'toc', label: 'Table of contents', keywords: 'outline', icon: 'toc', command: 'insertToc' },
  { id: 'break', label: 'Page break', keywords: 'new page', icon: 'pageBreak', command: 'pageBreak' },
];

interface Active { from: number; to: number; query: string }
const key = new PluginKey<Active | null>('slash');
const re = /^\/([\w-]{0,24})$/;

/**
 * Type "/" at the start of a block to open a searchable block menu. Entries whose command is not available
 * (plugin not installed) are left out.
 */
export function SlashCommands(commands: SlashCommand[] = DEFAULT_SLASH_COMMANDS): EditorPlugin {
  return {
    name: 'slash-commands',
    setup(editor: Editor) {
      let items: SlashCommand[] = [];
      let index = 0;

      const run = (cmd: SlashCommand, range: Active) => {
        const { state, dispatch } = editor.view;
        dispatch(state.tr.delete(range.from, range.to)); // remove "/query" first, so the command acts on a clean block
        editor.execute(cmd.command, ...(cmd.args ?? []));
      };

      return [
        new Plugin<Active | null>({
          key,
          state: {
            init: () => null,
            apply(tr, prev, _o, state) {
              if (tr.getMeta(key) === 'close') return null;
              if (!tr.docChanged && !tr.selectionSet) return prev;
              const { $from, empty } = state.selection;
              if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
              const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
              const m = re.exec(before);
              return m ? { from: $from.start(), to: $from.pos, query: m[1] } : null;
            },
          },
          props: {
            handleKeyDown(view, e) {
              const active = key.getState(view.state);
              if (!active || !items.length) return false;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                view.dispatch(view.state.tr.setMeta('slash-nav', index));
                return true;
              }
              if (e.key === 'Enter' || e.key === 'Tab') return (run(items[index], active), true);
              if (e.key === 'Escape') return (view.dispatch(view.state.tr.setMeta(key, 'close')), true);
              return false;
            },
          },
          view(view) {
            const menu = document.createElement('div');
            menu.className = 'wy-slash-menu wy-mention-popup';
            menu.setAttribute('role', 'listbox');
            menu.hidden = true;
            editor.root.append(menu);
            let lastQuery: string | null = null;

            const draw = () => {
              menu.replaceChildren();
              items.forEach((it, i) => {
                const row = document.createElement('div');
                row.className = 'wy-mention-item wy-slash-item' + (i === index ? ' is-active' : '');
                row.setAttribute('role', 'option');
                row.setAttribute('aria-selected', String(i === index));
                if (it.icon && hasIcon(it.icon)) row.insertAdjacentHTML('beforeend', icon(it.icon, 16));
                const t = document.createElement('span');
                t.textContent = it.label;
                row.append(t);
                row.addEventListener('mousedown', (ev) => {
                  ev.preventDefault();
                  const a = key.getState(view.state);
                  if (a) run(it, a);
                });
                menu.append(row);
              });
              menu.hidden = items.length === 0;
            };

            return {
              update(v) {
                const active = key.getState(v.state);
                if (!active) {
                  menu.hidden = true;
                  items = [];
                  lastQuery = null;
                  return;
                }
                if (active.query !== lastQuery) {
                  lastQuery = active.query;
                  const q = active.query.toLowerCase();
                  items = commands
                    .filter((c) => editor.hasCommand(c.command))
                    .filter((c) => !q || `${c.label} ${c.keywords ?? ''}`.toLowerCase().includes(q))
                    .slice(0, 8);
                  index = 0;
                }
                try {
                  const c = v.coordsAtPos(active.to);
                  const box = editor.root.getBoundingClientRect();
                  menu.style.left = `${c.left - box.left}px`;
                  menu.style.top = `${c.bottom - box.top + 4}px`;
                } catch {
                  /* no layout */
                }
                draw();
              },
              destroy: () => menu.remove(),
            };
          },
        }),
      ];
    },
  };
}
