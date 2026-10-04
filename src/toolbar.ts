import type { EditorState } from 'prosemirror-state';
import type { Editor } from './editor';
import type { ToolbarItem } from './types';

export class Toolbar {
  readonly el = document.createElement('div');
  private updaters: ((state: EditorState) => void)[] = [];

  constructor(private editor: Editor, items: ToolbarItem[]) {
    this.el.className = 'wy-toolbar';
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', this.editor.t('toolbar', 'Editor toolbar'));
    for (const item of items) this.el.append(this.render(item));
    this.setupKeyboard();
  }

  /** Roving tabindex: one tab stop for the whole toolbar, arrow keys move between controls (WAI-ARIA toolbar pattern). */
  private setupKeyboard() {
    const controls = () => [...this.el.querySelectorAll<HTMLElement>('button, select')].filter((c) => !c.hasAttribute('disabled'));
    const focusAt = (list: HTMLElement[], i: number) => {
      list.forEach((c, n) => (c.tabIndex = n === i ? 0 : -1));
      list[i]?.focus();
    };
    const initial = controls();
    initial.forEach((c, i) => (c.tabIndex = i === 0 ? 0 : -1));
    this.el.addEventListener('focusin', (e) => {
      const list = controls();
      const i = list.indexOf(e.target as HTMLElement);
      if (i >= 0) list.forEach((c, n) => (c.tabIndex = n === i ? 0 : -1));
    });
    this.el.addEventListener('keydown', (e) => {
      const list = controls();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (i < 0 || (e.target as HTMLElement).tagName === 'SELECT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) return;
      const rtl = getComputedStyle(this.el).direction === 'rtl';
      const next = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? i + 1 : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
      if (next === null) return;
      e.preventDefault();
      focusAt(list, (next + list.length) % list.length);
    });
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
      const label = this.editor.t(item.name, item.label);
      sel.title = label;
      sel.setAttribute('aria-label', label);
      for (const o of item.options) sel.add(new Option(this.editor.t(`${item.name}.${o.value}`, o.label), o.value));
      sel.addEventListener('change', () => this.editor.execute(item.command, sel.value));
      this.updaters.push((s) => (sel.value = item.getValue(s)));
      return sel;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wy-btn';
    const label = this.editor.t(item.name, item.label);
    btn.title = label;
    btn.setAttribute('aria-label', label);
    // Icons are developer-supplied markup; a label (possibly from a locale file) is always plain text.
    if (item.icon) btn.innerHTML = item.icon;
    else btn.textContent = label;
    // Keep editor selection when clicking toolbar buttons.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => this.editor.execute(item.command, ...(item.args ?? [])));
    this.updaters.push((s) => {
      if (!item.isActive) return; // plain action buttons are not toggles, so no aria-pressed
      const active = item.isActive(s);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    return btn;
  }
}
