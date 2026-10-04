import { createEditor, defaultPlugins, download, splitSlides, type Slide } from '../src';
import { $, button, codePanel, el } from './samples';

const content =
  '<h1>Small editors, big ideas</h1><p>A talk about modular rich-text editing</p><p>Notes: Welcome everyone. Introduce yourself in one sentence.</p><hr>' +
  '<h2>Why modular?</h2><ul><li><p>Ship only what you use</p></li><li><p>Replace one part, not the whole</p></li><li><p>Test each piece alone</p></li></ul><p>Notes: Give the bundle-size example here.</p><hr>' +
  '<h2>The plan</h2><ol><li><p>Core engine</p></li><li><p>Plugins</p></li><li><p>Your own UI</p></li></ol><blockquote><p>Keep the core small.</p></blockquote><hr>' +
  '<h2>Numbers</h2><table><tr><th>Quarter</th><th>Users</th></tr><tr><td>Q1</td><td>1,200</td></tr><tr><td>Q2</td><td>3,400</td></tr></table><p>Notes: Q2 grew almost threefold.</p><hr>' +
  '<h1>Thank you</h1><p>Questions?</p>';

const theme = el('select', { 'aria-label': 'Theme' }, ...['light', 'dark', 'brand'].map((t) => el('option', { value: t, textContent: t[0].toUpperCase() + t.slice(1) })));
const split = el('select', { 'aria-label': 'Slide separator' }, el('option', { value: 'hr', textContent: 'Split on horizontal line' }), el('option', { value: 'heading', textContent: 'Split on headings' }));
const thumbs = el('div', { class: 'thumbs' });
const count = el('div', { class: 'status' });
$('#app').append(
  el('div', { class: 'actions' }, button('▶ Present', () => present(0), true), el('label', {}, 'Theme ', theme), split, button('Download deck (.html)', () => downloadDeck())),
  el('div', { class: 'cols', style: 'grid-template-columns:minmax(0,1.4fr) minmax(0,1fr)' },
    el('div', { class: 'panel' }, el('div', { id: 'editor' })),
    el('div', { class: 'panel' }, el('h2', {}, 'Slides'), count, thumbs),
  ),
);

const editor = createEditor({ element: $('#editor'), plugins: defaultPlugins, content, onChange: render });
let slides: Slide[] = [];

const slideEl = (s: Slide, extra = '') => el('div', { class: `slide theme-${theme.value} ${extra}`, innerHTML: s.html });
function render() {
  slides = splitSlides(editor.getHTML(), { by: split.value as 'hr' | 'heading' });
  count.textContent = `${slides.length} slides · ${slides.filter((s) => s.notes).length} with notes`;
  thumbs.replaceChildren(...slides.map((s, i) => {
    const t = el('button', { class: 'thumb', type: 'button', 'aria-label': `Slide ${i + 1}: ${s.title}` }, slideEl(s), el('span', { class: 'n' }, String(i + 1)));
    t.addEventListener('click', () => present(i));
    new ResizeObserver(() => { const k = t.clientWidth / 960; if (k) (t.firstElementChild as HTMLElement).style.transform = `scale(${k})`; }).observe(t);
    return t;
  }));
}
theme.addEventListener('change', render);
split.addEventListener('change', render);

// ---- presenting
const overlay = el('div', { class: 'present', hidden: true, role: 'dialog', 'aria-label': 'Presentation' });
const stage = el('div', { class: 'stage' });
const notesBox = el('div', { class: 'notes', hidden: true });
const hud = el('div', { class: 'hud' });
overlay.append(stage, notesBox, hud);
document.body.append(overlay);
let index = 0;
let opener: HTMLElement | null = null;

function fit() {
  const k = Math.min(innerWidth / 960, (innerHeight - 0) / 540);
  stage.style.transform = `scale(${k}) translate(-50%, -50%)`;
  stage.style.width = '960px';
  stage.style.height = '540px';
  stage.style.transformOrigin = '0 0';
  stage.style.left = '50%';
  stage.style.top = '50%';
}
function show(i: number) {
  index = Math.max(0, Math.min(slides.length - 1, i));
  const s = slides[index];
  stage.replaceChildren(slideEl(s));
  notesBox.textContent = s.notes || '(no notes)';
  hud.replaceChildren(el('span', {}, `${index + 1} / ${slides.length}`), el('span', {}, '← → move · N notes · Esc exit'));
}
function present(i: number) {
  if (!slides.length) return;
  opener = document.activeElement as HTMLElement;
  overlay.hidden = false;
  fit();
  show(i);
  overlay.tabIndex = -1;
  overlay.focus();
  overlay.requestFullscreen?.().catch(() => { /* fullscreen is optional */ });
}
function exit() {
  overlay.hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  opener?.focus();
}
overlay.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') exit();
  else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); show(index + 1); }
  else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); show(index - 1); }
  else if (e.key === 'Home') show(0);
  else if (e.key === 'End') show(slides.length - 1);
  else if (e.key.toLowerCase() === 'n') notesBox.hidden = !notesBox.hidden;
});
overlay.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('.notes')) show(index + (e.clientX < innerWidth / 4 ? -1 : 1)); });
addEventListener('resize', () => !overlay.hidden && fit());
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !overlay.hidden) { /* keep presenting in the window */ fit(); } });

function downloadDeck() {
  const css = [...document.styleSheets].flatMap((sh) => { try { return [...sh.cssRules].map((r) => r.cssText).filter((t) => t.startsWith('.slide')); } catch { return []; } }).join('\n');
  const pages = slides.map((s) => `<section class="slide theme-${theme.value}">${s.html}</section>`).join('\n');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Deck</title><style>html,body{margin:0;height:100%;background:#000}section.slide{position:absolute;left:50%;top:50%;transform-origin:0 0;display:none}section.slide.on{display:flex}${css}</style>${pages}<script>const S=[...document.querySelectorAll('section')];let i=0;function f(){const k=Math.min(innerWidth/960,innerHeight/540);S.forEach((s,n)=>{s.classList.toggle('on',n===i);s.style.transform='scale('+k+') translate(-50%,-50%)'})}addEventListener('keydown',e=>{if(['ArrowRight',' ','PageDown'].includes(e.key))i=Math.min(S.length-1,i+1);if(['ArrowLeft','PageUp'].includes(e.key))i=Math.max(0,i-1);f()});addEventListener('click',e=>{i=Math.max(0,Math.min(S.length-1,i+(e.clientX<innerWidth/4?-1:1)));f()});addEventListener('resize',f);f()</script>`;
  download(html, 'deck.html', 'text/html');
}

render();
$('#app').append(codePanel(`
const slides = splitSlides(editor.getHTML());        // [{ html, notes, title }]
splitSlides(html, { by: 'heading' });                // or start a slide at every H1/H2
// "Notes: ..." paragraphs become speaker notes and are not shown on the slide
`));
