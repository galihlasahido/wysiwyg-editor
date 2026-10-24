/**
 * The slide show: full screen, one slide at a time, with transitions, a black screen, and a presenter view (this slide, the next one,
 * the notes and a clock). Drawn in an overlay inside the app element, so the theme and the CSS variables carry over.
 */
import { fitSlide, renderSlide, scaleTo } from './presentation-render';
import type { Deck, Slide } from './presentation-model';

export interface ShowOptions {
  /** Index in the deck of the slide to start at. */
  start?: number;
  /** Start in the presenter view. */
  presenter?: boolean;
  loop?: boolean;
  onExit?: () => void;
  onSlide?: (index: number) => void;
}

export interface Show { close(): void; goTo(index: number): void; readonly index: number }

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = (n: number) => String(n).padStart(2, '0');

export function startShow(root: HTMLElement, deck: Deck, o: ShowOptions = {}): Show {
  const list = deck.slides.filter((s) => !s.hidden);
  if (!list.length) return { close() { /* nothing to show */ }, goTo() { /* nothing */ }, index: 0 };
  const overlay = document.createElement('div');
  overlay.className = 'wy-pr-show';
  overlay.tabIndex = -1;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Slide show');
  const stage = document.createElement('div');
  stage.className = 'wy-pr-stage';
  const live = document.createElement('div');
  live.className = 'wy-pr-live';
  live.setAttribute('aria-live', 'polite');
  const counter = document.createElement('div');
  counter.className = 'wy-pr-counter';
  const bar = document.createElement('div');
  bar.className = 'wy-pr-showbar';
  const mkBtn = (label: string, text: string, fn: () => void) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.title = label; b.setAttribute('aria-label', label); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); overlay.focus(); }); return b; };
  let presenter = !!o.presenter;
  let black = false;
  // the slide to start at, or the first one that is shown after it
  let i = Math.max(0, list.findIndex((s) => deck.slides.indexOf(s) >= (o.start ?? 0)));
  const started = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let stops: (() => void)[] = [];
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let fsWasOn = false;

  const slideEl = (s: Slide) => { const e = renderSlide(deck, s); return e; };

  const build = (dir: 1 | -1 | 0) => {
    for (const s of stops) s();
    stops = [];
    stage.className = `wy-pr-stage${presenter ? ' is-presenter' : ''}${black ? ' is-black' : ''}`;
    const s = list[i];
    if (!presenter) {
      const host = document.createElement('div');
      host.className = 'wy-pr-host';
      const el = slideEl(s);
      host.append(el);
      const old = stage.querySelector<HTMLElement>('.wy-pr-host');
      stage.replaceChildren(...(old && dir && !reduced() && s.transition && s.transition !== 'none' ? [old] : []), host);
      stops.push(scaleTo(host, el, deck, 'contain'));
      fitSlide(el);
      if (old && dir && !reduced() && s.transition && s.transition !== 'none') {
        host.classList.add(`tr-${s.transition}`, dir > 0 ? 'fwd' : 'back');
        old.classList.add('leaving');
        setTimeout(() => { old.remove(); host.classList.remove(`tr-${s.transition}`, 'fwd', 'back'); }, 520);
      }
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'wy-pr-presenter';
      const main = document.createElement('div'); main.className = 'wy-pr-pmain';
      const side = document.createElement('div'); side.className = 'wy-pr-pside';
      const cur = document.createElement('div'); cur.className = 'wy-pr-host';
      const curEl = slideEl(s); cur.append(curEl); main.append(cur);
      stops.push(scaleTo(cur, curEl, deck, 'contain'));
      const next = list[i + 1];
      const nextHost = document.createElement('div'); nextHost.className = 'wy-pr-host wy-pr-next';
      if (next) { const ne = slideEl(next); nextHost.append(ne); stops.push(scaleTo(nextHost, ne, deck, 'contain')); fitSlide(ne); } else nextHost.textContent = 'End of slide show';
      const clock = document.createElement('div'); clock.className = 'wy-pr-clock';
      const notes = document.createElement('div'); notes.className = 'wy-pr-notes'; notes.textContent = s.notes || 'No notes for this slide.';
      const head = document.createElement('div'); head.className = 'wy-pr-phead'; head.textContent = `Slide ${i + 1} of ${list.length}`;
      side.append(head, clock, nextHost, notes);
      wrap.append(main, side);
      stage.replaceChildren(wrap);
      fitSlide(curEl);
      const tick = () => { const sec = Math.floor((Date.now() - started) / 1000); clock.textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}   ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`; };
      tick();
      clearInterval(timer); timer = setInterval(tick, 1000);
    }
    counter.textContent = `${i + 1} / ${list.length}`;
    live.textContent = `Slide ${i + 1} of ${list.length}`;
    o.onSlide?.(deck.slides.indexOf(s));
  };

  const go = (n: number, dir?: 1 | -1) => {
    let t = n;
    if (t >= list.length) { if (o.loop) t = 0; else { black = false; close(); return; } }
    if (t < 0) t = o.loop ? list.length - 1 : 0;
    const d = dir ?? (t > i ? 1 : t < i ? -1 : 0);
    black = false;
    i = t;
    build(d);
  };

  const wake = () => { bar.classList.add('on'); clearTimeout(hideTimer); hideTimer = setTimeout(() => bar.classList.remove('on'), 2500); };

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n', 'N'].includes(k)) { e.preventDefault(); e.stopPropagation(); go(i + 1, 1); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); e.stopPropagation(); go(i - 1, -1); }
    else if (k === 'Home') { e.preventDefault(); e.stopPropagation(); go(0); }
    else if (k === 'End') { e.preventDefault(); e.stopPropagation(); go(list.length - 1); }
    else if (k === 'b' || k === 'B' || k === '.') { e.preventDefault(); black = !black; stage.classList.toggle('is-black', black); }
    else if (k === 'p' || k === 'P') { e.preventDefault(); presenter = !presenter; build(0); }
    else return;
    wake();
  };
  let sx = 0; let sy = 0;
  overlay.addEventListener('pointerdown', (e) => { sx = e.clientX; sy = e.clientY; });
  overlay.addEventListener('pointerup', (e) => {
    if ((e.target as HTMLElement).closest('.wy-pr-showbar')) return;
    const dx = e.clientX - sx; const dy = e.clientY - sy;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(i + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    else if (Math.abs(dx) < 10 && Math.abs(dy) < 10) { if (black) { black = false; stage.classList.remove('is-black'); } else go(i + 1, 1); }
  });
  overlay.addEventListener('pointermove', wake);
  overlay.addEventListener('keydown', onKey);

  let closed = false;
  const onFs = () => { if (fsWasOn && !document.fullscreenElement) close(); };
  function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer); clearTimeout(hideTimer);
    for (const s of stops) s();
    document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement === overlay) void document.exitFullscreen?.().catch(() => undefined);
    overlay.remove();
    o.onExit?.();
  }

  bar.append(
    mkBtn('Previous slide', '‹', () => go(i - 1, -1)),
    mkBtn('Next slide', '›', () => go(i + 1, 1)),
    mkBtn('Presenter view (P)', 'Notes', () => { presenter = !presenter; build(0); }),
    mkBtn('Black screen (B)', '■', () => { black = !black; stage.classList.toggle('is-black', black); }),
    mkBtn('End the show (Esc)', '✕', close),
  );
  overlay.append(stage, counter, bar, live);
  root.append(overlay);
  build(0);
  overlay.focus();
  wake();
  if (overlay.requestFullscreen && !presenter) {
    overlay.requestFullscreen().then(() => { fsWasOn = true; document.addEventListener('fullscreenchange', onFs); }).catch(() => undefined);
  }
  return { close, goTo: (n) => go(n), get index() { return i; } };
}

