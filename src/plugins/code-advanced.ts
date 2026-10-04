import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { EditorPlugin } from '../types';
import type { FoldingProvider } from './code-blocks';

const indentOf = (l: string) => (l.trim() ? /^[ \t]*/.exec(l)![0].replace(/\t/g, '    ').length : -1);

/**
 * For every line, the last line (inclusive) of the fold that starts there: the following lines indented deeper, or null
 * when there is nothing to fold. One pass with a stack, so it is linear (a per-line scan was quadratic on big files).
 */
export function foldEnds(lines: string[]): (number | null)[] {
  const ends: (number | null)[] = lines.map(() => null);
  const stack: { line: number; indent: number }[] = [];
  let lastCode = -1;
  const close = (below: number) => {
    while (stack.length && stack[stack.length - 1].indent >= below) {
      const top = stack.pop()!;
      ends[top.line] = lastCode > top.line ? lastCode : null;
    }
  };
  lines.forEach((l, i) => {
    const n = indentOf(l);
    if (n < 0) return; // blank lines belong to a fold only when more indented code follows
    close(n);
    stack.push({ line: i, indent: n });
    lastCode = i;
  });
  close(-1);
  return ends;
}

/** Last line (inclusive) of the fold that starts at line `i`. Null when nothing to fold. */
export function foldEnd(lines: string[], i: number): number | null {
  return foldEnds(lines)[i] ?? null;
}

const lineStarts = (text: string): number[] => {
  const out = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1);
  return out;
};

interface Region { block: PMNode; start: number }
/** The code block that holds `pos` (the first one when `pos` is null). */
function blockAt(doc: PMNode, pos: number | null): Region | null {
  let found: Region | null = null;
  doc.descendants((node, p) => {
    if (found || node.type.name !== 'code_block') return !found;
    if (pos === null || (pos >= p && pos <= p + node.nodeSize)) found = { block: node, start: p + 1 };
    return false;
  });
  return found;
}

const foldKey = new PluginKey<number[]>('code-folds');
const caretKey = new PluginKey<number[]>('code-carets');

export interface CodeAdvancedOptions {
  /** Fold by indentation with gutter markers. Default true. */
  folding?: boolean;
  /** Extra cursors: Alt+click, Ctrl/Cmd+Alt+Up/Down. Default true. */
  multiCursor?: boolean;
}

export type CodeAdvancedPlugin = EditorPlugin & { folding: FoldingProvider };

/**
 * Code folding (by indentation, with gutter markers and a "⋯" chip) and basic multi-cursor editing (several carets that
 * receive typing, Enter, Backspace, Delete, arrows and paste together). Carets are collapsed (no multiple selections).
 */
export function CodeAdvanced(options: CodeAdvancedOptions = {}): CodeAdvancedPlugin {
  const useFold = options.folding !== false;
  const useCarets = options.multiCursor !== false;

  interface Analysis { region: Region; ends: (number | null)[]; closed: Map<number, number> }
  const analyses = new WeakMap<EditorState, Map<number, Analysis | null>>();
  /** Everything the gutter needs about one block, computed once per editor state (decorations run on every transaction). */
  const analyze = (state: EditorState, blockPos: number): Analysis | null => {
    let perState = analyses.get(state);
    if (!perState) analyses.set(state, (perState = new Map()));
    if (perState.has(blockPos)) return perState.get(blockPos)!;
    const region = blockAt(state.doc, blockPos + 1);
    let result: Analysis | null = null;
    if (region) {
      const text = region.block.textContent;
      const starts = lineStarts(text);
      const ends = foldEnds(text.split('\n'));
      const closed = new Map<number, number>();
      for (const abs of foldKey.getState(state) ?? []) {
        const line = starts.indexOf(abs - region.start);
        if (line >= 0 && ends[line] !== null) closed.set(line, ends[line]!);
      }
      result = { region, ends, closed };
    }
    perState.set(blockPos, result);
    return result;
  };
  const validFolds = (state: EditorState, blockPos: number) => {
    const a = analyze(state, blockPos);
    return { region: a?.region ?? null, out: a ? [...a.closed].map(([line, end]) => ({ line, end })) : [] };
  };

  const folding: FoldingProvider = {
    hidden(state, blockPos) {
      const hidden = new Set<number>();
      for (const f of validFolds(state, blockPos).out) for (let l = f.line + 1; l <= f.end; l++) hidden.add(l);
      return hidden;
    },
    marker(state, blockPos, line) {
      if (!useFold) return null;
      const a = analyze(state, blockPos);
      if (!a || a.ends[line] == null) return null;
      return a.closed.has(line) ? 'closed' : 'open';
    },
    toggle(view, blockPos, line) {
      const region = blockAt(view.state.doc, blockPos + 1);
      if (!region) return;
      const abs = region.start + lineStarts(region.block.textContent)[line];
      const cur = foldKey.getState(view.state) ?? [];
      view.dispatch(view.state.tr.setMeta(foldKey, cur.includes(abs) ? cur.filter((p) => p !== abs) : [...cur, abs]));
    },
  };

  // ---- multi-cursor helpers
  const carets = (state: EditorState) => caretKey.getState(state) ?? [];
  /** Position `delta` lines down (or up) at the same column, inside the same block. */
  function moveLine(state: EditorState, pos: number, delta: number): number | null {
    const region = blockAt(state.doc, pos);
    if (!region) return null;
    const text = region.block.textContent;
    const starts = lineStarts(text);
    const off = pos - region.start;
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= off) line++;
    const target = line + delta;
    if (target < 0 || target >= starts.length) return null;
    const col = off - starts[line];
    const lineLen = (starts[target + 1] ?? text.length + 1) - 1 - starts[target];
    return region.start + starts[target] + Math.min(col, lineLen);
  }

  /** Apply one edit at every cursor (the real selection and the extra carets) as a single undo step. */
  function editAll(view: EditorView, make: (from: number, to: number, doc: PMNode) => { from: number; to: number; text: string } | null): boolean {
    const { state } = view;
    const sel = state.selection;
    // A caret inside the selection would be edited twice (the edits are applied from the original positions): drop it.
    const others = carets(state).filter((p) => sel.from === sel.to || p < sel.from || p > sel.to);
    const spots = [{ from: sel.from, to: sel.to, primary: true }, ...others.map((p) => ({ from: p, to: p, primary: false }))].sort((a, b) => b.from - a.from);
    const tr = state.tr;
    const edits = spots.map((s) => ({ s, e: make(s.from, s.to, state.doc) }));
    for (const { e } of edits) if (e && (e.from !== e.to || e.text)) tr.replaceWith(e.from, e.to, e.text ? state.schema.text(e.text) : []);
    if (!tr.docChanged) return false;
    const next: number[] = [];
    let primary = sel.head;
    for (const { s, e } of edits) {
      const end = tr.mapping.map(e ? e.to : s.to, 1);
      if (s.primary) primary = end;
      else next.push(end);
    }
    tr.setSelection(TextSelection.create(tr.doc, primary)).setMeta(caretKey, [...new Set(next)].filter((p) => p !== primary));
    view.dispatch(tr.scrollIntoView());
    return true;
  }

  const addCaret = (view: EditorView, delta: number): boolean => {
    const { state } = view;
    const all = [state.selection.head, ...carets(state)];
    // extend from the outermost caret in the direction of travel
    const from = delta > 0 ? Math.max(...all) : Math.min(...all);
    const next = moveLine(state, from, delta);
    if (next === null || all.includes(next)) return false;
    view.dispatch(state.tr.setMeta(caretKey, [...carets(state), next]));
    return true;
  };

  let run: (name: string) => boolean = () => false;
  const plugins: Plugin[] = [];
  if (useFold) {
    plugins.push(new Plugin({
      key: foldKey,
      state: {
        init: () => [] as number[],
        apply(tr: Transaction, value: number[]) {
          const meta = tr.getMeta(foldKey) as number[] | undefined;
          if (meta) return meta;
          return tr.docChanged ? value.map((p) => tr.mapping.map(p, -1)) : value;
        },
      },
      appendTransaction(trs, _old, state) {
        // A cursor inside a fold would be invisible: open the fold it landed in.
        if (!trs.some((t) => t.docChanged || t.selectionSet)) return null;
        const folds = foldKey.getState(state) ?? [];
        if (!folds.length) return null;
        const head = state.selection.head;
        const region = blockAt(state.doc, head);
        if (!region) return null;
        const text = region.block.textContent;
        const lines = text.split('\n');
        const ends = foldEnds(lines);
        const starts = lineStarts(text);
        const keep = folds.filter((abs) => {
          const line = starts.indexOf(abs - region.start);
          if (line < 0) return true;
          const end = ends[line];
          if (end === null || end === undefined) return true;
          const hideFrom = region.start + starts[line] + lines[line].length;
          const hideTo = region.start + starts[end] + lines[end].length;
          return !(head > hideFrom && head <= hideTo);
        });
        return keep.length === folds.length ? null : state.tr.setMeta(foldKey, keep).setMeta('addToHistory', false);
      },
      props: {
        handleKeyDown(_view, e) {
          if ((e.metaKey || e.ctrlKey) && e.altKey && (e.key === '[' || e.code === 'BracketLeft')) { e.preventDefault(); return run('toggleFold'); }
          return false;
        },
        decorations(state) {
          const folds = foldKey.getState(state) ?? [];
          if (!folds.length) return DecorationSet.empty;
          const decos: Decoration[] = [];
          state.doc.descendants((node, pos) => {
            if (node.type.name !== 'code_block') return true;
            const lines = node.textContent.split('\n');
            const starts = lineStarts(node.textContent);
            for (const f of validFolds(state, pos).out) {
              const base = pos + 1;
              const from = base + starts[f.line] + lines[f.line].length;
              const to = base + starts[f.end] + lines[f.end].length;
              decos.push(Decoration.inline(from, to, { class: 'wy-folded' }));
              decos.push(Decoration.widget(from, (view, getPos) => {
                const chip = document.createElement('span');
                chip.className = 'wy-fold-chip';
                chip.contentEditable = 'false';
                chip.textContent = `⋯ ${f.end - f.line} lines`;
                chip.title = 'Unfold';
                // `pos` was captured when the decoration was built; the widget may be reused after the block moved
                chip.addEventListener('mousedown', (e) => { e.preventDefault(); folding.toggle(view, (getPos() ?? from) - (from - pos), f.line); });
                return chip;
              }, { side: 1, key: `fold${f.line}:${f.end}`, ignoreSelection: true }));
            }
            return false;
          });
          return DecorationSet.create(state.doc, decos);
        },
      },
    }));
  }
  if (useCarets) {
    plugins.push(new Plugin({
      key: caretKey,
      state: {
        init: () => [] as number[],
        apply(tr: Transaction, value: number[], _old, state) {
          const meta = tr.getMeta(caretKey) as number[] | undefined;
          let next = meta ?? (tr.docChanged ? value.map((p) => tr.mapping.map(p, 1)) : value);
          if (next.length) {
            const { $head, from, to } = state.selection;
            // Extra carets live in the same code block as the real cursor, and never inside a selection.
            next = [...new Set(next)].filter((p) => p >= 0 && p <= state.doc.content.size && p !== $head.pos && (from === to || p < from || p > to) && state.doc.resolve(p).sameParent($head));
          }
          return next;
        },
      },
      props: {
        decorations(state) {
          const list = carets(state);
          return list.length ? DecorationSet.create(state.doc, list.map((p) => Decoration.widget(p, () => {
            const c = document.createElement('span');
            c.className = 'wy-extra-caret';
            c.setAttribute('aria-hidden', 'true');
            return c;
          }, { side: 0, key: `caret${p}`, ignoreSelection: true }))) : DecorationSet.empty;
        },
        handleClick(view, pos, event) {
          if (event.altKey) {
            if (!view.state.doc.resolve(pos).sameParent(view.state.selection.$head)) return true; // carets stay inside one code block
            const cur = carets(view.state);
            view.dispatch(view.state.tr.setMeta(caretKey, cur.includes(pos) ? cur.filter((p) => p !== pos) : [...cur, pos]));
            return true;
          }
          if (carets(view.state).length) view.dispatch(view.state.tr.setMeta(caretKey, []));
          return false;
        },
        handleTextInput(view, _from, _to, text) {
          if (!carets(view.state).length) return false;
          return editAll(view, (from, to) => ({ from, to, text }));
        },
        handlePaste(view, event) {
          const text = event.clipboardData?.getData('text/plain');
          if (!text || !carets(view.state).length) return false;
          event.preventDefault();
          return editAll(view, (from, to) => ({ from, to, text }));
        },
        handleKeyDown(view, e) {
          const mod = e.metaKey || e.ctrlKey;
          if (mod && e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); return addCaret(view, e.key === 'ArrowDown' ? 1 : -1); }
          if (!carets(view.state).length) return false;
          if (e.key === 'Escape') { view.dispatch(view.state.tr.setMeta(caretKey, [])); return true; }
          if (mod || e.altKey) return false;
          switch (e.key) {
            case 'Backspace':
              e.preventDefault();
              return editAll(view, (from, to, doc) => (from !== to ? { from, to, text: '' } : from > (blockAt(doc, from)?.start ?? 0) ? { from: from - 1, to, text: '' } : null)) || true;
            case 'Delete':
              e.preventDefault();
              return editAll(view, (from, to, doc) => { const r = blockAt(doc, from); return from !== to ? { from, to, text: '' } : r && from < r.start + r.block.content.size ? { from, to: to + 1, text: '' } : null; }) || true;
            case 'Enter':
              e.preventDefault();
              return editAll(view, (from, to, doc) => {
                const r = blockAt(doc, from);
                if (!r) return null;
                const text = r.block.textContent;
                const before = text.slice(0, from - r.start);
                const indent = /^[ \t]*/.exec(before.slice(before.lastIndexOf('\n') + 1))![0];
                return { from, to, text: `\n${indent}` };
              }) || true;
            case 'ArrowLeft':
            case 'ArrowRight': {
              if (e.shiftKey) { view.dispatch(view.state.tr.setMeta(caretKey, [])); return false; }
              const d = e.key === 'ArrowLeft' ? -1 : 1;
              const block = blockAt(view.state.doc, view.state.selection.head);
              const lo = block?.start ?? 0;
              const hi = block ? block.start + block.block.content.size : view.state.doc.content.size;
              view.dispatch(view.state.tr.setMeta(caretKey, carets(view.state).map((p) => Math.max(lo, Math.min(hi, p + d)))));
              return false; // the real selection moves by default
            }
            case 'ArrowUp':
            case 'ArrowDown': {
              if (e.shiftKey) { view.dispatch(view.state.tr.setMeta(caretKey, [])); return false; }
              const d = e.key === 'ArrowUp' ? -1 : 1;
              view.dispatch(view.state.tr.setMeta(caretKey, carets(view.state).map((p) => moveLine(view.state, p, d) ?? p)));
              return false;
            }
            default:
              if (e.key.length > 1 && !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) view.dispatch(view.state.tr.setMeta(caretKey, [])); // Tab, Home, End, ...: back to one cursor
              return false;
          }
        },
      },
    }));
  }

  return {
    name: 'code-advanced',
    priority: 1000,
    folding,
    setup(editor) {
      run = (name) => editor.execute(name);
      const withView = (fn: (view: EditorView) => boolean) => () => fn(editor.view);
      const current = (state: EditorState) => blockAt(state.doc, state.selection.head);
      const lineOfHead = (state: EditorState) => {
        const r = current(state);
        if (!r) return null;
        const starts = lineStarts(r.block.textContent);
        const off = state.selection.head - r.start;
        let line = 0;
        while (line + 1 < starts.length && starts[line + 1] <= off) line++;
        return { r, line, starts };
      };
      editor.registerCommand('toggleFold', withView((view) => {
        const at = lineOfHead(view.state);
        if (!at) return false;
        // fold the nearest enclosing foldable line at or above the cursor
        const lines = at.r.block.textContent.split('\n');
        const ends = foldEnds(lines);
        for (let l = at.line; l >= 0; l--) {
          const end = ends[l];
          if (end !== null && end >= at.line) { folding.toggle(view, at.r.start - 1, l); return true; }
        }
        return false;
      }));
      const setAll = (view: EditorView, fold: boolean) => {
        const r = current(view.state);
        if (!r) return false;
        const lines = r.block.textContent.split('\n');
        const starts = lineStarts(r.block.textContent);
        const list: number[] = [];
        if (fold) {
          // outermost foldable lines only: inner ones stay open inside
          let skipTo = -1;
          const ends = foldEnds(lines);
          lines.forEach((_, i) => { if (i > skipTo) { const end = ends[i]; if (end !== null) { list.push(r.start + starts[i]); skipTo = end; } } });
        }
        view.dispatch(view.state.tr.setMeta(foldKey, list));
        return true;
      };
      editor.registerCommand('foldAll', withView((v) => setAll(v, true)));
      editor.registerCommand('unfoldAll', withView((v) => setAll(v, false)));
      editor.registerCommand('addCaretBelow', withView((v) => addCaret(v, 1)));
      editor.registerCommand('addCaretAbove', withView((v) => addCaret(v, -1)));
      editor.registerCommand('clearCarets', withView((v) => (carets(v.state).length ? (v.dispatch(v.state.tr.setMeta(caretKey, [])), true) : false)));
      editor.extensions.codeAdvanced = { cursorCount: () => 1 + carets(editor.view.state).length, foldedCount: () => (foldKey.getState(editor.view.state) ?? []).length };
      return plugins;
    },
  };
}
