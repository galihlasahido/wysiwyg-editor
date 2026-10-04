/** Shared sample content and helpers for the demo pages. */
import type { Editor } from '../src';

export const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.';

export const ARTICLE = `<h1>The case for small, modular editors</h1>
<p>Rich-text editing is one of those problems that looks easy until you try to ship it. <strong>Selection</strong>, <em>composition</em>, copy and paste, undo, accessibility and collaboration all interact, and a mistake in any one of them loses a user's work.</p>
<h2>Why modular?</h2>
<p>A modular editor keeps the core small and moves every feature into a plugin. You pay only for what you use, and you can replace a part without forking the whole.</p>
<ul><li><p>Tables, lists and images are plugins.</p></li><li><p>So are comments, track changes and AI helpers.</p></li><li><p>Your own features use the same hooks.</p></li></ul>
<blockquote><p>Make it work, make it right, make it fast. In that order.</p></blockquote>
<h2>What to look for</h2>
<ol><li><p>A document model that cannot represent invalid content.</p></li><li><p>Commands you can call from code, not only from buttons.</p></li><li><p>Output you can trust: sanitised, portable HTML.</p></li></ol>
<p>Try selecting some text, or press <code>/</code> on an empty line.</p>`;

export const PEOPLE = [
  { id: 'u1', label: 'Ana Lestari' }, { id: 'u2', label: 'Budi Santoso' }, { id: 'u3', label: 'Citra Dewi' },
  { id: 'u4', label: 'Dimas Pratama' }, { id: 'u5', label: 'Eka Wijaya' }, { id: 'u6', label: 'Fajar Nugroho' },
];

/** A recognisable PNG (gradient + grid + label) so image demos need no external files. */
export function makeImage(w: number, h: number, label: string, hue = 215): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, `hsl(${hue} 80% 55%)`);
  gr.addColorStop(1, `hsl(${(hue + 70) % 360} 85% 60%)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,.45)';
  for (let x = 0; x <= w; x += 40) (g.beginPath(), g.moveTo(x, 0), g.lineTo(x, h), g.stroke());
  for (let y = 0; y <= h; y += 40) (g.beginPath(), g.moveTo(0, y), g.lineTo(w, y), g.stroke());
  g.fillStyle = '#fff';
  g.font = `bold ${Math.round(h / 8)}px system-ui, sans-serif`;
  g.fillText(label, 12, Math.round(h / 8) + 8);
  g.fillText(`${w}×${h}`, 12, h - 14);
  return c.toDataURL('image/png');
}

/** Tiny DOM builder: `class` and `style` strings, `aria-*`/`data-*` attributes, anything else as a property. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, any> = {}, ...children: (string | Node)[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = String(v);
    else if (k === 'style' || k.startsWith('aria-') || k.startsWith('data-')) node.setAttribute(k, String(v));
    else (node as any)[k] = v;
  }
  node.append(...children);
  return node;
}

export function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const b = el('button', { type: 'button', className: `btn${primary ? ' primary' : ''}`, textContent: label });
  b.addEventListener('click', onClick);
  return b;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
export type { Editor };
