/**
 * The menus of the stand-alone office apps (spreadsheet, presentation), in two looks that share one description:
 * `classic` is the tabbed ribbon of Excel and PowerPoint; `floating` is a rounded card with a header (name, save status, your
 * controls), a menu bar with drop-downs and a one-row toolbar whose last items fold into "⋯". Nothing here knows an editor or a
 * spreadsheet: an app describes its tabs, menus and controls, the chrome draws them and asks them for their state when `refresh()`
 * is called.
 */
import { observeSize } from './resize';
import { hasIcon, icon, registerIcon } from './icons';

// A few more icons the office apps need (24×24, stroke only).
const EXTRA_ICONS: Record<string, string> = {
  alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  alignTop: '<path d="M4 4h16M12 20V8M8 12l4-4 4 4"/>',
  alignMiddle: '<path d="M4 12h16M12 4v5M9 7l3 3 3-3M12 20v-5M9 17l3-3 3 3"/>',
  alignBottom: '<path d="M4 20h16M12 4v12M8 12l4 4 4-4"/>',
  wrap: '<path d="M4 6h16M4 12h12a3 3 0 0 1 0 6h-3M4 18h5"/><path d="M11 16l-2 2 2 2"/>',
  fillColor: '<path d="M7 11l5-6 6 6-5 6z"/><path d="M5 20h14" stroke="var(--oc-bar, currentColor)" stroke-width="3"/><path d="M19 14s2 2.4 2 3.6a2 2 0 0 1-4 0C17 16.4 19 14 19 14z"/>',
  fontColor: '<path d="M7 16l5-11 5 11M9 12h6"/><path d="M5 20h14" stroke="var(--oc-bar, currentColor)" stroke-width="3"/>',
  borders: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
  currency: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.5c-.4-.9-1.4-1.4-2.5-1.4-1.4 0-2.5.8-2.5 1.9s1 1.6 2.5 2 2.5.9 2.5 2-1.1 1.9-2.5 1.9c-1.2 0-2.2-.5-2.6-1.5M12 6.5v1.6M12 15.9v1.6"/>',
  percent: '<path d="M18 6L6 18"/><circle cx="7.5" cy="7.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/>',
  decimalMore: '<path d="M4 15h2M10 8.5v7M14 8.5v7M10 8.5h4M10 15.5h4"/><path d="M17 12h4M19 10l2 2-2 2"/>',
  decimalLess: '<path d="M4 15h2M10 8.5v7M14 8.5v7M10 8.5h4M10 15.5h4"/><path d="M21 12h-4M19 10l-2 2 2 2"/>',
  sortAsc: '<path d="M6 5v14M3 16l3 3 3-3M13 6h3M13 11h5M13 16h8"/>',
  sortDesc: '<path d="M6 19V5M3 8l3-3 3 3M13 8h8M13 13h5M13 18h3"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  freeze: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9h16M9 4v16"/>',
  sum: '<path d="M17 5H7l6 7-6 7h10"/>',
  rowAbove: '<rect x="4" y="12" width="16" height="7" rx="1"/><path d="M12 4v5M9.5 6.5h5"/>',
  rowBelow: '<rect x="4" y="5" width="16" height="7" rx="1"/><path d="M12 15v5M9.5 17.5h5"/>',
  colLeft: '<rect x="12" y="4" width="8" height="16" rx="1"/><path d="M4 12h5M6.5 9.5v5"/>',
  colRight: '<rect x="4" y="4" width="8" height="16" rx="1"/><path d="M15 12h5M17.5 9.5v5"/>',
  delRow: '<rect x="4" y="9" width="16" height="6" rx="1"/><path d="M9 20l6-3M15 20l-6-3"/>',
  delCol: '<rect x="9" y="4" width="6" height="16" rx="1"/><path d="M4 9l3 6M4 15l3-6"/>',
  sheetAdd: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M12 8.5v7M8.5 12h7"/>',
  grid: '<rect x="4" y="4" width="16" height="16"/><path d="M4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16"/>',
  clear: '<path d="M8 6l10 10M18 6L8 16M5 20h14"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/>',
  slideAdd: '<rect x="3.5" y="5" width="14" height="10" rx="1.5"/><path d="M8 19h5M20 14v6M17 17h6"/>',
  slideNew: '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M9 20h6"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  textBox: '<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="2 2"/><path d="M9 9h6M12 9v7"/>',
  shapes: '<rect x="3.5" y="12" width="8" height="8" rx="1"/><circle cx="16" cy="8" r="4.5"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6"/>',
  triangle: '<path d="M12 5l8 14H4z"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
  star: '<path d="M12 4l2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7z"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="1"/><path d="M4 16V4h12" stroke-dasharray="2 2"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="1" stroke-dasharray="2 2"/><path d="M8 20h12V8"/>',
  duplicate: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13M10 11v6M14 11v6"/>',
  notes: '<path d="M5 4h14v16H5zM8.5 9h7M8.5 13h7M8.5 17h4"/>',
  layout: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 10h16M12 10v10"/>',
  background: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 16l5-5 4 4 3-3 4 4"/>',
  fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  chevronDown: '<path d="M7 10l5 5 5-5"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  share: '<circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M17 8v6M14 11h6"/>',
  text: '<path d="M5 6V5h14v1M12 5v14M9 19h6"/>',
  merge: '<rect x="3.5" y="6" width="17" height="12" rx="1.5"/><path d="M9 12h6M9 12l2-2M9 12l2 2M15 12l-2-2M15 12l-2 2"/>',
  cf: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.5h16M4 14.5h16"/><rect x="6" y="11" width="6" height="2.6" fill="currentColor" stroke="none"/>',
  chart: '<path d="M4 20V4M4 20h16"/><rect x="7.5" y="11" width="3" height="6"/><rect x="12.5" y="7" width="3" height="10"/><rect x="17.5" y="13" width="2" height="4"/>',
  imageAdd: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.5"/><path d="M4 16l5-4 4 3 3-2 4 3"/>',
};
for (const [k, v] of Object.entries(EXTRA_ICONS)) if (!hasIcon(k)) registerIcon(k, v);

export type MenuEntry =
  | '-'
  | { heading: string }
  | { label: string; onClick?: () => void; items?: MenuEntry[]; shortcut?: string; checked?: boolean; disabled?: boolean; icon?: string };

export type Control =
  | { kind: 'button'; id: string; label?: string; icon?: string; title?: string; size?: 'large' | 'small'; onClick: () => void; active?: () => boolean; disabled?: () => boolean }
  | { kind: 'menu'; id: string; label?: string; icon?: string; title?: string; size?: 'large' | 'small'; entries: () => MenuEntry[]; disabled?: () => boolean }
  | { kind: 'select'; id: string; title: string; options: () => { label: string; value: string }[]; value: () => string; onChange: (v: string) => void; width?: number; disabled?: () => boolean }
  | { kind: 'color'; id: string; title: string; icon: string; value: () => string | null; onPick: (color: string | null) => void; disabled?: () => boolean }
  | { kind: 'sep' };

export interface Group { label: string; controls: Control[] }
export interface Tab { id: string; label: string; groups: Group[] }
export interface MenuBarItem { label: string; entries: () => MenuEntry[] }

export interface ChromeSpec {
  /** The classic ribbon. */
  tabs: Tab[];
  /** The floating card: the menu bar and the one-row toolbar. */
  menus: MenuBarItem[];
  toolbar: Control[];
}

export interface ChromeOptions {
  mode: 'classic' | 'floating';
  /** The floating card's one-row toolbar (default true); without it the card is only the menu bar. */
  toolbar?: boolean;
  /** The document name at the top left (editable with `onTitle`). */
  title?: string | false;
  onTitle?: (title: string) => void;
  /** Your own controls, right of the header. */
  end?: HTMLElement;
  /** Called after a command so the app can take the focus back. */
  focus?: () => void;
  /** The element menus are opened in (it carries the theme). */
  root: HTMLElement;
  /** The tab shown first in the classic ribbon. */
  initialTab?: string;
  label?: string;
}

const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff',
  '#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff',
  '#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc',
  '#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd',
  '#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0',
  '#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79',
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
/** `Ctrl+B` written for the platform: `⌘B` on a Mac. */
export const keyLabel = (s: string): string => (isMac ? s.replace(/Ctrl\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧') : s);

// ---- pop-up menu ------------------------------------------------------------------------------------------------------------

export interface PopHandle { close(): void; el: HTMLElement }

/** Open a drop-down menu in `root`, below `anchor` (or at a point). It closes on a click elsewhere, Escape, scroll or resize. */
export function popMenu(root: HTMLElement, at: HTMLElement | { x: number; y: number }, entries: MenuEntry[], o: { onClose?: () => void; onRun?: () => void; label?: string } = {}): PopHandle {
  const layer = el('div', 'wy-oc-layer');
  const menus: HTMLElement[] = [];
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', onScroll, true);
    layer.remove();
    o.onClose?.();
  };
  const onOutside = (e: Event) => { if (!layer.contains(e.target as Node) && !(at instanceof HTMLElement && at.contains(e.target as Node))) close(); };
  const onScroll = (e: Event) => {
    const t = e.target as Node;
    if (layer.contains(t)) return;
    // the ribbon itself scrolling sideways (a button was brought into view): keep the menu under its button
    if (at instanceof HTMLElement && t instanceof Node && t.contains(at) && menus.length === 1) { const r = at.getBoundingClientRect(); place(first, r.left, r.bottom + 2); return; }
    close();
  };
  const place = (m: HTMLElement, x: number, y: number, side?: DOMRect) => {
    m.style.left = '0px'; m.style.top = '0px';
    const r = m.getBoundingClientRect();
    const vw = document.documentElement.clientWidth; const vh = document.documentElement.clientHeight;
    let left = side ? side.right - 2 : x;
    if (left + r.width > vw - 4) left = side ? Math.max(4, side.left - r.width + 2) : Math.max(4, vw - r.width - 4);
    let top = y;
    if (top + r.height > vh - 4) top = Math.max(4, vh - r.height - 4);
    m.style.left = `${left}px`; m.style.top = `${top}px`;
  };
  const focusables = (m: HTMLElement) => [...m.querySelectorAll<HTMLElement>(':scope > .wy-oc-item:not([aria-disabled="true"])')];
  const onKey = (e: KeyboardEvent) => {
    const top = menus[menus.length - 1];
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (menus.length > 1) { menus.pop()!.remove(); (menus[menus.length - 1].querySelector('[data-open]') as HTMLElement | null)?.focus(); } else close(); return; }
    const all = focusables(top);
    const i = all.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); all[(i + 1) % all.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); all[(i - 1 + all.length) % all.length]?.focus(); }
    else if (e.key === 'ArrowRight' && (document.activeElement as HTMLElement | null)?.getAttribute('aria-haspopup')) { e.preventDefault(); (document.activeElement as HTMLElement).click(); }
    else if (e.key === 'ArrowLeft' && menus.length > 1) { e.preventDefault(); menus.pop()!.remove(); (menus[menus.length - 1].querySelector('[data-open]') as HTMLElement | null)?.focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); close(); }
  };
  const build = (list: MenuEntry[], depth: number): HTMLElement => {
    const m = el('div', `wy-oc-menu${depth ? ' is-sub' : ''}`);
    m.setAttribute('role', 'menu');
    if (o.label && !depth) m.setAttribute('aria-label', o.label);
    for (const e of list) {
      if (e === '-') { const s = el('div', 'wy-oc-sep'); s.setAttribute('role', 'separator'); m.append(s); continue; }
      if ('heading' in e) { m.append(el('div', 'wy-oc-heading', e.heading)); continue; }
      const b = el('button', 'wy-oc-item');
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('role', e.checked !== undefined ? 'menuitemcheckbox' : 'menuitem');
      if (e.checked !== undefined) b.setAttribute('aria-checked', String(e.checked));
      if (e.disabled) b.setAttribute('aria-disabled', 'true');
      const ic = el('span', 'wy-oc-item-icon');
      ic.setAttribute('aria-hidden', 'true');
      if (e.checked) ic.textContent = '✓'; else if (e.icon && hasIcon(e.icon)) ic.innerHTML = icon(e.icon, 16);
      b.append(ic, el('span', 'wy-oc-item-label', e.label));
      if (e.shortcut) b.append(el('span', 'wy-oc-item-key', keyLabel(e.shortcut)));
      if (e.items) { b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false'); b.append(el('span', 'wy-oc-item-arrow', '›')); }
      const openSub = () => {
        if (!e.items || e.disabled) return;
        while (menus.length > depth + 1) menus.pop()!.remove();
        m.querySelectorAll('[data-open]').forEach((n) => { n.removeAttribute('data-open'); n.setAttribute('aria-expanded', 'false'); });
        const sub = build(e.items, depth + 1);
        layer.append(sub); menus.push(sub);
        b.setAttribute('data-open', ''); b.setAttribute('aria-expanded', 'true');
        const r = b.getBoundingClientRect();
        place(sub, r.right, r.top - 4, r);
        focusables(sub)[0]?.focus();
      };
      b.addEventListener('mouseenter', () => { b.focus(); if (e.items) openSub(); else { while (menus.length > depth + 1) menus.pop()!.remove(); m.querySelectorAll('[data-open]').forEach((n) => { n.removeAttribute('data-open'); n.setAttribute('aria-expanded', 'false'); }); } });
      b.addEventListener('mousedown', (ev) => ev.preventDefault());
      b.addEventListener('click', () => { if (e.disabled) return; if (e.items) openSub(); else { close(); o.onRun?.(); e.onClick?.(); } });
      m.append(b);
    }
    return m;
  };
  const first = build(entries, 0);
  layer.append(first); menus.push(first);
  root.append(layer);
  if (at instanceof HTMLElement) { const r = at.getBoundingClientRect(); place(first, r.left, r.bottom + 2); } else place(first, at.x, at.y);
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', onScroll, true);
  focusables(first)[0]?.focus();
  return { close, el: layer };
}

/** A colour palette pop-up: a grid of swatches, "No colour" and a custom colour. */
export function popColors(root: HTMLElement, anchor: HTMLElement, current: string | null, onPick: (c: string | null) => void, onClose?: () => void): PopHandle {
  const layer = el('div', 'wy-oc-layer');
  const box = el('div', 'wy-oc-menu wy-oc-colors');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', 'Colours');
  let closed = false;
  const close = () => { if (closed) return; closed = true; document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); layer.remove(); onClose?.(); };
  const out = (e: Event) => { if (!layer.contains(e.target as Node) && !anchor.contains(e.target as Node)) close(); };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
  const none = el('button', 'wy-oc-item', 'No colour');
  none.type = 'button';
  none.addEventListener('mousedown', (e) => e.preventDefault());
  none.addEventListener('click', () => { close(); onPick(null); });
  const grid = el('div', 'wy-oc-swatches');
  for (const c of PALETTE) {
    const b = el('button', `wy-oc-swatch${current?.toLowerCase() === c ? ' is-current' : ''}`);
    b.type = 'button'; b.style.background = c; b.title = c; b.setAttribute('aria-label', c);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => { close(); onPick(c); });
    grid.append(b);
  }
  const custom = el('label', 'wy-oc-custom', 'Custom ');
  const input = el('input');
  input.type = 'color'; input.value = /^#[0-9a-f]{6}$/i.test(current ?? '') ? current! : '#2563eb';
  input.addEventListener('change', () => { close(); onPick(input.value); });
  custom.append(input);
  box.append(none, grid, custom);
  layer.append(box);
  root.append(layer);
  const r = anchor.getBoundingClientRect();
  box.style.left = '0px'; box.style.top = '0px';
  const br = box.getBoundingClientRect();
  box.style.left = `${Math.max(4, Math.min(r.left, document.documentElement.clientWidth - br.width - 4))}px`;
  box.style.top = `${Math.min(r.bottom + 2, document.documentElement.clientHeight - br.height - 4)}px`;
  document.addEventListener('mousedown', out, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('resize', close);
  return { close, el: layer };
}

// ---- the chrome -------------------------------------------------------------------------------------------------------------

const STATUS: Record<string, string> = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Save failed, retrying…' };

export class Chrome {
  readonly el = el('div', 'wy-oc');
  private updaters: (() => void)[] = [];
  private statusEl = el('span', 'wy-oc-status');
  private titleEl: HTMLElement | null = null;
  private tabButtons = new Map<string, HTMLButtonElement>();
  private panels = new Map<string, HTMLElement>();
  private current = '';
  private bar: HTMLElement | null = null;
  private more: { btn: HTMLButtonElement; pop: HTMLElement } | null = null;
  private items: HTMLElement[] = [];
  private stopSize: (() => void) | null = null;
  private openPop: PopHandle | null = null;
  private onDoc = (e: Event) => { if (this.more && !this.more.pop.hidden && !this.more.pop.contains(e.target as Node) && !this.more.btn.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('.wy-oc-layer')) this.closeMore(); };

  constructor(private spec: ChromeSpec, private o: ChromeOptions) {
    this.el.classList.add(o.mode === 'floating' ? 'is-floating' : 'is-classic');
    this.buildHeader();
    if (o.mode === 'floating') { this.buildMenuBar(); if (o.toolbar !== false) this.buildToolbar(); } else this.buildRibbon();
    document.addEventListener('mousedown', this.onDoc, true);
  }

  private done() { this.refresh(); this.o.focus?.(); }

  private buildHeader() {
    const o = this.o;
    const header = el('div', 'wy-oc-header');
    const left = el('div', 'wy-oc-left');
    if (o.title !== undefined && o.title !== false) {
      const t = el(o.onTitle ? 'input' : 'span', 'wy-oc-title');
      if (t instanceof HTMLInputElement) {
        t.value = o.title; t.spellcheck = false; t.setAttribute('aria-label', 'Document name');
        t.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); t.blur(); o.focus?.(); } });
        t.addEventListener('change', () => { const v = t.value.trim() || (o.title as string); t.value = v; o.onTitle!(v); });
      } else t.textContent = o.title;
      this.titleEl = t;
      left.append(t);
    }
    this.statusEl.setAttribute('role', 'status');
    this.statusEl.hidden = true;
    left.append(this.statusEl);
    header.append(left);
    if (o.end) { const end = el('div', 'wy-oc-end'); end.append(o.end); header.append(end); }
    if (this.titleEl || o.end) this.el.append(header);
  }

  /** Show "Saving…", "Saved" and the like next to the name. Anything else hides it. */
  setStatus(status: string): void {
    this.statusEl.hidden = !STATUS[status];
    this.statusEl.textContent = STATUS[status] ?? '';
    this.statusEl.dataset.status = status;
  }

  setTitle(t: string): void { if (this.titleEl instanceof HTMLInputElement) this.titleEl.value = t; else if (this.titleEl) this.titleEl.textContent = t; }

  // ---- classic ribbon

  private buildRibbon() {
    const tabs = el('div', 'wy-oc-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', this.o.label ?? 'Ribbon');
    const body = el('div', 'wy-oc-panels');
    for (const tab of this.spec.tabs) {
      const b = el('button', 'wy-oc-tab', tab.label);
      b.type = 'button'; b.id = `wy-oc-tab-${tab.id}`;
      b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', `wy-oc-panel-${tab.id}`);
      b.addEventListener('click', () => this.select(tab.id));
      b.addEventListener('keydown', (e) => {
        const ids = this.spec.tabs.map((t) => t.id); const i = ids.indexOf(tab.id);
        const go = e.key === 'ArrowRight' ? ids[(i + 1) % ids.length] : e.key === 'ArrowLeft' ? ids[(i - 1 + ids.length) % ids.length] : e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[ids.length - 1] : null;
        if (go) { e.preventDefault(); this.select(go); this.tabButtons.get(go)!.focus(); }
      });
      tabs.append(b);
      this.tabButtons.set(tab.id, b);
      const panel = el('div', 'wy-oc-panel');
      panel.id = `wy-oc-panel-${tab.id}`; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', b.id); panel.hidden = true;
      for (const g of tab.groups) {
        const grp = el('div', 'wy-oc-group');
        grp.setAttribute('role', 'group'); grp.setAttribute('aria-label', g.label);
        const row = el('div', 'wy-oc-group-row');
        for (const c of g.controls) row.append(this.render(c, 'ribbon'));
        grp.append(row, el('div', 'wy-oc-group-label', g.label));
        panel.append(grp);
      }
      body.append(panel);
      this.panels.set(tab.id, panel);
    }
    this.el.append(tabs, body);
    this.select(this.o.initialTab && this.panels.has(this.o.initialTab) ? this.o.initialTab : this.spec.tabs[0]?.id ?? '');
  }

  /** Show a tab of the classic ribbon. */
  select(id: string): void {
    if (!this.panels.has(id)) return;
    this.current = id;
    for (const [k, p] of this.panels) {
      const on = k === id;
      p.hidden = !on;
      const b = this.tabButtons.get(k)!;
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; b.classList.toggle('is-active', on);
    }
    this.refresh();
  }

  get tab(): string { return this.current; }

  // ---- floating card

  private buildMenuBar() {
    if (!this.spec.menus.length) return;
    const bar = el('div', 'wy-oc-menubar');
    bar.setAttribute('role', 'menubar');
    const buttons: HTMLButtonElement[] = [];
    for (const m of this.spec.menus) {
      const b = el('button', 'wy-oc-menu-btn', m.label);
      b.type = 'button'; b.tabIndex = buttons.length ? -1 : 0;
      b.setAttribute('role', 'menuitem'); b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
      const show = () => {
        this.openPop?.close();
        b.setAttribute('aria-expanded', 'true'); b.classList.add('is-open');
        this.openPop = popMenu(this.o.root, b, m.entries(), { label: m.label, onClose: () => { b.setAttribute('aria-expanded', 'false'); b.classList.remove('is-open'); if (this.openPop && !this.openPop.el.isConnected) this.openPop = null; }, onRun: () => this.done() });
      };
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { if (b.classList.contains('is-open')) this.openPop?.close(); else show(); });
      b.addEventListener('mouseenter', () => { if (this.openPop?.el.isConnected && !b.classList.contains('is-open')) show(); });
      b.addEventListener('keydown', (e) => {
        const i = buttons.indexOf(b);
        const go = (n: number) => { const t = buttons[(n + buttons.length) % buttons.length]; buttons.forEach((x) => (x.tabIndex = x === t ? 0 : -1)); t.focus(); };
        if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
        else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); }
      });
      buttons.push(b);
      bar.append(b);
    }
    this.el.append(bar);
  }

  private buildToolbar() {
    const bar = el('div', 'wy-oc-toolbar');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', this.o.label ?? 'Toolbar');
    this.bar = bar;
    for (const c of this.spec.toolbar) { const e = this.render(c, 'toolbar'); this.items.push(e); bar.append(e); }
    const btn = el('button', 'wy-oc-btn wy-oc-more');
    btn.type = 'button'; btn.title = 'More'; btn.setAttribute('aria-label', 'More'); btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false'); btn.hidden = true;
    btn.innerHTML = icon('more', 18);
    const pop = el('div', 'wy-oc-more-pop');
    pop.hidden = true;
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => (pop.hidden ? this.openMore() : this.closeMore()));
    this.more = { btn, pop };
    const wrap = el('div', 'wy-oc-toolbar-wrap');
    wrap.append(bar, btn, pop);
    this.el.append(wrap);
    this.setupKeyboard(bar);
    this.stopSize = observeSize(wrap, () => this.layout());
    queueMicrotask(() => this.layout());
  }

  private setupKeyboard(bar: HTMLElement) {
    bar.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      if ((e.target as HTMLElement).tagName === 'SELECT' || (e.target as HTMLElement).tagName === 'INPUT') return;
      const all = [...bar.querySelectorAll<HTMLElement>('button, select')].filter((b) => !b.hasAttribute('disabled'));
      const i = all.indexOf(e.target as HTMLElement);
      if (i < 0) return;
      e.preventDefault();
      all[(i + (e.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length].focus();
    });
  }

  /** Fold the items that do not fit into "⋯". */
  private layout() {
    if (!this.bar || !this.more) return;
    const { btn, pop } = this.more;
    for (const it of this.items) this.bar.append(it);          // everything back, in order
    pop.hidden = true; btn.hidden = true; btn.setAttribute('aria-expanded', 'false');
    if (this.bar.clientWidth === 0) return;
    let moved = false;
    const moveLast = () => {
      const visible = [...this.bar!.children] as HTMLElement[];
      const last = visible[visible.length - 1];
      if (!last) return false;
      pop.prepend(last);
      return true;
    };
    while (this.bar.scrollWidth > this.bar.clientWidth + 1 && this.bar.children.length > 1) {
      if (!moveLast()) break;
      moved = true;
      btn.hidden = false;
    }
    // a separator left at the end of the bar, or at the start of the pop-up, looks wrong
    for (let last = this.bar.lastElementChild as HTMLElement | null; last?.classList.contains('wy-oc-tsep'); last = this.bar.lastElementChild as HTMLElement | null) pop.prepend(last);
    for (let first = pop.firstElementChild as HTMLElement | null; first?.classList.contains('wy-oc-tsep'); first = pop.firstElementChild as HTMLElement | null) this.bar.append(first);
    btn.hidden = !moved;
  }

  private openMore() { if (!this.more) return; this.more.pop.hidden = false; this.more.btn.setAttribute('aria-expanded', 'true'); }
  private closeMore() { if (!this.more) return; this.more.pop.hidden = true; this.more.btn.setAttribute('aria-expanded', 'false'); }

  // ---- controls

  private render(c: Control, where: 'ribbon' | 'toolbar'): HTMLElement {
    if (c.kind === 'sep') return el('span', 'wy-oc-tsep');
    const large = where === 'ribbon' && 'size' in c && c.size === 'large';
    if (c.kind === 'select') {
      const s = el('select', 'wy-oc-select');
      s.title = c.title; s.setAttribute('aria-label', c.title);
      if (c.width) s.style.width = `${c.width}px`;
      const fill = () => { const opts = c.options(); const key = opts.map((x) => x.value).join('\u0001'); if (s.dataset.k !== key) { s.dataset.k = key; s.replaceChildren(...opts.map((x) => new Option(x.label, x.value))); } };
      fill();
      s.addEventListener('change', () => { c.onChange(s.value); this.done(); });
      this.updaters.push(() => { fill(); s.value = c.value(); if (s.value !== c.value()) s.selectedIndex = -1; s.disabled = !!c.disabled?.(); });
      return s;
    }
    const b = el('button', `wy-oc-btn${large ? ' is-large' : ''}`);
    b.type = 'button';
    if ('title' in c && c.title) b.title = c.title; else if ('label' in c && c.label) b.title = c.label;
    b.setAttribute('aria-label', ('title' in c && c.title) || ('label' in c && c.label) || c.id);
    b.dataset.control = c.id;
    const ic = c.icon && hasIcon(c.icon) ? icon(c.icon, large ? 28 : 18) : '';
    const text = 'label' in c && c.label && (where === 'ribbon' || !c.icon || !ic) ? c.label : '';
    if (c.kind === 'color') {
      b.classList.add('is-color');
      b.innerHTML = `<span class="wy-oc-ic">${ic}</span>${icon('chevronDown', 10)}`;
      b.setAttribute('aria-haspopup', 'dialog');
      this.updaters.push(() => { b.style.setProperty('--oc-bar', c.value() ?? 'transparent'); b.disabled = !!c.disabled?.(); });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { this.openPop?.close(); this.openPop = popColors(this.o.root, b, c.value(), (col) => { c.onPick(col); this.done(); }); });
      return b;
    }
    b.innerHTML = `${ic ? `<span class="wy-oc-ic">${ic}</span>` : ''}${text ? `<span class="wy-oc-text">${text.replace(/[<>&]/g, (m) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[m]!)}</span>` : ''}${c.kind === 'menu' ? icon('chevronDown', 10) : ''}`;
    b.addEventListener('mousedown', (e) => e.preventDefault());
    if (c.kind === 'button') {
      b.addEventListener('click', () => { c.onClick(); this.done(); });
      this.updaters.push(() => { const on = !!c.active?.(); b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); b.disabled = !!c.disabled?.(); });
    } else {
      b.setAttribute('aria-haspopup', 'menu');
      b.addEventListener('click', () => {
        this.openPop?.close();
        b.setAttribute('aria-expanded', 'true');
        this.openPop = popMenu(this.o.root, b, c.entries(), { label: c.title ?? c.label, onClose: () => b.setAttribute('aria-expanded', 'false'), onRun: () => this.done() });
      });
      this.updaters.push(() => { b.disabled = !!c.disabled?.(); });
    }
    return b;
  }

  /** Ask every control for its state again (pressed, disabled, the value of a drop-down). */
  refresh(): void { for (const u of this.updaters) u(); }

  /** Re-fit the toolbar (after the card was resized from outside). */
  relayout(): void { this.layout(); }

  destroy(): void {
    this.openPop?.close();
    this.stopSize?.();
    document.removeEventListener('mousedown', this.onDoc, true);
    this.el.remove();
  }
}
