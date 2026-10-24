/**
 * The data of the presentation app, with no drawing: a deck of slides, each with text boxes, shapes and pictures; layouts and
 * themes; the operations on them (all of which return a new deck, so undo is a list of decks); and the clean-up of text and
 * values that come from outside. `presentation-render.ts` draws a deck and `presentation-editor.ts` edits it.
 */

export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'star' | 'arrow' | 'chevron' | 'callout' | 'line';
export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' }, { kind: 'round', label: 'Rounded rectangle' }, { kind: 'ellipse', label: 'Oval' }, { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' }, { kind: 'pentagon', label: 'Pentagon' }, { kind: 'hexagon', label: 'Hexagon' }, { kind: 'star', label: 'Star' },
  { kind: 'arrow', label: 'Arrow' }, { kind: 'chevron', label: 'Chevron' }, { kind: 'callout', label: 'Speech bubble' }, { kind: 'line', label: 'Line' },
];

export type Align = 'left' | 'center' | 'right' | 'justify';

export interface ElStyle {
  /** Font size in slide pixels (the slide is 1280 wide). */
  size?: number;
  color?: string;
  font?: string;
  b?: 1; i?: 1; u?: 1; s?: 1;
  align?: Align;
  valign?: 'top' | 'middle' | 'bottom';
  /** Line height as a multiple of the font size. */
  line?: number;
  bullets?: 'none' | 'bullet' | 'number';
  /** Shrink the text when it does not fit the box. */
  fit?: 1;
}

export interface SlideEl {
  id: string;
  type: 'text' | 'shape' | 'image';
  x: number; y: number; w: number; h: number;
  /** Degrees. */
  rot?: number;
  /** The text, as clean HTML (b, i, u, s, span with a few styles, lists, links, line breaks). */
  html?: string;
  /** What this box is for in the slide's layout. */
  ph?: 'title' | 'subtitle' | 'body' | 'body2';
  style?: ElStyle;
  shape?: ShapeKind;
  fill?: string | null;
  stroke?: string | null;
  strokeW?: number;
  src?: string;
  alt?: string;
  fit?: 'contain' | 'cover' | 'fill';
  opacity?: number;
  shadow?: 1;
  locked?: 1;
}

export type LayoutId = 'title' | 'titleContent' | 'twoContent' | 'section' | 'titleOnly' | 'blank';
export type Transition = 'none' | 'fade' | 'slide' | 'zoom';

export interface Slide {
  id: string;
  layout: LayoutId;
  els: SlideEl[];
  notes: string;
  /** Background colour; without it the theme's. */
  bg?: string | null;
  transition?: Transition;
  /** Left out of the slide show. */
  hidden?: 1;
}

export interface DeckTheme {
  name: string;
  label: string;
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  accent2: string;
  heading: string;
  body: string;
}

export interface Deck {
  title?: string;
  width: number;
  height: number;
  theme: string;
  slides: Slide[];
}

export const THEMES: DeckTheme[] = [
  { name: 'office', label: 'Office', bg: '#ffffff', fg: '#1f2937', muted: '#6b7280', accent: '#2563eb', accent2: '#f59e0b', heading: 'Calibri, "Segoe UI", system-ui, sans-serif', body: 'Calibri, "Segoe UI", system-ui, sans-serif' },
  { name: 'dark', label: 'Midnight', bg: '#111827', fg: '#f3f4f6', muted: '#9ca3af', accent: '#60a5fa', accent2: '#f472b6', heading: 'system-ui, "Segoe UI", sans-serif', body: 'system-ui, "Segoe UI", sans-serif' },
  { name: 'ocean', label: 'Ocean', bg: '#0b3954', fg: '#f0f9ff', muted: '#a5d8f3', accent: '#38bdf8', accent2: '#fbbf24', heading: 'Georgia, "Times New Roman", serif', body: 'system-ui, "Segoe UI", sans-serif' },
  { name: 'forest', label: 'Forest', bg: '#f1f5ee', fg: '#1f3d2b', muted: '#5f7a67', accent: '#2f855a', accent2: '#d69e2e', heading: 'Georgia, "Times New Roman", serif', body: 'Georgia, "Times New Roman", serif' },
  { name: 'sunset', label: 'Sunset', bg: '#fff7ed', fg: '#431407', muted: '#9a5b3c', accent: '#ea580c', accent2: '#be185d', heading: '"Trebuchet MS", system-ui, sans-serif', body: '"Trebuchet MS", system-ui, sans-serif' },
  { name: 'mono', label: 'Paper', bg: '#fafafa', fg: '#111111', muted: '#666666', accent: '#111111', accent2: '#b91c1c', heading: '"Times New Roman", Georgia, serif', body: '"Times New Roman", Georgia, serif' },
];

export const FONTS = ['Calibri', 'Arial', 'Georgia', 'Verdana', 'Trebuchet MS', 'Times New Roman', 'Courier New', 'Tahoma', 'Impact'];
export const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 60, 72, 96];

export const SIZE_WIDE = { width: 1280, height: 720 };
export const SIZE_STANDARD = { width: 960, height: 720 };

let counter = 0;
export const newId = (prefix = 'e'): string => `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const themeOf = (deck: Deck): DeckTheme => THEMES.find((t) => t.name === deck.theme) ?? THEMES[0];

// ---- layouts ----------------------------------------------------------------------------------------------------------------

interface Box { x: number; y: number; w: number; h: number }
interface Placeholder { ph: NonNullable<SlideEl['ph']>; box: Box; style: ElStyle; prompt: string }

/** Positions are written for a 1280 × 720 slide and scaled to the deck's size. */
const LAYOUTS: Record<LayoutId, { label: string; items: Placeholder[] }> = {
  title: { label: 'Title Slide', items: [
    { ph: 'title', box: { x: 160, y: 200, w: 960, h: 170 }, style: { size: 60, b: 1, align: 'center', valign: 'bottom', fit: 1 }, prompt: 'Click to add title' },
    { ph: 'subtitle', box: { x: 160, y: 390, w: 960, h: 110 }, style: { size: 28, align: 'center', valign: 'top', fit: 1 }, prompt: 'Click to add subtitle' },
  ] },
  titleContent: { label: 'Title and Content', items: [
    { ph: 'title', box: { x: 80, y: 40, w: 1120, h: 110 }, style: { size: 44, b: 1, valign: 'middle', fit: 1 }, prompt: 'Click to add title' },
    { ph: 'body', box: { x: 80, y: 170, w: 1120, h: 490 }, style: { size: 28, bullets: 'bullet', fit: 1 }, prompt: 'Click to add text' },
  ] },
  twoContent: { label: 'Two Content', items: [
    { ph: 'title', box: { x: 80, y: 40, w: 1120, h: 110 }, style: { size: 44, b: 1, valign: 'middle', fit: 1 }, prompt: 'Click to add title' },
    { ph: 'body', box: { x: 80, y: 170, w: 540, h: 490 }, style: { size: 26, bullets: 'bullet', fit: 1 }, prompt: 'Click to add text' },
    { ph: 'body2', box: { x: 660, y: 170, w: 540, h: 490 }, style: { size: 26, bullets: 'bullet', fit: 1 }, prompt: 'Click to add text' },
  ] },
  section: { label: 'Section Header', items: [
    { ph: 'title', box: { x: 100, y: 240, w: 1080, h: 150 }, style: { size: 56, b: 1, valign: 'bottom', fit: 1 }, prompt: 'Click to add section title' },
    { ph: 'subtitle', box: { x: 100, y: 410, w: 1080, h: 90 }, style: { size: 26, valign: 'top', fit: 1 }, prompt: 'Click to add text' },
  ] },
  titleOnly: { label: 'Title Only', items: [
    { ph: 'title', box: { x: 80, y: 40, w: 1120, h: 110 }, style: { size: 44, b: 1, valign: 'middle', fit: 1 }, prompt: 'Click to add title' },
  ] },
  blank: { label: 'Blank', items: [] },
};

export const LAYOUT_IDS = Object.keys(LAYOUTS) as LayoutId[];
export const layoutLabel = (id: LayoutId): string => LAYOUTS[id].label;
export const promptFor = (ph: SlideEl['ph']): string => ['title', 'subtitle', 'body', 'body2'].includes(ph ?? '') ? (Object.values(LAYOUTS).flatMap((l) => l.items).find((i) => i.ph === ph)?.prompt ?? '') : '';

const scaleBox = (b: Box, deck: { width: number; height: number }): Box => ({ x: Math.round(b.x * deck.width / 1280), y: Math.round(b.y * deck.height / 720), w: Math.round(b.w * deck.width / 1280), h: Math.round(b.h * deck.height / 720) });

function placeholdersFor(layout: LayoutId, deck: { width: number; height: number }): SlideEl[] {
  return LAYOUTS[layout].items.map((i) => ({ id: newId(), type: 'text' as const, ph: i.ph, html: '', style: { ...i.style }, ...scaleBox(i.box, deck) }));
}

// ---- clean-up of text and values ----------------------------------------------------------------------------------------------

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;
const SAFE_FONT = /^[\w \-,\x27\x22]{1,120}$/;

/** A colour value that is safe to put in a style, or undefined. */
export const cleanColor = (c: unknown): string | undefined => (typeof c === 'string' && COLOR.test(c.trim()) && !/^(url|expression|javascript)/i.test(c.trim()) ? c.trim() : undefined);

const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SUB', 'SUP', 'BR', 'P', 'DIV', 'SPAN', 'UL', 'OL', 'LI', 'A', 'MARK']);
const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL']);

function cleanStyle(css: string): string {
  const out: string[] = [];
  for (const part of css.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const prop = part.slice(0, i).trim().toLowerCase();
    const val = part.slice(i + 1).trim();
    if (!val || /url\(|expression|javascript|@import|\\/i.test(val)) continue;
    if ((prop === 'color' || prop === 'background-color') && cleanColor(val)) out.push(`${prop}:${val}`);
    else if (prop === 'font-size' && /^\d+(\.\d+)?(px|pt|em|rem|%)$/.test(val)) out.push(`font-size:${val}`);
    else if (prop === 'font-family' && SAFE_FONT.test(val)) out.push(`font-family:${val}`);
    else if (prop === 'font-weight' && /^(bold|normal|[1-9]00)$/.test(val)) out.push(`font-weight:${val}`);
    else if (prop === 'font-style' && /^(italic|normal)$/.test(val)) out.push(`font-style:${val}`);
    else if (prop === 'text-decoration' && /^(underline|line-through|none)( (underline|line-through))*$/.test(val)) out.push(`text-decoration:${val}`);
    else if (prop === 'text-align' && /^(left|right|center|justify)$/.test(val)) out.push(`text-align:${val}`);
    else if (prop === 'line-height' && /^\d+(\.\d+)?(px|em|%)?$/.test(val)) out.push(`line-height:${val}`);
  }
  return out.join(';');
}

const safeHref = (h: string): string | null => (/^(https?:|mailto:|tel:|#)/i.test(h.trim()) ? h.trim() : null);

/**
 * Clean text that came from outside or from the editing box: only the tags and styles listed above stay, links keep http(s),
 * mailto and tel, nothing runs. Works on the parsed text (an inert document), never on the page.
 */
export function cleanHTML(html: string): string {
  if (typeof html !== 'string' || html === '') return '';
  const doc = new DOMParser().parseFromString(`<body>${html.slice(0, 200000)}</body>`, 'text/html');
  const walk = (src: Node, dst: Node) => {
    for (const n of [...src.childNodes]) {
      if (n.nodeType === 3) { dst.appendChild(document.createTextNode(n.textContent ?? '')); continue; }
      if (n.nodeType !== 1) continue;
      const e = n as Element;
      if (!ALLOWED_TAGS.has(e.tagName)) {
        if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'NOSCRIPT', 'TEMPLATE'].includes(e.tagName)) continue;
        walk(e, dst);                                          // an unknown tag: keep what is inside it
        continue;
      }
      const tag = e.tagName === 'STRONG' ? 'b' : e.tagName === 'EM' ? 'i' : e.tagName === 'STRIKE' || e.tagName === 'DEL' ? 's' : e.tagName.toLowerCase();
      const copy = document.createElement(tag);
      const style = e.getAttribute('style');
      if (style) { const c = cleanStyle(style); if (c) copy.setAttribute('style', c); }
      if (e.tagName === 'A') {
        const h = safeHref(e.getAttribute('href') ?? '');
        if (h) { copy.setAttribute('href', h); copy.setAttribute('rel', 'noopener noreferrer'); copy.setAttribute('target', '_blank'); }
      }
      walk(e, copy);
      dst.appendChild(copy);
    }
  };
  const box = document.createElement('div');
  walk(doc.body, box);
  return box.innerHTML;
}

/** The plain text of clean HTML, one line per block. */
export function htmlToText(html: string): string {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const lines: string[] = [];
  let cur = '';
  const flush = () => { lines.push(cur); cur = ''; };
  const walk = (n: Node) => {
    for (const c of [...n.childNodes]) {
      if (c.nodeType === 3) cur += c.textContent ?? '';
      else if (c.nodeType === 1) {
        const e = c as Element;
        if (e.tagName === 'BR') { flush(); continue; }
        const block = BLOCK.has(e.tagName);
        if (block && cur) flush();
        walk(e);
        if (block && cur) flush();
      }
    }
  };
  walk(doc.body);
  if (cur) flush();
  return lines.join('\n');
}

/** Plain text to HTML: lines become paragraphs, text is escaped. */
export function textToHTML(text: string): string {
  const esc = (t: string) => t.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[m]!);
  return text.split(/\r?\n/).map((l) => `<div>${l === '' ? '<br>' : esc(l)}</div>`).join('');
}

/** All the pictures of one deck together, as text (about 75 MB of image data). */
const MAX_PICTURES = 100_000_000;
const SAFE_SRC = /^(data:image\/(png|jpe?g|gif|webp|svg\+xml|avif)[;,]|https?:\/\/|blob:)/i;
const num = (v: unknown, d: number, lo = -1e5, hi = 1e5): number => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

function cleanStyleObj(s: unknown): ElStyle | undefined {
  if (!s || typeof s !== 'object') return undefined;
  const o = s as Record<string, unknown>;
  const t: ElStyle = {};
  if (Number.isFinite(Number(o.size)) && Number(o.size) >= 6 && Number(o.size) <= 400) t.size = Number(o.size);
  const c = cleanColor(o.color); if (c) t.color = c;
  if (typeof o.font === 'string' && SAFE_FONT.test(o.font)) t.font = o.font;
  for (const f of ['b', 'i', 'u', 's', 'fit'] as const) if (o[f]) t[f] = 1;
  if (['left', 'center', 'right', 'justify'].includes(o.align as string)) t.align = o.align as Align;
  if (['top', 'middle', 'bottom'].includes(o.valign as string)) t.valign = o.valign as ElStyle['valign'];
  if (Number.isFinite(Number(o.line)) && Number(o.line) >= 0.8 && Number(o.line) <= 4) t.line = Number(o.line);
  if (['none', 'bullet', 'number'].includes(o.bullets as string)) t.bullets = o.bullets as ElStyle['bullets'];
  return Object.keys(t).length ? t : undefined;
}

function cleanEl(e: unknown): SlideEl | null {
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  const type = o.type === 'text' || o.type === 'shape' || o.type === 'image' ? o.type : null;
  if (!type) return null;
  const el: SlideEl = { id: typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : newId(), type, x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 100, 4, 20000), h: num(o.h, 60, 4, 20000) };
  if (Number(o.rot)) el.rot = num(o.rot, 0, -360, 360);
  if (type === 'text' || (type === 'shape' && typeof o.html === 'string')) el.html = cleanHTML(String(o.html ?? ''));
  if (['title', 'subtitle', 'body', 'body2'].includes(o.ph as string)) el.ph = o.ph as SlideEl['ph'];
  const st = cleanStyleObj(o.style); if (st) el.style = st;
  if (type === 'shape') {
    el.shape = SHAPES.some((s) => s.kind === o.shape) ? (o.shape as ShapeKind) : 'rect';
    el.fill = o.fill === null ? null : cleanColor(o.fill);
    el.stroke = o.stroke === null ? null : cleanColor(o.stroke);
    if (Number.isFinite(Number(o.strokeW))) el.strokeW = num(o.strokeW, 2, 0, 40);
  }
  if (type === 'image') {
    if (typeof o.src !== 'string' || !SAFE_SRC.test(o.src) || o.src.length > 12_000_000) return null;
    el.src = o.src;
    if (typeof o.alt === 'string') el.alt = o.alt.slice(0, 500);
    el.fit = o.fit === 'cover' || o.fit === 'fill' ? o.fit : 'contain';
  }
  if (Number.isFinite(Number(o.opacity)) && Number(o.opacity) < 1) el.opacity = num(o.opacity, 1, 0.05, 1);
  if (o.shadow) el.shadow = 1;
  if (o.locked) el.locked = 1;
  return el;
}

/** A deck from outside (a file, JSON text): every field is checked, so what comes out is safe to draw. */
export function cleanDeck(input: unknown): Deck {
  let d = input;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
  const o = (d && typeof d === 'object' ? d : {}) as Record<string, unknown>;
  const width = num(o.width, 1280, 320, 4000); const height = num(o.height, 720, 240, 4000);
  const slides: Slide[] = [];
  let pictureBytes = 0;     // pictures are text inside the deck; the whole deck may hold only so much
  for (const s of Array.isArray(o.slides) ? o.slides.slice(0, 500) : []) {
    if (!s || typeof s !== 'object') continue;
    const so = s as Record<string, unknown>;
    const slide: Slide = {
      id: typeof so.id === 'string' && /^[\w-]{1,40}$/.test(so.id) ? so.id : newId('s'),
      layout: LAYOUT_IDS.includes(so.layout as LayoutId) ? (so.layout as LayoutId) : 'blank',
      els: (Array.isArray(so.els) ? so.els.slice(0, 500) : []).map(cleanEl).filter((x): x is SlideEl => {
        if (!x) return false;
        if (x.src) { pictureBytes += x.src.length; if (pictureBytes > MAX_PICTURES) return false; }
        return true;
      }),
      notes: typeof so.notes === 'string' ? so.notes.slice(0, 20000) : '',
    };
    const bg = cleanColor(so.bg); if (bg) slide.bg = bg;
    if (['none', 'fade', 'slide', 'zoom'].includes(so.transition as string)) slide.transition = so.transition as Transition;
    if (so.hidden) slide.hidden = 1;
    slides.push(slide);
  }
  const ids = new Set<string>();
  for (const s of slides) { if (ids.has(s.id)) s.id = newId('s'); ids.add(s.id); }
  const deck: Deck = { width, height, theme: THEMES.some((t) => t.name === o.theme) ? (o.theme as string) : 'office', slides };
  if (typeof o.title === 'string') deck.title = o.title.slice(0, 200);
  if (!deck.slides.length) deck.slides.push(makeSlide(deck, 'title'));
  return deck;
}

// ---- operations (each returns a new deck) ----------------------------------------------------------------------------------------

export function makeSlide(deck: { width: number; height: number }, layout: LayoutId): Slide {
  return { id: newId('s'), layout, els: placeholdersFor(layout, deck), notes: '' };
}

export function newDeck(title = 'Untitled presentation'): Deck {
  const d: Deck = { title, ...SIZE_WIDE, theme: 'office', slides: [] };
  d.slides.push(makeSlide(d, 'title'));
  return d;
}

const mapSlide = (deck: Deck, id: string, fn: (s: Slide) => Slide): Deck => ({ ...deck, slides: deck.slides.map((s) => (s.id === id ? fn(s) : s)) });

export const slideIndex = (deck: Deck, id: string): number => deck.slides.findIndex((s) => s.id === id);

export function addSlide(deck: Deck, at: number, layout: LayoutId = 'titleContent'): { deck: Deck; slide: Slide } {
  const slide = makeSlide(deck, layout);
  const slides = [...deck.slides]; slides.splice(Math.max(0, Math.min(slides.length, at)), 0, slide);
  return { deck: { ...deck, slides }, slide };
}

export function duplicateSlides(deck: Deck, ids: string[]): { deck: Deck; ids: string[] } {
  const slides: Slide[] = []; const made: string[] = [];
  for (const s of deck.slides) {
    slides.push(s);
    if (ids.includes(s.id)) { const c: Slide = { ...s, id: newId('s'), els: s.els.map((e) => ({ ...e, id: newId() })) }; slides.push(c); made.push(c.id); }
  }
  return { deck: { ...deck, slides }, ids: made };
}

export function deleteSlides(deck: Deck, ids: string[]): Deck {
  const slides = deck.slides.filter((s) => !ids.includes(s.id));
  if (!slides.length) { const blank = makeSlide(deck, 'title'); return { ...deck, slides: [blank] }; }
  return { ...deck, slides };
}

export function moveSlide(deck: Deck, id: string, to: number): Deck {
  const from = slideIndex(deck, id);
  if (from < 0) return deck;
  const slides = [...deck.slides];
  const [s] = slides.splice(from, 1);
  slides.splice(Math.max(0, Math.min(slides.length, to)), 0, s);
  return { ...deck, slides };
}

/** Change the layout: boxes the new layout has take the old ones' text, boxes it does not have go if they are empty. */
export function setLayout(deck: Deck, id: string, layout: LayoutId): Deck {
  return mapSlide(deck, id, (s) => {
    const fresh = placeholdersFor(layout, deck);
    const used = new Set<string>();
    const els: SlideEl[] = [];
    for (const e of s.els) {
      if (!e.ph) { els.push(e); continue; }
      const target = fresh.find((f) => f.ph === e.ph);
      if (target) { used.add(target.ph!); els.push({ ...e, x: target.x, y: target.y, w: target.w, h: target.h, style: { ...target.style, ...(e.style?.color ? { color: e.style.color } : {}) } }); }
      else if (htmlToText(e.html ?? '').trim()) els.push({ ...e, ph: undefined });   // text stays as a plain box
    }
    for (const f of fresh) if (!used.has(f.ph!)) els.push(f);
    els.sort((a, b) => (a.ph ? 0 : 1) - (b.ph ? 0 : 1));
    return { ...s, layout, els };
  });
}

export function updateSlide(deck: Deck, id: string, patch: Partial<Slide>): Deck { return mapSlide(deck, id, (s) => ({ ...s, ...patch })); }

export function updateEls(deck: Deck, slideId: string, ids: string[], patch: Partial<SlideEl> | ((e: SlideEl) => Partial<SlideEl>)): Deck {
  return mapSlide(deck, slideId, (s) => ({ ...s, els: s.els.map((e) => (ids.includes(e.id) ? { ...e, ...(typeof patch === 'function' ? patch(e) : patch) } : e)) }));
}

/** Change the text style of boxes; a field set to undefined is removed. */
export function styleEls(deck: Deck, slideId: string, ids: string[], patch: Partial<Record<keyof ElStyle, unknown>>): Deck {
  return updateEls(deck, slideId, ids, (e) => {
    const s: Record<string, unknown> = { ...(e.style ?? {}) };
    for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === null || v === false) delete s[k]; else s[k] = v; }
    return { style: s as ElStyle };
  });
}

export function addEls(deck: Deck, slideId: string, els: SlideEl[]): Deck { return mapSlide(deck, slideId, (s) => ({ ...s, els: [...s.els, ...els] })); }
export function removeEls(deck: Deck, slideId: string, ids: string[]): Deck { return mapSlide(deck, slideId, (s) => ({ ...s, els: s.els.filter((e) => !ids.includes(e.id)) })); }

/** Stacking order: the list order is the order, last on top. */
export function reorderEls(deck: Deck, slideId: string, ids: string[], how: 'front' | 'back' | 'forward' | 'backward'): Deck {
  return mapSlide(deck, slideId, (s) => {
    const picked = s.els.filter((e) => ids.includes(e.id));
    const rest = s.els.filter((e) => !ids.includes(e.id));
    if (how === 'front') return { ...s, els: [...rest, ...picked] };
    if (how === 'back') return { ...s, els: [...picked, ...rest] };
    const els = [...s.els];
    if (how === 'forward') { for (let i = els.length - 2; i >= 0; i--) if (ids.includes(els[i].id) && !ids.includes(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]]; }
    else for (let i = 1; i < els.length; i++) if (ids.includes(els[i].id) && !ids.includes(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
    return { ...s, els };
  });
}

export function alignEls(deck: Deck, slideId: string, ids: string[], how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): Deck {
  const slide = deck.slides.find((s) => s.id === slideId);
  if (!slide) return deck;
  const sel = slide.els.filter((e) => ids.includes(e.id));
  if (!sel.length) return deck;
  // one box aligns to the slide, several align to each other
  const box = sel.length === 1 ? { x: 0, y: 0, w: deck.width, h: deck.height } : { x: Math.min(...sel.map((e) => e.x)), y: Math.min(...sel.map((e) => e.y)), w: Math.max(...sel.map((e) => e.x + e.w)) - Math.min(...sel.map((e) => e.x)), h: Math.max(...sel.map((e) => e.y + e.h)) - Math.min(...sel.map((e) => e.y)) };
  return updateEls(deck, slideId, ids, (e) => {
    switch (how) {
      case 'left': return { x: box.x };
      case 'center': return { x: Math.round(box.x + (box.w - e.w) / 2) };
      case 'right': return { x: Math.round(box.x + box.w - e.w) };
      case 'top': return { y: box.y };
      case 'middle': return { y: Math.round(box.y + (box.h - e.h) / 2) };
      default: return { y: Math.round(box.y + box.h - e.h) };
    }
  });
}

export function distributeEls(deck: Deck, slideId: string, ids: string[], axis: 'horizontal' | 'vertical'): Deck {
  const slide = deck.slides.find((s) => s.id === slideId);
  const sel = slide?.els.filter((e) => ids.includes(e.id)) ?? [];
  if (sel.length < 3) return deck;
  const h = axis === 'horizontal';
  const sorted = [...sel].sort((a, b) => (h ? a.x - b.x : a.y - b.y));
  const first = h ? sorted[0].x : sorted[0].y;
  const last = h ? sorted[sorted.length - 1].x + sorted[sorted.length - 1].w : sorted[sorted.length - 1].y + sorted[sorted.length - 1].h;
  const total = sorted.reduce((t, e) => t + (h ? e.w : e.h), 0);
  const gap = (last - first - total) / (sorted.length - 1);
  const pos = new Map<string, number>();
  let at = first;
  for (const e of sorted) { pos.set(e.id, Math.round(at)); at += (h ? e.w : e.h) + gap; }
  return updateEls(deck, slideId, ids, (e) => (h ? { x: pos.get(e.id)! } : { y: pos.get(e.id)! }));
}

export function setTheme(deck: Deck, name: string): Deck { return THEMES.some((t) => t.name === name) ? { ...deck, theme: name } : deck; }

/** 16:9 or 4:3: the boxes keep their place relative to the slide. */
export function setSlideSize(deck: Deck, size: { width: number; height: number }): Deck {
  if (size.width === deck.width && size.height === deck.height) return deck;
  const fx = size.width / deck.width; const fy = size.height / deck.height;
  return { ...deck, ...size, slides: deck.slides.map((s) => ({ ...s, els: s.els.map((e) => ({ ...e, x: Math.round(e.x * fx), w: Math.round(e.w * fx), y: Math.round(e.y * fy), h: Math.round(e.h * fy) })) })) };
}

export function setTransition(deck: Deck, ids: string[] | 'all', t: Transition): Deck {
  return { ...deck, slides: deck.slides.map((s) => (ids === 'all' || ids.includes(s.id) ? { ...s, transition: t === 'none' ? undefined : t } : s)) };
}

/** A new box for the toolbar: text, a shape or a picture, placed in the middle of the slide. */
export function newTextEl(deck: Deck, text = ''): SlideEl {
  const w = 520; const h = 90;
  return { id: newId(), type: 'text', x: Math.round((deck.width - w) / 2), y: Math.round((deck.height - h) / 2), w, h, html: text ? textToHTML(text) : '', style: { size: 28 } };
}
export function newShapeEl(deck: Deck, shape: ShapeKind): SlideEl {
  const line = shape === 'line';
  const w = line ? 360 : 280; const h = line ? 4 : shape === 'ellipse' || shape === 'star' || shape === 'pentagon' || shape === 'hexagon' || shape === 'diamond' ? 220 : 180;
  const t = themeOf(deck);
  return { id: newId(), type: 'shape', shape, x: Math.round((deck.width - w) / 2), y: Math.round((deck.height - h) / 2), w, h, fill: line ? null : t.accent, stroke: line ? t.fg : null, strokeW: line ? 4 : 0, html: '', style: { size: 24, color: '#ffffff', align: 'center', valign: 'middle' } };
}
export function newImageEl(deck: Deck, src: string, natural: { w: number; h: number }, alt = ''): SlideEl {
  const max = { w: deck.width * 0.7, h: deck.height * 0.7 };
  const k = Math.min(1, max.w / natural.w, max.h / natural.h);
  const w = Math.max(20, Math.round(natural.w * k)); const h = Math.max(20, Math.round(natural.h * k));
  return { id: newId(), type: 'image', x: Math.round((deck.width - w) / 2), y: Math.round((deck.height - h) / 2), w, h, src, alt, fit: 'contain' };
}

/** Copies of boxes with new ids, a little to the side, for paste and duplicate. */
export function cloneEls(els: SlideEl[], offset = 24): SlideEl[] { return els.map((e) => ({ ...e, id: newId(), x: e.x + offset, y: e.y + offset, ph: undefined })); }

/** The title of a slide: the text of its title box, or of its first text. */
export function slideTitle(s: Slide): string {
  const t = s.els.find((e) => e.ph === 'title') ?? s.els.find((e) => e.type === 'text' && htmlToText(e.html ?? '').trim());
  const text = t ? htmlToText(t.html ?? '').split('\n').find((l) => l.trim()) ?? '' : '';
  return text.trim().slice(0, 120);
}

// ---- the store: the current deck with undo and redo ------------------------------------------------------------------------------------

export class DeckStore {
  deck: Deck;
  private undoStack: Deck[] = [];
  private redoStack: Deck[] = [];
  private pending: Deck | null = null;
  private listeners = new Set<(e: { label: string }) => void>();

  constructor(deck: Deck, private max = 100) { this.deck = deck; }

  get canUndo(): boolean { return this.undoStack.length > 0 || !!this.pending; }
  get canRedo(): boolean { return this.redoStack.length > 0; }
  on(fn: (e: { label: string }) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private emit(label: string) { for (const f of [...this.listeners]) { try { f({ label }); } catch (e) { console.error('Presentation listener failed', e); } } }

  /** Replace the deck; this is one undo step. */
  set(next: Deck, label = 'edit'): void {
    if (next === this.deck) return;
    this.endLive();
    this.undoStack.push(this.deck);
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack = [];
    this.deck = next;
    this.emit(label);
  }

  /** While dragging: show the change without making a step (call `endLive` when it is done). */
  live(next: Deck): void {
    if (!this.pending) this.pending = this.deck;
    this.deck = next;
    this.emit('live');
  }

  endLive(): void {
    if (!this.pending) return;
    const base = this.pending;
    this.pending = null;
    if (base !== this.deck) { this.undoStack.push(base); if (this.undoStack.length > this.max) this.undoStack.shift(); this.redoStack = []; this.emit('edit'); }
  }

  /** Throw a live change away. */
  cancelLive(): void { if (this.pending) { this.deck = this.pending; this.pending = null; this.emit('undo'); } }

  undo(): boolean {
    this.endLive();
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.deck); this.deck = prev; this.emit('undo');
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.deck); this.deck = next; this.emit('redo');
    return true;
  }

  /** Start again with another deck and no history. */
  load(deck: Deck): void { this.deck = deck; this.undoStack = []; this.redoStack = []; this.pending = null; this.emit('load'); }
}
