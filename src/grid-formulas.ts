/**
 * The formula engine of the spreadsheet and of the formulas in an editor table: A1 references and ranges, `$` for fixed ones, about
 * five hundred Excel functions, arrays that spill, references to other sheets, and a small safe evaluator (no `eval`). It imports
 * nothing, so the stand-alone spreadsheet can use it without the editor.
 */
import { CYCLE, budget, Ctx, FormulaError, NAME, REF, Rng, SPILL, SYNTAX, SheetCtx, Scalar, V, colIndexOf, colNameOf, isArr, isRng, mat } from './formula-core';
import { evaluate } from './formula-eval';

export type CellValue = number | string | boolean;
export { FormulaError } from './formula-core';
export type { SheetCtx } from './formula-core';

/** Column letters to a 0-based index ("A" 0, "AA" 26). */
export const colIndex = colIndexOf;
export const colName = colNameOf;

export const asValue = (s: string): CellValue => {
  const t = s.trim();
  return /^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : s; // plain decimals only: not 0x10, 1e3 or Infinity
};
const PLAIN_DEC = /^[-+]?(?:\d+\.?\d*|\.\d+)$/;
const PLAIN_NUM = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/;
/** What a cell's text means: a number, TRUE / FALSE, or text. */
const parseRaw = (s: string, legacy: boolean): Scalar => {
  const t = s.trim();
  if ((legacy ? PLAIN_DEC : PLAIN_NUM).test(t)) return Number(t);
  if (legacy) return s;
  const u = t.toUpperCase();
  return u === 'TRUE' ? true : u === 'FALSE' ? false : s;
};

export interface Evaluator {
  /** The value of a cell: a number, text, TRUE / FALSE, or an error such as `#DIV/0!`. */
  value(col: number, row: number): CellValue;
  /** The error code when the cell's formula failed, else null (so a text cell like "#tag" is never taken for an error). */
  error(col: number, row: number): string | null;
  /** The value a formula elsewhere spills into this empty cell, or undefined. */
  spilled(col: number, row: number): CellValue | undefined;
  /** Evaluate formula text (with or without the `=`) as if it stood in a cell, without keeping it (conditional formats use this). */
  formula(src: string, col: number, row: number): CellValue;
  /** This sheet for formulas on other sheets. */
  readonly sheet: SheetCtx;
}

export interface EvaluatorOptions {
  /** The name of this sheet, for `Sheet1!A1` written inside it. */
  name?: string;
  /** Another sheet by name (case does not matter), for `Sheet2!A1`. */
  sheets?: (name: string) => SheetCtx | undefined;
  /** Shared by all the evaluators of a workbook, so a loop across sheets is found. */
  scope?: Set<string>;
  /** A defined name as formula text (`Sheet1!$A$1:$A$10`, `0.2`, `A1*2`). */
  names?: (name: string) => string | undefined;
  /** Call `visit` for every cell holding a formula; arrays spill from them. Without it nothing spills. */
  scan?: (visit: (col: number, row: number, raw: string) => void) => void;
  /** Ranges that run past the grid are `#REF!` (the editor's tables); else they are cut to the grid. */
  strictBounds?: boolean;
  /** The editor's tables: `^` goes right to left and comparisons give 1 or 0. */
  legacy?: boolean;
  /** The clock for NOW and TODAY, in ms. */
  now?: number;
}

/** The most work (cells read, elements made) one cell may cost, and one sheet's whole recalculation; past it a formula gives `#CALC!`. */
const CELL_WORK = 5_000_000;
const SHEET_WORK = 500_000_000;

/** A formula whose answer may be an array bigger than one cell (so it may spill). */
const SPILLY = /\b(?:FILTER|SORT|SORTBY|UNIQUE|SEQUENCE|RANDARRAY|TRANSPOSE|TOCOL|TOROW|VSTACK|HSTACK|TAKE|DROP|EXPAND|CHOOSECOLS|CHOOSEROWS|TEXTSPLIT|WRAPROWS|WRAPCOLS|MMULT|MINVERSE|MUNIT|MODE\.MULT|TREND|GROWTH|FREQUENCY|LINEST)\s*\(|\{|^=\s*[-+(@]*\$?[A-Za-z]{1,3}\$?\d+\s*:|[(,*/+\-<>=&]\s*\$?[A-Za-z]{1,3}\$?\d+:\$?[A-Za-z]{1,3}\$?\d+\s*(?:[*/+\-<>=&^]|$)|\bIF\s*\(|\bLET\s*\(/i;

/**
 * Evaluate cells on demand. `rawAt` gives a cell's text (`undefined` for a cell outside the grid), `bounds` is `[columns, rows]`.
 * Only the cells asked for, and the ones they depend on, are calculated; the answers are kept until you make a new evaluator.
 */
export function createEvaluator(rawAt: (col: number, row: number) => string | undefined, bounds: [number, number], opts: EvaluatorOptions = {}): Evaluator {
  const memo = new Map<string, Scalar>();
  const spills = new Map<string, Scalar>();
  const scope = opts.scope ?? new Set<string>();
  const sheetName = opts.name ?? '';
  const now = opts.now ?? Date.now();
  const work = { left: SHEET_WORK };
  let scanning = false;
  let spillsReady = !opts.scan;
  let depth = 0;

  const get = (c: number, r: number): Scalar => {
    const raw = rawAt(c, r);
    if (raw === undefined) return REF;
    const key = `${c},${r}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    if (!raw.trim().startsWith('=')) {
      if (raw === '') { if (!scanning && !spillsReady) ensureSpills(); return spills.get(key) ?? null; }
      const v = parseRaw(raw, !!opts.legacy);
      memo.set(key, v);
      return v;
    }
    const scopeKey = `${sheetName}!${key}`;
    if (scope.has(scopeKey)) return CYCLE;
    const outermost = scope.size === 0;
    if (outermost) { budget.cell = CELL_WORK; budget.total = work.left; }
    scope.add(scopeKey);
    let v: Scalar;
    try {
      v = settle(evaluate(raw.trim().slice(1), ctxFor(c, r), { strictBounds: opts.strictBounds, legacyPow: opts.legacy }), c, r);
    } catch (e) {
      v = e instanceof FormulaError ? e : e instanceof RangeError ? SYNTAX : SYNTAX;
    } finally {
      scope.delete(scopeKey);
      if (outermost) work.left = budget.total;
    }
    memo.set(key, v);
    return v;
  };

  /** A formula's answer as the cell's value; an array bigger than one cell spills into the cells beside it. */
  function settle(v: V, c: number, r: number): Scalar {
    if (isRng(v)) { if (v.rows * v.cols === 1) { const x = v.sheet.cell(v.c0, v.r0); return x === null ? 0 : x; } v = v.matrix(); }
    if (!isArr(v)) return v;
    const rows = v.length; const cols = v[0]?.length ?? 0;
    const first = v[0]?.[0] ?? null;
    if (rows * cols <= 1) return first === null ? 0 : first;
    if (!opts.scan) return first === null ? 0 : first;
    if (c + cols > bounds[0] || r + rows > bounds[1]) return SPILL;
    const targets: string[] = [];
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      if (!i && !j) continue;
      const k = `${c + j},${r + i}`;
      const existing = rawAt(c + j, r + i);
      if ((existing !== undefined && existing !== '') || spills.has(k)) return SPILL;
      targets.push(k);
    }
    let t = 0;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { if (!i && !j) continue; spills.set(targets[t++], v[i][j] ?? 0); }
    return first === null ? 0 : first;
  }

  function ensureSpills() {
    spillsReady = true;
    scanning = true;
    const found: [number, number][] = [];
    try { opts.scan!((c, r, raw) => { if (SPILLY.test(raw)) found.push([c, r]); }); } catch { /* a broken scan just means no spills */ }
    for (const [c, r] of found) get(c, r);
    scanning = false;
  }

  const self: SheetCtx = {
    name: sheetName, cols: bounds[0], rows: bounds[1],
    cell: (c, r) => get(c, r),
    isFormula: (c, r) => (rawAt(c, r) ?? '').trim().startsWith('='),
  };

  function ctxFor(col: number, row: number): Ctx {
    const ctx: Ctx = {
      sheet: self, col, row, now,
      sheets: (name) => (name.toLowerCase() === sheetName.toLowerCase() ? self : opts.sheets?.(name)),
      rand: Math.random,
      name: (n) => opts.names?.(n),
      evalText: (src) => {
        if (++depth > 20) { depth--; throw NAME; }
        try { return evaluate(src, ctx, { strictBounds: opts.strictBounds, legacyPow: opts.legacy }); } finally { depth--; }
      },
    };
    return ctx;
  }

  const out = (v: Scalar): CellValue => (v instanceof FormulaError ? v.message : v === null ? '' : opts.legacy && typeof v === 'boolean' ? (v ? 1 : 0) : v);
  return {
    sheet: self,
    value(c, r) { try { return out(get(c, r)); } catch { return '#ERR!'; } },
    error(c, r) { const v = get(c, r); return v instanceof FormulaError ? v.message : null; },
    formula(src, c, r) {
      const outermost = scope.size === 0;
      if (outermost) { budget.cell = CELL_WORK; budget.total = work.left; }
      try {
        let v = evaluate(src.trim().replace(/^=/, ''), ctxFor(c, r), { strictBounds: opts.strictBounds, legacyPow: opts.legacy });
        if (isRng(v)) v = v.matrix();
        if (isArr(v)) v = v[0]?.[0] ?? null;   // an array gives its first value; nothing spills from here
        return out(v === null ? 0 : (v as Scalar));
      }
      catch (e) { return e instanceof FormulaError ? e.message : '#ERR!'; }
      finally { if (outermost) work.left = budget.total; }
    },
    spilled(c, r) {
      if (!spillsReady) ensureSpills();
      const v = spills.get(`${c},${r}`);
      return v === undefined ? undefined : out(v);
    },
  };
}

/** Evaluate a grid of cell texts. Cells starting with "=" are formulas; the result has one value per cell. */
export function evaluateGrid(grid: string[][]): CellValue[][] {
  const ev = createEvaluator((c, r) => grid[r]?.[c], [Math.max(0, ...grid.map((r) => r.length)), grid.length], { legacy: true, strictBounds: true });
  return grid.map((row, r) => row.map((_, c) => ev.value(c, r)));
}

export const formatValue = (v: CellValue): string => (typeof v === 'number' ? String(Math.round(v * 1e10) / 1e10) : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v);

const ERROR_CODES = /^#(?:DIV\/0!|REF!|NAME\?|VALUE!|NUM!|ERR!|CYCLE!|N\/A|NULL!|SPILL!|CALC!)$/;
export const isErrorValue = (v: CellValue): boolean => typeof v === 'string' && ERROR_CODES.test(v);

export { Rng, mat };

// ---- A1 references -------------------------------------------------------------------------------------------------------

/** "B3" for column 1, row 2 (both 0-based). */
export const cellRef = (col: number, row: number): string => `${colName(col)}${row + 1}`;

/** "B3" or "$B$3" to `{ col, row }` (0-based), or null. */
export function parseCellRef(s: string): { col: number; row: number } | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.trim());
  return m ? { col: colIndex(m[1].toUpperCase()), row: Number(m[2]) - 1 } : null;
}

export type RefMove = (col: number, row: number, absCol: boolean, absRow: boolean) => { col: number; row: number } | null;
/** A range `A1:B5` (0-based corners, start first). Return the new corners, or null when the whole range is gone. */
export type RangeMove = (a: { col: number; row: number }, b: { col: number; row: number }) => [{ col: number; row: number }, { col: number; row: number }] | null;

/**
 * Rewrite the cell references of a formula. `fn` gets each reference (0-based, with whether the column or row is absolute, `$`) and
 * returns the new position, or null for a reference that no longer exists (it becomes `#REF!`). A range like `A1:A5` goes through
 * `range` when you give it (so a range can shrink instead of failing), else through `fn` once for each end. Text inside quotes and
 * function names are left alone. Used to move formulas when rows or columns are inserted, deleted, copied or filled.
 */
export function mapFormulaRefs(formula: string, fn: RefMove, range?: RangeMove): string {
  if (!formula.trim().startsWith('=')) return formula;
  const REF = '(\\$?)([A-Za-z]{1,3})(\\$?)(\\d{1,7})';
  const re = new RegExp(`("[^"]*")|([A-Za-z0-9_.]?)${REF}(?::${REF})?(?![\\w(])`, 'g');
  const one = (d1: string, l: string, d2: string, n: string) => fn(colIndex(l.toUpperCase()), Number(n) - 1, d1 === '$', d2 === '$');
  const text = (d1: string, p: { col: number; row: number }, d2: string) => `${d1}${colName(p.col)}${d2}${p.row + 1}`;
  return formula.replace(re, (all, str: string | undefined, before: string, a1: string, a2: string, a3: string, a4: string, b1?: string, b2?: string, b3?: string, b4?: string) => {
    if (str !== undefined || before) return all;
    if (b2 === undefined) {
      const out = one(a1, a2, a3, a4);
      return out ? text(a1, out, a3) : '#REF!';
    }
    if (range) {
      const out = range({ col: colIndex(a2.toUpperCase()), row: Number(a4) - 1 }, { col: colIndex(b2.toUpperCase()), row: Number(b4) - 1 });
      return out ? `${text(a1, out[0], a3)}:${text(b1!, out[1], b3!)}` : '#REF!';
    }
    const p = one(a1, a2, a3, a4);
    const q = one(b1!, b2, b3!, b4!);
    return p && q ? `${text(a1, p, a3)}:${text(b1!, q, b3!)}` : '#REF!';
  });
}

/** The formula as it reads when copied `dc` columns and `dr` rows away: relative references move, `$` ones stay. */
export const shiftFormula = (formula: string, dc: number, dr: number): string =>
  mapFormulaRefs(formula, (col, row, ac, ar) => {
    const c = ac ? col : col + dc;
    const r = ar ? row : row + dr;
    return c < 0 || r < 0 ? null : { col: c, row: r };
  });

