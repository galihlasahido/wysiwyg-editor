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

// ---- code execution (demo only: the library never runs code) -----------------------------------------------------

/** Source of the document that runs inside the kernel iframe. */
const KERNEL_DOC = `<script>
  const fmt = (v) => { if (typeof v === 'string') return v; try { return JSON.stringify(v, null, 2) ?? String(v); } catch { return String(v); } };
  addEventListener('message', async (e) => {
    const { id, code } = e.data;
    const send = (type, extra) => parent.postMessage({ id, type, ...extra }, '*');
    for (const k of ['log', 'info', 'warn', 'error']) {
      console[k] = (...a) => send('log', { lines: [(k === 'error' || k === 'warn' ? k + ': ' : '') + a.map(fmt).join(' ')] });
    }
    try {
      // Indirect eval runs in the global scope, so "var" and function declarations persist between runs.
      const usesAwait = /\\bawait\\b/.test(code);
      const value = await (0, eval)(usesAwait ? '(async () => {' + code + '\\n})()' : code);
      if (value !== undefined && !usesAwait) send('log', { lines: ['→ ' + fmt(value)] });
      send('done');
    } catch (err) {
      send('error', { message: String(err) });
    }
  });
<\/script>`;

/**
 * A tiny JavaScript "kernel" in a sandboxed iframe (scripts allowed, no same-origin access). Code is posted in
 * after load rather than embedded in srcdoc, so it cannot break out of the page markup.
 */
export class Kernel {
  private frame!: HTMLIFrameElement;
  private ready!: Promise<void>;
  private pending = new Map<number, { lines: string[]; resolve: (r: { lines: string[]; error?: string }) => void; timer: ReturnType<typeof setTimeout> }>();
  private seq = 0;
  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.frame?.contentWindow || !e.data || typeof e.data.id !== 'number') return;
    const job = this.pending.get(e.data.id);
    if (!job) return;
    if (e.data.type === 'log') job.lines.push(...(e.data.lines as string[]));
    else {
      clearTimeout(job.timer);
      this.pending.delete(e.data.id);
      job.resolve({ lines: job.lines, error: e.data.type === 'error' ? String(e.data.message) : undefined });
    }
  };

  constructor(private timeoutMs = 4000) {
    window.addEventListener('message', this.onMessage);
    this.reset();
  }

  reset() {
    this.frame?.remove();
    for (const j of this.pending.values()) {
      clearTimeout(j.timer);
      j.resolve({ lines: j.lines, error: 'Kernel was reset' });
    }
    this.pending.clear();
    this.frame = document.createElement('iframe');
    this.frame.setAttribute('sandbox', 'allow-scripts');
    this.frame.hidden = true;
    this.frame.srcdoc = KERNEL_DOC;
    this.ready = new Promise((resolve) => this.frame.addEventListener('load', () => resolve(), { once: true }));
    document.body.append(this.frame);
  }

  async run(code: string): Promise<{ lines: string[]; error?: string }> {
    await this.ready;
    const id = ++this.seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.reset(); // an infinite loop cannot be interrupted, so replace the whole kernel
        resolve({ lines: [], error: `Timed out after ${this.timeoutMs / 1000}s` });
      }, this.timeoutMs);
      this.pending.set(id, { lines: [], resolve, timer });
      this.frame.contentWindow!.postMessage({ id, code }, '*');
    });
  }

  destroy() {
    window.removeEventListener('message', this.onMessage);
    this.frame.remove();
  }
}

/** A collapsible "show the code" panel with a snippet that matches what the page does. */
export function codePanel(code: string, title = 'Show the code'): HTMLElement {
  const pre = el('pre', { class: 'out' });
  pre.textContent = code.trim();
  return el('details', { class: 'panel code-panel', style: 'margin-top:16px' }, el('summary', { style: 'cursor:pointer;font-weight:600' }, title), pre);
}
