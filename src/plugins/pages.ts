import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { openDialog } from '../dialog';
import { Ruler } from '../ruler';
import type { EditorPlugin } from '../types';

/** Page sizes in CSS px (96 dpi). */
export const PAGE_SIZES = {
  a4: { width: 794, height: 1123, label: 'A4' },
  letter: { width: 816, height: 1056, label: 'Letter' },
  legal: { width: 816, height: 1344, label: 'Legal' },
} as const;
export type PageSizeName = keyof typeof PAGE_SIZES;

export interface Margins { top: number; right: number; bottom: number; left: number }

export interface PageSettings {
  size: PageSizeName;
  orientation: 'portrait' | 'landscape';
  width: number;
  height: number;
  margins: Margins;
  header: string;
  footer: string;
  differentFirstPage: boolean;
  firstHeader: string;
  firstFooter: string;
}

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
 * by vertical overlap. `top` is relative to the block, in unzoomed CSS px, and corrected for widgets already inside
 * it, so the result does not change when a break is inserted. `viewTop`/`height` stay in screen px (for posAtCoords).
 */
function measureLines(dom: HTMLElement, blockTop: number, adj: (top: number) => number, scale: number): LineGroup[] {
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
    } else groups.push({ top: (r.top - blockTop) / scale - adj(r.top / scale), bottom: r.bottom, left: r.left, viewTop: r.top });
  }
  return groups.map((g) => ({ left: g.left, top: g.top, height: g.bottom - g.viewTop, viewTop: g.viewTop }));
}

const pagesKey = new PluginKey<DecorationSet>('pages');

/** Google Docs-style paged view: page cards, margins, header/footer, page numbers, ruler, page breaks. */
export function Pages(options: PageOptions = {}): EditorPlugin {
  const settings = {
    size: options.size ?? ('a4' as PageSizeName),
    orientation: options.orientation ?? ('portrait' as 'portrait' | 'landscape'),
    // Editable at runtime (Header & Footer dialog, Page Numbers menu).
    header: options.header ?? '',
    footer: options.footer ?? 'Page {page} of {pages}',
    paged: true,
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
      const headerFor = (page: number, pages: number) =>
        fill(page === 1 && options.differentFirstPage ? options.firstHeader ?? '' : settings.header, page, pages);
      const footerFor = (page: number, pages: number) =>
        fill(page === 1 && options.differentFirstPage ? options.firstFooter ?? '' : settings.footer, page, pages);
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
      editor.extensions.pageSettings = () => ({
        size: settings.size,
        orientation: settings.orientation,
        width: dims().width,
        height: dims().height,
        margins: { ...settings.margins },
        header: settings.header,
        footer: settings.footer,
        differentFirstPage: !!options.differentFirstPage,
        firstHeader: options.firstHeader ?? '',
        firstFooter: options.firstFooter ?? '',
      });
      // Browser print / "Save as PDF": the page margins become real @page margins.
      editor.registerCommand('print', () => {
        const { width, height } = dims();
        const m = settings.margins;
        const style = document.createElement('style');
        style.textContent = `@page{size:${width}px ${height}px;margin:${m.top}px ${m.right}px ${m.bottom}px ${m.left}px}@media print{.wy-paged .wy-content .ProseMirror{padding:0}}`;
        document.head.append(style);
        window.addEventListener('afterprint', () => style.remove(), { once: true });
        window.print();
        return true;
      });
      // ---- Office-style page commands
      const PRESETS: Record<string, Partial<Margins>> = {
        normal: { top: 96, bottom: 96, left: 96, right: 96 },
        narrow: { top: 48, bottom: 48, left: 48, right: 48 },
        moderate: { top: 96, bottom: 96, left: 72, right: 72 },
        wide: { top: 96, bottom: 96, left: 192, right: 192 },
      };
      editor.registerCommand('pageMarginPreset', (e, name: string) => (PRESETS[name] ? e.execute('pageMargins', PRESETS[name]) : false));
      editor.registerCommand('pageColor', (e, color: string) => {
        if (color && !/^#[0-9a-f]{3,8}$/i.test(color)) return false; // only plain hex colors reach the stylesheet
        if (color) e.root.style.setProperty('--wy-page-bg', color);
        else e.root.style.removeProperty('--wy-page-bg');
        e.view.dispatch(e.view.state.tr.setMeta('addToHistory', false));
        return true;
      });
      editor.registerCommand('setHeaderFooter', (e, v: { header?: string; footer?: string }) => {
        if (typeof v?.header === 'string') settings.header = v.header.slice(0, 200);
        if (typeof v?.footer === 'string') settings.footer = v.footer.slice(0, 200);
        refresh(true);
        e.view.dispatch(e.view.state.tr.setMeta('addToHistory', false));
        return true;
      });
      editor.registerCommand('pageNumberPreset', (e, where: 'bottom' | 'bottom-total' | 'top' | 'none') => {
        const NUMBER = /\s*Page \{page\}( of \{pages\})?/g; // remove any previous page number text first
        const strip = (t: string) => t.replace(NUMBER, '').trim();
        const header = strip(settings.header);
        const footer = strip(settings.footer);
        if (where === 'none') return e.execute('setHeaderFooter', { header, footer });
        if (where === 'top') return e.execute('setHeaderFooter', { header: `${header} Page {page}`.trim(), footer });
        if (where === 'bottom' || where === 'bottom-total') return e.execute('setHeaderFooter', { header, footer: `${footer} ${where === 'bottom' ? 'Page {page}' : 'Page {page} of {pages}'}`.trim() });
        return false;
      });
      editor.registerCommand('headerFooterDialog', (e) => {
        const form = document.createElement('div');
        const field = (label: string, value: string) => {
          const l = document.createElement('label');
          l.textContent = label;
          const i = document.createElement('input');
          i.type = 'text';
          i.value = value;
          l.append(i);
          form.append(l);
          return i;
        };
        const h = field('Header (use {page} and {pages})', settings.header);
        const f = field('Footer', settings.footer);
        openDialog(e.root, {
          title: e.t('hf', 'Header & Footer'),
          body: form,
          actions: [{ label: 'Cancel' }, { label: 'OK', primary: true, onClick: () => e.execute('setHeaderFooter', { header: h.value, footer: f.value }) }],
        });
        return true;
      });
      editor.registerCommand('togglePages', (e) => {
        settings.paged = !settings.paged;
        e.root.classList.toggle('wy-paged', settings.paged);
        if (!settings.paged) delete e.root.dataset.pages;
        refresh(true);
        e.view.dispatch(e.view.state.tr.setMeta('addToHistory', false));
        return true;
      }, { readOnlySafe: true });
      editor.registerCommand('pageBreak', (e) => {
        const { state, dispatch } = e.view;
        dispatch(state.tr.replaceSelectionWith(e.schema.nodes.page_break.create()).scrollIntoView());
        return true;
      });

      // The ruler is created once and updated in place (see ruler.ts).
      const guide = document.createElement('div');
      guide.className = 'wy-ruler-guide';
      guide.hidden = true;
      editor.workspace.append(guide);
      // `editor.view` is not assigned while EditorView is being constructed, so keep the plugin's own reference.
      let pmView: EditorView | null = null;
      const pageEl = () => editor.root.querySelector<HTMLElement>('.wy-content')!;
      const scaleNow = () => pageEl().getBoundingClientRect().width / dims().width || 1;
      const ruler =
        options.ruler === false
          ? null
          : new Ruler({
              width: () => dims().width,
              margins: () => settings.margins,
              setMargins: (m) => editor.execute('pageMargins', m),
              paragraph: () => {
                const v = pmView ?? editor.view;
                if (!v) return null;
                const parent = v.state.selection.$from.parent;
                if (!parent.isTextblock || !('indentLeft' in parent.type.spec.attrs!)) return null;
                return { left: parent.attrs.indentLeft ?? 0, right: parent.attrs.indentRight ?? 0, firstLine: parent.attrs.firstLine ?? 0 };
              },
              setParagraph: (p) => editor.execute('paragraphIndent', p),
              scale: scaleNow,
              guide: (x) => {
                guide.hidden = x === null;
                if (x === null) return;
                const ws = editor.workspace.getBoundingClientRect();
                guide.style.left = `${pageEl().getBoundingClientRect().left - ws.left + editor.workspace.scrollLeft + x * scaleNow()}px`;
                guide.style.height = `${editor.workspace.scrollHeight}px`;
              },
            });
      if (ruler) editor.workspace.prepend(ruler.el);
      renderRuler = () => ruler?.rebuild();

      const plugin = new Plugin<DecorationSet>({
        key: pagesKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, set) => tr.getMeta(pagesKey) ?? set.map(tr.mapping, tr.doc),
        },
        props: { decorations: (state) => pagesKey.getState(state) },
        view(view) {
          pmView = view;
          let lastSig = '';
          // Widgets inside a paragraph, table row or list item sit at unknown indents; stretch them to the full page.
          const alignNestedWidgets = () => {
            const page = editor.root.querySelector<HTMLElement>('.wy-content')?.getBoundingClientRect();
            if (!page) return;
            const scale = page.width / dims().width || 1; // lengths set here live in the zoomed element's own px
            for (const w of view.dom.querySelectorAll<HTMLElement>('.wy-page-break')) {
              if (w.parentElement === view.dom) continue; // top-level widgets are laid out by CSS
              w.style.width = `${dims().width}px`;
              w.style.marginLeft = '0px';
              w.style.marginRight = '0px';
              w.style.marginLeft = `${(page.left - w.getBoundingClientRect().left) / scale}px`;
            }
          };
          /** Set by destroy(): late callbacks (fonts.ready, a queued frame) must not touch a view that no longer exists. */
          let gone = false;
          const measure = (force = false) => {
            if (gone) return;
            const { doc } = view.state;
            if (!settings.paged) {
              // "Separate Pages" is off: remove our widgets once and stop measuring.
              if (pagesKey.getState(view.state)?.find().length) {
                lastSig = '';
                view.dispatch(view.state.tr.setMeta(pagesKey, DecorationSet.empty).setMeta('addToHistory', false));
              }
              return;
            }
            // With on-screen zoom, rects are in screen px; convert every length back to unzoomed CSS px.
            const scale = pageEl().getBoundingClientRect().width / dims().width || 1;
            const S = (n: number) => n / scale;
            const metrics: BlockMetric[] = [];
            const positions: number[] = [];
            const anchors: (LineGroup[] | undefined)[] = [];
            const blockEnds: number[] = [];
            const modes: ('block' | 'row' | 'item')[] = [];
            const cols: number[] = [];

            // Heights are measured top-to-top between consecutive units (blocks, table rows, list items), after
            // removing the height of our own page widgets. Unlike `rect.height + margin` this includes margins that
            // collapse out of their box (e.g. a <p> inside an <li>), so it matches what the layout really consumes.
            // `:scope >` matters: a break widget contains its own header/footer divs, which must not be counted twice.
            const widgetRects = [...view.dom.querySelectorAll<HTMLElement>(':scope > .wy-page-header, :scope > .wy-page-end, .wy-page-break')].map((w) => {
              const r = (w.closest('tr.wy-page-break-row, li.wy-page-break-item') ?? w).getBoundingClientRect();
              return { bottom: S(r.bottom), height: S(r.height) };
            });
            const flat = (y: number) => y - widgetRects.reduce((t, r) => (r.bottom <= y + 0.5 ? t + r.height : t), 0);
            const pmTop = flat(S(view.dom.getBoundingClientRect().top));

            interface Unit { top: number; metric: BlockMetric; lastMargin: number }
            const units: Unit[] = [];
            const push = (top: number, metric: BlockMetric, pos: number, end: number, mode: 'block' | 'row' | 'item', colCount: number, lastMargin: number, lines?: LineGroup[]) => {
              if (lines) anchors[units.length] = lines;
              units.push({ top: flat(S(top)), metric, lastMargin });
              positions.push(pos);
              blockEnds.push(end);
              modes.push(mode);
              cols.push(colCount);
            };

            doc.forEach((node, offset) => {
              const dom = view.nodeDOM(offset);
              if (!(dom instanceof HTMLElement)) return;
              const cs = getComputedStyle(dom);
              const rect = dom.getBoundingClientRect();
              const mb = parseFloat(cs.marginBottom) || 0;
              const isTable = node.type.name === 'table';
              const isList = /_list$/.test(node.type.name);
              if ((isTable || isList) && node.childCount > 1) {
                let colCount = 1;
                if (isTable) {
                  colCount = 0;
                  node.firstChild!.forEach((cell) => (colCount += cell.attrs.colspan || 1));
                }
                node.forEach((_c, childOffset, i) => {
                  const cdom = view.nodeDOM(offset + 1 + childOffset);
                  const top = cdom instanceof HTMLElement ? cdom.getBoundingClientRect().top : rect.top;
                  const last = i === node.childCount - 1;
                  // Before the first child the break goes before the whole block.
                  push(top, { height: 0 }, i === 0 ? offset : offset + 1 + childOffset, offset + node.nodeSize, i === 0 ? 'block' : isTable ? 'row' : 'item', colCount, last ? mb : 0);
                });
                return;
              }
              // Page-break widgets already placed inside a paragraph must not count toward its size.
              const inner = [...dom.querySelectorAll<HTMLElement>('.wy-page-break')].map((w) => {
                const r = w.getBoundingClientRect();
                return { bottom: S(r.bottom), height: S(r.height) };
              });
              const innerHeight = inner.reduce((t, r) => t + r.height, 0);
              const adj = (top: number) => inner.reduce((t, r) => (r.bottom <= top + 0.5 ? t + r.height : t), 0);
              const metric: BlockMetric = { height: 0, breakAfter: node.type.name === 'page_break' };
              let lines: LineGroup[] | undefined;
              if (node.type.name === 'paragraph' && node.childCount > 0) {
                const groups = measureLines(dom, rect.top, adj, scale);
                if (groups.length >= 4) {
                  const bottom = S(rect.height) - innerHeight;
                  metric.lines = groups.map((g, i) => (i + 1 < groups.length ? groups[i + 1].top : bottom) - (i === 0 ? 0 : g.top));
                  lines = groups;
                }
              }
              push(rect.top, metric, offset, offset + node.nodeSize, 'block', 1, mb, lines);
            });
            // Endnotes sit after the last block; count them so the last page's footer stays below them.
            const notes = view.dom.querySelector<HTMLElement>('.wy-footnotes');
            if (notes) push(notes.getBoundingClientRect().top, { height: 0 }, doc.content.size, doc.content.size, 'block', 1, 0);

            // Bottom edge of the last content element (widgets of ours excluded), in flat coordinates.
            const lastEl = [...view.dom.children].filter((c) => !c.matches('.wy-page-header, .wy-page-end, .wy-page-break')).pop();
            const contentBottom = lastEl ? flat(S(lastEl.getBoundingClientRect().bottom)) : pmTop;

            units.forEach((u, i) => {
              const next = units[i + 1];
              // Last unit: down to the end of the content, plus its own bottom margin.
              let height = next ? next.top - u.top : contentBottom - u.top + u.lastMargin;
              if (i === 0) height += u.top - pmTop; // the first unit also owns any gap above it
              u.metric.height = Math.max(0, height);
              metrics.push(u.metric);
            });
            const result = paginate(metrics, contentHeight());
            // Resolve each break to a document position; a mid-paragraph break needs the position of its first line.
            const breakPos = result.breaks.map((b) => {
              if (b.line === undefined) return positions[b.index];
              const g = anchors[b.index]?.[b.line];
              const hit = g && view.posAtCoords({ left: g.left + 0.5, top: g.viewTop + g.height / 2 });
              return hit && hit.pos > positions[b.index] + 1 && hit.pos < blockEnds[b.index] - 1 ? hit.pos : positions[b.index];
            });
            alignNestedWidgets();
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
              const mode = b.line === undefined ? modes[b.index] : 'block';
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
                    // Between table rows / list items the widget must itself be a valid <tr> / <li>.
                    if (mode === 'row') {
                      const tr = document.createElement('tr');
                      tr.className = 'wy-page-break-row';
                      const td = document.createElement('td');
                      td.colSpan = cols[b.index];
                      td.append(w);
                      tr.append(td);
                      return tr;
                    }
                    if (mode === 'item') {
                      const li = document.createElement('li');
                      li.className = 'wy-page-break-item';
                      li.append(w);
                      return li;
                    }
                    return w;
                  },
                  { side: -1, key: `b${page}-${mode}-${b.filler}-${m.top}-${m.bottom}-${result.pages}-${ftr(page)}-${hdr(page + 1)}` },
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
          applyVars();
          return {
            update: () => (ruler?.update(), schedule()),
            destroy() {
              gone = true;
              cancel();
              view.dom.removeEventListener('load', onResize, true);
              window.removeEventListener('resize', onResize);
              ruler?.el.remove();
              guide.remove();
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
      { name: 'print', label: 'Print / Save as PDF', icon: '🖨', command: 'print' },
      { name: 'pageBreak', label: 'Page break (Ctrl+Enter)', icon: '⤓', command: 'pageBreak' },
    ],
  };
}
