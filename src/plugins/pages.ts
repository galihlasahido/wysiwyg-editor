import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import type { EditorPlugin } from '../types';

/** Page sizes in CSS px (96 dpi). */
export const PAGE_SIZES = {
  a4: { width: 794, height: 1123, label: 'A4' },
  letter: { width: 816, height: 1056, label: 'Letter' },
  legal: { width: 816, height: 1344, label: 'Legal' },
} as const;
export type PageSizeName = keyof typeof PAGE_SIZES;

export interface Margins { top: number; right: number; bottom: number; left: number }

export interface PageOptions {
  size?: PageSizeName;
  margins?: Partial<Margins>;
  /** Header/footer text. `{page}` and `{pages}` are replaced. */
  header?: string;
  footer?: string;
  orientation?: 'portrait' | 'landscape';
  /** Use `firstHeader`/`firstFooter` on page 1 instead of `header`/`footer`. */
  differentFirstPage?: boolean;
  firstHeader?: string;
  firstFooter?: string;
  /** Show the horizontal ruler with draggable margins. Default true. */
  ruler?: boolean;
  /** Height of the editor viewport, any CSS length. Default '80vh'. */
  height?: string;
}

export interface BlockMetric {
  /** Total height including trailing margin. */
  height: number;
  breakAfter?: boolean;
  /** Content line heights of a splittable paragraph (their sum is `height` minus the trailing margin). */
  lines?: number[];
}
/** `line` is set when the page ends inside block `index`, before that line; otherwise before the block. */
export interface PageBreak { index: number; filler: number; line?: number }
export interface PaginationResult { breaks: PageBreak[]; lastFiller: number; pages: number }

/** Gap drawn between pages, in px. */
const GAP = 32;
const MIN_SPLIT_LINES = 4;

/**
 * Split top-level blocks into pages. Atomic blocks that do not fit move to the next page (a block taller
 * than a page overflows on its own page). Paragraphs with `lines` are split between lines, keeping at least
 * two lines on each side (widow/orphan control). `filler` is the unused space at the end of each page so
 * every page keeps a constant physical height.
 */
export function paginate(blocks: BlockMetric[], contentHeight: number): PaginationResult {
  const breaks: PageBreak[] = [];
  let acc = 0;
  let forced = false;
  const sum = (a: number[], from: number, to: number) => a.slice(from, to).reduce((x, y) => x + y, 0);

  blocks.forEach((b, i) => {
    if (i > 0 && forced) {
      breaks.push({ index: i, filler: Math.max(0, contentHeight - acc) });
      acc = 0;
    }
    forced = !!b.breakAfter;

    const lines = b.lines;
    if (!lines || lines.length < MIN_SPLIT_LINES) {
      if (acc > 0 && acc + b.height > contentHeight) {
        breaks.push({ index: i, filler: Math.max(0, contentHeight - acc) });
        acc = 0;
      }
      acc += b.height;
      return;
    }

    const margin = b.height - sum(lines, 0, lines.length);
    let start = 0;
    for (;;) {
      const remaining = contentHeight - acc;
      let k = start;
      let used = 0;
      while (k < lines.length && used + lines[k] <= remaining) used += lines[k++];
      if (k === lines.length) {
        acc += used + margin;
        return;
      }
      let fit = k - start;
      if (lines.length - k < 2) fit = lines.length - 2 - start; // keep two lines for the next page
      if (fit >= 2) {
        k = start + fit;
        breaks.push({ index: i, line: k, filler: Math.max(0, remaining - sum(lines, start, k)) });
        acc = 0;
        start = k;
      } else if (acc > 0 && start === 0) {
        breaks.push({ index: i, filler: Math.max(0, remaining) }); // move the whole paragraph
        acc = 0;
      } else {
        // Fresh page but even two lines do not fit: take what we can (at least one line) to guarantee progress.
        k = Math.max(k, start + 1);
        if (k >= lines.length) {
          acc += sum(lines, start, lines.length) + margin;
          return;
        }
        breaks.push({ index: i, line: k, filler: Math.max(0, remaining - sum(lines, start, k)) });
        acc = 0;
        start = k;
      }
    }
  });
  return { breaks, lastFiller: Math.max(0, contentHeight - acc), pages: breaks.length + 1 };
}

function el(cls: string, height?: number, text?: string): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  d.setAttribute('contenteditable', 'false');
  if (height !== undefined) d.style.height = `${height}px`;
  if (text !== undefined) d.textContent = text;
  return d;
}

const fill = (tpl: string, page: number, pages: number) => tpl.replace(/\{page\}/g, String(page)).replace(/\{pages\}/g, String(pages));

interface LineGroup { left: number; top: number; height: number; viewTop: number }

/**
 * Visual lines of a paragraph: rects of its text nodes and inline atoms (ignoring page-break widgets) grouped
 * by vertical overlap. `top` is relative to the block and corrected for widgets already inside it, so the
 * result does not change when a break is inserted.
 */
function measureLines(dom: HTMLElement, blockTop: number, adj: (top: number) => number): LineGroup[] {
  const rects: DOMRect[] = [];
  const walker = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      n instanceof HTMLElement && n.classList.contains('wy-page-break') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) rects.push(r);
    } else if (n instanceof HTMLElement && /^(IMG|SUP)$/.test(n.tagName)) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) rects.push(r);
    }
  }
  rects.sort((a, b) => a.top - b.top || a.left - b.left);
  const groups: { top: number; bottom: number; left: number; viewTop: number }[] = [];
  for (const r of rects) {
    const g = groups[groups.length - 1];
    const center = (r.top + r.bottom) / 2;
    if (g && center >= g.viewTop && center <= g.bottom) {
      g.bottom = Math.max(g.bottom, r.bottom);
      g.left = Math.min(g.left, r.left);
    } else groups.push({ top: r.top - blockTop - adj(r.top), bottom: r.bottom, left: r.left, viewTop: r.top });
  }
  return groups.map((g) => ({ left: g.left, top: g.top, height: g.bottom - g.viewTop, viewTop: g.viewTop }));
}

const pagesKey = new PluginKey<DecorationSet>('pages');

/** Google Docs-style paged view: page cards, margins, header/footer, page numbers, ruler, page breaks. */
export function Pages(options: PageOptions = {}): EditorPlugin {
  const settings = {
    size: options.size ?? ('a4' as PageSizeName),
    orientation: options.orientation ?? ('portrait' as 'portrait' | 'landscape'),
    margins: { top: 96, right: 96, bottom: 96, left: 96, ...options.margins } as Margins,
  };
  const dims = () => {
    const { width, height } = PAGE_SIZES[settings.size];
    return settings.orientation === 'landscape' ? { width: height, height: width } : { width, height };
  };
  return {
    name: 'pages',
    nodes: {
      page_break: {
        group: 'block',
        atom: true,
        selectable: true,
        parseDOM: [{ tag: 'div[data-page-break]' }],
        toDOM: () => ['div', { class: 'wy-manual-break', 'data-page-break': '' }],
      },
    },
    setup(editor) {
      const header = options.header ?? '';
      const footer = options.footer ?? 'Page {page} of {pages}';
      const headerFor = (page: number, pages: number) =>
        fill(page === 1 && options.differentFirstPage ? options.firstHeader ?? '' : header, page, pages);
      const footerFor = (page: number, pages: number) =>
        fill(page === 1 && options.differentFirstPage ? options.firstFooter ?? '' : footer, page, pages);
      const root = editor.root;
      root.classList.add('wy-paged');
      root.style.setProperty('--wy-height', options.height ?? '80vh');

      const contentHeight = () => dims().height - settings.margins.top - settings.margins.bottom;
      let refresh: (force?: boolean) => void = () => {};
      let renderRuler = () => {};

      const applyVars = () => {
        const { width } = dims();
        const m = settings.margins;
        root.style.setProperty('--wy-page-w', `${width}px`);
        root.style.setProperty('--wy-ml', `${m.left}px`);
        root.style.setProperty('--wy-mr', `${m.right}px`);
        renderRuler();
        refresh(true);
      };

      editor.registerCommand('pageSize', (_e, size: PageSizeName) => {
        if (!(size in PAGE_SIZES)) return false;
        settings.size = size;
        applyVars();
        return true;
      });
      editor.registerCommand('pageOrientation', (_e, o: 'portrait' | 'landscape') => {
        if (o !== 'portrait' && o !== 'landscape') return false;
        settings.orientation = o;
        // Re-clamp margins against the new width.
        editor.execute('pageMargins', {});
        return true;
      });
      editor.registerCommand('pageMargins', (_e, m: Partial<Margins>) => {
        const width = dims().width;
        const next = { ...settings.margins, ...m };
        const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));
        settings.margins = {
          top: clamp(next.top, 300),
          bottom: clamp(next.bottom, 300),
          left: clamp(next.left, width / 2 - 50),
          right: clamp(next.right, width / 2 - 50),
        };
        applyVars();
        return true;
      });
      editor.registerCommand('pageBreak', (e) => {
        const { state, dispatch } = e.view;
        dispatch(state.tr.replaceSelectionWith(e.schema.nodes.page_break.create()).scrollIntoView());
        return true;
      });

      const buildRuler = () => {
        root.querySelector('.wy-ruler')?.remove();
        if (options.ruler === false) return;
        const { width } = dims();
        const ruler = document.createElement('div');
        ruler.className = 'wy-ruler';
        ruler.style.width = `${width}px`;
        const cm = 96 / 2.54;
        for (let i = 1; i * cm < width; i++) {
          const t = document.createElement('span');
          t.className = 'wy-ruler-num';
          t.style.left = `${i * cm}px`;
          t.textContent = String(i);
          ruler.append(t);
        }
        const handle = (side: 'left' | 'right') => {
          const h = document.createElement('div');
          h.className = `wy-ruler-handle wy-ruler-${side}`;
          h.title = `${side === 'left' ? 'Left' : 'Right'} margin`;
          const place = () => (h.style.left = `${side === 'left' ? settings.margins.left : width - settings.margins.right}px`);
          place();
          h.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            h.setPointerCapture(ev.pointerId);
            const rect = ruler.getBoundingClientRect();
            const move = (e2: PointerEvent) => {
              const x = e2.clientX - rect.left;
              editor.execute('pageMargins', side === 'left' ? { left: x } : { right: width - x });
            };
            const up = () => {
              h.removeEventListener('pointermove', move);
              h.removeEventListener('pointerup', up);
            };
            h.addEventListener('pointermove', move);
            h.addEventListener('pointerup', up);
          });
          ruler.append(h);
        };
        handle('left');
        handle('right');
        editor.workspace.prepend(ruler);
      };
      renderRuler = buildRuler;

      const plugin = new Plugin<DecorationSet>({
        key: pagesKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => tr.getMeta(pagesKey) ?? set.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => pagesKey.getState(state) },
        view(view) {
          let lastSig = '';
          const measure = (force = false) => {
            const { doc } = view.state;
            const metrics: BlockMetric[] = [];
            const positions: number[] = [];
            const anchors: (LineGroup[] | undefined)[] = [];
            const blockEnds: number[] = [];
            doc.forEach((node, offset) => {
              const dom = view.nodeDOM(offset);
              if (!(dom instanceof HTMLElement)) return;
              const cs = getComputedStyle(dom);
              const rect = dom.getBoundingClientRect();
              // Page-break widgets already placed inside a paragraph must not count toward its size.
              const widgets = [...dom.querySelectorAll<HTMLElement>('.wy-page-break')].map((w) => w.getBoundingClientRect());
              const widgetsHeight = widgets.reduce((t, r) => t + r.height, 0);
              const adj = (top: number) => widgets.reduce((t, r) => (r.bottom <= top + 0.5 ? t + r.height : t), 0);
              const margin = (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
              const metric: BlockMetric = { height: rect.height - widgetsHeight + margin, breakAfter: node.type.name === 'page_break' };
              if (node.type.name === 'paragraph' && node.childCount > 0) {
                const groups = measureLines(dom, rect.top, adj);
                if (groups.length >= 4) {
                  const bottom = rect.height - widgetsHeight;
                  metric.lines = groups.map((g, i) => (i + 1 < groups.length ? groups[i + 1].top : bottom) - (i === 0 ? 0 : g.top));
                  anchors[metrics.length] = groups;
                }
              }
              metrics.push(metric);
              positions.push(offset);
              blockEnds.push(offset + node.nodeSize);
            });
            // Endnotes sit after the last block; count them so the last page's footer stays below them.
            const notes = view.dom.querySelector<HTMLElement>('.wy-footnotes');
            if (notes) {
              metrics.push({ height: notes.getBoundingClientRect().height });
              positions.push(doc.content.size);
              blockEnds.push(doc.content.size);
            }
            const result = paginate(metrics, contentHeight());
            // Resolve each break to a document position; a mid-paragraph break needs the position of its first line.
            const breakPos = result.breaks.map((b) => {
              if (b.line === undefined) return positions[b.index];
              const g = anchors[b.index]?.[b.line];
              const hit = g && view.posAtCoords({ left: g.left + 0.5, top: g.viewTop + g.height / 2 });
              return hit && hit.pos > positions[b.index] + 1 && hit.pos < blockEnds[b.index] - 1 ? hit.pos : positions[b.index];
            });
            const sig = JSON.stringify([result, breakPos, settings]);
            if (!force && sig === lastSig) return;
            lastSig = sig;
            const m = settings.margins;
            const hdr = (page: number) => headerFor(page, result.pages);
            const ftr = (page: number) => footerFor(page, result.pages);
            const decos: Decoration[] = [
              Decoration.widget(0, () => el('wy-page-header', m.top, hdr(1)), { side: -1, key: `h1-${hdr(1)}-${m.top}-${result.pages}` }),
            ];
            result.breaks.forEach((b, i) => {
              const page = i + 1;
              decos.push(
                Decoration.widget(
                  breakPos[i],
                  () => {
                    const w = el('wy-page-break');
                    w.append(
                      el('wy-filler', b.filler),
                      el('wy-page-footer', m.bottom, ftr(page)),
                      el('wy-page-gap', GAP),
                      el('wy-page-header', m.top, hdr(page + 1)),
                    );
                    return w;
                  },
                  { side: -1, key: `b${page}-${b.filler}-${m.top}-${m.bottom}-${result.pages}-${ftr(page)}-${hdr(page + 1)}` },
                ),
              );
            });
            decos.push(
              Decoration.widget(
                doc.content.size,
                () => {
                  const w = el('wy-page-end');
                  w.append(el('wy-filler', result.lastFiller), el('wy-page-footer', m.bottom, ftr(result.pages)));
                  return w;
                },
                { side: 1, key: `end-${result.lastFiller}-${m.bottom}-${result.pages}-${ftr(result.pages)}` },
              ),
            );
            // Before dispatching: plugin views (status bar) read this during the update.
            editor.root.dataset.pages = String(result.pages);
            view.dispatch(view.state.tr.setMeta(pagesKey, DecorationSet.create(doc, decos)).setMeta('addToHistory', false));
          };
          // requestAnimationFrame never fires in hidden tabs, which would leave a background-loaded
          // document unpaginated until the tab is shown; layout still works there, so use a timer.
          let cancel = () => {};
          const schedule = (force?: boolean) => {
            cancel();
            const run = () => measure(force === true);
            if (document.hidden) {
              const t = setTimeout(run, 30);
              cancel = () => clearTimeout(t);
            } else {
              const f = requestAnimationFrame(run);
              cancel = () => cancelAnimationFrame(f);
            }
          };
          refresh = schedule;
          const onResize = () => schedule();
          view.dom.addEventListener('load', onResize, true); // images changing height
          window.addEventListener('resize', onResize);
          document.fonts?.ready.then(onResize);
          buildRuler();
          applyVars();
          return {
            update: () => schedule(),
            destroy() {
              cancel();
              view.dom.removeEventListener('load', onResize, true);
              window.removeEventListener('resize', onResize);
              root.querySelector('.wy-ruler')?.remove();
            },
          };
        },
      });

      return [plugin, keymap({ 'Mod-Enter': (state, dispatch) => (dispatch?.(state.tr.replaceSelectionWith(state.schema.nodes.page_break.create()).scrollIntoView()), true) })];
    },
    toolbar: [
      {
        type: 'select',
        name: 'pageSize',
        label: 'Page size',
        command: 'pageSize',
        options: Object.entries(PAGE_SIZES).map(([value, v]) => ({ label: v.label, value })),
        getValue: () => settings.size,
      },
      {
        type: 'select',
        name: 'pageOrientation',
        label: 'Orientation',
        command: 'pageOrientation',
        options: [{ label: 'Portrait', value: 'portrait' }, { label: 'Landscape', value: 'landscape' }],
        getValue: () => settings.orientation,
      },
      { name: 'pageBreak', label: 'Page break (Ctrl+Enter)', icon: '⤓', command: 'pageBreak' },
    ],
  };
}
