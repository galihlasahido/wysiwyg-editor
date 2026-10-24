import type { Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { TableMap } from 'prosemirror-tables';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorPlugin } from '../types';

import { evaluateGrid, formatValue, isErrorValue, colName } from '../grid-formulas';
import type { CellValue } from '../grid-formulas';
export { evaluateGrid, formatValue, isErrorValue, colName };
export type { CellValue };

/** The cell grid of a table, with merged cells placed at their top-left slot so column letters match what the user sees. */
function tableGrid(table: PMNode): { texts: string[][]; at: ({ pos: number; node: PMNode } | null)[][] } {
  const map = TableMap.get(table);
  const texts = Array.from({ length: map.height }, () => Array<string>(map.width).fill(''));
  const at = Array.from({ length: map.height }, () => Array<{ pos: number; node: PMNode } | null>(map.width).fill(null));
  const seen = new Set<number>();
  map.map.forEach((pos, i) => {
    if (seen.has(pos)) return; // a merged cell appears once per slot it covers
    seen.add(pos);
    const node = table.nodeAt(pos);
    if (!node) return;
    const r = Math.floor(i / map.width);
    const c = i % map.width;
    texts[r][c] = node.textContent;
    at[r][c] = { pos, node };
  });
  return { texts, at };
}

/** Same idea for a parsed HTML table (colspan / rowspan), used when exporting. */
function domGrid(table: Element): { texts: string[][]; at: (HTMLElement | null)[][] } {
  const texts: string[][] = [];
  const at: (HTMLElement | null)[][] = [];
  const busy: boolean[][] = [];
  const span = (v: string | null) => Math.max(1, Math.min(100, Math.round(Number(v)) || 1));
  [...table.querySelectorAll('tr')].forEach((tr, r) => {
    texts[r] ??= [];
    at[r] ??= [];
    busy[r] ??= [];
    let c = 0;
    for (const cell of [...tr.children].filter((x) => /^t[dh]$/i.test(x.tagName)) as HTMLElement[]) {
      while (busy[r][c]) c++;
      const rs = span(cell.getAttribute('rowspan'));
      const cs = span(cell.getAttribute('colspan'));
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) { (busy[r + dr] ??= [])[c + dc] = true; (texts[r + dr] ??= [])[c + dc] ??= ''; (at[r + dr] ??= [])[c + dc] ??= null; }
      texts[r][c] = cell.textContent ?? '';
      at[r][c] = cell;
      c += cs;
    }
  });
  const width = Math.max(0, ...texts.map((t) => t.length));
  for (const row of texts) for (let c = 0; c < width; c++) row[c] ??= '';
  for (const row of at) for (let c = 0; c < width; c++) row[c] ??= null;
  return { texts, at };
}

/** Replace every formula cell of every table in an HTML string with its computed value (for export). */
export function computeFormulasInHTML(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('table').forEach((table) => {
    const { texts, at } = domGrid(table);
    const values = evaluateGrid(texts);
    at.forEach((row, r) => row.forEach((cell, c) => { if (cell && (cell.textContent ?? '').trim().startsWith('=')) cell.textContent = formatValue(values[r][c]); }));
  });
  return doc.body.innerHTML;
}

/**
 * Spreadsheet-style formulas inside ordinary tables: a cell whose text starts with "=" shows its computed value
 * ("=SUM(A1:A3)", "=B2*C2", "=IF(A1>10,"big","small")"). The text stays the document content, so the formula is kept
 * on export and editable; the value is only shown. Columns are A, B, C… and rows 1, 2, 3… of that table.
 */
export const TableFormulas: EditorPlugin = {
  name: 'table-formulas',
  setup() {
    let cache: { doc: PMNode; sel: number; set: DecorationSet } | null = null;
    const valuesCache = new WeakMap<PMNode, CellValue[][]>();
    return [
      new Plugin({
        props: {
          decorations(state) {
            const selFrom = state.selection.from;
            if (cache && cache.doc === state.doc && cache.sel === selFrom) return cache.set;
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'table') return true;
              let values = valuesCache.get(node); // keyed by the table node: moving the cursor does not re-evaluate anything
              const { texts, at } = tableGrid(node);
              if (!values) valuesCache.set(node, (values = evaluateGrid(texts)));
              at.forEach((row, ri) => row.forEach((slot, ci) => {
                if (!slot || !slot.node.textContent.trim().startsWith('=')) return;
                const cell = slot.node;
                const start = pos + 1 + slot.pos;
                const end = start + cell.nodeSize;
                const editing = selFrom >= start && selFrom <= end;
                const v = values![ri][ci];
                const isErr = isErrorValue(v);
                decos.push(Decoration.node(start, end, { class: `wy-formula-cell${editing ? ' is-editing' : ''}${isErr ? ' is-error' : ''}`, 'data-formula': cell.textContent.trim() }));
                if (end - 2 > start + 2) decos.push(Decoration.inline(start + 2, end - 2, { class: 'wy-fsrc' }));
                decos.push(Decoration.widget(end - 2, () => {
                  const el = document.createElement('span');
                  el.className = 'wy-formula-value';
                  el.contentEditable = 'false';
                  el.textContent = formatValue(v);
                  return el;
                }, { side: 1, key: `f${start}:${formatValue(v)}:${editing}` }));
              }));
              return false;
            });
            const set = DecorationSet.create(state.doc, decos);
            cache = { doc: state.doc, sel: selFrom, set };
            return set;
          },
        },
      }),
    ];
  },
};
