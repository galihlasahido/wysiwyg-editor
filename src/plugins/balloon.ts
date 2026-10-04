import { Plugin } from 'prosemirror-state';
import type { Editor } from '../editor';
import { hasIcon, icon } from '../icons';
import type { EditorPlugin, ToolbarItem } from '../types';

export interface BalloonOptions {
  /** Toolbar item names to show, in order ('|' for a separator). */
  items?: string[];
}

const DEFAULT_ITEMS = ['bold', 'italic', 'underline', '|', 'link', 'heading', '|', 'bulletList', 'orderedList', '|', 'comment'];

/**
 * A small toolbar that floats above the selection, for "inline" and "balloon" editors. It appears when text is
 * selected and the editor has focus, and hides itself when the selection collapses or focus leaves.
 */
export function BalloonToolbar(options: BalloonOptions = {}): EditorPlugin {
  return {
    name: 'balloon',
    setup(editor: Editor) {
      const items = new Map<string, ToolbarItem>();
      for (const p of editor.config.plugins) for (const i of p.toolbar ?? []) items.set(i.name, i);
      let refresh = () => {};

      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              focus: () => (setTimeout(refresh), false),
              blur: () => (setTimeout(refresh, 0), false),
            },
          },
          view(view) {
            const bar = document.createElement('div');
            bar.className = 'wy-balloon';
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', editor.t('balloon', 'Formatting'));
            bar.hidden = true;
            const updaters: (() => void)[] = [];
            for (const name of options.items ?? DEFAULT_ITEMS) {
              if (name === '|') {
                const sep = document.createElement('span');
                sep.className = 'wy-sep';
                bar.append(sep);
                continue;
              }
              const item = items.get(name);
              if (!item || item.type === 'separator') continue;
              if (item.type === 'select') {
                const sel = document.createElement('select');
                sel.className = 'wy-select';
                const label = editor.t(item.name, item.label);
                sel.title = label;
                sel.setAttribute('aria-label', label);
                for (const o of item.options) sel.add(new Option(editor.t(`${item.name}.${o.value}`, o.label), o.value));
                sel.addEventListener('change', () => editor.execute(item.command, sel.value));
                updaters.push(() => (sel.value = item.getValue(view.state)));
                bar.append(sel);
                continue;
              }
              const btn = document.createElement('button');
              btn.type = 'button';
              btn.className = 'wy-btn';
              const label = editor.t(item.name, item.label);
              btn.title = label;
              btn.setAttribute('aria-label', label);
              if (hasIcon(item.name)) btn.innerHTML = icon(item.name, 16);
              else if (item.icon) btn.innerHTML = item.icon;
              else btn.textContent = label;
              btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection
              btn.addEventListener('click', () => (editor.execute(item.command, ...(item.args ?? [])), refresh()));
              if (item.isActive) {
                const active = item.isActive;
                updaters.push(() => {
                  const on = active(view.state);
                  btn.classList.toggle('is-active', on);
                  btn.setAttribute('aria-pressed', String(on));
                });
              }
              bar.append(btn);
            }
            editor.root.append(bar);

            refresh = () => {
              const { empty, from, to } = view.state.selection;
              const show = !empty && !editor.isReadOnly && (view.hasFocus() || bar.contains(document.activeElement));
              bar.hidden = !show;
              if (!show) return;
              updaters.forEach((u) => u());
              try {
                const a = view.coordsAtPos(from);
                const b = view.coordsAtPos(to);
                const root = editor.root.getBoundingClientRect();
                const mid = (Math.min(a.left, b.left) + Math.max(a.right, b.right)) / 2;
                const top = Math.min(a.top, b.top) - root.top - bar.offsetHeight - 8;
                bar.style.left = `${Math.max(4, Math.min(mid - root.left - bar.offsetWidth / 2, root.width - bar.offsetWidth - 4))}px`;
                bar.style.top = `${Math.max(4, top)}px`;
              } catch {
                /* no layout (tests): leave it where it is */
              }
            };
            return { update: refresh, destroy: () => bar.remove() };
          },
        }),
      ];
    },
  };
}
