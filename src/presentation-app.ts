/**
 * A presentation app on its own, in the manner of PowerPoint and Google Slides: slides with text boxes, shapes and pictures,
 * themes, layouts, transitions, a slide show with a presenter view, and export. `createPresentation({ element })` builds it, with the menus
 * as a classic ribbon or a floating card. It is the stand-alone entry `wysiwygido/presentation`.
 */
import './styles.css';
import './office.css';
import './presentation.css';
import { Chrome, popMenu, type ChromeSpec, type Control, type MenuEntry } from './office-chrome';
import { observeSize } from './resize';
import { SlideCanvas, readImageFile } from './presentation-editor';
import { ensureSlideCss, fitSlide, renderSlide, scaleTo, deckToHTML } from './presentation-render';
import { startShow, type Show } from './presentation-show';
import { deckToPptx, pptxToDeck } from './presentation-pptx';
import {
  DeckStore, FONTS, LAYOUT_IDS, SHAPES, SIZES, SIZE_STANDARD, SIZE_WIDE, THEMES,
  addEls, addSlide, alignEls, cleanDeck, deleteSlides, distributeEls, duplicateSlides, layoutLabel, moveSlide, newDeck, newImageEl, newShapeEl, newTextEl,
  reorderEls, setLayout, setSlideSize, setTheme, setTransition, slideIndex, slideTitle, styleEls, updateEls, updateSlide, htmlToText, textToHTML,
  type Deck, type ElStyle, type LayoutId, type ShapeKind, type SlideEl, type Transition,
} from './presentation-model';
import { defaultThemes, themeVars, type Theme } from './plugins/themes';

export {
  DeckStore, THEMES as PRESENTATION_THEMES, SHAPES as PRESENTATION_SHAPES, LAYOUT_IDS as PRESENTATION_LAYOUTS,
  cleanDeck as cleanPresentation, newDeck as newPresentation, deckToHTML as presentationToHTML, slideTitle, htmlToText, textToHTML,
};
export { renderSlide, fitSlide, readImageFile };
export type { Deck as PresentationData, SlideEl, ElStyle, LayoutId, ShapeKind, Transition };
export { defaultThemes, themeVars };
export type { Theme };
export type { Slide as PresentationSlide, DeckTheme as PresentationTheme } from './presentation-model';

export interface PresentationOptions {
  /** Where the app goes. Its content is replaced. */
  element: HTMLElement;
  /** The deck: `{ title, width, height, theme, slides: [{ layout, els: [...], notes }] }` (or its JSON text). Default: one title slide. */
  data?: Deck | string | null;
  /** `'classic'` (the tabbed ribbon) or `'floating'` (a rounded card with a menu bar and a one-row toolbar). Default `'classic'`. */
  menu?: 'classic' | 'floating';
  /** The colours of the app around the slides: `'light'`, `'dark'`, `'auto'`, a colour theme name or a theme object. */
  theme?: 'light' | 'dark' | 'auto' | string | Theme;
  themes?: Theme[];
  /** The name in the header (it is the deck's title). Editable when the header is shown. */
  title?: string | false;
  onTitle?: (title: string) => void;
  /** Your own controls at the right of the header: avatars, a Share button… */
  end?: HTMLElement;
  readOnly?: boolean;
  /** CSS height of the whole app. Default `'680px'`. */
  height?: string;
  /** Show the notes pane under the slide (default true). */
  notes?: boolean;
  statusBar?: boolean;
  /** Save the deck. The header shows Saving… and Saved. Reject to signal failure (retried). */
  save?: (data: Deck) => Promise<void> | void;
  /** Keep the deck in `localStorage` under this key and load it again next time (when no `data` is given). */
  storageKey?: string;
  saveDelayMs?: number;
  /** Called after every change with the deck as it now is. */
  onChange?: (data: Deck) => void;
  /** The ribbon tab shown first. */
  initialTab?: string;
}

export interface Presentation {
  readonly el: HTMLElement;
  readonly store: DeckStore;
  readonly canvas: SlideCanvas;
  getData(): Deck;
  setData(data: Deck | string): void;
  /** Number of the slide being edited (0-based). */
  readonly current: number;
  goTo(index: number): void;
  addSlide(layout?: LayoutId): void;
  /** Start the slide show (`from`: the slide to start at; default the first). */
  present(from?: number, presenter?: boolean): Show;
  toHTML(): string;
  /** The deck as a PowerPoint file (.pptx). */
  toPptx(): Promise<Blob>;
  /** Replace the deck with a PowerPoint file. Rejects with an `Error` for a file that is not a .pptx; `skipped` lists what could not be brought over (`['2 tables']`). */
  loadPptx(file: Blob | ArrayBuffer): Promise<{ skipped: string[] }>;
  undo(): void;
  redo(): void;
  setMenu(menu: 'classic' | 'floating'): void;
  setTheme(theme: NonNullable<PresentationOptions['theme']>): void;
  setReadOnly(on: boolean): void;
  focus(): void;
  /**
   * `'error'`: `{ message }` for a file that could not be opened or a picture that was turned away.
   * `'import'`: `{ slides, skipped }` after a .pptx file was opened: the number of slides and a list of what was left out (`['2 tables']`).
   */
  on(event: 'change' | 'select' | 'save' | 'slide' | 'error' | 'import', fn: (payload: unknown) => void): () => void;
  destroy(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function download(content: string | Blob, name: string, type: string) {
  const url = URL.createObjectURL(typeof content === 'string' ? new Blob([content], { type }) : content);
  const a = el('a');
  a.href = url; a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const safeName = (t: string | undefined) => (t ?? 'presentation').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'presentation';

export function createPresentation(options: PresentationOptions): Presentation {
  const o = options;
  ensureSlideCss();
  let menuMode: 'classic' | 'floating' = o.menu === 'floating' ? 'floating' : 'classic';
  let readOnly = !!o.readOnly;
  let showNotes = o.notes !== false;
  let view: 'normal' | 'sorter' = 'normal';
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const emit = (ev: string, p: unknown) => { for (const f of [...(listeners.get(ev) ?? [])]) { try { f(p); } catch (e) { console.error(`Presentation "${ev}" listener failed`, e); } } };

  let initial: Deck | null = null;
  if (o.data) initial = cleanDeck(o.data);
  else if (o.storageKey) { try { const raw = localStorage.getItem(o.storageKey); if (raw) initial = cleanDeck(raw); } catch { /* storage blocked */ } }
  const store = new DeckStore(initial ?? newDeck(typeof o.title === 'string' ? o.title : 'Untitled presentation'));
  if (typeof o.title === 'string' && !initial?.title) store.deck = { ...store.deck, title: o.title };

  const root = el('div', 'wy-app wy-pr-app');
  root.style.height = o.height ?? '680px';
  const applyTheme = (t: NonNullable<PresentationOptions['theme']>) => {
    const all = [...defaultThemes, ...(o.themes ?? [])];
    root.removeAttribute('style');
    root.style.height = o.height ?? '680px';
    const sys = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    let mode: 'light' | 'dark' = 'light';
    if (t === 'auto') mode = sys?.matches ? 'dark' : 'light';
    else if (t === 'dark' || t === 'light') mode = t;
    else { const th = typeof t === 'string' ? all.find((x) => x.name === t) : t; if (th) { mode = th.palette.mode ?? 'light'; for (const [k, v] of Object.entries(themeVars(th.palette))) root.style.setProperty(k, v); } }
    root.dataset.theme = mode;
  };
  applyTheme(o.theme ?? 'light');
  let sysQuery: MediaQueryList | null = null;
  const onSys = () => { if (o.theme === 'auto') applyTheme('auto'); };
  if (o.theme === 'auto' && typeof matchMedia === 'function') { sysQuery = matchMedia('(prefers-color-scheme: dark)'); sysQuery.addEventListener?.('change', onSys); }

  const deck = (): Deck => store.deck;
  let curId = deck().slides[0].id;
  let sel: string[] = [curId];                               // selected slides in the thumbnail strip
  let anchorId = curId;

  let chrome: Chrome | null = null;
  // ---- the canvas
  const canvas = new SlideCanvas(store, {
    readOnly,
    onSelect: () => { chrome?.refresh(); emit('select', { ids: canvas.selected }); },
    onState: () => chrome?.refresh(),
    onError: (message) => emit('error', { message }),
    onContext: (x, y, onEl) => openContext(x, y, onEl),
  });
  canvas.setSlide(curId);

  const cur = () => deck().slides.find((s) => s.id === curId) ?? deck().slides[0];
  const curIndex = () => Math.max(0, slideIndex(deck(), cur().id));

  // ---- thumbnails and the sorter
  const strip = el('div', 'wy-pr-thumbs');
  strip.setAttribute('role', 'listbox'); strip.setAttribute('aria-label', 'Slides'); strip.setAttribute('aria-multiselectable', 'true'); strip.tabIndex = 0;
  const sorter = el('div', 'wy-pr-sorter');
  sorter.setAttribute('role', 'listbox'); sorter.setAttribute('aria-label', 'Slide sorter'); sorter.tabIndex = 0; sorter.hidden = true;
  const thumbCache = new Map<string, { ref: unknown; deckKey: string; dom: HTMLElement; stop: () => void }>();
  let dragId: string | null = null;

  const makeThumb = (id: string, big: boolean): HTMLElement => {
    const s = deck().slides.find((x) => x.id === id)!;
    const i = slideIndex(deck(), id);
    const item = el('div', `wy-pr-thumb${id === curId ? ' is-current' : ''}${sel.includes(id) ? ' is-sel' : ''}${s.hidden ? ' is-hidden' : ''}`);
    item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(sel.includes(id))); item.dataset.id = id;
    item.setAttribute('aria-label', `Slide ${i + 1}${slideTitle(s) ? `: ${slideTitle(s)}` : ''}`);
    item.draggable = !readOnly;
    const num = el('span', 'wy-pr-thumbnum', String(i + 1));
    const host = el('div', 'wy-pr-thumbhost');
    host.style.aspectRatio = `${deck().width} / ${deck().height}`;
    const dom = renderSlide(deck(), s);
    host.append(dom);
    item.append(num, host);
    const key = `${deck().theme}|${deck().width}|${deck().height}`;
    const old = thumbCache.get(`${big ? 'b' : 's'}${id}`);
    old?.stop();
    const stop = scaleTo(host, dom, deck(), 'width');
    thumbCache.set(`${big ? 'b' : 's'}${id}`, { ref: s, deckKey: key, dom: item, stop });
    item.addEventListener('click', (e) => selectSlide(id, e.shiftKey, e.ctrlKey || e.metaKey));
    item.addEventListener('dblclick', () => { if (view === 'sorter') setView('normal'); });
    item.addEventListener('contextmenu', (e) => { e.preventDefault(); if (!sel.includes(id)) selectSlide(id, false, false); openSlideMenu(e.clientX, e.clientY); });
    item.addEventListener('dragstart', (e) => { dragId = id; e.dataTransfer?.setData('text/plain', id); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
    item.addEventListener('dragover', (e) => { if (dragId) { e.preventDefault(); const r = item.getBoundingClientRect(); const before = big ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2; item.classList.toggle('drop-before', before); item.classList.toggle('drop-after', !before); } });
    item.addEventListener('dragleave', () => item.classList.remove('drop-before', 'drop-after'));
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const before = item.classList.contains('drop-before');
      item.classList.remove('drop-before', 'drop-after');
      if (dragId && dragId !== id) {
        const from = slideIndex(deck(), dragId); let to = slideIndex(deck(), id) + (before ? 0 : 1);
        if (from < to) to--;
        store.set(moveSlide(deck(), dragId, to), 'move slide');
      }
      dragId = null;
    });
    item.addEventListener('dragend', () => { dragId = null; });
    fitSlide(dom);
    return item;
  };

  const renderThumbs = () => {
    const d = deck();
    const target = view === 'sorter' ? sorter : strip;
    const big = view === 'sorter';
    for (const [k, v] of [...thumbCache]) { v.stop(); thumbCache.delete(k); }
    target.replaceChildren(...d.slides.map((s) => makeThumb(s.id, big)));
    if (!big) target.querySelector('.is-current')?.scrollIntoView?.({ block: 'nearest' });
  };

  /** Refresh only what changed: the thumbnail of a slide that was edited, the numbers, the current mark. */
  const syncThumbs = () => {
    const d = deck();
    const target = view === 'sorter' ? sorter : strip;
    const big = view === 'sorter';
    const ids = d.slides.map((s) => s.id);
    const present = [...target.children].map((c) => (c as HTMLElement).dataset.id);
    const key = `${d.theme}|${d.width}|${d.height}`;
    const sameOrder = ids.length === present.length && ids.every((id, i) => id === present[i]);
    const stale = d.slides.some((s) => { const c = thumbCache.get(`${big ? 'b' : 's'}${s.id}`); return !c || c.deckKey !== key; });
    if (!sameOrder || stale) { renderThumbs(); return; }
    d.slides.forEach((s, i) => {
      const c = thumbCache.get(`${big ? 'b' : 's'}${s.id}`)!;
      if (c.ref !== s) { const fresh = makeThumb(s.id, big); c.dom.replaceWith(fresh); return; }
      c.dom.classList.toggle('is-current', s.id === curId);
      c.dom.classList.toggle('is-sel', sel.includes(s.id));
      c.dom.setAttribute('aria-selected', String(sel.includes(s.id)));
      const n = c.dom.querySelector('.wy-pr-thumbnum'); if (n && n.textContent !== String(i + 1)) n.textContent = String(i + 1);
    });
  };

  const selectSlide = (id: string, range: boolean, add: boolean) => {
    if (!deck().slides.some((s) => s.id === id)) return;
    if (range) {
      const a = slideIndex(deck(), anchorId); const b = slideIndex(deck(), id);
      sel = deck().slides.slice(Math.min(a, b), Math.max(a, b) + 1).map((s) => s.id);
    } else if (add) sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    else { sel = [id]; anchorId = id; }
    if (!sel.length) sel = [id];
    if (id !== curId) { flushNotes(); curId = id; canvas.setSlide(id); loadNotes(); emit('slide', { index: curIndex() }); }
    syncThumbs();
    chrome?.refresh();
    updateStatus();
  };

  strip.addEventListener('keydown', (e) => {
    const d = deck(); const i = curIndex();
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = Math.max(0, Math.min(d.slides.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      if (mod && !readOnly) { store.set(moveSlide(d, curId, n), 'move slide'); return; }
      selectSlide(d.slides[n].id, e.shiftKey, false);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) { e.preventDefault(); removeSlides(); }
    else if (e.key === 'Enter' && !readOnly) { e.preventDefault(); newSlide(); }
    else if (mod && (e.key === 'd' || e.key === 'D') && !readOnly) { e.preventDefault(); dupSlides(); }
    else if (e.key === 'Home') { e.preventDefault(); selectSlide(d.slides[0].id, false, false); }
    else if (e.key === 'End') { e.preventDefault(); selectSlide(d.slides[d.slides.length - 1].id, false, false); }
  });
  sorter.addEventListener('keydown', (e) => strip.dispatchEvent(new KeyboardEvent('keydown', e)));

  // ---- notes
  const notesBox = el('div', 'wy-pr-notes-pane');
  const notesLabel = el('label', 'wy-pr-notes-label', 'Speaker notes');
  const notesArea = el('textarea', 'wy-pr-notes-area');
  notesArea.placeholder = 'Click to add speaker notes';
  notesArea.id = `wy-pr-notes-${Math.random().toString(36).slice(2, 7)}`;
  notesLabel.htmlFor = notesArea.id;
  notesBox.append(notesLabel, notesArea);
  let notesTimer: ReturnType<typeof setTimeout> | undefined;
  const flushNotes = () => {
    clearTimeout(notesTimer);
    const s = deck().slides.find((x) => x.id === notesFor);
    if (s && s.notes !== notesArea.value) store.set(updateSlide(deck(), s.id, { notes: notesArea.value }), 'notes');
  };
  let notesFor = curId;
  const loadNotes = () => { notesFor = curId; notesArea.value = cur().notes; notesArea.readOnly = readOnly; };
  notesArea.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(flushNotes, 600); });
  notesArea.addEventListener('blur', flushNotes);
  notesBox.hidden = !showNotes;

  // ---- layout of the app
  const body = el('div', 'wy-pr-body');
  const main = el('div', 'wy-pr-main');
  main.append(canvas.el, notesBox);
  body.append(strip, main, sorter);
  const status = el('div', 'wy-pr-status');
  const slideInfo = el('span', 'wy-pr-slideinfo');
  const viewBtns = el('div', 'wy-pr-viewbtns');
  const mkView = (label: string, v: 'normal' | 'sorter') => { const b = el('button', 'wy-pr-vbtn', label); b.type = 'button'; b.addEventListener('click', () => setView(v)); return b; };
  const bNormal = mkView('Normal', 'normal'); const bSorter = mkView('Slide sorter', 'sorter');
  const bShow = el('button', 'wy-pr-vbtn', '▶ Show'); bShow.type = 'button'; bShow.title = 'Slide show from the current slide (Shift+F5)'; bShow.addEventListener('click', () => api.present(curIndex()));
  viewBtns.append(bNormal, bSorter, bShow);
  const zoomSel = el('select', 'wy-pr-zoomsel');
  zoomSel.setAttribute('aria-label', 'Zoom');
  for (const [v, l] of [['fit', 'Fit'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%']]) zoomSel.add(new Option(l, v));
  zoomSel.addEventListener('change', () => { canvas.setZoom(zoomSel.value === 'fit' ? 'fit' : Number(zoomSel.value)); chrome?.refresh(); });
  status.append(slideInfo, viewBtns, zoomSel);
  const updateStatus = () => { slideInfo.textContent = `Slide ${curIndex() + 1} of ${deck().slides.length}`; bNormal.classList.toggle('is-on', view === 'normal'); bSorter.classList.toggle('is-on', view === 'sorter'); };

  const setView = (v: 'normal' | 'sorter') => {
    flushNotes();
    view = v;
    strip.hidden = v === 'sorter'; main.hidden = v === 'sorter'; sorter.hidden = v !== 'sorter';
    root.classList.toggle('is-sorter', v === 'sorter');
    renderThumbs();
    if (v === 'normal') canvas.sync();
    updateStatus(); chrome?.refresh();
  };

  // ---- slide commands
  const newSlide = (layout?: LayoutId) => {
    if (readOnly) return;
    flushNotes();
    const lay = layout ?? (cur().layout === 'title' ? 'titleContent' : cur().layout === 'blank' ? 'blank' : cur().layout);
    const { deck: next, slide } = addSlide(deck(), curIndex() + 1, lay);
    curId = slide.id; sel = [slide.id]; anchorId = slide.id;
    store.set(next, 'new slide');
    canvas.setSlide(slide.id);
    loadNotes();
    canvas.focus();
  };
  const dupSlides = () => {
    if (readOnly) return;
    const r = duplicateSlides(deck(), sel);
    store.set(r.deck, 'duplicate slide');
    if (r.ids.length) { curId = r.ids[r.ids.length - 1]; sel = r.ids; anchorId = curId; canvas.setSlide(curId); loadNotes(); syncThumbs(); }
  };
  const removeSlides = () => {
    if (readOnly) return;
    const at = Math.min(...sel.map((id) => slideIndex(deck(), id)));
    const next = deleteSlides(deck(), sel);
    store.set(next, 'delete slide');
    const keep = next.slides[Math.min(at, next.slides.length - 1)];
    curId = keep.id; sel = [keep.id]; anchorId = keep.id; canvas.setSlide(keep.id); loadNotes(); renderThumbs(); chrome?.refresh(); updateStatus();
  };
  const moveSlides = (delta: number) => {
    if (readOnly) return;
    const i = curIndex();
    store.set(moveSlide(deck(), curId, Math.max(0, Math.min(deck().slides.length - 1, i + delta))), 'move slide');
  };

  // ---- element commands
  const targets = (): string[] => (canvas.isEditing && canvas.editingId ? [canvas.editingId] : canvas.selected);
  const firstStyle = (): ElStyle => { const id = targets()[0]; return (id ? cur().els.find((e) => e.id === id)?.style : undefined) ?? {}; };
  const firstEl = (): SlideEl | undefined => { const id = targets()[0]; return id ? cur().els.find((e) => e.id === id) : undefined; };
  const hasTargets = () => targets().length > 0;

  /** Change something on the boxes: text being typed is saved first, and typing goes on afterwards. */
  const edit = (fn: () => void) => {
    if (readOnly) return;
    const id = canvas.isEditing ? canvas.editingId : null;
    if (id) canvas.endEdit(true);
    fn();
    if (id && cur().els.some((e) => e.id === id)) canvas.startEdit(id);
  };
  const setStyle = (patch: Partial<Record<keyof ElStyle, unknown>>) => edit(() => { const ids = canvas.isEditing ? [canvas.editingId!] : canvas.selected; if (ids.length) store.set(styleEls(deck(), curId, ids, patch), 'format'); });
  const toggleStyle = (f: 'b' | 'i' | 'u' | 's') => {
    if (readOnly) return;
    if (canvas.isEditing && canvas.hasTextSelection) { canvas.execInline(f === 'b' ? 'bold' : f === 'i' ? 'italic' : f === 'u' ? 'underline' : 'strikeThrough'); return; }
    const on = !!firstStyle()[f];
    setStyle({ [f]: on ? undefined : 1 });
  };
  const inlineOn = (f: 'b' | 'i' | 'u' | 's') => (canvas.isEditing && canvas.hasTextSelection ? canvas.queryInline(f === 'b' ? 'bold' : f === 'i' ? 'italic' : f === 'u' ? 'underline' : 'strikeThrough') : !!firstStyle()[f]);
  /** Colour, size or font: on the selected words while typing, else on the whole box. */
  const setText = (css: Record<string, string>, patch: Partial<Record<keyof ElStyle, unknown>>) => {
    if (canvas.isEditing && canvas.hasTextSelection && canvas.styleSelection(css)) return;
    setStyle(patch);
  };
  const setEls = (patch: Partial<SlideEl> | ((e: SlideEl) => Partial<SlideEl>)) => edit(() => { const ids = targets(); if (ids.length) store.set(updateEls(deck(), curId, ids, patch), 'format'); });
  const shapesSelected = () => cur().els.filter((e) => targets().includes(e.id) && e.type === 'shape');

  const addEl = (e: SlideEl, editNow = false) => {
    if (readOnly) return;
    if (canvas.isEditing) canvas.endEdit(true);
    store.set(addEls(deck(), curId, [e]), 'insert');
    canvas.select([e.id]);
    if (editNow) canvas.startEdit(e.id);
  };
  const insertShape = (kind: ShapeKind) => addEl(newShapeEl(deck(), kind));
  const pickImage = () => {
    const input = el('input');
    input.type = 'file'; input.accept = 'image/*'; input.multiple = true;
    input.addEventListener('change', () => { const f = [...(input.files ?? [])]; if (f.length) void canvas.addImages(f); });
    input.click();
  };
  const arrange = (how: 'front' | 'back' | 'forward' | 'backward') => { if (!readOnly && canvas.selected.length) store.set(reorderEls(deck(), curId, canvas.selected, how), 'arrange'); };
  const alignSel = (how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => { if (!readOnly && canvas.selected.length) store.set(alignEls(deck(), curId, canvas.selected, how), 'align'); };

  // ---- file
  const openFile = () => {
    const input = el('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 100 * 1024 * 1024) { emit('error', { message: 'The file is larger than 100 MB' }); return; }
      try {
        const text = await f.text();
        if (!Array.isArray((JSON.parse(text) as { slides?: unknown })?.slides)) throw new Error('no slides');
        api.setData(text);
      } catch { emit('error', { message: 'This file is not a presentation' }); }
    });
    input.click();
  };
  const PPTX_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const openPptx = () => {
    const input = el('input');
    input.type = 'file'; input.accept = `.pptx,${PPTX_TYPE}`;
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 100 * 1024 * 1024) { emit('error', { message: 'The file is larger than 100 MB' }); return; }
      try { await api.loadPptx(f); } catch (e) { emit('error', { message: e instanceof Error && e.message ? e.message : 'This file could not be opened' }); }
    });
    input.click();
  };
  const downloadPptx = async () => {
    try { download(await api.toPptx(), `${safeName(deck().title)}.pptx`, PPTX_TYPE); } catch { emit('error', { message: 'The PowerPoint file could not be made' }); }
  };
  const printDeck = () => {
    const frame = el('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    frame.setAttribute('sandbox', 'allow-same-origin allow-modals');   // the printed copy runs no script
    document.body.append(frame);
    frame.addEventListener('load', () => { setTimeout(() => { frame.contentWindow?.focus(); frame.contentWindow?.print(); setTimeout(() => frame.remove(), 3000); }, 200); });
    frame.srcdoc = deckToHTML(deck());
  };
  let show: Show | null = null;
  const present = (from = 0, presenter = false): Show => {
    flushNotes();
    if (canvas.isEditing) canvas.endEdit(true);
    show?.close();
    const s = startShow(root, deck(), { start: from, presenter, onExit: () => { show = null; canvas.focus(); }, onSlide: (i) => { if (deck().slides[i] && deck().slides[i].id !== curId) { /* keep the editor where it was */ } } });
    show = s;
    return s;
  };

  // ---- menus
  const btn = (id: string, label: string | undefined, ic: string, onClick: () => void, extra: { title?: string; active?: () => boolean; size?: 'large' | 'small'; keepOpen?: boolean; edit?: boolean; disabled?: () => boolean } = {}): Control => ({
    kind: 'button', id, label, icon: ic, title: extra.title ?? label, size: extra.size, onClick, active: extra.active, disabled: extra.disabled ?? (extra.edit === false ? undefined : () => readOnly),
  });
  const menu = (id: string, label: string | undefined, ic: string, entries: () => MenuEntry[], size?: 'large' | 'small', title?: string): Control => ({ kind: 'menu', id, label, icon: ic, entries, size, title: title ?? label, disabled: () => readOnly });
  const sep: Control = { kind: 'sep' };

  const layoutEntries = (apply: (l: LayoutId) => void, checked?: LayoutId): MenuEntry[] => LAYOUT_IDS.map((l) => ({ label: layoutLabel(l), checked: checked === undefined ? undefined : checked === l, onClick: () => apply(l) }));
  const shapeEntries = (): MenuEntry[] => SHAPES.map((s) => ({ label: s.label, icon: ['rect', 'ellipse', 'triangle', 'line', 'arrow', 'star'].includes(s.kind) ? s.kind : undefined, onClick: () => insertShape(s.kind) }));
  const themeEntries = (): MenuEntry[] => THEMES.map((t) => ({ label: t.label, checked: deck().theme === t.name, onClick: () => store.set(setTheme(deck(), t.name), 'theme') }));
  const arrangeEntries = (): MenuEntry[] => [
    { heading: 'Order' },
    { label: 'Bring to front', icon: 'front', onClick: () => arrange('front'), disabled: !hasTargets() }, { label: 'Send to back', icon: 'back', onClick: () => arrange('back'), disabled: !hasTargets() },
    { label: 'Bring forward', onClick: () => arrange('forward'), disabled: !hasTargets() }, { label: 'Send backward', onClick: () => arrange('backward'), disabled: !hasTargets() },
    '-', { heading: 'Align' },
    ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((h) => ({ label: `Align ${h}`, onClick: () => alignSel(h), disabled: !hasTargets() })),
    '-',
    { label: 'Distribute horizontally', onClick: () => store.set(distributeEls(deck(), curId, canvas.selected, 'horizontal'), 'distribute'), disabled: canvas.selected.length < 3 },
    { label: 'Distribute vertically', onClick: () => store.set(distributeEls(deck(), curId, canvas.selected, 'vertical'), 'distribute'), disabled: canvas.selected.length < 3 },
    '-',
    { label: 'Rotate right 90°', onClick: () => setEls((e) => ({ rot: (((e.rot ?? 0) + 90 + 180) % 360) - 180 || undefined })), disabled: !hasTargets() },
    { label: 'Rotate left 90°', onClick: () => setEls((e) => ({ rot: (((e.rot ?? 0) - 90 + 540) % 360) - 180 || undefined })), disabled: !hasTargets() },
    { label: firstEl()?.locked ? 'Unlock' : 'Lock position', onClick: () => setEls((e) => ({ locked: e.locked ? undefined : 1 })), disabled: !hasTargets() },
  ];
  const bulletEntries = (): MenuEntry[] => (['none', 'bullet', 'number'] as const).map((b) => ({ label: b === 'none' ? 'No list' : b === 'bullet' ? 'Bullets' : 'Numbering', checked: (firstStyle().bullets ?? 'none') === b, disabled: !hasTargets(), onClick: () => setStyle({ bullets: b === 'none' ? undefined : b }) }));
  const spacingEntries = (): MenuEntry[] => [1, 1.15, 1.5, 2].map((n) => ({ label: `Line spacing ${n}`, checked: (firstStyle().line ?? 1.2) === n, disabled: !hasTargets(), onClick: () => setStyle({ line: n }) }));
  const bgEntries = (): MenuEntry[] => ['#ffffff', '#f3f4f6', '#111827', '#dbeafe', '#fef3c7', '#dcfce7', '#fce7f3'].map((c) => ({ label: c, icon: 'background', onClick: () => store.set(updateSlide(deck(), curId, { bg: c }), 'background') })).concat([{ label: 'Use the theme background', icon: 'background', onClick: () => store.set(updateSlide(deck(), curId, { bg: null }), 'background') }]);
  const transitionEntries = (): MenuEntry[] => (['none', 'fade', 'slide', 'zoom'] as Transition[]).map((t) => ({ label: t === 'none' ? 'None' : t === 'fade' ? 'Fade' : t === 'slide' ? 'Push' : 'Zoom', checked: (cur().transition ?? 'none') === t, onClick: () => store.set(setTransition(deck(), sel, t), 'transition') }));
  const fileEntries = (): MenuEntry[] => [
    { label: 'Open deck (.json)…', icon: 'openFile', onClick: openFile, disabled: readOnly },
    { label: 'Open .pptx…', icon: 'openFile', onClick: openPptx, disabled: readOnly },
    { label: 'Download as .json', icon: 'download', onClick: () => download(JSON.stringify(deck(), null, 2), `${safeName(deck().title)}.json`, 'application/json') },
    { label: 'Download as web page (.html)', icon: 'download', onClick: () => download(deckToHTML(deck()), `${safeName(deck().title)}.html`, 'text/html') },
    { label: 'Download as PowerPoint (.pptx)', icon: 'download', onClick: () => { void downloadPptx(); } },
    '-', { label: 'Print / save as PDF', icon: 'print', onClick: printDeck },
  ];
  const slideEntries = (): MenuEntry[] => [
    { label: 'New slide', icon: 'slideAdd', shortcut: 'Ctrl+M', disabled: readOnly, onClick: () => newSlide() },
    { label: 'New slide with layout', items: layoutEntries((l) => newSlide(l)) },
    { label: 'Duplicate slide', icon: 'duplicate', disabled: readOnly, onClick: dupSlides },
    { label: 'Delete slide', icon: 'trash', disabled: readOnly, onClick: removeSlides },
    '-',
    { label: 'Layout', items: layoutEntries((l) => store.set(setLayout(deck(), curId, l), 'layout'), cur().layout) },
    { label: 'Move up', disabled: readOnly || curIndex() === 0, onClick: () => moveSlides(-1) }, { label: 'Move down', disabled: readOnly || curIndex() >= deck().slides.length - 1, onClick: () => moveSlides(1) },
    { label: cur().hidden ? 'Show slide' : 'Hide slide', disabled: readOnly, onClick: () => store.set(updateSlide(deck(), curId, { hidden: cur().hidden ? undefined : 1 }), 'hide slide') },
    '-', { label: 'Background', items: bgEntries() }, { label: 'Transition', items: transitionEntries() },
  ];
  const openSlideMenu = (x: number, y: number) => popMenu(root, { x, y }, slideEntries(), { label: 'Slide menu', onRun: () => canvas.focus() });
  const openContext = (x: number, y: number, onEl: boolean) => {
    const entries: MenuEntry[] = onEl
      ? [{ label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', onClick: () => canvas.cut(), disabled: readOnly }, { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', onClick: () => canvas.copy(null) }, { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', onClick: () => canvas.paste(), disabled: readOnly },
        { label: 'Duplicate', icon: 'duplicate', shortcut: 'Ctrl+D', onClick: () => canvas.duplicate(), disabled: readOnly }, { label: 'Delete', icon: 'trash', shortcut: 'Del', onClick: () => canvas.deleteSelected(), disabled: readOnly }, '-', { label: 'Arrange', items: arrangeEntries() }]
      : [{ label: 'Paste', icon: 'paste', onClick: () => canvas.paste(), disabled: readOnly }, { label: 'New text box', icon: 'textBox', onClick: () => addEl(newTextEl(deck()), true), disabled: readOnly }, { label: 'New slide', icon: 'slideAdd', onClick: () => newSlide(), disabled: readOnly }, '-', { label: 'Background', items: bgEntries() }, { label: 'Layout', items: layoutEntries((l) => store.set(setLayout(deck(), curId, l), 'layout'), cur().layout) }];
    popMenu(root, { x, y }, entries, { label: 'Slide menu', onRun: () => canvas.focus() });
  };

  const fontSel = (): Control => ({ kind: 'select', id: 'font', title: 'Font', width: 122, options: () => [{ label: 'Theme font', value: '' }, ...FONTS.map((f) => ({ label: f, value: f }))], value: () => firstStyle().font ?? '', onChange: (v) => setText(v ? { 'font-family': v } : {}, { font: v || undefined }), disabled: () => readOnly || !hasTargets() });
  const sizeSel = (): Control => ({ kind: 'select', id: 'size', title: 'Font size', width: 62, options: () => { const now = firstStyle().size; const list = now && !SIZES.includes(now) ? [...SIZES, now].sort((x, y) => x - y) : SIZES; return list.map((n) => ({ label: String(n), value: String(n) })); }, value: () => String(firstStyle().size ?? (firstEl()?.ph === 'title' ? 44 : 28)), onChange: (v) => setText({ 'font-size': `${v}px` }, { size: Number(v), fit: undefined }), disabled: () => readOnly || !hasTargets() });
  const textColor = (): Control => ({ kind: 'color', id: 'textcolor', title: 'Text colour', icon: 'fontColor', value: () => firstStyle().color ?? '#000000', onPick: (c) => setText(c ? { color: c } : {}, { color: c ?? undefined }), disabled: () => readOnly || !hasTargets() });
  const fillColor = (): Control => ({ kind: 'color', id: 'fill', title: 'Shape fill', icon: 'fillColor', value: () => shapesSelected()[0]?.fill ?? null, onPick: (c) => edit(() => { const ids = shapesSelected().map((e) => e.id); if (ids.length) store.set(updateEls(deck(), curId, ids, { fill: c }), 'format'); }), disabled: () => readOnly || !shapesSelected().length });
  const lineColor = (): Control => ({ kind: 'color', id: 'outline', title: 'Shape outline', icon: 'borders', value: () => shapesSelected()[0]?.stroke ?? null, onPick: (c) => edit(() => { const ids = shapesSelected().map((e) => e.id); if (ids.length) store.set(updateEls(deck(), curId, ids, (e) => ({ stroke: c, strokeW: c ? (e.strokeW && e.strokeW > 0 ? e.strokeW : 3) : 0 })), 'format'); }), disabled: () => readOnly || !shapesSelected().length });
  const B = (id: string, label: string, ic: string, f: 'b' | 'i' | 'u' | 's', key: string): Control => btn(id, undefined, ic, () => toggleStyle(f), { title: `${label}${key ? ` (${key})` : ''}`, active: () => inlineOn(f), disabled: () => readOnly || !hasTargets() });
  const alignBtn = (a: 'left' | 'center' | 'right' | 'justify', ic: string): Control => btn(`al-${a}`, undefined, ic, () => setStyle({ align: a === 'left' ? undefined : a }), { title: `Align ${a}`, active: () => (firstStyle().align ?? 'left') === a, disabled: () => readOnly || !hasTargets() });
  const valign = (a: 'top' | 'middle' | 'bottom', ic: string): Control => btn(`va-${a}`, undefined, ic, () => setStyle({ valign: a === 'top' ? undefined : a }), { title: `Align ${a}`, active: () => (firstStyle().valign ?? 'top') === a, disabled: () => readOnly || !hasTargets() });
  const undoRedo = (): Control[] => [
    { kind: 'button', id: 'undo', icon: 'undo', title: 'Undo (Ctrl+Z)', onClick: () => undo(), disabled: () => (!store.canUndo && !canvas.isEditing) || readOnly },
    { kind: 'button', id: 'redo', icon: 'redo', title: 'Redo (Ctrl+Y)', onClick: () => redo(), disabled: () => (!store.canRedo && !canvas.isEditing) || readOnly },
  ];
  const zoomCtl = (): Control => ({ kind: 'select', id: 'zoomc', title: 'Zoom', width: 76, options: () => [{ label: 'Fit', value: 'fit' }, { label: '50%', value: '0.5' }, { label: '75%', value: '0.75' }, { label: '100%', value: '1' }, { label: '150%', value: '1.5' }], value: () => String(canvas.zoom), onChange: (v) => { canvas.setZoom(v === 'fit' ? 'fit' : Number(v)); zoomSel.value = v; } });

  const spec = (): ChromeSpec => {
    const insertGroup: Control[] = [
      btn('textbox', 'Text box', 'textBox', () => addEl(newTextEl(deck()), true), { size: 'large' }),
      menu('shapes', 'Shapes', 'shapes', shapeEntries, 'large'),
      btn('picture', 'Picture', 'imageAdd', pickImage, { size: 'large' }),
    ];
    return {
      tabs: [
        { id: 'file', label: 'File', groups: [
          { label: 'Open and save', controls: [btn('open', 'Open', 'openFile', openFile, { size: 'large' }), btn('openpptx', 'Open .pptx', 'openFile', openPptx, { size: 'large' }), menu('download', 'Download', 'download', () => fileEntries().slice(2, 5), 'large', 'Download')] },
          { label: 'Print', controls: [btn('print', 'Print / PDF', 'print', printDeck, { size: 'large', edit: false })] },
        ] },
        { id: 'home', label: 'Home', groups: [
          { label: 'Undo', controls: undoRedo() },
          { label: 'Slides', controls: [menu('newslide', 'New slide', 'slideAdd', () => layoutEntries((l) => newSlide(l)), 'large'), menu('layout', 'Layout', 'layout', () => layoutEntries((l) => store.set(setLayout(deck(), curId, l), 'layout'), cur().layout), 'small'), btn('dup', 'Duplicate', 'duplicate', dupSlides, { size: 'small' }), btn('del', 'Delete', 'trash', removeSlides, { size: 'small' })] },
          { label: 'Font', controls: [fontSel(), sizeSel(), sep, B('bold', 'Bold', 'bold', 'b', 'Ctrl+B'), B('italic', 'Italic', 'italic', 'i', 'Ctrl+I'), B('underline', 'Underline', 'underline', 'u', 'Ctrl+U'), B('strike', 'Strikethrough', 'strike', 's', ''), sep, textColor()] },
          { label: 'Paragraph', controls: [menu('bullets', undefined, 'bulletList', bulletEntries, 'small', 'Bullets and numbering'), alignBtn('left', 'alignLeft'), alignBtn('center', 'alignCenter'), alignBtn('right', 'alignRight'), menu('spacing', undefined, 'lineSpacing', spacingEntries, 'small', 'Line spacing'), sep, valign('top', 'alignTop'), valign('middle', 'alignMiddle'), valign('bottom', 'alignBottom')] },
          { label: 'Drawing', controls: [menu('shapes2', 'Shapes', 'shapes', shapeEntries, 'large'), fillColor(), lineColor(), menu('arrange', 'Arrange', 'front', arrangeEntries, 'large')] },
        ] },
        { id: 'insert', label: 'Insert', groups: [
          { label: 'Slides', controls: [menu('newslide2', 'New slide', 'slideAdd', () => layoutEntries((l) => newSlide(l)), 'large')] },
          { label: 'Insert', controls: insertGroup },
          { label: 'Text', controls: [btn('link', 'Link', 'link', () => { const url = canvas.isEditing ? '' : ''; void url; linkPrompt(); }, { size: 'large', disabled: () => readOnly || !canvas.isEditing })] },
        ] },
        { id: 'design', label: 'Design', groups: [
          { label: 'Themes', controls: [menu('themes', 'Themes', 'pageColor', themeEntries, 'large')] },
          { label: 'Slide', controls: [menu('bg', 'Background', 'background', bgEntries, 'large'), menu('size', 'Slide size', 'size', () => [{ label: 'Widescreen (16:9)', checked: deck().width === SIZE_WIDE.width, onClick: () => store.set(setSlideSize(deck(), SIZE_WIDE), 'size') }, { label: 'Standard (4:3)', checked: deck().width === SIZE_STANDARD.width, onClick: () => store.set(setSlideSize(deck(), SIZE_STANDARD), 'size') }], 'large')] },
        ] },
        { id: 'transitions', label: 'Transitions', groups: [
          { label: 'Transition to this slide', controls: (['none', 'fade', 'slide', 'zoom'] as Transition[]).map((t): Control => btn(`tr-${t}`, t === 'none' ? 'None' : t === 'fade' ? 'Fade' : t === 'slide' ? 'Push' : 'Zoom', 'slideNew', () => store.set(setTransition(deck(), sel, t), 'transition'), { size: 'large', active: () => (cur().transition ?? 'none') === t })) },
          { label: 'Timing', controls: [btn('tr-all', 'Apply to all', 'duplicate', () => store.set(setTransition(deck(), 'all', cur().transition ?? 'none'), 'transition'), { size: 'large' })] },
        ] },
        { id: 'show', label: 'Slide Show', groups: [
          { label: 'Start slide show', controls: [btn('from-start', 'From beginning', 'play', () => present(0), { size: 'large', edit: false }), btn('from-cur', 'From current slide', 'play', () => present(curIndex()), { size: 'large', edit: false }), btn('presenter', 'Presenter view', 'notes', () => present(curIndex(), true), { size: 'large', edit: false })] },
          { label: 'Set up', controls: [btn('hide', 'Hide slide', 'slideNew', () => store.set(updateSlide(deck(), curId, { hidden: cur().hidden ? undefined : 1 }), 'hide slide'), { size: 'large', active: () => !!cur().hidden })] },
        ] },
        { id: 'view', label: 'View', groups: [
          { label: 'Presentation views', controls: [btn('v-normal', 'Normal', 'layout', () => setView('normal'), { size: 'large', active: () => view === 'normal', edit: false }), btn('v-sorter', 'Slide sorter', 'grid', () => setView('sorter'), { size: 'large', active: () => view === 'sorter', edit: false }), btn('v-notes', 'Notes', 'notes', () => { showNotes = !showNotes; notesBox.hidden = !showNotes; }, { size: 'large', active: () => showNotes, edit: false })] },
          { label: 'Show', controls: [btn('v-grid', 'Gridlines', 'grid', () => canvas.setGrid(!canvas.gridOn), { size: 'large', active: () => canvas.gridOn, edit: false })] },
          { label: 'Zoom', controls: [zoomCtl()] },
        ] },
      ],
      menus: [
        { label: 'File', entries: fileEntries },
        { label: 'Edit', entries: () => [
          { label: 'Undo', icon: 'undo', shortcut: 'Ctrl+Z', disabled: !store.canUndo || readOnly, onClick: () => undo() }, { label: 'Redo', icon: 'redo', shortcut: 'Ctrl+Y', disabled: !store.canRedo || readOnly, onClick: () => redo() }, '-',
          { label: 'Cut', icon: 'cut', shortcut: 'Ctrl+X', disabled: readOnly || !canvas.selected.length, onClick: () => canvas.cut() }, { label: 'Copy', icon: 'copy', shortcut: 'Ctrl+C', disabled: !canvas.selected.length, onClick: () => canvas.copy(null) }, { label: 'Paste', icon: 'paste', shortcut: 'Ctrl+V', disabled: readOnly, onClick: () => canvas.paste() },
          { label: 'Duplicate', shortcut: 'Ctrl+D', disabled: readOnly || !canvas.selected.length, onClick: () => canvas.duplicate() }, { label: 'Delete', shortcut: 'Del', disabled: readOnly || !canvas.selected.length, onClick: () => canvas.deleteSelected() },
          '-', { label: 'Select all', shortcut: 'Ctrl+A', onClick: () => canvas.selectAll() },
        ] },
        { label: 'View', entries: () => [
          { label: 'Normal', checked: view === 'normal', onClick: () => setView('normal') }, { label: 'Slide sorter', checked: view === 'sorter', onClick: () => setView('sorter') }, '-',
          { label: 'Speaker notes', checked: showNotes, onClick: () => { showNotes = !showNotes; notesBox.hidden = !showNotes; } }, { label: 'Gridlines', checked: canvas.gridOn, onClick: () => canvas.setGrid(!canvas.gridOn) }, '-',
          { label: 'Zoom', items: [['fit', 'Fit'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%']].map(([v, l]) => ({ label: l, checked: String(canvas.zoom) === v, onClick: () => { canvas.setZoom(v === 'fit' ? 'fit' : Number(v)); zoomSel.value = v; } })) },
          '-', { label: 'Slide show from the beginning', icon: 'play', onClick: () => present(0) }, { label: 'Slide show from this slide', onClick: () => present(curIndex()) }, { label: 'Presenter view', onClick: () => present(curIndex(), true) },
        ] },
        { label: 'Insert', entries: () => [
          { label: 'New slide', icon: 'slideAdd', disabled: readOnly, onClick: () => newSlide() }, '-',
          { label: 'Text box', icon: 'textBox', disabled: readOnly, onClick: () => addEl(newTextEl(deck()), true) }, { label: 'Picture…', icon: 'imageAdd', disabled: readOnly, onClick: pickImage }, { label: 'Shape', items: shapeEntries() }, { label: 'Link…', disabled: readOnly || !canvas.isEditing, onClick: linkPrompt },
        ] },
        { label: 'Format', entries: () => [
          { label: 'Bold', shortcut: 'Ctrl+B', checked: inlineOn('b'), disabled: !hasTargets() || readOnly, onClick: () => toggleStyle('b') }, { label: 'Italic', shortcut: 'Ctrl+I', checked: inlineOn('i'), disabled: !hasTargets() || readOnly, onClick: () => toggleStyle('i') },
          { label: 'Underline', shortcut: 'Ctrl+U', checked: inlineOn('u'), disabled: !hasTargets() || readOnly, onClick: () => toggleStyle('u') }, { label: 'Strikethrough', checked: inlineOn('s'), disabled: !hasTargets() || readOnly, onClick: () => toggleStyle('s') }, '-',
          { label: 'Align', items: (['left', 'center', 'right', 'justify'] as const).map((a) => ({ label: a[0].toUpperCase() + a.slice(1), checked: (firstStyle().align ?? 'left') === a, disabled: !hasTargets(), onClick: () => setStyle({ align: a === 'left' ? undefined : a }) })) },
          { label: 'Bullets and numbering', items: bulletEntries() }, { label: 'Line spacing', items: spacingEntries() }, '-', { label: 'Theme', items: themeEntries() },
        ] },
        { label: 'Slide', entries: slideEntries },
        { label: 'Arrange', entries: arrangeEntries },
      ],
      toolbar: [
        ...undoRedo(), sep,
        menu('newslide', undefined, 'slideAdd', () => layoutEntries((l) => newSlide(l)), 'small', 'New slide'), menu('layout', undefined, 'layout', () => layoutEntries((l) => store.set(setLayout(deck(), curId, l), 'layout'), cur().layout), 'small', 'Layout'), sep,
        btn('textbox', undefined, 'textBox', () => addEl(newTextEl(deck()), true), { title: 'Text box' }), menu('shapes', undefined, 'shapes', shapeEntries, 'small', 'Shapes'), btn('picture', undefined, 'imageAdd', pickImage, { title: 'Picture' }), sep,
        fontSel(), sizeSel(), sep, B('bold', 'Bold', 'bold', 'b', 'Ctrl+B'), B('italic', 'Italic', 'italic', 'i', 'Ctrl+I'), B('underline', 'Underline', 'underline', 'u', 'Ctrl+U'), textColor(), fillColor(), lineColor(), sep,
        menu('bullets', undefined, 'bulletList', bulletEntries, 'small', 'Bullets and numbering'), alignBtn('left', 'alignLeft'), alignBtn('center', 'alignCenter'), alignBtn('right', 'alignRight'), sep,
        menu('arrange', undefined, 'front', arrangeEntries, 'small', 'Arrange'), menu('themes', undefined, 'pageColor', themeEntries, 'small', 'Theme'), menu('transition', undefined, 'slideNew', transitionEntries, 'small', 'Transition'), sep,
        btn('present', 'Slideshow', 'play', () => present(curIndex()), { title: 'Start the slide show (Shift+F5)', edit: false }),
      ],
    };
  };

  const linkPrompt = () => {
    if (!canvas.isEditing || !canvas.hasTextSelection) return;
    const layer = el('div', 'wy-oc-layer');
    const box = el('div', 'wy-oc-menu wy-pr-linkbox');
    const input = el('input', 'wy-pr-linkinput'); input.type = 'url'; input.placeholder = 'https://'; input.setAttribute('aria-label', 'Link address');
    const ok = el('button', 'wy-ss-fbtn2 is-primary', 'Apply'); ok.type = 'button';
    box.append(input, ok); layer.append(box); root.append(layer);
    const r = canvas.el.getBoundingClientRect();
    box.style.left = `${r.left + 24}px`; box.style.top = `${r.top + 24}px`;
    const saved = (() => { const s = getSelection(); return s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null; })();
    const close = () => { layer.remove(); document.removeEventListener('mousedown', out, true); };
    const out = (e: Event) => { if (!layer.contains(e.target as Node)) close(); };
    const apply = () => { const href = input.value.trim(); close(); if (/^(https?:|mailto:|tel:)/i.test(href) && saved) { const s = getSelection(); s?.removeAllRanges(); s?.addRange(saved); canvas.insertLink(href); } canvas.focus(); };
    ok.addEventListener('click', apply);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); canvas.focus(); } });
    document.addEventListener('mousedown', out, true);
    input.focus();
  };

  const undo = () => { if (canvas.isEditing) { document.execCommand('undo'); return; } flushNotes(); store.undo(); };
  const redo = () => { if (canvas.isEditing) { document.execCommand('redo'); return; } store.redo(); };

  // ---- mount
  const mountChrome = () => {
    chrome?.destroy();
    chrome = new Chrome(spec(), { mode: menuMode, title: o.title === false ? false : deck().title ?? o.title ?? 'Untitled presentation', onTitle: (t) => { store.set({ ...deck(), title: t }, 'title'); o.onTitle?.(t); }, end: o.end, root, focus: () => { if (!show) canvas.focus(); }, initialTab: o.initialTab ?? 'home', label: 'Presentation menu' });
    root.classList.toggle('is-floating', menuMode === 'floating');
    root.prepend(chrome.el);
    chrome.refresh();
    if (saveStatus) chrome.setStatus(saveStatus);
  };
  root.append(body);
  if (o.statusBar !== false) root.append(status);
  o.element.replaceChildren(root);

  // ---- saving
  let saveStatus = '';
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let saving = false; let dirty = false; let failures = 0;
  const setSave = (s: string) => { saveStatus = s; chrome?.setStatus(s); emit('save', { status: s }); };
  const persist = async () => {
    if (saving || !dirty) return;
    dirty = false; saving = true; setSave('saving');
    try {
      const data = deck();
      if (o.storageKey) { try { localStorage.setItem(o.storageKey, JSON.stringify(data)); } catch { /* full or blocked */ } }
      await o.save?.(data);
      failures = 0; saving = false;
      if (dirty) { void persist(); return; }
      setSave('saved');
    } catch (e) { saving = false; dirty = true; failures++; setSave('error'); saveTimer = setTimeout(() => void persist(), Math.min(30000, 1000 * 2 ** failures)); console.error('Presentation save failed', e); }
  };
  const wantsSave = !!(o.save || o.storageKey);

  const offStore = store.on((e) => {
    const d = deck();
    if (!d.slides.some((s) => s.id === curId)) { curId = d.slides[Math.min(curIndexSafe(), d.slides.length - 1)].id; sel = [curId]; canvas.setSlide(curId); loadNotes(); }
    sel = sel.filter((id) => d.slides.some((s) => s.id === id));
    if (!sel.length) sel = [curId];
    if (e.label !== 'live') { if (notesFor === curId && document.activeElement !== notesArea) notesArea.value = cur().notes; }
    syncThumbs();
    updateStatus();
    chrome?.refresh();
    if (e.label === 'live' || e.label === 'load') return;
    emit('change', d);
    o.onChange?.(d);
    if (wantsSave) { dirty = true; setSave('unsaved'); clearTimeout(saveTimer); saveTimer = setTimeout(() => void persist(), o.saveDelayMs ?? 800); }
  });
  let lastIndex = 0;
  const curIndexSafe = () => { lastIndex = Math.max(0, Math.min(lastIndex, deck().slides.length - 1)); return lastIndex; };
  store.on(() => { const i = slideIndex(deck(), curId); if (i >= 0) lastIndex = i; });

  // keyboard shortcuts of the whole app
  root.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const typing = (e.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'F5' || (e.key === 'F5' && e.shiftKey)) { e.preventDefault(); present(e.shiftKey ? curIndex() : 0); return; }
    if (mod && !e.shiftKey && (e.key === 'm' || e.key === 'M') && !readOnly) { e.preventDefault(); newSlide(); return; }
    if (typing) return;
    if (mod && (e.key === 'z' || e.key === 'Z') && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && ((e.key === 'z' || e.key === 'Z') && e.shiftKey || e.key === 'y' || e.key === 'Y')) { e.preventDefault(); redo(); }
    else if (mod && (e.key === 'p' || e.key === 'P')) { e.preventDefault(); printDeck(); }
    else if (mod && (e.key === 's' || e.key === 'S') && wantsSave) { e.preventDefault(); void persist(); }
  });

  mountChrome();
  renderThumbs();
  loadNotes();
  updateStatus();
  const stopSize = observeSize(root, () => chrome?.relayout());
  if (wantsSave) setSave('saved');
  if (readOnly) root.classList.add('is-readonly');

  const api: Presentation = {
    el: root, store, canvas,
    getData: () => deck(),
    setData(d) { const next = cleanDeck(d); store.load(next); curId = next.slides[0].id; sel = [curId]; anchorId = curId; canvas.setSlide(curId); loadNotes(); renderThumbs(); chrome?.setTitle(next.title ?? ''); updateStatus(); chrome?.refresh(); },
    get current() { return curIndex(); },
    goTo(i) { const s = deck().slides[Math.max(0, Math.min(deck().slides.length - 1, i))]; if (s) selectSlide(s.id, false, false); },
    addSlide: (l) => newSlide(l),
    present: (from, presenter) => present(from ?? 0, presenter ?? false),
    toHTML: () => deckToHTML(deck()),
    async toPptx() { return new Blob([await deckToPptx(deck()) as BlobPart], { type: PPTX_TYPE }); },
    async loadPptx(file) {
      const size = file instanceof Blob ? file.size : file.byteLength;
      if (size > 100 * 1024 * 1024) throw new Error('The file is larger than 100 MB');
      const bytes = file instanceof Blob ? await file.arrayBuffer() : file;
      const { deck: next, skipped } = await pptxToDeck(bytes);
      if (!next.title) next.title = deck().title;
      api.setData(next);
      emit('import', { slides: next.slides.length, skipped });
      return { skipped };
    },
    undo, redo,
    setMenu(m) { if (m === menuMode) return; menuMode = m; mountChrome(); },
    setTheme(t) { applyTheme(t); },
    setReadOnly(on) { readOnly = on; canvas.setReadOnly(on); root.classList.toggle('is-readonly', on); notesArea.readOnly = on; renderThumbs(); chrome?.refresh(); },
    focus: () => canvas.focus(),
    on(event, fn) { let s = listeners.get(event); if (!s) listeners.set(event, (s = new Set())); s.add(fn); return () => s!.delete(fn); },
    destroy() { clearTimeout(saveTimer); clearTimeout(notesTimer); offStore(); stopSize(); sysQuery?.removeEventListener?.('change', onSys); show?.close(); chrome?.destroy(); canvas.destroy(); for (const v of thumbCache.values()) v.stop(); root.remove(); listeners.clear(); },
  };
  return api;
}

export { newTextEl, newShapeEl, newImageEl, addEls, setTheme };
