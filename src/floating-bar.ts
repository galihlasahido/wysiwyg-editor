import type { Editor } from './editor';
import { openMenu, type Open } from './plugins/context-menu';
import type { ContextMenuEntry } from './types';

export interface FloatingMenu {
  label: string;
  /** The items of the drop-down, or a function that builds them each time it opens (so checks and greyed-out items are current). */
  entries: ContextMenuEntry[] | ((editor: Editor) => ContextMenuEntry[]);
}

/** The floating card: a header (title, save status, your own controls), a menu bar, then the toolbar or ribbon. */
export interface FloatingBarOptions {
  /** The document name at the top left. Editable when `onTitle` is given. `false` leaves the header out unless `end` or the save status needs it. */
  title?: string | false;
  /** Called when the person renames the document. */
  onTitle?: (title: string) => void;
  /** Menu bar: File, Edit, View, Insert, Format by default (only entries whose commands exist). Your own list replaces it; `false` hides the bar. */
  menus?: FloatingMenu[] | false;
  /** Show Saving… / Saved from the `Autosave` plugin (default true). */
  status?: boolean;
  /** Your own controls at the right of the header: avatars, a Share button… */
  end?: HTMLElement | ((editor: Editor) => HTMLElement);
}

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl+';
const STATUS: Record<string, string> = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Save failed, retrying…', conflict: 'Conflict: reload' };

/** The menus a word processor has, built from the commands this editor has. A command that is not installed leaves its entry out. */
export function defaultFloatingMenus(): FloatingMenu[] {
  const cmd = (label: string, command: string, extra: Partial<ContextMenuEntry & object> = {}): ContextMenuEntry => ({ label, command, ...extra } as ContextMenuEntry);
  const build = (list: (ContextMenuEntry | null)[]) => (editor: Editor): ContextMenuEntry[] => {
    const out: ContextMenuEntry[] = [];
    for (const e of list) {
      if (e === null) continue;
      if (e === '-') { if (out.length && out[out.length - 1] !== '-') out.push('-'); continue; }
      if (e.items) { const sub = build(e.items as ContextMenuEntry[])(editor); if (sub.length) out.push({ ...e, items: sub }); continue; }
      if (e.command && !editor.hasCommand(e.command)) continue;
      out.push(e);
    }
    while (out[out.length - 1] === '-') out.pop();
    return out;
  };
  return [
    { label: 'File', entries: build([cmd('New', 'newDocument'), cmd('Open Word file…', 'openDocx'), '-', cmd('Download as Word (.docx)', 'exportDocx'), cmd('Download as HTML', 'exportHtml'), cmd('Download as Markdown', 'exportMarkdown'), '-', cmd('Print', 'print', { shortcut: `${mod}P` })]) },
    { label: 'Edit', entries: build([cmd('Undo', 'undo', { shortcut: `${mod}Z` }), cmd('Redo', 'redo', { shortcut: `${mod}Y` }), '-', cmd('Cut', 'cut', { shortcut: `${mod}X` }), cmd('Copy', 'copy', { shortcut: `${mod}C` }), cmd('Paste', 'paste', { shortcut: `${mod}V` }), cmd('Select all', 'selectAll', { shortcut: `${mod}A` }), '-', cmd('Find and replace', 'toggleFind', { shortcut: `${mod}F` })]) },
    { label: 'View', entries: build([cmd('Outline', 'toggleOutline'), cmd('Ruler', 'toggleRuler'), cmd('Pages', 'togglePages'), cmd('Reading view', 'toggleReadingView'), '-', cmd('Collapse all headings', 'collapseHeadings'), cmd('Expand all headings', 'expandHeadings'), '-', cmd('Dark / light theme', 'toggleTheme')]) },
    { label: 'Insert', entries: build([cmd('Table', 'insertTable'), cmd('Image', 'image'), cmd('Link', 'link', { shortcut: `${mod}K` }), cmd('Horizontal line', 'horizontalRule'), cmd('Page break', 'pageBreak'), '-', cmd('Table of contents', 'insertToc'), cmd('Footnote', 'footnote'), cmd('Equation', 'insertMath'), cmd('Code block', 'codeBlock')]) },
    { label: 'Format', entries: build([cmd('Bold', 'bold', { shortcut: `${mod}B` }), cmd('Italic', 'italic', { shortcut: `${mod}I` }), cmd('Underline', 'underline', { shortcut: `${mod}U` }), cmd('Strikethrough', 'strike'), '-',
      { label: 'Paragraph style', items: [cmd('Normal text', 'heading', { args: ['paragraph'] }), cmd('Heading 1', 'heading', { args: ['1'] }), cmd('Heading 2', 'heading', { args: ['2'] }), cmd('Heading 3', 'heading', { args: ['3'] })] },
      { label: 'Align', items: [cmd('Left', 'align', { args: ['left'] }), cmd('Center', 'align', { args: ['center'] }), cmd('Right', 'align', { args: ['right'] }), cmd('Justify', 'align', { args: ['justify'] })] },
      '-', cmd('Bulleted list', 'bulletList'), cmd('Numbered list', 'orderedList'), '-', cmd('Clear formatting', 'clearFormatting')]) },
  ];
}

/**
 * The floating card at the top of the editor (the `floating` option): rounded, with a soft shadow, it holds a header with the document
 * name, the save status and your own controls, a menu bar with drop-downs, and the toolbar or ribbon. It stays in view while the text scrolls.
 */
export class FloatingBar {
  readonly el = document.createElement('div');
  /** Where the toolbar (or ribbon) goes. */
  readonly host = document.createElement('div');
  private header = document.createElement('div');
  private titleEl: HTMLElement | null = null;
  private statusEl = document.createElement('span');
  private menuBar = document.createElement('div');
  private open: { menu: Open; button: HTMLButtonElement } | null = null;
  private off: (() => void)[] = [];

  constructor(private editor: Editor, private options: FloatingBarOptions = {}) {
    this.el.className = 'wy-floating';
    this.header.className = 'wy-fl-header';
    this.host.className = 'wy-fl-tools';
    this.buildHeader();
    this.buildMenus();
    this.el.append(this.host);
  }

  private buildHeader() {
    const o = this.options;
    const left = document.createElement('div');
    left.className = 'wy-fl-left';
    if (o.title !== false && o.title !== undefined) {
      const t = document.createElement(o.onTitle ? 'input' : 'span');
      t.className = 'wy-fl-title';
      if (t instanceof HTMLInputElement) {
        t.value = o.title;
        t.setAttribute('aria-label', this.editor.t('documentName', 'Document name'));
        t.spellcheck = false;
        t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); t.blur(); this.editor.view.focus(); } });
        t.addEventListener('change', () => { const v = t.value.trim() || o.title as string; t.value = v; o.onTitle!(v); });
      } else t.textContent = o.title;
      this.titleEl = t;
      left.append(t);
    }
    if (o.status !== false) {
      this.statusEl.className = 'wy-fl-status';
      this.statusEl.setAttribute('role', 'status');
      this.statusEl.hidden = true;
      left.append(this.statusEl);
      this.off.push(this.editor.on('save', (e: unknown) => {
        const s = (e as { status?: string }).status ?? '';
        this.statusEl.hidden = !STATUS[s];
        this.statusEl.textContent = STATUS[s] ?? '';
        this.statusEl.dataset.status = s;
      }));
    }
    const end = typeof o.end === 'function' ? o.end(this.editor) : o.end;
    if (end) { const right = document.createElement('div'); right.className = 'wy-fl-end'; right.append(end); this.header.append(left, right); }
    else this.header.append(left);
    if (this.titleEl || end || o.status !== false) this.el.prepend(this.header);
  }

  private buildMenus() {
    const menus = this.options.menus === undefined ? defaultFloatingMenus() : this.options.menus;
    if (!menus || !menus.length) return;
    this.menuBar.className = 'wy-fl-menus';
    this.menuBar.setAttribute('role', 'menubar');
    this.menuBar.setAttribute('aria-label', this.editor.t('menus', 'Menus'));
    const buttons: HTMLButtonElement[] = [];
    for (const m of menus) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wy-fl-menu';
      b.textContent = m.label;
      b.tabIndex = buttons.length ? -1 : 0;
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('mousedown', (e) => e.preventDefault()); // the selection stays in the text
      b.addEventListener('click', () => this.toggle(b, m));
      b.addEventListener('mouseenter', () => { if (this.open && this.open.button !== b) this.show(b, m); });
      b.addEventListener('keydown', (e) => {
        const i = buttons.indexOf(b);
        const go = (n: number) => { const t = buttons[(n + buttons.length) % buttons.length]; buttons.forEach((x) => (x.tabIndex = x === t ? 0 : -1)); t.focus(); };
        if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
        else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.show(b, m); }
      });
      buttons.push(b);
      this.menuBar.append(b);
    }
    this.el.append(this.menuBar);
  }

  private toggle(b: HTMLButtonElement, m: FloatingMenu) {
    if (this.open?.button === b) { this.closeMenu(); return; }
    this.show(b, m);
  }

  private show(b: HTMLButtonElement, m: FloatingMenu) {
    this.closeMenu();
    const entries = typeof m.entries === 'function' ? m.entries(this.editor) : m.entries;
    if (!entries.length) return;
    const r = b.getBoundingClientRect();
    const menu = openMenu(this.editor, entries, r.left, r.bottom + 4, null, () => {
      b.setAttribute('aria-expanded', 'false');
      b.classList.remove('is-open');
      if (this.open?.button === b) this.open = null;
    });
    b.setAttribute('aria-expanded', 'true');
    b.classList.add('is-open');
    this.open = { menu, button: b };
  }

  private closeMenu() { this.open?.menu.close(false); }

  /** Change the document name shown in the header. */
  setTitle(title: string): void {
    if (!this.titleEl) return;
    if (this.titleEl instanceof HTMLInputElement) this.titleEl.value = title; else this.titleEl.textContent = title;
  }

  destroy(): void { this.closeMenu(); for (const f of this.off) f(); this.off = []; this.el.remove(); }
}
