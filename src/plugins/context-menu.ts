import { AllSelection, NodeSelection, Plugin, TextSelection, type EditorState } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import type { Editor } from '../editor';
import type { ContextMenuContext, ContextMenuEntry, ContextMenuItem, EditorPlugin } from '../types';
import { markRunAt } from './helpers';

export interface ContextMenuOptions {
  /** Extra items added at the top, for this editor only (plugins add theirs with the `contextMenu` hook). */
  extra?: (context: ContextMenuContext) => ContextMenuEntry[];
}

const isItem = (e: ContextMenuEntry): e is ContextMenuItem => e !== '-';

/** Remove what a read-only editor must not offer, then tidy the separators: none first, last or doubled, and no empty fly-outs. */
export function tidyEntries(entries: ContextMenuEntry[], readOnlyEditor: boolean): ContextMenuEntry[] {
  const out: ContextMenuEntry[] = [];
  for (const e of entries) {
    if (e === '-') { if (out.length && out[out.length - 1] !== '-') out.push('-'); continue; }
    if (readOnlyEditor && !e.readOnly && !e.items) continue;
    if (e.items) {
      const sub = tidyEntries(e.items, readOnlyEditor);
      if (!sub.some(isItem)) continue;
      out.push({ ...e, items: sub });
    } else out.push(e);
  }
  while (out[out.length - 1] === '-') out.pop();
  return out;
}

/** The nearest ancestor with this node type, the node itself when it is the selected one. */
function makeContext(editor: Editor, event: MouseEvent | null): ContextMenuContext {
  const state = editor.view.state;
  return {
    editor,
    event,
    state,
    readonly: !editor.view.editable,
    closest(typeName) {
      const sel = state.selection;
      if (sel instanceof NodeSelection && sel.node.type.name === typeName) return { node: sel.node, pos: sel.from, depth: sel.$from.depth + 1 };
      const $from = sel.$from;
      for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === typeName) return { node: $from.node(d), pos: $from.before(d), depth: d };
      return null;
    },
    markAt(markName) {
      return markRunAt(state, markName);
    },
  };
}

/** Everything a plugin offers for the current selection, grouped by plugin order. */
export function buildContextMenu(editor: Editor, event: MouseEvent | null, extra?: ContextMenuOptions['extra']): ContextMenuEntry[] {
  const ctx = makeContext(editor, event);
  const readOnly = ctx.readonly;
  const groups: ContextMenuEntry[][] = [];
  const own = extra?.(ctx) ?? [];
  if (own.length) groups.push(own);
  const plugins = [...editor.config.plugins].filter((p) => p.contextMenu).sort((a, b) => (b.contextMenuOrder ?? 0) - (a.contextMenuOrder ?? 0));
  for (const p of plugins) {
    let items: ContextMenuEntry[] = [];
    try { items = p.contextMenu!(ctx); } catch (err) { console.error(`contextMenu of plugin "${p.name}" failed`, err); }
    if (items.length) groups.push(items);
  }
  groups.push([selectAllItem]);
  const flat: ContextMenuEntry[] = [];
  for (const g of groups) { if (flat.length) flat.push('-'); flat.push(...g); }
  return tidyEntries(flat, readOnly);
}

// ---- the popup ---------------------------------------------------------------------------------------------------------------

export interface Open { root: HTMLElement; menus: HTMLElement[]; close(restoreFocus?: boolean): void }

function place(menu: HTMLElement, x: number, y: number, alignRightOf?: DOMRect) {
  menu.style.left = '0px';
  menu.style.top = '0px';
  const r = menu.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let left = alignRightOf ? alignRightOf.right - 2 : x;
  if (left + r.width > vw - 4) left = alignRightOf ? Math.max(4, alignRightOf.left - r.width + 2) : Math.max(4, vw - r.width - 4);
  let top = y;
  if (top + r.height > vh - 4) top = Math.max(4, vh - r.height - 4);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

export function openMenu(editor: Editor, entries: ContextMenuEntry[], x: number, y: number, hint: string | null, onClose?: () => void): Open {
  const layer = document.createElement('div');
  layer.className = 'wy-ctx-layer';
  const menus: HTMLElement[] = [];
  let closed = false;

  const close = (restoreFocus = true) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onEscape, true);
    window.removeEventListener('blur', onAway);
    window.removeEventListener('resize', onAway);
    document.removeEventListener('scroll', onAway, true);
    layer.remove();
    editor.root.removeAttribute('data-ctx-open');
    onClose?.();
    if (restoreFocus && !editor.view.isDestroyed) editor.view.focus();
  };
  const onOutside = (e: Event) => { if (!layer.contains(e.target as Node)) close(false); };
  const onAway = (e?: Event) => { if (e && layer.contains(e.target as Node)) return; close(false); };
  const onEscape = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    const sub = menus[menus.length - 1];
    if (menus.length > 1) { sub.remove(); menus.pop(); (menus[menus.length - 1].querySelector('[aria-expanded="true"]') as HTMLElement | null)?.setAttribute('aria-expanded', 'false'); (menus[menus.length - 1].querySelector('.wy-ctx-item[data-open]') as HTMLElement | null)?.focus(); return; }
    close();
  };

  const run = (item: ContextMenuItem) => {
    close(); // the editor gets focus back first, so a dialog the command opens keeps its own focus
    if (item.run) item.run(editor);
    else if (item.command) editor.execute(item.command, ...(item.args ?? []));
  };

  const items = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>(':scope > .wy-ctx-item:not([aria-disabled="true"])')];

  const build = (list: ContextMenuEntry[], depth: number, label: string): HTMLElement => {
    const menu = document.createElement('div');
    menu.className = `wy-ctx${depth ? ' wy-ctx-sub' : ''}`;
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', label);
    for (const entry of list) {
      if (entry === '-') {
        const sep = document.createElement('div');
        sep.className = 'wy-ctx-sep';
        sep.setAttribute('role', 'separator');
        menu.append(sep);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `wy-ctx-item${entry.danger ? ' is-danger' : ''}`;
      b.tabIndex = -1;
      b.setAttribute('role', entry.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
      if (entry.checked !== undefined) b.setAttribute('aria-checked', String(entry.checked));
      if (entry.disabled) b.setAttribute('aria-disabled', 'true');
      const mark = document.createElement('span');
      mark.className = 'wy-ctx-icon';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = entry.checked ? '✓' : entry.icon ?? '';
      if (entry.icon && /^#[0-9a-f]{3,8}$/i.test(entry.label)) mark.style.color = entry.label; // a colour swatch
      const text = document.createElement('span');
      text.className = 'wy-ctx-label';
      text.textContent = entry.label; // labels are text, never markup
      b.append(mark, text);
      if (entry.shortcut) {
        const key = document.createElement('span');
        key.className = 'wy-ctx-key';
        key.textContent = entry.shortcut;
        b.append(key);
      }
      if (entry.items) {
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        const arrow = document.createElement('span');
        arrow.className = 'wy-ctx-arrow';
        arrow.setAttribute('aria-hidden', 'true');
        arrow.textContent = '›';
        b.append(arrow);
      }
      const openSub = (focusFirst: boolean) => {
        if (!entry.items || entry.disabled) return;
        while (menus.length > depth + 1) menus.pop()!.remove();
        menu.querySelectorAll('[data-open]').forEach((n) => { n.removeAttribute('data-open'); n.setAttribute('aria-expanded', 'false'); });
        const sub = build(entry.items, depth + 1, entry.label);
        layer.append(sub);
        menus.push(sub);
        b.setAttribute('data-open', '');
        b.setAttribute('aria-expanded', 'true');
        const r = b.getBoundingClientRect();
        place(sub, r.right, r.top - 4, r);
        if (focusFirst) items(sub)[0]?.focus();
      };
      b.addEventListener('mouseenter', () => { b.focus(); if (entry.items) openSub(false); else { while (menus.length > depth + 1) menus.pop()!.remove(); menu.querySelectorAll('[data-open]').forEach((n) => { n.removeAttribute('data-open'); n.setAttribute('aria-expanded', 'false'); }); } });
      b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the selection in the editor
      b.addEventListener('click', () => {
        if (entry.disabled) return;
        if (entry.items) openSub(true); else run(entry);
      });
      b.addEventListener('keydown', (e) => {
        const all = items(menu);
        const i = all.indexOf(b);
        if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
        else if (e.key === 'Home') { e.preventDefault(); all[0]?.focus(); }
        else if (e.key === 'End') { e.preventDefault(); all[all.length - 1]?.focus(); }
        else if (e.key === 'ArrowRight' && entry.items) { e.preventDefault(); openSub(true); }
        else if (e.key === 'ArrowLeft' && depth > 0) { e.preventDefault(); onEscape(new KeyboardEvent('keydown', { key: 'Escape' })); }
        else if (e.key === 'Tab') { e.preventDefault(); close(); }
      });
      menu.append(b);
    }
    if (hint && depth === 0) {
      const note = document.createElement('div');
      note.className = 'wy-ctx-hint';
      note.textContent = hint;
      menu.append(note);
    }
    return menu;
  };

  const root = build(entries, 0, 'Context menu');
  layer.append(root);
  menus.push(root);
  editor.root.append(layer);
  editor.root.setAttribute('data-ctx-open', '');
  place(root, x, y);
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onEscape, true);
  window.addEventListener('blur', onAway);
  window.addEventListener('resize', onAway);
  document.addEventListener('scroll', onAway, true);
  items(root)[0]?.focus();
  return { root: layer, menus, close };
}

// ---- clipboard ---------------------------------------------------------------------------------------------------------------

function copySelection(editor: Editor, cut: boolean) {
  const view = editor.view;
  view.focus();
  let ok = false;
  try { ok = document.execCommand(cut ? 'cut' : 'copy'); } catch { /* not allowed here */ }
  if (!ok) {
    // the plain text is better than nothing when the browser refuses the command
    const { from, to } = view.state.selection;
    const text = view.state.doc.textBetween(from, to, '\n', ' ');
    void navigator.clipboard?.writeText(text).then(() => { if (cut && view.editable) view.dispatch(view.state.tr.deleteSelection()); }).catch(() => editor.emit('clipboard-error', { message: 'The browser did not allow copying. Use the keyboard shortcut.' }));
  }
}

/** Paste what is on the clipboard through the editor's own paste handling (Word and Google Docs clean-up included). */
async function pasteFromClipboard(editor: Editor) {
  const view = editor.view;
  view.focus();
  try {
    const clip = navigator.clipboard as Clipboard & { read?: () => Promise<ClipboardItem[]> };
    if (clip.read) {
      for (const item of await clip.read()) {
        if (item.types.includes('text/html')) { view.pasteHTML(await (await item.getType('text/html')).text()); return; }
        if (item.types.includes('text/plain')) { view.pasteText(await (await item.getType('text/plain')).text()); return; }
      }
      return;
    }
    view.pasteText(await clip.readText());
  } catch {
    editor.emit('clipboard-error', { message: 'The browser did not allow reading the clipboard. Press Ctrl+V (Cmd+V on a Mac) to paste.' });
  }
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl+';

/**
 * The right-click menu. It shows what applies at the click: clipboard actions, then the items each plugin adds for the
 * selection (table tools in a table, list tools in a list, link tools on a link, picture tools on a picture…). Plugins add
 * items with the `contextMenu(context)` hook. Hold Shift while right-clicking to get the browser's own menu (spelling
 * suggestions from the browser's spell checker live there). It opens from the keyboard with the Menu key or Shift+F10.
 */
export function ContextMenu(options: ContextMenuOptions = {}): EditorPlugin {
  return {
    name: 'context-menu',
    contextMenuOrder: 100,
    contextMenu({ state, readonly }) {
      const hasSel = !state.selection.empty;
      const items: ContextMenuEntry[] = [
        { label: 'Cut', icon: '✂', shortcut: `${mod}X`, disabled: !hasSel, run: (e) => copySelection(e, true) },
        { label: 'Copy', icon: '⧉', shortcut: `${mod}C`, disabled: !hasSel, readOnly: true, run: (e) => copySelection(e, false) },
      ];
      if (!readonly) items.push({ label: 'Paste', icon: '📋', shortcut: `${mod}V`, run: (e) => void pasteFromClipboard(e) });
      return items;
    },
    setup(editor) {
      const pickPosition = (event: MouseEvent) => {
        // like a word processor: right-clicking outside the selection moves the caret there; inside it keeps the selection
        const view = editor.view;
        let hit: { pos: number; inside: number } | null = null;
        try { hit = view.posAtCoords({ left: event.clientX, top: event.clientY }); } catch { hit = null; }
        if (!hit) return;
        const { selection, doc } = view.state;
        const within = hit.pos >= selection.from && hit.pos <= selection.to;
        if (selection instanceof CellSelection) {
          let inCell = false;
          selection.forEachCell((_n, p) => { if (hit!.pos > p && hit!.pos <= p + (_n.nodeSize - 1)) inCell = true; });
          if (inCell) return;
        } else if (!selection.empty && within) return;
        const node = hit.inside >= 0 ? doc.nodeAt(hit.inside) : null;
        if (node && node.isAtom && node.type.spec.selectable !== false && !node.isText) {
          if (!(selection instanceof NodeSelection && selection.from === hit.inside)) view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, hit.inside)));
          return;
        }
        if (selection.empty && selection.from === hit.pos) return;
        view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(hit.pos))));
      };

      let current: Open | null = null;
      const show = (event: MouseEvent | null, x: number, y: number) => {
        current?.close(false);
        const entries = buildContextMenu(editor, event, options.extra);
        if (!entries.some(isItem)) return false;
        const browserSpelling = editor.view.dom.getAttribute('spellcheck') === 'true' && !!editor.view.editable;
        current = openMenu(editor, entries, x, y, browserSpelling ? 'Shift + right-click: browser menu (spelling)' : null);
        return true;
      };
      editor.registerCommand('openContextMenu', (e) => {
        const view = e.view;
        const c = view.coordsAtPos(view.state.selection.head);
        return show(null, c.left, c.bottom + 4);
      }, { readOnlySafe: true });

      return [
        new Plugin({
          view(view) {
            const onContext = (ev: MouseEvent) => {
              if (ev.defaultPrevented || ev.shiftKey) return; // another plugin handled it (spelling suggestions), or the browser menu was asked for
              const t = ev.target as HTMLElement | null;
              if (t?.closest('input, textarea, select')) return;
              if (view.editable) pickPosition(ev);
              if (show(ev, ev.clientX, ev.clientY)) ev.preventDefault(); // nothing to offer: the browser's menu appears instead
            };
            const onKey = (ev: KeyboardEvent) => {
              if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) { ev.preventDefault(); editor.execute('openContextMenu'); }
            };
            view.dom.addEventListener('contextmenu', onContext);
            view.dom.addEventListener('keydown', onKey);
            return { destroy() { view.dom.removeEventListener('contextmenu', onContext); view.dom.removeEventListener('keydown', onKey); current?.close(false); } };
          },
        }),
      ];
    },
  };
}

/** Select everything: an item other plugins can reuse. */
export const selectAllItem: ContextMenuItem = {
  label: 'Select all', shortcut: `${mod}A`, readOnly: true,
  run: (e) => { const s: EditorState = e.view.state; e.view.dispatch(s.tr.setSelection(new AllSelection(s.doc))); e.view.focus(); },
};
