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
  /** Show the horizontal ruler with draggable margins. Default true. */
  ruler?: boolean;
  /** Height of the editor viewport, any CSS length. Default '80vh'. */
  height?: string;
}

export interface BlockMetric { height: number; breakAfter?: boolean }
export interface PageBreak { index: number; filler: number }
export interface PaginationResult { breaks: PageBreak[]; lastFiller: number; pages: number }

/** Gap drawn between pages, in px. */
const GAP = 32;

/**
 * Split top-level blocks into pages. A block is never split: a block taller than a page
 * starts on a fresh page and overflows. `filler` is the unused space on the page that ends
 * at each break, so every page keeps a constant physical height.
 */
export function paginate(blocks: BlockMetric[], contentHeight: number): PaginationResult {
  const breaks: PageBreak[] = [];
  let acc = 0;
  let forced = false;
  blocks.forEach((b, i) => {
    if (i > 0 && (forced || (acc > 0 && acc + b.height > contentHeight))) {
      breaks.push({ index: i, filler: Math.max(0, contentHeight - acc) });
      acc = 0;
    }
    acc += b.height;
    forced = !!b.breakAfter;
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

const pagesKey = new PluginKey<DecorationSet>('pages');

/** Google Docs-style paged view: page cards, margins, header/footer, page numbers, ruler, page breaks. */
export function Pages(options: PageOptions = {}): EditorPlugin {
  const settings = {
    size: options.size ?? ('a4' as PageSizeName),
    margins: { top: 96, right: 96, bottom: 96, left: 96, ...options.margins } as Margins,
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
      const root = editor.root;
      root.classList.add('wy-paged');
      root.style.setProperty('--wy-height', options.height ?? '80vh');

      const contentHeight = () => PAGE_SIZES[settings.size].height - settings.margins.top - settings.margins.bottom;
      let refresh: (force?: boolean) => void = () => {};
      let renderRuler = () => {};

      const applyVars = () => {
        const { width } = PAGE_SIZES[settings.size];
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
      editor.registerCommand('pageMargins', (_e, m: Partial<Margins>) => {
        const width = PAGE_SIZES[settings.size].width;
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
        const { width } = PAGE_SIZES[settings.size];
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
          let raf = 0;
          let lastSig = '';
          const measure = (force = false) => {
            const { doc } = view.state;
            const metrics: BlockMetric[] = [];
            const positions: number[] = [];
            doc.forEach((node, offset) => {
              const dom = view.nodeDOM(offset);
              if (!(dom instanceof HTMLElement)) return;
              const cs = getComputedStyle(dom);
              metrics.push({
                height: dom.getBoundingClientRect().height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0),
                breakAfter: node.type.name === 'page_break',
              });
              positions.push(offset);
            });
            // Endnotes sit after the last block; count them so the last page's footer stays below them.
            const notes = view.dom.querySelector<HTMLElement>('.wy-footnotes');
            if (notes) {
              metrics.push({ height: notes.getBoundingClientRect().height });
              positions.push(doc.content.size);
            }
            const result = paginate(metrics, contentHeight());
            const sig = JSON.stringify([result, settings]);
            if (!force && sig === lastSig) return;
            lastSig = sig;
            const m = settings.margins;
            const decos: Decoration[] = [
              Decoration.widget(0, () => el('wy-page-header', m.top, fill(header, 1, result.pages)), { side: -1, key: `h1-${header}-${m.top}-${result.pages}` }),
            ];
            result.breaks.forEach((b, i) => {
              const page = i + 1;
              decos.push(
                Decoration.widget(
                  positions[b.index],
                  () => {
                    const w = el('wy-page-break');
                    w.append(
                      el('wy-filler', b.filler),
                      el('wy-page-footer', m.bottom, fill(footer, page, result.pages)),
                      el('wy-page-gap', GAP),
                      el('wy-page-header', m.top, fill(header, page + 1, result.pages)),
                    );
                    return w;
                  },
                  { side: -1, key: `b${page}-${b.filler}-${m.top}-${m.bottom}-${result.pages}-${footer}-${header}` },
                ),
              );
            });
            decos.push(
              Decoration.widget(
                doc.content.size,
                () => {
                  const w = el('wy-page-end');
                  w.append(el('wy-filler', result.lastFiller), el('wy-page-footer', m.bottom, fill(footer, result.pages, result.pages)));
                  return w;
                },
                { side: 1, key: `end-${result.lastFiller}-${m.bottom}-${result.pages}-${footer}` },
              ),
            );
            view.dispatch(view.state.tr.setMeta(pagesKey, DecorationSet.create(doc, decos)).setMeta('addToHistory', false));
            editor.root.dataset.pages = String(result.pages);
          };
          const schedule = (force?: boolean) => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => measure(force === true));
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
              cancelAnimationFrame(raf);
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
      { name: 'pageBreak', label: 'Page break (Ctrl+Enter)', icon: '⤓', command: 'pageBreak' },
    ],
  };
}
