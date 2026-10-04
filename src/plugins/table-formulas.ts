import type { Node as PMNode } from 'prosemirror-model';
import { Plugin } from 'prosemirror-state';
import { TableMap } from 'prosemirror-tables';
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

const MAX_TEXT = 10000; // a cell's text result; stops =A1&A1 chains from doubling into gigabytes
const capText = (s: string): string => {
  if (s.length > MAX_TEXT) throw new FormulaError('#VALUE!');
  return s;
};

function evaluateExpression(src: string, resolve: Resolve, bounds: [number, number]): CellValue {
  const toks = tokenize(src);
  let i = 0;
  /** >0 while parsing an IF branch that is not taken: it is parsed but never evaluated, so =IF(A1=0,0,1/A1) is safe. */
  let dead = 0;
  const peek = () => toks[i];
  const take = (v?: string) => {
    const t = toks[i];
    if (!t || (v !== undefined && t.v !== v)) throw new FormulaError('#ERR!');
    i++;
    return t;
  };
  const num = (v: CellValue): number => {
    if (dead) return 0;
    if (typeof v === 'number') return v;
    if (v === '') return 0;
    const n = Number(v);
    if (Number.isNaN(n)) throw new FormulaError('#VALUE!');
    return n;
  };
  const PLAIN = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
  const flat = (a: (CellValue | CellValue[])[]) => a.flat().filter((v) => typeof v === 'number' || (typeof v === 'string' && PLAIN.test(v.trim()))).map(Number);
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
    CONCAT: (a) => capText(a.flat().join('')),
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
      l = op === '&' ? capText(`${l}${r}`) : op === '+' ? num(l) + num(r) : num(l) - num(r);
    }
    return l;
  }
  function term(): CellValue {
    let l = power();
    while (peek()?.t === 'op' && ['*', '/'].includes(peek().v)) {
      const op = take().v;
      const r = num(power());
      if (op === '/' && r === 0 && !dead) throw new FormulaError('#DIV/0!');
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
        if (dead) { out.push([]); if (peek()?.v === ',') { take(); continue; } take(')'); return out; }
        if (Math.max(c1, c2) >= bounds[0] || Math.max(r1, r2) >= bounds[1]) throw new FormulaError('#REF!'); // also keeps A1:ZZ99999 from looping millions of times
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
    if (t.t === 'ref') { take(); const [c, r] = refToCell(t.v); return dead ? 0 : resolve(c, r); }
    if (t.t === 'id') {
      take();
      const f = Object.hasOwn(FUNCS, t.v) ? FUNCS[t.v] : undefined;
      if (!f) throw new FormulaError('#NAME?');
      if (t.v === 'IF') {
        take('(');
        const cond = comparison();
        const yes = cond !== 0 && cond !== '';
        take(',');
        if (!yes) dead++;
        const a = comparison();
        if (!yes) dead--;
        let b: CellValue = '';
        if (peek()?.v === ',') {
          take();
          if (yes) dead++;
          b = comparison();
          if (yes) dead--;
        }
        take(')');
        return dead ? 0 : yes ? a : b;
      }
      const values = args();
      return dead ? 0 : f(values);
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
  return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : s; // plain decimals only: not 0x10, 1e3 or Infinity
};

/** Evaluate a grid of cell texts. Cells starting with "=" are formulas; the result has one value per cell. */
export function evaluateGrid(grid: string[][]): CellValue[][] {
  const memo = new Map<string, CellValue>();
  /** Cells whose formula failed. Kept apart from values so a text cell like "#tag" is never mistaken for an error. */
  const errors = new Map<string, string>();
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
          const err = errors.get(`${cc},${rr}`);
          if (err) throw new FormulaError(err);
          return x;
        }, [Math.max(0, ...grid.map((r) => r.length)), grid.length]);
      } catch (e) {
        v = e instanceof FormulaError ? e.message : '#ERR!';
        errors.set(key, v);
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

const ERROR_CODES = /^#(?:DIV\/0!|REF!|NAME\?|VALUE!|NUM!|ERR!|CYCLE!)$/;
export const isErrorValue = (v: CellValue): boolean => typeof v === 'string' && ERROR_CODES.test(v);

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
