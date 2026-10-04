import type { Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorPlugin } from '../types';

export type CellValue = number | string;

/** Column letters to a 0-based index ("A" 0, "AA" 26). */
const colIndex = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
export const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

type Tok = { t: 'num' | 'str' | 'ref' | 'id' | 'op'; v: string };
const TOKEN = /\s*(?:(\d+\.?\d*|\.\d+)|"([^"]*)"|([A-Za-z]+\d+)|([A-Za-z]+)|(<>|<=|>=|[-+*/^(),:<>=%&]))/y;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  let end = 0;
  while (end < src.trim().length + (src.length - src.trimStart().length) && (m = TOKEN.exec(src))) {
    out.push(m[1] !== undefined ? { t: 'num', v: m[1] } : m[2] !== undefined ? { t: 'str', v: m[2] } : m[3] !== undefined ? { t: 'ref', v: m[3].toUpperCase() } : m[4] !== undefined ? { t: 'id', v: m[4].toUpperCase() } : { t: 'op', v: m[5] });
    end = TOKEN.lastIndex;
    if (src.slice(end).trim() === '') break;
  }
  if (src.slice(end).trim() !== '') throw new FormulaError('#ERR!');
  return out;
}

class FormulaError extends Error {}

type Resolve = (col: number, row: number) => CellValue;

function evaluateExpression(src: string, resolve: Resolve): CellValue {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const take = (v?: string) => {
    const t = toks[i];
    if (!t || (v !== undefined && t.v !== v)) throw new FormulaError('#ERR!');
    i++;
    return t;
  };
  const num = (v: CellValue): number => {
    if (typeof v === 'number') return v;
    if (v === '') return 0;
    const n = Number(v);
    if (Number.isNaN(n)) throw new FormulaError('#VALUE!');
    return n;
  };
  const flat = (a: (CellValue | CellValue[])[]) => a.flat().filter((v) => v !== '').map((v) => (typeof v === 'number' ? v : Number(v))).filter((n) => !Number.isNaN(n));
  const refToCell = (r: string): [number, number] => {
    const m = /^([A-Z]+)(\d+)$/.exec(r)!;
    return [colIndex(m[1]), Number(m[2]) - 1];
  };

  const FUNCS: Record<string, (a: (CellValue | CellValue[])[]) => CellValue> = {
    SUM: (a) => flat(a).reduce((x, y) => x + y, 0),
    AVERAGE: (a) => { const n = flat(a); if (!n.length) throw new FormulaError('#DIV/0!'); return n.reduce((x, y) => x + y, 0) / n.length; },
    MIN: (a) => Math.min(...flat(a)),
    MAX: (a) => Math.max(...flat(a)),
    COUNT: (a) => flat(a).length,
    ROUND: (a) => { const d = a[1] === undefined ? 0 : num(a[1] as CellValue); const f = 10 ** d; return Math.round(num(a[0] as CellValue) * f) / f; },
    ABS: (a) => Math.abs(num(a[0] as CellValue)),
    SQRT: (a) => { const n = num(a[0] as CellValue); if (n < 0) throw new FormulaError('#NUM!'); return Math.sqrt(n); },
    IF: (a) => (a[0] && a[0] !== 0 && a[0] !== '' ? (a[1] ?? '') : (a[2] ?? '')) as CellValue,
    CONCAT: (a) => a.flat().join(''),
  };

  // precedence: comparison < + - & < * / < ^ < unary
  function comparison(): CellValue {
    let l = additive();
    while (peek() && ['<', '>', '=', '<>', '<=', '>='].includes(peek().v) && peek().t === 'op') {
      const op = take().v;
      const r = additive();
      const [a, b] = typeof l === 'number' && typeof r === 'number' ? [l, r] : [String(l), String(r)];
      l = (op === '<' ? a < b : op === '>' ? a > b : op === '=' ? a === b : op === '<>' ? a !== b : op === '<=' ? a <= b : a >= b) ? 1 : 0;
    }
    return l;
  }
  function additive(): CellValue {
    let l = term();
    while (peek()?.t === 'op' && ['+', '-', '&'].includes(peek().v)) {
      const op = take().v;
      const r = term();
      l = op === '&' ? `${l}${r}` : op === '+' ? num(l) + num(r) : num(l) - num(r);
    }
    return l;
  }
  function term(): CellValue {
    let l = power();
    while (peek()?.t === 'op' && ['*', '/'].includes(peek().v)) {
      const op = take().v;
      const r = num(power());
      if (op === '/' && r === 0) throw new FormulaError('#DIV/0!');
      l = op === '*' ? num(l) * r : num(l) / r;
    }
    return l;
  }
  function power(): CellValue {
    const base = unary();
    if (peek()?.v === '^') { take(); return num(base) ** num(power()); }
    return base;
  }
  function unary(): CellValue {
    if (peek()?.t === 'op' && peek().v === '-') { take(); return -num(unary()); }
    if (peek()?.t === 'op' && peek().v === '+') { take(); return unary(); }
    return postfix();
  }
  function postfix(): CellValue {
    let v = primary();
    while (peek()?.v === '%' && peek().t === 'op') { take(); v = num(v) / 100; }
    return v;
  }
  function args(): (CellValue | CellValue[])[] {
    const out: (CellValue | CellValue[])[] = [];
    take('(');
    if (peek()?.v === ')') { take(); return out; }
    for (;;) {
      if (peek()?.t === 'ref' && toks[i + 1]?.v === ':') {
        const [c1, r1] = refToCell(take().v);
        take(':');
        const [c2, r2] = refToCell(take().t === 'ref' ? toks[i - 1].v : (() => { throw new FormulaError('#REF!'); })());
        const vals: CellValue[] = [];
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) vals.push(resolve(c, r));
        out.push(vals);
      } else out.push(comparison());
      if (peek()?.v === ',') { take(); continue; }
      take(')');
      return out;
    }
  }
  function primary(): CellValue {
    const t = peek();
    if (!t) throw new FormulaError('#ERR!');
    if (t.t === 'num') { take(); return Number(t.v); }
    if (t.t === 'str') { take(); return t.v; }
    if (t.t === 'ref') { take(); const [c, r] = refToCell(t.v); return resolve(c, r); }
    if (t.t === 'id') {
      take();
      const f = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : undefined;
      if (!f) throw new FormulaError('#NAME?');
      return f(args());
    }
    if (t.v === '(') { take(); const v = comparison(); take(')'); return v; }
    throw new FormulaError('#ERR!');
  }
  const result = comparison();
  if (i < toks.length) throw new FormulaError('#ERR!');
  return typeof result === 'number' && !Number.isFinite(result) ? '#NUM!' : result;
}

const asValue = (s: string): CellValue => {
  const t = s.trim();
  return t !== '' && !Number.isNaN(Number(t)) ? Number(t) : s;
};

/** Evaluate a grid of cell texts. Cells starting with "=" are formulas; the result has one value per cell. */
export function evaluateGrid(grid: string[][]): CellValue[][] {
  const memo = new Map<string, CellValue>();
  const active = new Set<string>();
  const get = (c: number, r: number): CellValue => {
    const raw = grid[r]?.[c];
    if (raw === undefined) throw new FormulaError('#REF!');
    const key = `${c},${r}`;
    if (memo.has(key)) return memo.get(key)!;
    let v: CellValue;
    if (raw.trim().startsWith('=')) {
      if (active.has(key)) throw new FormulaError('#CYCLE!');
      active.add(key);
      try {
        v = evaluateExpression(raw.trim().slice(1), (cc, rr) => {
          const x = get(cc, rr);
          if (typeof x === 'string' && x.startsWith('#')) throw new FormulaError(x);
          return x;
        });
      } catch (e) {
        v = e instanceof FormulaError ? e.message : '#ERR!';
      } finally {
        active.delete(key);
      }
    } else v = asValue(raw);
    memo.set(key, v);
    return v;
  };
  return grid.map((row, r) => row.map((_, c) => get(c, r)));
}

export const formatValue = (v: CellValue): string => (typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10) : v);

const cellTexts = (table: PMNode): string[][] => {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
};

/** Replace every formula cell of every table in an HTML string with its computed value (for export). */
export function computeFormulasInHTML(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.querySelectorAll('table').forEach((table) => {
    const rows = [...table.querySelectorAll('tr')].map((tr) => [...tr.children].filter((c) => /^t[dh]$/i.test(c.tagName)) as HTMLElement[]);
    const values = evaluateGrid(rows.map((r) => r.map((c) => c.textContent ?? '')));
    rows.forEach((r, ri) => r.forEach((c, ci) => { if ((c.textContent ?? '').trim().startsWith('=')) c.textContent = formatValue(values[ri][ci]); }));
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
    return [
      new Plugin({
        props: {
          decorations(state) {
            const selFrom = state.selection.from;
            if (cache && cache.doc === state.doc && cache.sel === selFrom) return cache.set;
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== 'table') return true;
              const values = evaluateGrid(cellTexts(node));
              node.forEach((row, rowOff, ri) => {
                row.forEach((cell, cellOff, ci) => {
                  if (!cell.textContent.trim().startsWith('=')) return;
                  const start = pos + 1 + rowOff + 1 + cellOff;
                  const end = start + cell.nodeSize;
                  const editing = selFrom >= start && selFrom <= end;
                  const v = values[ri][ci];
                  const isErr = typeof v === 'string' && v.startsWith('#');
                  decos.push(Decoration.node(start, end, { class: `wy-formula-cell${editing ? ' is-editing' : ''}${isErr ? ' is-error' : ''}`, 'data-formula': cell.textContent.trim() }));
                  if (end - 2 > start + 2) decos.push(Decoration.inline(start + 2, end - 2, { class: 'wy-fsrc' }));
                  decos.push(Decoration.widget(end - 2, () => {
                    const s = document.createElement('span');
                    s.className = 'wy-formula-value';
                    s.contentEditable = 'false';
                    s.textContent = formatValue(v);
                    return s;
                  }, { side: 1, key: `f${start}:${formatValue(v)}:${editing}` }));
                });
              });
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
