import type { EditorState } from 'prosemirror-state';
import type { Editor } from './editor';
import { hasIcon, icon } from './icons';
import type { ToolbarButton, ToolbarEntry, ToolbarGroup, ToolbarItem, ToolbarOptions } from './types';

/** Run a toolbar button: its own `run` function, or its command. */
export function runToolbarItem(editor: Editor, item: ToolbarButton): void {
  if (item.run) {
    if (!editor.isReadOnly) item.run(editor);
    editor.view.focus();
  } else if (item.command) editor.execute(item.command, ...((item as { args?: unknown[] }).args ?? []));
}

/** A layout entry after names are looked up. */
export type ResolvedEntry = ToolbarItem | { type: 'break' } | { type: 'spacer' } | { type: 'group'; label: string; items: ResolvedEntry[] };

const isGroup = (e: ToolbarEntry): e is ToolbarGroup => typeof e === 'object' && 'group' in e && 'items' in e;

/** Turn a layout (names, objects, groups, '|' '-' '>') into resolved entries. Unknown names are skipped. */
export function resolveLayout(entries: ToolbarEntry[], available: ToolbarItem[], hide: string[] = []): ResolvedEntry[] {
  const byName = new Map(available.map((i) => [i.name, i]));
  const hidden = new Set(hide);
  let n = 0;
  const walk = (list: ToolbarEntry[]): ResolvedEntry[] =>
    list.flatMap((e): ResolvedEntry[] => {
      if (typeof e === 'string') {
        if (e === '|') return [{ type: 'separator', name: `sep-${n++}` }];
        if (e === '-') return [{ type: 'break' }];
        if (e === '>') return [{ type: 'spacer' }];
        const item = byName.get(e);
        return item && !hidden.has(e) ? [item] : [];
      }
      if (isGroup(e)) {
        const items = walk(e.items);
        return items.length ? [{ type: 'group', label: e.group, items }] : [];
      }
      return hidden.has(e.name) ? [] : [e]; // an object you defined yourself
    });
  return walk(entries);
}

export class Toolbar {
  readonly el = document.createElement('div');
  private updaters: ((state: EditorState) => void)[] = [];
  private bar = document.createElement('div');
  private more: { btn: HTMLButtonElement; pop: HTMLElement } | null = null;
  private observer: ResizeObserver | null = null;
  private onDocPointer = (e: PointerEvent) => { if (this.more && !this.more.pop.hidden && !this.el.contains(e.target as Node)) this.closeMore(); };

  constructor(private editor: Editor, items: ResolvedEntry[], options: ToolbarOptions = {}) {
    this.el.className = `wy-toolbar is-overflow-${options.overflow ?? 'wrap'}${options.align ? ` is-align-${options.align}` : ''}${options.sticky ? ' is-sticky' : ''}${options.position === 'bottom' ? ' is-bottom' : ''}`;
    this.el.setAttribute('role', 'toolbar');
    this.el.setAttribute('aria-label', options.label ?? this.editor.t('toolbar', 'Editor toolbar'));
    this.bar.className = 'wy-tb-bar';
    this.el.append(this.bar);
    for (const item of items) this.bar.append(this.render(item));
    if (options.overflow === 'more') this.setupMore();
    this.setupKeyboard();
  }

  /** The "⋯" menu: items that do not fit move into it (the real elements, so they keep working). */
  private setupMore() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wy-btn wy-tb-more';
    btn.textContent = '⋯';
    btn.title = this.editor.t('more', 'More');
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    const pop = document.createElement('div');
    pop.className = 'wy-tb-pop';
    pop.hidden = true;
    pop.setAttribute('role', 'group');
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => (pop.hidden ? this.openMore() : this.closeMore()));
    this.el.append(btn, pop);
    this.more = { btn, pop };
    btn.hidden = true;
    document.addEventListener('pointerdown', this.onDocPointer, true);
    this.el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !pop.hidden) { this.closeMore(); btn.focus(); } });
    if (typeof ResizeObserver === 'function') {
      this.observer = new ResizeObserver(() => this.layout());
      this.observer.observe(this.el);
    }
    this.layout();
  }
  private openMore() { if (!this.more) return; this.more.pop.hidden = false; this.more.btn.setAttribute('aria-expanded', 'true'); }
  private closeMore() { if (!this.more) return; this.more.pop.hidden = true; this.more.btn.setAttribute('aria-expanded', 'false'); }

  /** Move trailing entries into the menu until the bar fits. */
  private layout() {
    if (!this.more) return;
    const { btn, pop } = this.more;
    for (const child of [...pop.children]) this.bar.append(child); // start from everything in the bar
    btn.hidden = false;
    const fits = () => this.bar.scrollWidth <= this.bar.clientWidth + 1;
    const movable = () => [...this.bar.children].filter((c) => !c.classList.contains('wy-tb-break'));
    const moved: Element[] = [];
    while (!fits() && movable().length > 1) {
      const last = movable().at(-1)!;
      moved.unshift(last);
      pop.prepend(last);
    }
    btn.hidden = !moved.length;
    if (!moved.length) this.closeMore();
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


  destroy(): void {
    this.observer?.disconnect();
    document.removeEventListener('pointerdown', this.onDocPointer, true);
  }

  update(state: EditorState): void {
    for (const u of this.updaters) u(state);
  }

  private render(item: ResolvedEntry): HTMLElement {
    if ('type' in item && item.type === 'break') { // a new row: a full-width element that forces what follows below
      const br = document.createElement('span');
      br.className = 'wy-tb-break';
      return br;
    }
    if ('type' in item && item.type === 'spacer') {
      const sp = document.createElement('span');
      sp.className = 'wy-tb-spacer';
      return sp;
    }
    if ('type' in item && item.type === 'group') {
      const g = document.createElement('div');
      g.className = 'wy-tb-group';
      g.setAttribute('role', 'group');
      g.setAttribute('aria-label', this.editor.t(`group.${item.label}`, item.label));
      for (const child of item.items) g.append(this.render(child));
      return g;
    }
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
    if (hasIcon(item.name)) btn.innerHTML = icon(item.name, 18);
    else if (item.icon) btn.innerHTML = item.icon;
    else btn.textContent = label;
    // Keep editor selection when clicking toolbar buttons.
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => { runToolbarItem(this.editor, item); this.closeMore(); });
    this.updaters.push((s) => {
      if (!item.isActive) return; // plain action buttons are not toggles, so no aria-pressed
      const active = item.isActive(s);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    return btn;
  }
}
