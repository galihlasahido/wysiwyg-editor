/**
 * Drawing a deck: one function turns a slide into DOM at its own size (1280 × 720 by default); thumbnails, the editing canvas, the
 * slide show and the exported file all use it, scaled with CSS. Text goes in as clean HTML only (see `cleanHTML`).
 */
import { observeSize } from './resize';
import { cleanColor, themeOf, type Deck, type DeckTheme, type Slide, type SlideEl, type ShapeKind } from './presentation-model';

/** The rules every drawn slide needs. Injected once into the page, and written into an exported file. */
export const SLIDE_CSS = `
.wy-pr-slide{position:relative;overflow:hidden;background:var(--pr-bg);color:var(--pr-fg);font-family:var(--pr-body);transform-origin:0 0;flex:none}
.wy-pr-el{position:absolute;box-sizing:border-box}
.wy-pr-text{display:flex;flex-direction:column;overflow:hidden}
.wy-pr-content{white-space:pre-wrap;overflow-wrap:break-word;outline:none;width:100%}
.wy-pr-content>div,.wy-pr-content>p{min-height:1em;margin:0}
.wy-pr-content ul,.wy-pr-content ol{margin:0;padding-left:1.4em}
.wy-pr-content a{color:var(--pr-accent);text-decoration:underline}
.wy-pr-content mark{background:#fde68a;color:inherit}
.wy-pr-content.is-bullets>div,.wy-pr-content.is-bullets>p{display:list-item;list-style:disc outside;margin-left:1.2em}
.wy-pr-content.is-numbers>div,.wy-pr-content.is-numbers>p{display:list-item;list-style:decimal outside;margin-left:1.4em}
.wy-pr-shape{display:block}
.wy-pr-shape svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.wy-pr-shape .wy-pr-text{position:absolute;inset:0;padding:6px}
.wy-pr-img{display:block}
.wy-pr-img img{width:100%;height:100%;display:block;user-select:none;-webkit-user-drag:none}
`;

let injected = false;
/** Put the slide rules in the page (once). */
export function ensureSlideCss(): void {
  if (injected || typeof document === 'undefined') return;
  if (document.querySelector('style[data-wy-pr]')) { injected = true; return; }
  const st = document.createElement('style');
  st.dataset.wyPr = '';
  st.textContent = SLIDE_CSS;
  document.head.append(st);
  injected = true;
}

const PATHS: Record<Exclude<ShapeKind, 'round' | 'ellipse'>, string> = {
  rect: 'M0 0H100V100H0Z',
  triangle: 'M50 0L100 100L0 100Z',
  diamond: 'M50 0L100 50L50 100L0 50Z',
  pentagon: 'M50 0L100 38L81 100L19 100L0 38Z',
  hexagon: 'M25 0L75 0L100 50L75 100L25 100L0 50Z',
  star: 'M50 0L61 36L100 36L69 58L80 96L50 73L20 96L31 58L0 36L39 36Z',
  arrow: 'M0 30H60V0L100 50L60 100V70H0Z',
  chevron: 'M0 0H65L100 50L65 100H0L35 50Z',
  callout: 'M0 0H100V75H40L15 100V75H0Z',
  line: 'M0 50H100',
};
const NS = 'http://www.w3.org/2000/svg';

export function themeVars(t: DeckTheme): Record<string, string> {
  return { '--pr-bg': t.bg, '--pr-fg': t.fg, '--pr-muted': t.muted, '--pr-accent': t.accent, '--pr-accent2': t.accent2, '--pr-heading': t.heading, '--pr-body': t.body };
}

export interface RenderOptions {
  /** Show the grey prompt in empty placeholder boxes ("Click to add title"). */
  prompts?: boolean;
}

const PROMPTS: Record<string, string> = { title: 'Click to add title', subtitle: 'Click to add subtitle', body: 'Click to add text', body2: 'Click to add text' };

function shapeSvg(e: SlideEl): SVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const kind = e.shape ?? 'rect';
  let node: SVGElement;
  if (kind === 'ellipse') { node = document.createElementNS(NS, 'ellipse'); node.setAttribute('cx', '50'); node.setAttribute('cy', '50'); node.setAttribute('rx', '50'); node.setAttribute('ry', '50'); }
  else if (kind === 'round') { node = document.createElementNS(NS, 'rect'); node.setAttribute('width', '100'); node.setAttribute('height', '100'); node.setAttribute('rx', '14'); node.setAttribute('ry', '14'); }
  else { node = document.createElementNS(NS, 'path'); node.setAttribute('d', PATHS[kind] ?? PATHS.rect); }
  node.setAttribute('fill', kind === 'line' ? 'none' : cleanColor(e.fill) ?? 'none');
  const stroke = cleanColor(e.stroke);
  if (stroke && (e.strokeW ?? 0) > 0) { node.setAttribute('stroke', stroke); node.setAttribute('stroke-width', String(e.strokeW)); node.setAttribute('vector-effect', 'non-scaling-stroke'); node.setAttribute('stroke-linejoin', 'round'); }
  svg.append(node);
  if (kind === 'line' && (e.strokeW ?? 0) > 0) node.setAttribute('stroke-linecap', 'round');
  return svg;
}

function textBox(deck: Deck, e: SlideEl, o: RenderOptions): HTMLElement {
  const t = themeOf(deck);
  const s = e.style ?? {};
  const box = document.createElement('div');
  box.className = 'wy-pr-text';
  box.style.justifyContent = s.valign === 'middle' ? 'center' : s.valign === 'bottom' ? 'flex-end' : 'flex-start';
  const content = document.createElement('div');
  content.className = `wy-pr-content${s.bullets === 'bullet' ? ' is-bullets' : s.bullets === 'number' ? ' is-numbers' : ''}`;
  const heading = e.ph === 'title' || e.ph === 'subtitle';
  const size = s.size ?? (e.ph === 'title' ? 44 : 28);
  content.style.fontSize = `${size}px`;
  content.dataset.size = String(size);
  content.style.fontFamily = s.font ?? (e.ph === 'title' ? t.heading : '');
  content.style.color = cleanColor(s.color) ?? (e.ph === 'subtitle' ? 'var(--pr-muted)' : '');
  content.style.textAlign = s.align ?? 'left';
  content.style.lineHeight = String(s.line ?? 1.2);
  if (s.b) content.style.fontWeight = '700';
  if (s.i) content.style.fontStyle = 'italic';
  if (s.u || s.s) content.style.textDecoration = `${s.u ? 'underline' : ''} ${s.s ? 'line-through' : ''}`.trim();
  void heading;
  content.innerHTML = e.html ?? '';              // clean HTML only: cleanDeck and the editor both pass text through cleanHTML
  const empty = !(e.html ?? '').replace(/<br\s*\/?>|<\/?div>|<\/?p>/g, '').trim();
  if (empty && o.prompts && e.ph) { content.dataset.prompt = PROMPTS[e.ph] ?? ''; content.classList.add('is-empty'); }
  box.append(content);
  if (s.fit) box.dataset.fit = '1';
  return box;
}

/** One box of a slide. */
export function renderEl(deck: Deck, e: SlideEl, o: RenderOptions = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = `wy-pr-el ${e.type === 'text' ? 'wy-pr-textbox' : e.type === 'shape' ? 'wy-pr-shape' : 'wy-pr-img'}`;
  el.dataset.id = e.id;
  const st = el.style;
  st.left = `${e.x}px`; st.top = `${e.y}px`; st.width = `${e.w}px`; st.height = `${e.h}px`;
  if (e.rot) st.transform = `rotate(${e.rot}deg)`;
  if (e.opacity !== undefined && e.opacity < 1) st.opacity = String(e.opacity);
  if (e.shadow) st.filter = 'drop-shadow(0 6px 10px rgba(0,0,0,.35))';
  if (e.type === 'text') el.append(textBox(deck, e, o));
  else if (e.type === 'shape') {
    el.append(shapeSvg(e));
    if ((e.html ?? '') !== '' || (o.prompts && e.shape !== 'line')) el.append(textBox(deck, e, { ...o, prompts: false }));
  } else if (e.src) {
    const img = document.createElement('img');
    img.src = e.src; img.alt = e.alt ?? ''; img.draggable = false; img.decoding = 'async';
    img.style.objectFit = e.fit === 'cover' ? 'cover' : e.fit === 'fill' ? 'fill' : 'contain';
    el.append(img);
  }
  return el;
}

/** A slide at its own size, as a block you can scale. */
export function renderSlide(deck: Deck, slide: Slide, o: RenderOptions = {}): HTMLElement {
  const root = document.createElement('div');
  root.className = 'wy-pr-slide';
  root.dataset.id = slide.id;
  root.style.width = `${deck.width}px`;
  root.style.height = `${deck.height}px`;
  for (const [k, v] of Object.entries(themeVars(themeOf(deck)))) root.style.setProperty(k, v);
  const bg = cleanColor(slide.bg);
  if (bg) root.style.background = bg;
  for (const e of slide.els) root.append(renderEl(deck, e, o));
  return root;
}

/** Shrink the text of boxes marked "fit" until it fits (down to half size). Needs the slide to be in the page. */
export function fitSlide(root: HTMLElement): void {
  for (const box of root.querySelectorAll<HTMLElement>('.wy-pr-text[data-fit="1"]')) {
    const content = box.firstElementChild as HTMLElement | null;
    if (!content) continue;
    const size = Number(content.dataset.size) || 28;
    content.style.fontSize = `${size}px`;
    let k = 1;
    while (content.scrollHeight > box.clientHeight + 1 && k > 0.5) { k -= 0.05; content.style.fontSize = `${Math.round(size * k * 10) / 10}px`; }
  }
}

/** Show `slideEl` scaled to the width of `host`. Returns a function that stops following the host's size. */
export function scaleTo(host: HTMLElement, slideEl: HTMLElement, deck: Deck, fit: 'width' | 'contain' = 'width'): () => void {
  const apply = () => {
    const w = host.clientWidth; const h = host.clientHeight;
    const k = fit === 'width' ? (w || deck.width) / deck.width : Math.min((w || deck.width) / deck.width, (h || deck.height) / deck.height);
    slideEl.style.transform = `scale(${k})`;
    if (fit === 'contain') { slideEl.style.position = 'absolute'; slideEl.style.left = `${((w || deck.width) - deck.width * k) / 2}px`; slideEl.style.top = `${((h || deck.height) - deck.height * k) / 2}px`; }
    host.style.setProperty('--k', String(k));
    if (fit === 'width') host.style.height = `${deck.height * k}px`;
  };
  apply();
  return observeSize(host, apply);
}

// ---- export -----------------------------------------------------------------------------------------------------------------

const esc = (t: string) => t.replace(/[&<>\x22]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);

/** The deck as one self-contained page: slides one after the other, arrow keys to move, one slide to a printed page. */
export function deckToHTML(deck: Deck): string {
  ensureSlideCss();
  const slides = deck.slides.filter((s) => !s.hidden);
  const parts = slides.map((s) => `<section class="s" aria-label="Slide">${renderSlide(deck, s).outerHTML}</section>`).join('\n');
  const w = deck.width; const h = deck.height;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(deck.title ?? 'Presentation')}</title>
<style>${SLIDE_CSS}
html,body{margin:0;background:#111;height:100%}
.s{width:calc(${w}px * var(--k,1));height:calc(${h}px * var(--k,1));margin:0 auto 12px;position:relative;overflow:hidden}
.s .wy-pr-slide{transform:scale(var(--k,1))}
body.show{overflow:hidden}
body.show .s{display:none;position:fixed;inset:0;margin:auto}
body.show .s.on{display:block}
@page{size:${w}px ${h}px;margin:0}
@media print{html,body{background:none}.s{margin:0;break-after:page;--k:1!important;display:block!important;position:relative!important}.s .wy-pr-slide{transform:none}}
</style></head><body>
${parts}
<script>
(function(){var w=${w},h=${h},ss=[].slice.call(document.querySelectorAll('.s')),i=0,show=false;
function k(){var f=show?Math.min(innerWidth/w,innerHeight/h):Math.min(1,(innerWidth-24)/w);document.documentElement.style.setProperty('--k',f)}
function go(n){i=Math.max(0,Math.min(ss.length-1,n));ss.forEach(function(s,j){s.classList.toggle('on',j===i)});if(!show)ss[i].scrollIntoView({block:'center'})}
addEventListener('resize',k);k();
addEventListener('keydown',function(e){if(e.key==='f'||e.key==='F'){show=!show;document.body.classList.toggle('show',show);k();go(i)}
else if(e.key==='Escape'){show=false;document.body.classList.remove('show');k()}
else if(/^(ArrowRight|ArrowDown|PageDown| |Enter)$/.test(e.key)){e.preventDefault();go(i+1)}
else if(/^(ArrowLeft|ArrowUp|PageUp|Backspace)$/.test(e.key)){e.preventDefault();go(i-1)}});
document.addEventListener('click',function(){if(show)go(i+1)});go(0);
})();
</script></body></html>`;
}
