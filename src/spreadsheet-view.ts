/**
 * The grid of the spreadsheet: it draws the visible cells only (so a sheet of 20,000 rows is as quick as one of 20), and handles
 * selection, typing, the keyboard, the mouse, the clipboard, resizing and the fill handle. The data lives in `spreadsheet-model.ts`.
 */
import { cellRef, colName } from './grid-formulas';
import { MAX_COLS, MAX_ROWS, normRange, parseDelimited, type CellData, type CellStyle, type Range, type Sheet, type Workbook } from './spreadsheet-model';

const HEAD_W = 48;
const HEAD_H = 24;
const SPILL_MAX = 20;

export interface GridOptions {
  readOnly?: boolean;
  gridlines?: boolean;
  headings?: boolean;
  /** Called when the selection, or what it holds, changes. */
  onSelect?: () => void;
  /** Called when the text being typed changes (so the formula bar can show it). */
  onEdit?: (text: string | null) => void;
  /** A right-click or the context-menu key: where, and on what. */
  onContext?: (x: number, y: number, zone: 'cell' | 'col' | 'row') => void;
  /** The arrow of a filter header was clicked. */
  onFilter?: (col: number, anchor: HTMLElement) => void;
}

interface Pos { r: number; c: number }

const lowerBound = (a: number[], v: number): number => {
  let lo = 0; let hi = a.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (a[m] <= v) lo = m; else hi = m - 1; }
  return lo;
};

export class GridView {
  readonly el = document.createElement('div');
  private sizer = document.createElement('div');
  private colHead = document.createElement('div');
  private rowHead = document.createElement('div');
  private corner = document.createElement('div');
  private layer = document.createElement('div');
  private selBox = document.createElement('div');
  private activeBox = document.createElement('div');
  private clipBox = document.createElement('div');
  private fillBox = document.createElement('div');
  private handle = document.createElement('div');
  private editor = document.createElement('textarea');
  private live = document.createElement('div');
  /** Copy and paste go through this hidden box: not every browser sends them to a plain element that has no text selected. */
  private catcher = document.createElement('textarea');

  private colX: number[] = [0];
  private rowY: number[] = [0];
  private z = 1;
  private frame = 0;
  private lastKey = '';
  anchor: Pos = { r: 0, c: 0 };
  active: Pos = { r: 0, c: 0 };
  range: Range = { r0: 0, c0: 0, r1: 0, c1: 0 };
  private editing: { r: number; c: number; typed: boolean; from: 'cell' | 'bar'; original: string; sheet: Sheet } | null = null;
  private formulaRef: { start: number; end: number } | null = null;
  private clip: { cells: (CellData | undefined)[][]; from: Pos; range: Range; cut: boolean; text: string; sheet: Sheet } | null = null;
  private drag: null | { kind: 'select' } | { kind: 'cols' | 'rows'; anchor: number } | { kind: 'colsize'; c: number; startX: number; startW: number } | { kind: 'rowsize'; r: number; startY: number; startH: number } | { kind: 'fill'; src: Range; target: Range | null } | { kind: 'ref' } = null;
  private unsub: () => void;
  showFormulas = false;
  gridlines: boolean;
  headings: boolean;
  readOnly: boolean;

  constructor(readonly wb: Workbook, private o: GridOptions = {}) {
    this.gridlines = o.gridlines !== false;
    this.headings = o.headings !== false;
    this.readOnly = !!o.readOnly;
    const el = this.el;
    el.className = 'wy-ss-grid';
    el.tabIndex = 0;
    el.setAttribute('role', 'grid');
    el.setAttribute('aria-label', 'Spreadsheet');
    el.setAttribute('aria-multiselectable', 'true');
    this.sizer.className = 'wy-ss-sizer';
    this.colHead.className = 'wy-ss-colhead';
    this.rowHead.className = 'wy-ss-rowhead';
    this.corner.className = 'wy-ss-corner';
    this.layer.className = 'wy-ss-cells';
    this.selBox.className = 'wy-ss-sel';
    this.activeBox.className = 'wy-ss-active';
    this.clipBox.className = 'wy-ss-clip';
    this.fillBox.className = 'wy-ss-fillbox';
    this.handle.className = 'wy-ss-handle';
    this.editor.className = 'wy-ss-edit';
    this.editor.rows = 1;
    this.editor.spellcheck = false;
    this.editor.setAttribute('aria-label', 'Cell');
    this.editor.hidden = true;
    this.live.className = 'wy-ss-live';
    this.live.setAttribute('role', 'status');
    this.live.setAttribute('aria-live', 'polite');
    this.catcher.className = 'wy-ss-catcher';
    this.catcher.tabIndex = -1;
    this.catcher.setAttribute('aria-hidden', 'true');
    this.colHead.append(this.corner);
    this.sizer.append(this.colHead, this.rowHead, this.layer);
    el.append(this.sizer, this.live, this.catcher);
    this.layer.append(this.selBox, this.activeBox, this.clipBox, this.fillBox, this.handle, this.editor);
    this.handle.hidden = true;
    this.clipBox.hidden = true;
    this.fillBox.hidden = true;

    el.addEventListener('scroll', () => this.schedule());
    el.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    el.addEventListener('pointermove', (e) => this.onPointerMove(e));
    el.addEventListener('pointerup', (e) => this.onPointerUp(e));
    el.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    el.addEventListener('dblclick', (e) => this.onDblClick(e));
    el.addEventListener('contextmenu', (e) => this.onContext(e));
    el.addEventListener('keydown', (e) => this.onKeyDown(e));
    el.addEventListener('copy', (e) => this.onCopy(e, false));
    el.addEventListener('cut', (e) => this.onCopy(e, true));
    el.addEventListener('paste', (e) => this.onPaste(e));
    this.catcher.addEventListener('copy', (e) => { this.onCopy(e, false); this.back(); });
    this.catcher.addEventListener('cut', (e) => { this.onCopy(e, true); this.back(); });
    this.catcher.addEventListener('paste', (e) => { this.onPaste(e); this.back(); });
    this.editor.addEventListener('keydown', (e) => this.onEditKey(e));
    this.editor.addEventListener('input', () => { this.fit(); this.o.onEdit?.(this.editor.value); this.formulaRef = null; });
    this.editor.addEventListener('blur', () => { if (this.editing?.from === 'cell' && !this.drag) this.commit(0, 0); });
    this.unsub = wb.on(() => { this.measure(); this.syncSelectionToSheet(); this.schedule(true); this.o.onSelect?.(); });
    this.measure();
    this.schedule();
  }

  destroy(): void { this.unsub(); cancelAnimationFrame(this.frame); this.el.remove(); }

  get sheet(): Sheet { return this.wb.sheet; }
  get zoom(): number { return this.z; }
  /** The in-cell editor, for the function suggestions. */
  get editorEl(): HTMLTextAreaElement { return this.editor; }
  get isEditing(): boolean { return !!this.editing; }
  get editingFrom(): 'cell' | 'bar' | null { return this.editing?.from ?? null; }

  setZoom(z: number): void {
    const n = Math.max(0.25, Math.min(3, z));
    if (n === this.z) return;
    const cx = this.el.scrollLeft / this.z; const cy = this.el.scrollTop / this.z;
    this.z = n;
    this.measure();
    this.el.scrollLeft = cx * n; this.el.scrollTop = cy * n;
    this.schedule(true);
  }

  setOptions(o: { gridlines?: boolean; headings?: boolean; showFormulas?: boolean; readOnly?: boolean }): void {
    if (o.gridlines !== undefined) this.gridlines = o.gridlines;
    if (o.headings !== undefined) { this.headings = o.headings; this.measure(); }
    if (o.showFormulas !== undefined) this.showFormulas = o.showFormulas;
    if (o.readOnly !== undefined) this.readOnly = o.readOnly;
    this.schedule(true);
  }

  focus(): void { this.el.focus({ preventScroll: true }); }

  // ---- geometry

  private hw(): number { return this.headings ? HEAD_W * this.z : 0; }
  private hh(): number { return this.headings ? HEAD_H * this.z : 0; }

  private measure() {
    const sh = this.sheet;
    this.colX = new Array(sh.cols + 1);
    this.rowY = new Array(sh.rows + 1);
    let x = 0;
    for (let c = 0; c < sh.cols; c++) { this.colX[c] = x; x += sh.colWidth(c) * this.z; }
    this.colX[sh.cols] = x;
    let y = 0;
    for (let r = 0; r < sh.rows; r++) { this.rowY[r] = y; y += sh.rowHeight(r) * this.z; }
    this.rowY[sh.rows] = y;
    this.sizer.style.width = `${this.hw() + x}px`;
    this.sizer.style.height = `${this.hh() + y + 2}px`;
    this.layer.style.left = `${this.hw()}px`;
    this.layer.style.top = `${this.hh()}px`;
    this.colHead.style.height = `${this.hh()}px`;
    this.rowHead.style.width = `${this.hw()}px`;
    this.rowHead.style.height = `${y + 2}px`;
    this.corner.style.width = `${this.hw()}px`;
    this.el.classList.toggle('no-headings', !this.headings);
  }

  private syncSelectionToSheet() {
    const sh = this.sheet;
    const clamp = (p: Pos): Pos => ({ r: Math.max(0, Math.min(sh.rows - 1, p.r)), c: Math.max(0, Math.min(sh.cols - 1, p.c)) });
    this.anchor = clamp(this.anchor); this.active = clamp(this.active);
    this.range = this.fixRange(this.range);
  }

  private fixRange(r: Range): Range {
    const sh = this.sheet;
    const n = normRange(r);
    return { r0: Math.max(0, Math.min(sh.rows - 1, n.r0)), r1: Math.max(0, Math.min(sh.rows - 1, n.r1)), c0: Math.max(0, Math.min(sh.cols - 1, n.c0)), c1: Math.max(0, Math.min(sh.cols - 1, n.c1)) };
  }

  /** Cell under a point of the screen, and what part of the grid it is in. */
  private hit(clientX: number, clientY: number): { r: number; c: number; zone: 'cell' | 'col' | 'row' | 'corner'; edge: 'col' | 'row' | null } {
    const sh = this.sheet;
    const wr = this.el.getBoundingClientRect();
    const sx = clientX - wr.left - this.el.clientLeft; const sy = clientY - wr.top - this.el.clientTop;
    const x = sx - this.hw(); const y = sy - this.hh();
    const fw = this.colX[Math.min(sh.freezeCols, sh.cols)] ?? 0;
    const fh = this.rowY[Math.min(sh.freezeRows, sh.rows)] ?? 0;
    const px = x < fw ? x : x + this.el.scrollLeft;
    const py = y < fh ? y : y + this.el.scrollTop;
    const c = Math.max(0, Math.min(sh.cols - 1, lowerBound(this.colX, Math.max(0, px))));
    const r = Math.max(0, Math.min(sh.rows - 1, lowerBound(this.rowY, Math.max(0, py))));
    const zone = x < 0 && y < 0 ? 'corner' : y < 0 ? 'col' : x < 0 ? 'row' : 'cell';
    let edge: 'col' | 'row' | null = null;
    if (zone === 'col') { const right = this.colX[c + 1] - px; const left = px - this.colX[c]; if (right >= 0 && right <= 4) edge = 'col'; else if (left <= 4 && c > 0) { edge = 'col'; return { r, c: c - 1, zone, edge }; } }
    if (zone === 'row') { const bot = this.rowY[r + 1] - py; const top = py - this.rowY[r]; if (bot >= 0 && bot <= 4) edge = 'row'; else if (top <= 4 && r > 0) { edge = 'row'; return { r: r - 1, c, zone, edge }; } }
    return { r, c, zone, edge };
  }

  private rect(range: Range): { x: number; y: number; w: number; h: number } {
    const n = this.fixRange(range);
    return { x: this.colX[n.c0], y: this.rowY[n.r0], w: this.colX[n.c1 + 1] - this.colX[n.c0], h: this.rowY[n.r1 + 1] - this.rowY[n.r0] };
  }

  // ---- drawing

  private schedule(now = false) {
    if (now) { cancelAnimationFrame(this.frame); this.frame = 0; this.draw(true); return; }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(false); });
  }

  /** Redraw after something outside changed (a style, a value). */
  refresh(): void { this.schedule(true); }

  private draw(force: boolean) {
    const sh = this.sheet;
    const z = this.z;
    const el = this.el;
    const vw = el.clientWidth; const vh = el.clientHeight;
    const sl = el.scrollLeft; const st = el.scrollTop;
    const fr = Math.min(sh.freezeRows, sh.rows); const fc = Math.min(sh.freezeCols, sh.cols);
    const c0 = Math.max(0, lowerBound(this.colX, sl) - 1);
    let c1 = lowerBound(this.colX, sl + vw); c1 = Math.min(sh.cols - 1, c1 + 1);
    const r0 = Math.max(0, lowerBound(this.rowY, st) - 1);
    let r1 = lowerBound(this.rowY, st + vh); r1 = Math.min(sh.rows - 1, r1 + 1);
    const key = `${sh.name}|${c0}|${c1}|${r0}|${r1}|${fr}|${fc}|${this.z}`;
    const fixed = this.layer.querySelectorAll<HTMLElement>('[data-fx]');
    const moveFixed = () => { for (const n of fixed) { const dx = n.dataset.fx === '1' ? sl : 0; const dy = n.dataset.fy === '1' ? st : 0; n.style.transform = dx || dy ? `translate(${dx}px, ${dy}px)` : ''; } };
    if (!force && key === this.lastKey) { moveFixed(); this.headerTransforms(sl, st); this.drawSelection(); return; }
    this.lastKey = key;

    const cols: number[] = []; const rows: number[] = [];
    for (let c = 0; c < fc; c++) cols.push(c);
    for (let c = Math.max(c0, fc); c <= c1; c++) cols.push(c);
    for (let r = 0; r < fr; r++) rows.push(r);
    for (let r = Math.max(r0, fr); r <= r1; r++) rows.push(r);

    const frag = document.createDocumentFragment();
    const wb = this.wb;
    const filter = sh.filter;
    const hasSpill = true;
    for (const r of rows) {
      const h = this.rowY[r + 1] - this.rowY[r];
      if (h <= 0) continue;
      for (const c of cols) {
        const w = this.colX[c + 1] - this.colX[c];
        if (w <= 0) continue;
        const data = sh.get(r, c);
        const s: CellStyle = data?.s ?? {};
        const d = data?.v !== undefined || (hasSpill && wb.spilled(sh, r, c)) ? wb.display(sh, r, c) : { text: '', number: false, error: false };
        const cell = document.createElement('div');
        cell.className = 'wy-ss-c';
        cell.setAttribute('role', 'gridcell');
        cell.setAttribute('aria-rowindex', String(r + 1));
        cell.setAttribute('aria-colindex', String(c + 1));
        cell.dataset.r = String(r); cell.dataset.c = String(c);
        const st2 = cell.style;
        st2.left = `${this.colX[c]}px`; st2.top = `${this.rowY[r]}px`; st2.width = `${w}px`; st2.height = `${h}px`;
        let text = d.text;
        if (this.showFormulas && data?.v?.trim().startsWith('=')) text = data.v;
        const align = s.align ?? (d.number && !this.showFormulas ? 'right' : d.error ? 'center' : 'left');
        st2.textAlign = align;
        st2.fontSize = `${(s.size ?? 11) * z}px`;
        if (s.font) st2.fontFamily = s.font;
        if (s.b) st2.fontWeight = '700';
        if (s.i) st2.fontStyle = 'italic';
        if (s.u || s.s) st2.textDecoration = `${s.u ? 'underline' : ''} ${s.s ? 'line-through' : ''}`.trim();
        if (s.color) st2.color = s.color;
        if (s.bg) st2.backgroundColor = s.bg;
        st2.justifyContent = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
        st2.alignItems = s.valign === 'top' ? 'flex-start' : s.valign === 'middle' ? 'center' : 'flex-end';
        if (!s.valign) st2.alignItems = 'flex-end';
        if (s.wrap) cell.classList.add('is-wrap');
        if (d.error) cell.classList.add('is-error');
        if (s.bt) st2.borderTop = '1px solid var(--ss-ink)';
        if (s.bb) st2.borderBottom = '1px solid var(--ss-ink)';
        if (s.bl) st2.borderLeft = '1px solid var(--ss-ink)';
        if (s.br) st2.borderRight = '1px solid var(--ss-ink)';
        if (!this.gridlines) cell.classList.add('no-grid');
        if (r === fr - 1 && fr > 0) cell.classList.add('freeze-b');
        if (c === fc - 1 && fc > 0) cell.classList.add('freeze-r');
        const frozenR = r < fr; const frozenC = c < fc;
        if (frozenR || frozenC) { cell.dataset.fx = frozenC ? '1' : '0'; cell.dataset.fy = frozenR ? '1' : '0'; cell.classList.add('is-frozen'); cell.style.transform = `translate(${frozenC ? sl : 0}px, ${frozenR ? st : 0}px)`; }
        const inner = document.createElement('span');
        inner.className = 'wy-ss-text';
        inner.textContent = text;
        cell.append(inner);
        // text that does not fit goes on over the empty cells to its right, as in Excel
        if (text && !s.wrap && !d.number && align === 'left' && !d.error) {
          const need = text.length * (s.size ?? 11) * 0.6 * z + 8;
          if (need > w) {
            let span = w; let cc = c + 1;
            while (span < need && cc < sh.cols && cc - c < SPILL_MAX && sh.get(r, cc)?.v === undefined) { span += this.colX[cc + 1] - this.colX[cc]; cc++; }
            if (span > w) { st2.width = `${span}px`; cell.classList.add('is-spill'); }
          }
        }
        if (filter && r === filter.row && c >= filter.c0 && c <= filter.c1) {
          const f = document.createElement('button');
          f.type = 'button'; f.className = `wy-ss-fbtn${filter.hide[c]?.length ? ' is-on' : ''}`; f.dataset.filter = String(c);
          f.setAttribute('aria-label', `Filter ${colName(c)}`); f.setAttribute('aria-haspopup', 'dialog');
          f.innerHTML = '<svg viewBox="0 0 10 10" width="9" height="9"><path d="M1 3l4 4 4-4z" fill="currentColor"/></svg>';
          cell.append(f);
        }
        frag.append(cell);
      }
    }
    // keep the overlays and the editor; replace the cells
    for (const n of [...this.layer.children]) if ((n as HTMLElement).classList.contains('wy-ss-c')) n.remove();
    this.layer.prepend(frag);

    // headers
    this.colHead.querySelectorAll('.wy-ss-ch').forEach((n) => n.remove());
    this.rowHead.querySelectorAll('.wy-ss-rh').forEach((n) => n.remove());
    if (this.headings) {
      const cf = document.createDocumentFragment();
      for (const c of cols) {
        const w = this.colX[c + 1] - this.colX[c];
        if (w <= 0) continue;
        const h = document.createElement('div');
        h.className = 'wy-ss-ch'; h.dataset.c = String(c);
        h.style.left = `${this.hw() + this.colX[c]}px`; h.style.width = `${w}px`;
        h.textContent = colName(c);
        h.setAttribute('role', 'columnheader');
        if (c < fc) { h.dataset.fx = '1'; h.style.transform = `translateX(${sl}px)`; }
        cf.append(h);
      }
      this.colHead.append(cf);
      const rf = document.createDocumentFragment();
      for (const r of rows) {
        const h = this.rowY[r + 1] - this.rowY[r];
        if (h <= 0) continue;
        const n = document.createElement('div');
        n.className = 'wy-ss-rh'; n.dataset.r = String(r);
        n.style.top = `${this.rowY[r]}px`; n.style.height = `${h}px`;
        n.textContent = String(r + 1);
        n.setAttribute('role', 'rowheader');
        if (r < fr) { n.dataset.fy = '1'; n.style.transform = `translateY(${st}px)`; }
        rf.append(n);
      }
      this.rowHead.append(rf);
    }
    this.headerTransforms(sl, st);
    this.drawSelection();
  }

  private headerTransforms(sl: number, st: number) {
    for (const n of this.colHead.querySelectorAll<HTMLElement>('[data-fx="1"]')) n.style.transform = `translateX(${sl}px)`;
    for (const n of this.rowHead.querySelectorAll<HTMLElement>('[data-fy="1"]')) n.style.transform = `translateY(${st}px)`;
  }

  private drawSelection() {
    const sh = this.sheet;
    const rg = this.range;
    const b = this.rect(rg);
    const fr = sh.freezeRows; const fc = sh.freezeCols;
    const sl = this.el.scrollLeft; const st = this.el.scrollTop;
    const place = (n: HTMLElement, box: { x: number; y: number; w: number; h: number }, range: Range) => {
      n.style.left = `${box.x}px`; n.style.top = `${box.y}px`; n.style.width = `${box.w}px`; n.style.height = `${box.h}px`;
      const fx = range.c1 < fc ? sl : 0; const fy = range.r1 < fr ? st : 0;
      n.style.transform = fx || fy ? `translate(${fx}px, ${fy}px)` : '';
    };
    place(this.selBox, b, rg);
    const single = rg.r0 === rg.r1 && rg.c0 === rg.c1;
    this.selBox.hidden = single && !this.editing;
    const a = this.rect({ r0: this.active.r, c0: this.active.c, r1: this.active.r, c1: this.active.c });
    place(this.activeBox, a, { r0: this.active.r, c0: this.active.c, r1: this.active.r, c1: this.active.c });
    this.activeBox.classList.toggle('is-editing', !!this.editing);
    // the fill handle: bottom-right corner of the selection
    this.handle.hidden = this.readOnly || !!this.editing || this.rowY[rg.r1 + 1] - this.rowY[rg.r1] <= 0;
    this.handle.style.left = `${b.x + b.w - 4}px`; this.handle.style.top = `${b.y + b.h - 4}px`;
    this.handle.style.transform = rg.c1 < fc || rg.r1 < fr ? `translate(${rg.c1 < fc ? sl : 0}px, ${rg.r1 < fr ? st : 0}px)` : '';
    if (this.clip && this.clip.sheet === sh) { this.clipBox.hidden = false; place(this.clipBox, this.rect(this.clip.range), this.clip.range); } else this.clipBox.hidden = true;
    // header highlight
    if (this.headings) {
      const n = normRange(rg);
      for (const h of this.colHead.querySelectorAll<HTMLElement>('.wy-ss-ch')) { const c = Number(h.dataset.c); h.classList.toggle('is-sel', c >= n.c0 && c <= n.c1); h.classList.toggle('is-all', c >= n.c0 && c <= n.c1 && n.r0 === 0 && n.r1 === sh.rows - 1); }
      for (const h of this.rowHead.querySelectorAll<HTMLElement>('.wy-ss-rh')) { const r = Number(h.dataset.r); h.classList.toggle('is-sel', r >= n.r0 && r <= n.r1); h.classList.toggle('is-all', r >= n.r0 && r <= n.r1 && n.c0 === 0 && n.c1 === sh.cols - 1); }
    }
    for (const n of this.layer.querySelectorAll<HTMLElement>('.wy-ss-c[aria-selected]')) n.removeAttribute('aria-selected');
    const act = this.layer.querySelector<HTMLElement>(`.wy-ss-c[data-r="${this.active.r}"][data-c="${this.active.c}"]`);
    act?.setAttribute('aria-selected', 'true');
    if (this.editing) this.placeEditor();
  }

  // ---- selection

  private announce() {
    this.live.textContent = `${cellRef(this.active.c, this.active.r)}: ${this.wb.display(this.sheet, this.active.r, this.active.c).text || 'empty'}`;
  }

  /** Select a range; the active cell is where the typing goes (default: its top-left corner). */
  select(range: Range, active?: Pos, anchor?: Pos): void {
    if (this.editing) this.commit(0, 0);
    const n = this.fixRange(range);
    this.range = n;
    this.active = active ? { r: Math.max(0, Math.min(this.sheet.rows - 1, active.r)), c: Math.max(0, Math.min(this.sheet.cols - 1, active.c)) } : { r: n.r0, c: n.c0 };
    this.anchor = anchor ?? { r: n.r0, c: n.c0 };
    this.scrollTo(this.active.r, this.active.c);
    this.drawSelection();
    this.announce();
    this.o.onSelect?.();
  }

  moveTo(r: number, c: number, extend = false): void {
    const sh = this.sheet;
    if (r >= sh.rows && r < MAX_ROWS) this.wb.ensureSize(sh, Math.min(MAX_ROWS, r + 50), sh.cols);
    if (c >= sh.cols && c < MAX_COLS) this.wb.ensureSize(sh, sh.rows, Math.min(MAX_COLS, c + 10));
    r = Math.max(0, Math.min(sh.rows - 1, r)); c = Math.max(0, Math.min(sh.cols - 1, c));
    // hidden rows are skipped
    if (sh.hidden.has(r)) { let rr = r; const dir = r >= this.active.r ? 1 : -1; while (rr >= 0 && rr < sh.rows && sh.hidden.has(rr)) rr += dir; if (rr >= 0 && rr < sh.rows) r = rr; else return; }
    if (extend) { this.range = { r0: Math.min(this.anchor.r, r), c0: Math.min(this.anchor.c, c), r1: Math.max(this.anchor.r, r), c1: Math.max(this.anchor.c, c) }; this.active = { r, c }; this.scrollTo(r, c); this.drawSelection(); this.announce(); this.o.onSelect?.(); }
    else this.select({ r0: r, c0: c, r1: r, c1: c }, { r, c }, { r, c });
  }

  /** Scroll so the cell is in view (under the frozen panes, not behind them). */
  scrollTo(r: number, c: number): void {
    const sh = this.sheet; const el = this.el;
    const fw = this.colX[Math.min(sh.freezeCols, sh.cols)] ?? 0; const fh = this.rowY[Math.min(sh.freezeRows, sh.rows)] ?? 0;
    const x0 = this.colX[c]; const x1 = this.colX[c + 1]; const y0 = this.rowY[r]; const y1 = this.rowY[r + 1];
    const vw = el.clientWidth - this.hw(); const vh = el.clientHeight - this.hh();
    if (c >= sh.freezeCols) { if (x0 - fw < el.scrollLeft) el.scrollLeft = x0 - fw; else if (x1 > el.scrollLeft + vw) el.scrollLeft = x1 - vw; }
    if (r >= sh.freezeRows) { if (y0 - fh < el.scrollTop) el.scrollTop = y0 - fh; else if (y1 > el.scrollTop + vh) el.scrollTop = y1 - vh; }
  }

  selectAll(): void { const sh = this.sheet; this.select({ r0: 0, c0: 0, r1: sh.rows - 1, c1: sh.cols - 1 }, this.active, { r: 0, c: 0 }); }

  // ---- editing

  private placeEditor() {
    if (!this.editing) return;
    const { r, c } = this.editing;
    const b = this.rect({ r0: r, c0: c, r1: r, c1: c });
    const s = this.wb.style(this.sheet, r, c);
    const e = this.editor;
    e.style.left = `${b.x}px`; e.style.top = `${b.y}px`; e.style.minWidth = `${b.w}px`; e.style.height = `${b.h}px`;
    e.style.fontSize = `${(s.size ?? 11) * this.z}px`;
    e.style.fontFamily = s.font ?? '';
    e.style.fontWeight = s.b ? '700' : '';
    e.style.fontStyle = s.i ? 'italic' : '';
    e.style.textAlign = s.align ?? 'left';
    const fr = this.sheet.freezeRows; const fc = this.sheet.freezeCols;
    e.style.transform = c < fc || r < fr ? `translate(${c < fc ? this.el.scrollLeft : 0}px, ${r < fr ? this.el.scrollTop : 0}px)` : '';
    this.fit();
  }

  private fit() {
    const e = this.editor;
    if (e.hidden) return;
    e.style.width = '0px';
    e.style.width = `${Math.max(parseFloat(e.style.minWidth) || 0, Math.min(e.scrollWidth + 6, this.el.clientWidth))}px`;
    const lines = Math.max(1, e.value.split('\n').length);
    const base = parseFloat(e.style.minWidth) ? parseFloat(e.style.height) : 24;
    e.style.height = `${Math.max(base, lines * 18 * this.z)}px`;
  }

  /** Start typing in the active cell. `text` replaces what is there (typing a letter); without it the cell's own text is edited. */
  startEdit(text?: string, from: 'cell' | 'bar' = 'cell'): void {
    if (this.readOnly || this.editing) return;
    const { r, c } = this.active;
    const original = this.wb.raw(this.sheet, r, c);
    this.editing = { r, c, typed: text !== undefined, from, original, sheet: this.sheet };
    this.editor.hidden = from === 'bar';
    this.editor.value = text ?? original;
    this.drawSelection();
    this.placeEditor();
    if (from === 'cell') { this.editor.focus(); const n = this.editor.value.length; this.editor.setSelectionRange(n, n); }
    this.o.onEdit?.(this.editor.value);
  }

  /** The formula bar changed the text of the cell being edited. */
  setEditText(text: string): void { if (this.editing) { this.editor.value = text; this.fit(); } }

  get editText(): string { return this.editor.value; }

  /** Finish editing. `dr`, `dc`: where the selection goes next. */
  commit(dr: number, dc: number): void {
    const ed = this.editing;
    if (!ed) return;
    this.editing = null;
    const text = this.editor.value;
    this.editor.hidden = true;
    this.formulaRef = null;
    if (ed.sheet === this.sheet && text !== ed.original) this.wb.input(this.sheet, ed.r, ed.c, text);
    this.o.onEdit?.(null);
    this.drawSelection();
    this.schedule(true);
    if (dr || dc) {
      // Enter inside a multi-cell selection walks through it
      const n = this.range;
      const multi = n.r0 !== n.r1 || n.c0 !== n.c1;
      if (multi && ((dr && !dc) || (dc && !dr))) {
        let r = this.active.r + dr; let c = this.active.c + dc;
        if (dr && r > n.r1) { r = n.r0; c = c + 1 > n.c1 ? n.c0 : c + 1; } else if (dr && r < n.r0) { r = n.r1; c = c - 1 < n.c0 ? n.c1 : c - 1; }
        if (dc && c > n.c1) { c = n.c0; r = r + 1 > n.r1 ? n.r0 : r + 1; } else if (dc && c < n.c0) { c = n.c1; r = r - 1 < n.r0 ? n.r1 : r - 1; }
        this.active = { r, c }; this.scrollTo(r, c); this.drawSelection(); this.o.onSelect?.();
      } else this.moveTo(this.active.r + dr, this.active.c + dc);
    } else this.o.onSelect?.();
    this.focus();
  }

  cancelEdit(): void {
    if (!this.editing) return;
    this.editing = null;
    this.editor.hidden = true;
    this.formulaRef = null;
    this.o.onEdit?.(null);
    this.drawSelection();
    this.focus();
  }

  private onEditKey(e: KeyboardEvent) {
    const ed = this.editing;
    if (!ed) return;
    e.stopPropagation();
    if (e.key === 'Enter' && !(e.altKey)) { e.preventDefault(); this.commit(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); const t = this.editor; const s = t.selectionStart; t.value = `${t.value.slice(0, s)}\n${t.value.slice(t.selectionEnd)}`; t.setSelectionRange(s + 1, s + 1); this.fit(); this.o.onEdit?.(t.value); }
    else if (e.key === 'Tab') { e.preventDefault(); this.commit(0, e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
    else if (ed.typed && !this.editor.value.startsWith('=') && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !e.shiftKey) {
      e.preventDefault();
      this.commit(e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0, e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
    } else if (e.key === 'F4' && this.editor.value.startsWith('=')) {
      e.preventDefault(); this.cycleAbsolute();
    }
  }

  /** F4 in a formula: A1 → $A$1 → A$1 → $A1 for the reference at the caret. */
  private cycleAbsolute() {
    const t = this.editor;
    const pos = t.selectionStart;
    const re = /\$?[A-Za-z]{1,3}\$?\d+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t.value))) {
      if (pos >= m.index && pos <= m.index + m[0].length) {
        const mm = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(m[0])!;
        const next = mm[1] === '' && mm[3] === '' ? `$${mm[2]}$${mm[4]}` : mm[1] && mm[3] ? `${mm[2]}$${mm[4]}` : mm[3] ? `$${mm[2]}${mm[4]}` : `${mm[2]}${mm[4]}`;
        t.value = t.value.slice(0, m.index) + next + t.value.slice(m.index + m[0].length);
        t.setSelectionRange(m.index + next.length, m.index + next.length);
        this.o.onEdit?.(t.value);
        return;
      }
    }
  }

  /** In a formula, right after `=`, an operator, `(` or `,` a click picks a cell for the formula. */
  private canPoint(): boolean {
    if (!this.editing || this.editing.from !== 'cell') return false;
    const t = this.editor;
    if (!t.value.startsWith('=')) return false;
    const before = t.value.slice(0, t.selectionStart).trimEnd();
    return before === '=' || /[=+\-*/^&<>(,:]$/.test(before) || this.formulaRef !== null;
  }

  private pointAt(r: number, c: number, r2 = r, c2 = c) {
    const t = this.editor;
    const text = cellRef(c, r) + (r !== r2 || c !== c2 ? `:${cellRef(c2, r2)}` : '');
    const start = this.formulaRef ? this.formulaRef.start : t.selectionStart;
    const end = this.formulaRef ? this.formulaRef.end : t.selectionEnd;
    t.value = t.value.slice(0, start) + text + t.value.slice(end);
    this.formulaRef = { start, end: start + text.length };
    t.setSelectionRange(this.formulaRef.end, this.formulaRef.end);
    this.fit();
    this.o.onEdit?.(t.value);
  }

  // ---- mouse

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('.wy-ss-fbtn')) { const b = target.closest<HTMLElement>('.wy-ss-fbtn')!; e.preventDefault(); this.o.onFilter?.(Number(b.dataset.filter), b); return; }
    if (target === this.editor) return;
    const h = this.hit(e.clientX, e.clientY);
    // the scroll bars are part of the element: ignore clicks on them
    const wr = this.el.getBoundingClientRect();
    if (e.clientX - wr.left > this.el.clientWidth || e.clientY - wr.top > this.el.clientHeight) return;
    if (target === this.handle) { e.preventDefault(); this.drag = { kind: 'fill', src: { ...this.range }, target: null }; this.el.setPointerCapture(e.pointerId); return; }
    if (this.canPoint() && h.zone === 'cell') {
      e.preventDefault();
      this.pointAt(h.r, h.c);
      this.drag = { kind: 'ref' };
      this.anchor = { r: h.r, c: h.c };
      this.el.setPointerCapture(e.pointerId);
      return;
    }
    if (this.editing) this.commit(0, 0);
    this.focus();
    e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    const sh = this.sheet;
    if (h.zone === 'corner') { this.selectAll(); return; }
    if (h.zone === 'col') {
      if (h.edge === 'col') { this.drag = { kind: 'colsize', c: h.c, startX: e.clientX, startW: sh.colWidth(h.c) }; return; }
      const ext = e.shiftKey ? this.anchor.c : h.c;
      this.drag = { kind: 'cols', anchor: ext };
      this.select({ r0: 0, c0: Math.min(ext, h.c), r1: sh.rows - 1, c1: Math.max(ext, h.c) }, { r: this.active.r, c: h.c }, { r: 0, c: ext });
      return;
    }
    if (h.zone === 'row') {
      if (h.edge === 'row') { this.drag = { kind: 'rowsize', r: h.r, startY: e.clientY, startH: sh.rowHeight(h.r) }; return; }
      const ext = e.shiftKey ? this.anchor.r : h.r;
      this.drag = { kind: 'rows', anchor: ext };
      this.select({ r0: Math.min(ext, h.r), c0: 0, r1: Math.max(ext, h.r), c1: sh.cols - 1 }, { r: h.r, c: this.active.c }, { r: ext, c: 0 });
      return;
    }
    this.drag = { kind: 'select' };
    if (e.shiftKey) this.moveTo(h.r, h.c, true); else this.moveTo(h.r, h.c);
  }

  private onPointerMove(e: PointerEvent) {
    const sh = this.sheet;
    if (!this.drag) {
      const h = this.hit(e.clientX, e.clientY);
      const t = e.target as HTMLElement;
      this.el.style.cursor = t === this.handle ? 'crosshair' : h.edge === 'col' && h.zone === 'col' ? 'col-resize' : h.edge === 'row' && h.zone === 'row' ? 'row-resize' : '';
      return;
    }
    const d = this.drag;
    if (d.kind === 'colsize') { const w = Math.max(12, d.startW + (e.clientX - d.startX) / this.z); this.liveResize(() => sh.colW.set(d.c, w)); return; }
    if (d.kind === 'rowsize') { const hh = Math.max(10, d.startH + (e.clientY - d.startY) / this.z); this.liveResize(() => sh.rowH.set(d.r, hh)); return; }
    const wr = this.el.getBoundingClientRect();
    // near an edge: keep scrolling
    if (e.clientX > wr.right - 24) this.el.scrollLeft += 20; else if (e.clientX < wr.left + this.hw() + 12) this.el.scrollLeft -= 20;
    if (e.clientY > wr.bottom - 24) this.el.scrollTop += 20; else if (e.clientY < wr.top + this.hh() + 12) this.el.scrollTop -= 20;
    const h = this.hit(e.clientX, e.clientY);
    if (d.kind === 'select') { if (h.zone === 'cell') this.moveTo(h.r, h.c, true); }
    else if (d.kind === 'cols') { this.range = { r0: 0, r1: sh.rows - 1, c0: Math.min(d.anchor, h.c), c1: Math.max(d.anchor, h.c) }; this.active = { r: this.active.r, c: h.c }; this.drawSelection(); this.o.onSelect?.(); }
    else if (d.kind === 'rows') { this.range = { c0: 0, c1: sh.cols - 1, r0: Math.min(d.anchor, h.r), r1: Math.max(d.anchor, h.r) }; this.active = { r: h.r, c: this.active.c }; this.drawSelection(); this.o.onSelect?.(); }
    else if (d.kind === 'ref') { if (h.zone === 'cell') this.pointAt(Math.min(this.anchor.r, h.r), Math.min(this.anchor.c, h.c), Math.max(this.anchor.r, h.r), Math.max(this.anchor.c, h.c)); }
    else if (d.kind === 'fill') {
      const s = d.src;
      const down = h.r - s.r1; const up = s.r0 - h.r; const right = h.c - s.c1; const left = s.c0 - h.c;
      const best = Math.max(down, up, right, left);
      let t: Range | null = null;
      if (best > 0) {
        if (best === down) t = { r0: s.r1 + 1, r1: h.r, c0: s.c0, c1: s.c1 };
        else if (best === up) t = { r0: h.r, r1: s.r0 - 1, c0: s.c0, c1: s.c1 };
        else if (best === right) t = { c0: s.c1 + 1, c1: h.c, r0: s.r0, r1: s.r1 };
        else t = { c0: h.c, c1: s.c0 - 1, r0: s.r0, r1: s.r1 };
      }
      d.target = t;
      if (t) { const b = this.rect({ r0: Math.min(s.r0, t.r0), c0: Math.min(s.c0, t.c0), r1: Math.max(s.r1, t.r1), c1: Math.max(s.c1, t.c1) }); this.fillBox.hidden = false; Object.assign(this.fillBox.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` }); } else this.fillBox.hidden = true;
    }
  }

  /** Resize while dragging: only the picture changes; the undo step is made when the button is let go. */
  private liveResize(fn: () => void) { fn(); this.measure(); this.schedule(true); }

  private onPointerUp(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    try { this.el.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (!d) return;
    const sh = this.sheet;
    if (d.kind === 'colsize') { const w = sh.colWidth(d.c); sh.colW.set(d.c, d.startW); if (w !== d.startW) this.wb.setColWidth(sh, d.c, w); else this.schedule(true); }
    else if (d.kind === 'rowsize') { const h = sh.rowHeight(d.r); sh.rowH.set(d.r, d.startH); if (h !== d.startH) this.wb.setRowHeight(sh, d.r, h); else this.schedule(true); }
    else if (d.kind === 'fill') {
      this.fillBox.hidden = true;
      if (d.target) {
        const t = normRange(d.target);
        this.wb.fill(sh, d.src, t);
        const all = { r0: Math.min(d.src.r0, t.r0), c0: Math.min(d.src.c0, t.c0), r1: Math.max(d.src.r1, t.r1), c1: Math.max(d.src.c1, t.c1) };
        this.select(all, this.active, { r: all.r0, c: all.c0 });
      }
    } else if (d.kind === 'ref') this.editor.focus();
  }

  private onDblClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('.wy-ss-fbtn') || t === this.editor) return;
    const h = this.hit(e.clientX, e.clientY);
    const sh = this.sheet;
    if (h.zone === 'col' && h.edge === 'col') { this.wb.setColWidth(sh, h.c, this.wb.autofitWidth(sh, h.c)); return; }
    if (h.zone === 'row' && h.edge === 'row') { this.wb.setRowHeight(sh, h.r, this.autofitHeight(h.r)); return; }
    if (h.zone === 'cell') this.startEdit();
  }

  private autofitHeight(r: number): number {
    const sh = this.sheet;
    let lines = 1; let size = 11;
    for (let c = 0; c < sh.cols; c++) {
      const d = sh.get(r, c);
      if (!d?.v) continue;
      const s = d.s ?? {};
      size = Math.max(size, s.size ?? 11);
      const text = this.wb.display(sh, r, c).text;
      const per = Math.max(1, Math.floor((sh.colWidth(c) - 8) / ((s.size ?? 11) * 0.6)));
      const n = s.wrap ? text.split('\n').reduce((t, line) => t + Math.max(1, Math.ceil(line.length / per)), 0) : text.split('\n').length;
      lines = Math.max(lines, n);
    }
    return Math.max(24, Math.round(lines * size * 1.45 + 6));
  }

  private onContext(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.wy-ss-edit')) return;
    e.preventDefault();
    const h = this.hit(e.clientX, e.clientY);
    const n = normRange(this.range);
    const sh = this.sheet;
    if (h.zone === 'cell' && !(h.r >= n.r0 && h.r <= n.r1 && h.c >= n.c0 && h.c <= n.c1)) this.moveTo(h.r, h.c);
    else if (h.zone === 'col' && !(h.c >= n.c0 && h.c <= n.c1 && n.r0 === 0 && n.r1 === sh.rows - 1)) this.select({ r0: 0, r1: sh.rows - 1, c0: h.c, c1: h.c }, { r: this.active.r, c: h.c }, { r: 0, c: h.c });
    else if (h.zone === 'row' && !(h.r >= n.r0 && h.r <= n.r1 && n.c0 === 0 && n.c1 === sh.cols - 1)) this.select({ r0: h.r, r1: h.r, c0: 0, c1: sh.cols - 1 }, { r: h.r, c: this.active.c }, { r: h.r, c: 0 });
    this.o.onContext?.(e.clientX, e.clientY, h.zone === 'corner' ? 'cell' : h.zone);
  }

  // ---- keyboard

  private onKeyDown(e: KeyboardEvent) {
    if (this.editing || e.target === this.editor) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key;
    const ro = this.readOnly;
    const sh = this.sheet;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const cur = e.shiftKey ? this.activeEnd() : this.active;
      if (mod) { const j = this.wb.jump(sh, cur.r, cur.c, dr, dc); this.moveTo(j.r, j.c, e.shiftKey); }
      else this.moveTo(cur.r + dr, cur.c + dc, e.shiftKey);
    };
    if (k === 'ArrowDown') return move(1, 0);
    if (k === 'ArrowUp') return move(-1, 0);
    if (k === 'ArrowRight') return move(0, 1);
    if (k === 'ArrowLeft') return move(0, -1);
    if (k === 'Tab') { e.preventDefault(); if (e.shiftKey) this.stepInside(0, -1); else this.stepInside(0, 1); return; }
    if (k === 'Enter') { e.preventDefault(); if (ro) this.stepInside(e.shiftKey ? -1 : 1, 0); else if (mod) this.startEdit(); else this.stepInside(e.shiftKey ? -1 : 1, 0); return; }
    if (k === 'PageDown' || k === 'PageUp') { e.preventDefault(); const rows = Math.max(1, Math.floor((this.el.clientHeight - this.hh()) / (24 * this.z)) - 1); this.moveTo(this.active.r + (k === 'PageDown' ? rows : -rows), this.active.c, e.shiftKey); return; }
    if (k === 'Home') { e.preventDefault(); this.moveTo(mod ? 0 : this.active.r, 0, e.shiftKey); return; }
    if (k === 'End' && mod) { e.preventDefault(); const u = sh.used(); this.moveTo(Math.max(0, u.row), Math.max(0, u.col), e.shiftKey); return; }
    if (k === ' ' && e.shiftKey && !mod) { e.preventDefault(); this.select({ r0: this.active.r, r1: this.active.r, c0: 0, c1: sh.cols - 1 }, this.active); return; }
    if (k === ' ' && mod && !e.shiftKey) { e.preventDefault(); this.select({ r0: 0, r1: sh.rows - 1, c0: this.active.c, c1: this.active.c }, this.active); return; }
    if (mod && !e.altKey && !e.shiftKey && ['c', 'C', 'x', 'X', 'v', 'V'].includes(k)) {
      // the browser copies from the focused element: hand the focus to the hidden box for this one key
      const kind = k.toLowerCase();
      if (kind === 'v') { if (!ro) { this.catcher.value = ''; this.catcher.focus({ preventScroll: true }); this.backSoon(); } }
      else if (kind === 'c' || !ro) { this.catcher.value = this.wb.toTSV(sh, this.range); this.catcher.focus({ preventScroll: true }); this.catcher.select(); this.backSoon(); }
      return;
    }
    if (mod && (k === 'a' || k === 'A')) { e.preventDefault(); this.selectAll(); return; }
    if (k === 'F2' && !ro) { e.preventDefault(); this.startEdit(); return; }
    if (k === 'Escape' && this.clip) { this.clip = null; this.drawSelection(); return; }
    if (ro) return;
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); this.wb.clear(sh, this.range, 'values'); return; }
    if (mod && !e.altKey) {
      const lower = k.toLowerCase();
      if (lower === 'z') { e.preventDefault(); if (e.shiftKey) this.wb.redo(); else this.wb.undo(); return; }
      if (lower === 'y') { e.preventDefault(); this.wb.redo(); return; }
      if (lower === 'd') { e.preventDefault(); this.fillEdge('down'); return; }
      if (lower === 'r') { e.preventDefault(); this.fillEdge('right'); return; }
      if (['b', 'i', 'u'].includes(lower)) { e.preventDefault(); this.toggleStyle(lower === 'b' ? 'b' : lower === 'i' ? 'i' : 'u'); return; }
      if (lower === '5' && e.shiftKey) { e.preventDefault(); this.wb.patchStyle(sh, this.range, { fmt: 'percent' }); return; }
      return;
    }
    // typing a character starts editing the cell, replacing what it held
    if (k.length === 1 && !e.altKey) { e.preventDefault(); this.startEdit(k); this.o.onEdit?.(this.editor.value); }
  }

  private activeEnd(): Pos {
    // the corner of the selection opposite the anchor: the one that moves when extending
    const n = normRange(this.range);
    return { r: this.anchor.r === n.r0 ? n.r1 : n.r0, c: this.anchor.c === n.c0 ? n.c1 : n.c0 };
  }

  /** Tab / Enter: inside a selection of several cells they go round the selection, else they move one cell. */
  private stepInside(dr: number, dc: number) {
    const n = normRange(this.range);
    const multi = n.r0 !== n.r1 || n.c0 !== n.c1;
    if (!multi) { this.moveTo(this.active.r + dr, this.active.c + dc); return; }
    let r = this.active.r + dr; let c = this.active.c + dc;
    if (dr && r > n.r1) { r = n.r0; c = c + 1 > n.c1 ? n.c0 : c + 1; } else if (dr && r < n.r0) { r = n.r1; c = c - 1 < n.c0 ? n.c1 : c - 1; }
    if (dc && c > n.c1) { c = n.c0; r = r + 1 > n.r1 ? n.r0 : r + 1; } else if (dc && c < n.c0) { c = n.c1; r = r - 1 < n.r0 ? n.r1 : r - 1; }
    this.active = { r, c };
    this.scrollTo(r, c);
    this.drawSelection();
    this.announce();
    this.o.onSelect?.();
  }

  private toggleStyle(f: 'b' | 'i' | 'u' | 's') {
    const on = !!this.wb.styleAt(this.sheet, this.range)[f];
    this.wb.patchStyle(this.sheet, this.range, { [f]: on ? undefined : 1 });
  }

  /** Ctrl+D / Ctrl+R: copy the first row (column) of the selection over the rest. */
  fillEdge(dir: 'down' | 'right'): void {
    const n = normRange(this.range);
    if (dir === 'down') { if (n.r1 > n.r0) this.wb.fill(this.sheet, { r0: n.r0, r1: n.r0, c0: n.c0, c1: n.c1 }, { r0: n.r0 + 1, r1: n.r1, c0: n.c0, c1: n.c1 }); else if (n.r0 > 0) this.wb.fill(this.sheet, { r0: n.r0 - 1, r1: n.r0 - 1, c0: n.c0, c1: n.c1 }, { r0: n.r0, r1: n.r0, c0: n.c0, c1: n.c1 }); }
    else if (n.c1 > n.c0) this.wb.fill(this.sheet, { r0: n.r0, r1: n.r1, c0: n.c0, c1: n.c0 }, { r0: n.r0, r1: n.r1, c0: n.c0 + 1, c1: n.c1 });
    else if (n.c0 > 0) this.wb.fill(this.sheet, { r0: n.r0, r1: n.r1, c0: n.c0 - 1, c1: n.c0 - 1 }, { r0: n.r0, r1: n.r1, c0: n.c0, c1: n.c0 });
  }

  // ---- clipboard

  /** Take the focus back from the hidden box once the browser has dealt with the key. */
  private back() { if (document.activeElement === this.catcher) this.focus(); }
  private backSoon() { window.setTimeout(() => this.back(), 400); }

  /** Copy (or cut) the selection; `native` is the event that asked, whose clipboard gets the text. */
  private onCopy(e: ClipboardEvent, cut: boolean) {
    if (this.editing || (e.target as HTMLElement) === this.editor) return;
    if (cut && this.readOnly) return;
    e.preventDefault();
    this.copyTo(e.clipboardData, cut);
  }

  private copyTo(data: DataTransfer | null, cut: boolean) {
    const sh = this.sheet;
    const n = normRange(this.range);
    const text = this.wb.toTSV(sh, n);
    this.clip = { cells: this.wb.copyCells(sh, n), from: { r: n.r0, c: n.c0 }, range: n, cut, text, sheet: sh };
    data?.setData('text/plain', text);
    data?.setData('text/html', this.toHTML(n));
    this.drawSelection();
  }

  /** The cells as an HTML table, which Excel, Word and Google Sheets paste with the formats. */
  private toHTML(n: Range): string {
    const sh = this.sheet;
    const esc = (t: string) => t.replace(/[&<>\x22]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]!);
    let out = '<table>';
    for (let r = n.r0; r <= n.r1; r++) {
      out += '<tr>';
      for (let c = n.c0; c <= n.c1; c++) {
        const s = this.wb.style(sh, r, c);
        const css = [s.b && 'font-weight:bold', s.i && 'font-style:italic', s.u && 'text-decoration:underline', s.color && `color:${s.color}`, s.bg && `background:${s.bg}`, s.align && `text-align:${s.align}`].filter(Boolean).join(';');
        out += `<td${css ? ` style="${css}"` : ''}>${esc(this.wb.display(sh, r, c).text)}</td>`;
      }
      out += '</tr>';
    }
    return `${out}</table>`;
  }

  /** The buttons of the ribbon: copy and cut work through the browser so the system clipboard gets the text. */
  copyCommand(cut = false): void {
    this.focus();
    let ok = false;
    try { ok = document.execCommand(cut ? 'cut' : 'copy'); } catch { ok = false; }
    if (!ok) { this.copyTo(null, cut); void navigator.clipboard?.writeText(this.clip?.text ?? '').catch(() => undefined); }
  }

  async pasteCommand(what: 'all' | 'values' | 'formats' = 'all'): Promise<boolean> {
    this.focus();
    try {
      const text = await navigator.clipboard.readText();
      this.pasteFrom(text, what);
      return true;
    } catch { return false; }
  }

  private onPaste(e: ClipboardEvent) {
    if (this.editing || (e.target as HTMLElement) === this.editor || this.readOnly) return;
    e.preventDefault();
    this.pasteFrom(e.clipboardData?.getData('text/plain') ?? '', 'all');
  }

  pasteFrom(text: string, what: 'all' | 'values' | 'formats' = 'all'): void {
    if (this.readOnly) return;
    const sh = this.sheet;
    const n = normRange(this.range);
    const norm = (t: string) => t.replace(/\r\n?/g, '\n').replace(/\n$/, '');
    if (this.clip && norm(text) === norm(this.clip.text) || (what === 'formats' && this.clip)) {
      const clip = this.clip!;
      const target = clip.sheet === sh || true;
      void target;
      // a copy that is one cell fills a larger selection
      const rows = clip.cells.length; const cols = Math.max(...clip.cells.map((x) => x.length));
      const fill = rows === 1 && cols === 1 && (n.r1 > n.r0 || n.c1 > n.c0);
      this.wb.transact('paste', () => {
        let last: Range;
        if (fill) { for (let r = n.r0; r <= n.r1; r++) for (let c = n.c0; c <= n.c1; c++) this.wb.pasteCells(sh, r, c, clip.cells, clip.from, what); last = n; }
        else last = this.wb.pasteCells(sh, n.r0, n.c0, clip.cells, clip.from, what);
        if (clip.cut && what === 'all') { const src = clip.range; const rest = { r0: src.r0, c0: src.c0, r1: src.r1, c1: src.c1 }; const inside = (r: number, c: number) => r >= last.r0 && r <= last.r1 && c >= last.c0 && c <= last.c1; for (let r = rest.r0; r <= rest.r1; r++) for (let c = rest.c0; c <= rest.c1; c++) if (!inside(r, c)) this.wb.clear(clip.sheet, { r0: r, c0: c, r1: r, c1: c }, 'all'); }
        this.select(last, { r: last.r0, c: last.c0 }, { r: last.r0, c: last.c0 });
      });
      if (clip.cut) this.clip = null;
      this.drawSelection();
      return;
    }
    if (what === 'formats') return;
    const grid = /[\t\n\r]/.test(text) ? parseDelimited(norm(text), '\t') : [[text]];
    if (grid.length === 1 && grid[0].length === 1 && (n.r1 > n.r0 || n.c1 > n.c0)) {
      this.wb.transact('paste', () => { for (let r = n.r0; r <= n.r1; r++) for (let c = n.c0; c <= n.c1; c++) this.wb.pasteText(sh, r, c, grid); });
      return;
    }
    const placed = this.wb.pasteText(sh, n.r0, n.c0, grid);
    this.select(placed, { r: placed.r0, c: placed.c0 }, { r: placed.r0, c: placed.c0 });
  }

  /** Drop the marching outline (after the sheet was replaced). */
  clearClipboard(): void { this.clip = null; this.drawSelection(); }
}
