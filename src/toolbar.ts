import type { EditorState } from 'prosemirror-state';
import type { Editor } from './editor';
import type { ToolbarItem } from './types';

export class Toolbar {
  readonly el = document.createElement('div');
  private updaters: ((state: EditorState) => void)[] = [];

  constructor(private editor: Editor, items: ToolbarItem[]) {
    this.el.className = 'wy-toolbar';
    this.el.setAttribute('role', 'toolbar');
    for (const item of items) this.el.append(this.render(item));
  }

  update(state: EditorState): void {
    for (const u of this.updaters) u(state);
  }

  private render(item: ToolbarItem): HTMLElement {
    if (item.type === 'separator') {
      const s = document.createElement('span');
      s.className = 'wy-sep';
      return s;
    }
    if (item.type === 'select') {
      const sel = document.createElement('select');
      sel.className = 'wy-select';
      sel.title = item.label;
      for (const o of item.options) sel.add(new Option(o.label, o.value));
      sel.addEventListener('change', () => this.editor.execute(item.command, sel.value));
      this.updaters.push((s) => (sel.value = item.getValue(s)));
      return sel;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wy-btn';
    btn.title = item.label;
    btn.setAttribute('aria-label', item.label);
    btn.innerHTML = item.icon ?? item.label;
    // Keep editor selection when clicking toolbar buttons.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => this.editor.execute(item.command, ...(item.args ?? [])));
    this.updaters.push((s) => {
      const active = item.isActive?.(s) ?? false;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    return btn;
  }
}
