/**
 * The formula editor above the grid: a rounded bar with the name box (and its list), cancel and confirm buttons, an `fx` button that
 * opens the function list, the formula field, and a chevron that opens it to several lines. `attachSuggest` adds function names while
 * you type and a line with the syntax of the function you are in.
 */
import { categoryOf, functionNames, isCommon, signature, FUNCTION_CATEGORIES } from './formula-catalog';
import { popMenu, type MenuEntry } from './office-chrome';

const svg = (d: string) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  down: svg('<path d="m6 9 6 6 6-6"/>'),
  up: svg('<path d="m6 15 6-6 6 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  grip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><circle cx="12" cy="6" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18" r="1.5"/></svg>',
};

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const button = (cls: string, label: string, html: string): HTMLButtonElement => {
  const b = el('button', cls);
  b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = html;
  b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus where the text is
  return b;
};

export interface FormulaBar {
  el: HTMLElement;
  nameBox: HTMLInputElement;
  input: HTMLTextAreaElement;
  /** The cancel and confirm buttons are live while a cell is being edited. */
  setEditing(on: boolean): void;
  setReadOnly(on: boolean): void;
  expanded(): boolean;
  setExpanded(on: boolean): void;
}

export interface FormulaBarOptions {
  /** Carries the theme; menus open in it. */
  root: HTMLElement;
  confirm(): void;
  cancel(): void;
  /** The entries of the list under the name box. */
  nameList(): MenuEntry[];
  /** Put a function in the field: the text `SUM(` at the caret. */
  insert(text: string): void;
}

export function createFormulaBar(o: FormulaBarOptions): FormulaBar {
  const bar = el('div', 'wy-ss-fbar');
  const nameWrap = el('div', 'wy-ss-namewrap');
  const nameBox = el('input', 'wy-ss-name');
  nameBox.setAttribute('aria-label', 'Name box'); nameBox.spellcheck = false;
  const nameBtn = button('wy-ss-namebtn', 'Cell list', ICON.down);
  nameBtn.setAttribute('aria-haspopup', 'menu');
  nameBtn.addEventListener('click', () => popMenu(o.root, nameWrap, o.nameList(), { label: 'Go to' }));
  nameWrap.append(nameBox, nameBtn);

  const grip = el('span', 'wy-ss-grip'); grip.innerHTML = ICON.grip;
  const cancel = button('wy-ss-fb', 'Cancel (Esc)', ICON.close);
  const ok = button('wy-ss-fb', 'Enter', ICON.check);
  cancel.disabled = true; ok.disabled = true;
  cancel.addEventListener('click', () => o.cancel());
  ok.addEventListener('click', () => o.confirm());
  const fx = button('wy-ss-fx', 'Insert function', 'fx');
  fx.setAttribute('aria-haspopup', 'menu');
  fx.addEventListener('click', () => {
    const entries: MenuEntry[] = FUNCTION_CATEGORIES.map(([cat, names]) => ({ label: cat, items: names.map((n) => ({ label: n, shortcut: '', onClick: () => o.insert(`${n}(`) })) }));
    popMenu(o.root, fx, entries, { label: 'Functions' });
  });

  const input = el('textarea', 'wy-ss-formula');
  input.rows = 1; input.spellcheck = false;
  input.setAttribute('aria-label', 'Formula bar');
  input.setAttribute('autocomplete', 'off');
  const more = button('wy-ss-fmore', 'Expand formula bar', ICON.down);
  more.setAttribute('aria-expanded', 'false');
  let open = false;
  const setExpanded = (on: boolean) => {
    open = on;
    bar.classList.toggle('is-expanded', on);
    more.innerHTML = on ? ICON.up : ICON.down;
    more.title = on ? 'Collapse formula bar' : 'Expand formula bar';
    more.setAttribute('aria-label', more.title); more.setAttribute('aria-expanded', String(on));
  };
  more.addEventListener('click', () => setExpanded(!open));

  bar.append(nameWrap, grip, cancel, ok, fx, input, more);
  return {
    el: bar, nameBox, input,
    setEditing(on) { cancel.disabled = !on; ok.disabled = !on; bar.classList.toggle('is-editing', on); },
    setReadOnly(on) { input.readOnly = on; fx.disabled = on; },
    expanded: () => open,
    setExpanded,
  };
}

// ---- function names while typing ------------------------------------------------------------------------------------------------------

/** The name being typed just before the caret, when the text is a formula. */
function wordAt(text: string, caret: number): { start: number; word: string } | null {
  if (!text.trimStart().startsWith('=')) return null;
  const before = text.slice(0, caret);
  const m = /([A-Za-z_][A-Za-z0-9_.]*)$/.exec(before);
  if (!m) return null;
  const start = caret - m[1].length;
  const prev = before[start - 1];
  if (prev && /[A-Za-z0-9_.$!'"]/.test(prev)) return null;
  // a cell name such as A1 or B12 is not a function
  if (/^[A-Za-z]{1,3}\d+$/.test(m[1])) return null;
  return { start, word: m[1] };
}

/** The function the caret is inside, and which argument it is in. */
function callAt(text: string, caret: number): { name: string; arg: number } | null {
  if (!text.trimStart().startsWith('=')) return null;
  const stack: { name: string; arg: number }[] = [];
  let quote = false;
  for (let i = 0; i < caret; i++) {
    const ch = text[i];
    if (ch === '"') quote = !quote;
    if (quote) continue;
    if (ch === '(') { const m = /([A-Za-z_][A-Za-z0-9_.]*)$/.exec(text.slice(0, i)); stack.push({ name: m ? m[1].toUpperCase() : '', arg: 0 }); }
    else if (ch === ')') stack.pop();
    else if (ch === ',' && stack.length) stack[stack.length - 1].arg++;
  }
  for (let k = stack.length - 1; k >= 0; k--) if (stack[k].name) return stack[k];
  return null;
}

export interface Suggest { destroy(): void; close(): void }

/**
 * Suggestions for a text field (the formula bar and the cell editor). `host` is a positioned element the lists are drawn in.
 * Arrow keys choose, Tab or Enter take the choice, Escape closes the list.
 */
export function attachSuggest(field: HTMLTextAreaElement | HTMLInputElement, host: HTMLElement, onChange: () => void): Suggest {
  const list = el('div', 'wy-ss-suggest');
  list.setAttribute('role', 'listbox'); list.hidden = true;
  const hint = el('div', 'wy-ss-hint'); hint.hidden = true; hint.setAttribute('role', 'status');
  host.append(list, hint);
  let items: string[] = [];
  let at = 0;
  let span: { start: number; word: string } | null = null;

  const place = (box: HTMLElement) => {
    const h = host.getBoundingClientRect(); const f = field.getBoundingClientRect();
    box.style.left = `${Math.max(0, f.left - h.left)}px`;
    box.style.top = `${f.bottom - h.top + 2}px`;
  };
  const close = () => { list.hidden = true; items = []; };
  const paint = () => {
    list.replaceChildren();
    items.forEach((n, i) => {
      const row = el('div', `wy-ss-sg${i === at ? ' is-on' : ''}`);
      row.setAttribute('role', 'option'); row.setAttribute('aria-selected', String(i === at));
      row.append(el('span', 'wy-ss-sg-name', n), el('span', 'wy-ss-sg-cat', categoryOf(n)));
      row.addEventListener('mousedown', (e) => { e.preventDefault(); at = i; accept(); });
      list.append(row);
    });
    list.title = items[at] ? signature(items[at]) : '';
  };
  const accept = () => {
    const name = items[at];
    if (!name || !span) return;
    const v = field.value; const caret = field.selectionStart ?? v.length;
    const next = `${v.slice(0, span.start)}${name}(${v.slice(caret)}`;
    field.value = next;
    const pos = span.start + name.length + 1;
    field.setSelectionRange(pos, pos);
    close();
    field.dispatchEvent(new Event('input', { bubbles: true }));
    onChange();
  };
  const refresh = () => {
    const caret = field.selectionStart ?? field.value.length;
    span = wordAt(field.value, caret);
    const w = span?.word.toUpperCase() ?? '';
    items = w ? functionNames().filter((n) => n.startsWith(w) && n !== w).sort((a, b) => Number(isCommon(b)) - Number(isCommon(a)) || a.length - b.length || (a < b ? -1 : 1)).slice(0, 8) : [];
    if (items.length && document.activeElement === field) { at = 0; paint(); list.hidden = false; place(list); } else close();
    const call = document.activeElement === field ? callAt(field.value, caret) : null;
    if (call && items.length === 0) {
      const sig = signature(call.name);
      const inner = /\((.*)\)$/.exec(sig)?.[1] ?? '';
      const parts = inner.split(/,\s*/);
      hint.replaceChildren(el('span', 'wy-ss-hint-name', call.name + '('));
      parts.forEach((p, i) => {
        if (i) hint.append(', ');
        const on = i === Math.min(call.arg, parts.length - 1) || (p === '…' && call.arg >= parts.length - 1);
        hint.append(on ? el('b', '', p) : document.createTextNode(p));
      });
      hint.append(')');
      hint.hidden = false; place(hint);
    } else hint.hidden = true;
  };
  const onKey = (e: Event) => {
    const k = e as KeyboardEvent;
    if (!list.hidden && items.length) {
      if (k.key === 'ArrowDown' || k.key === 'ArrowUp') { k.preventDefault(); k.stopImmediatePropagation(); at = (at + (k.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; paint(); return; }
      if (k.key === 'Tab' || k.key === 'Enter') { k.preventDefault(); k.stopImmediatePropagation(); accept(); return; }
      if (k.key === 'Escape') { k.preventDefault(); k.stopImmediatePropagation(); close(); return; }
    }
  };
  const onInput = () => refresh();
  const hide = () => { close(); hint.hidden = true; };
  field.addEventListener('keydown', onKey, true);
  field.addEventListener('input', onInput);
  const onKeyUp = (e: Event) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes((e as KeyboardEvent).key)) refresh(); };
  field.addEventListener('keyup', onKeyUp);
  field.addEventListener('click', refresh);
  field.addEventListener('blur', hide);
  return {
    close: hide,
    destroy() { field.removeEventListener('keydown', onKey, true); field.removeEventListener('input', onInput); field.removeEventListener('click', refresh); field.removeEventListener('keyup', onKeyUp); field.removeEventListener('blur', hide); list.remove(); hint.remove(); },
  };
}
