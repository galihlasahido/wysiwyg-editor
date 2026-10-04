import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

export interface MentionItem { id: string; label: string }

export interface MentionsOptions {
  /** Return suggestions for the text typed after the trigger. May be async (e.g. a server call). */
  search: (query: string) => MentionItem[] | Promise<MentionItem[]>;
  /** Default '@'. */
  trigger?: string;
  /** Maximum suggestions shown. Default 8. */
  limit?: number;
}

interface Active { from: number; to: number; query: string }

const key = new PluginKey<Active | null>('mentions');

/** @-mentions with a suggestion popup. Mentions are atomic inline nodes carrying an id. */
export function Mentions(options: MentionsOptions): EditorPlugin {
  const trigger = options.trigger ?? '@';
  const limit = options.limit ?? 8;
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\s)${escaped}([^\\s${escaped}]{0,30})$`);

  return {
    name: 'mentions',
    nodes: {
      mention: {
        inline: true,
        group: 'inline',
        atom: true,
        attrs: { id: {}, label: {} },
        parseDOM: [{ tag: 'span[data-mention-id]', getAttrs: (n) => ({ id: (n as HTMLElement).getAttribute('data-mention-id'), label: (n as HTMLElement).textContent?.replace(new RegExp(`^${escaped}`), '') ?? '' }) }],
        toDOM: (n) => ['span', { class: 'wy-mention', 'data-mention-id': n.attrs.id }, `${trigger}${n.attrs.label}`],
        leafText: (n) => `${trigger}${n.attrs.label}`,
      },
    },
    setup(editor) {
      let items: MentionItem[] = [];
      let index = 0;

      const insert = (item: MentionItem, range?: Active | null) => {
        const { state, dispatch } = editor.view;
        const r = range ?? key.getState(state);
        const node = state.schema.nodes.mention.create({ id: item.id, label: item.label });
        const { from, to } = r ?? { from: state.selection.from, to: state.selection.to };
        const tr = state.tr.replaceWith(from, to, [node, state.schema.text(' ')]);
        dispatch(tr.setSelection(TextSelection.create(tr.doc, from + node.nodeSize + 1)).scrollIntoView());
      };
      editor.registerCommand('insertMention', (_e, item: MentionItem) => (item?.id && item.label ? (insert(item), true) : false));

      return [
        new Plugin<Active | null>({
          key,
          state: {
            init: () => null,
            apply(tr, prev, _old, state) {
              if (tr.getMeta(key) === 'close') return null;
              if (!tr.docChanged && !tr.selectionSet) return prev;
              const { $from, empty } = state.selection;
              if (!empty || !$from.parent.isTextblock) return null;
              const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
              const m = re.exec(before);
              if (!m) return null;
              return { from: $from.pos - m[1].length - trigger.length, to: $from.pos, query: m[1] };
            },
          },
          props: {
            handleKeyDown(view, e) {
              const active = key.getState(view.state);
              if (!active || !items.length) return false;
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                view.dispatch(view.state.tr.setMeta('mentions-nav', index)); // refresh popup highlight
                return true;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                insert(items[index], active);
                return true;
              }
              if (e.key === 'Escape') {
                view.dispatch(view.state.tr.setMeta(key, 'close'));
                return true;
              }
              return false;
            },
          },
          view(view) {
            const popup = document.createElement('div');
            popup.className = 'wy-mention-popup';
            popup.setAttribute('role', 'listbox');
            popup.hidden = true;
            editor.root.append(popup);
            let seq = 0;
            let lastQuery: string | null = null;

            const draw = () => {
              popup.replaceChildren();
              items.forEach((it, i) => {
                const row = document.createElement('div');
                row.className = 'wy-mention-item' + (i === index ? ' is-active' : '');
                row.setAttribute('role', 'option');
                row.setAttribute('aria-selected', String(i === index));
                row.textContent = it.label;
                row.addEventListener('mousedown', (ev) => (ev.preventDefault(), insert(it)));
                popup.append(row);
              });
              popup.hidden = items.length === 0;
            };

            return {
              update(v) {
                const active = key.getState(v.state);
                if (!active) {
                  popup.hidden = true;
                  items = [];
                  lastQuery = null;
                  return;
                }
                if (active.query !== lastQuery) {
                  lastQuery = active.query;
                  const mine = ++seq;
                  Promise.resolve(options.search(active.query)).then((res) => {
                    if (mine !== seq) return; // a newer query superseded this one
                    items = res.slice(0, limit);
                    index = 0;
                    draw();
                  }, () => {
                    if (mine === seq) (items = [], draw());
                  });
                }
                const c = v.coordsAtPos(active.to);
                const box = editor.root.getBoundingClientRect();
                popup.style.left = `${c.left - box.left}px`;
                popup.style.top = `${c.bottom - box.top + 4}px`;
                draw();
              },
              destroy: () => popup.remove(),
            };
          },
        }),
      ];
    },
  };
}
