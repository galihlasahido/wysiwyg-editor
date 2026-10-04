import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import type { Editor } from '../editor';
import { openDialog } from '../dialog';
import { simpleHighlight, type Highlighter } from '../highlight';
import type { EditorPlugin } from '../types';

export interface CursorInfo {
  /** 1-based. */
  line: number;
  col: number;
  /** Characters selected (0 when it is just a caret). */
  selected: number;
  lines: number;
  language: string | null;
}

export interface CodeEditingOptions {
  highlight?: Highlighter;
  onCursor?: (info: CursorInfo) => void;
  /** Pair brackets and quotes as you type. Default true. */
  autoClose?: boolean;
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' };
const CLOSERS = new Set([')', ']', '}']);
const OPEN_OF: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
const QUOTES = new Set(['"', "'", '`']);
const isWord = (c: string | undefined) => !!c && /[\w$]/.test(c);

type CommentStyle = { line: string } | { open: string; close: string } | null;
const HASH = { line: '#' };
const SLASH = { line: '//' };
const COMMENTS: Record<string, CommentStyle> = {
  javascript: SLASH, typescript: SLASH, js: SLASH, ts: SLASH, jsx: SLASH, tsx: SLASH, java: SLASH, go: SLASH, rust: SLASH, rs: SLASH, c: SLASH, cpp: SLASH, cs: SLASH, php: SLASH, kotlin: SLASH, swift: SLASH, scss: SLASH, less: SLASH,
  python: HASH, py: HASH, ruby: HASH, rb: HASH, bash: HASH, sh: HASH, shell: HASH, zsh: HASH, yaml: HASH, yml: HASH, toml: HASH, dockerfile: HASH, makefile: HASH, r: HASH, perl: HASH,
  sql: { line: '--' }, lua: { line: '--' }, haskell: { line: '--' },
  css: { open: '/*', close: '*/' }, html: { open: '<!--', close: '-->' }, xml: { open: '<!--', close: '-->' }, svg: { open: '<!--', close: '-->' }, markdown: { open: '<!--', close: '-->' },
};

/** The code block around the selection head, and the text positions inside it. */
interface Ctx { node: PMNode; start: number; text: string; head: number; anchor: number; from: number; to: number; language: string | null }
function context(state: EditorState): Ctx | null {
  const { $head, $anchor, from, to } = state.selection;
  if ($head.parent.type.name !== 'code_block' || !$head.sameParent($anchor)) return null;
  const start = $head.start();
  return { node: $head.parent, start, text: $head.parent.textContent, head: $head.pos - start, anchor: $anchor.pos - start, from: from - start, to: to - start, language: $head.parent.attrs.language ?? null };
}

/** Start of the line containing `offset`, and the end (before the newline). */
const lineStart = (text: string, offset: number) => (offset <= 0 ? 0 : text.lastIndexOf('\n', offset - 1) + 1); // lastIndexOf with a negative index would still see a newline at 0
const lineEnd = (text: string, offset: number) => {
  const i = text.indexOf('\n', offset);
  return i < 0 ? text.length : i;
};
/** Range covering every line touched by the selection. */
function selectedLines(c: Ctx): [number, number] {
  // A selection that ends at the very start of a line does not include that line (like most editors).
  const to = c.to > c.from && c.text[c.to - 1] === '\n' ? c.to - 1 : c.to;
  return [lineStart(c.text, c.from), lineEnd(c.text, to)];
}

function setSelection(tr: Transaction, start: number, anchor: number, head: number): Transaction {
  return tr.setSelection(TextSelection.create(tr.doc, start + anchor, start + head));
}

/** String and comment ranges of a text, remembered for the last few texts: the cursor moving must not re-highlight the file. */
const maskMemo = new Map<string, { from: number; to: number }[]>();
function maskCache(highlight: Highlighter, text: string, language: string | null) {
  const key = `${language}\u0000${text}`;
  let masks = maskMemo.get(key);
  if (!masks) {
    masks = highlight(text, language).filter((t) => t.type === 'string' || t.type === 'comment').map(({ from, to }) => ({ from, to })).sort((a, b) => a.from - b.from);
    if (maskMemo.size > 20) maskMemo.clear();
    maskMemo.set(key, masks);
  }
  return masks;
}

/** Matching bracket for the one at `i`, ignoring brackets inside strings and comments. Null when unmatched. */
export function findMatchingBracket(text: string, i: number, ignored: (pos: number) => boolean, limit = 60000): number | null {
  const ch = text[i];
  const forward = ch in PAIRS && !QUOTES.has(ch);
  const backward = CLOSERS.has(ch);
  if (!forward && !backward) return null;
  const open = forward ? ch : OPEN_OF[ch];
  const close = forward ? PAIRS[ch] : ch;
  let depth = 0;
  const step = forward ? 1 : -1;
  for (let j = i, n = 0; j >= 0 && j < text.length && n < limit; j += step, n++) {
    if (ignored(j)) continue;
    if (text[j] === open) depth += forward ? 1 : -1;
    else if (text[j] === close) depth += forward ? -1 : 1;
    if (depth === 0) return j;
  }
  return null;
}

/**
 * What makes a code block feel like an editor: pairing of brackets and quotes, comment toggling, line operations,
 * bracket matching, an active-line highlight and cursor reporting. Works on the code block that holds the cursor.
 */
export function CodeEditing(options: CodeEditingOptions = {}): EditorPlugin {
  const highlight = options.highlight ?? simpleHighlight;
  return {
    name: 'code-editing',
    setup(editor: Editor) {
      const run = (fn: (c: Ctx, state: EditorState) => Transaction | null) => (e: Editor) => {
        const { state, dispatch } = e.view;
        const c = context(state);
        if (!c) return false;
        const tr = fn(c, state);
        if (!tr) return false;
        dispatch(tr.scrollIntoView());
        return true;
      };

      // ---- comments
      editor.registerCommand('toggleComment', run((c, state) => {
        const style = COMMENTS[(c.language ?? '').toLowerCase()] ?? null;
        if (!style) return null;
        const [a, b] = selectedLines(c);
        const lines = c.text.slice(a, b).split('\n');
        const blank = (l: string) => !l.trim();
        const active = lines.filter((l) => !blank(l));
        if (!active.length) return null;
        let next: string[];
        if ('line' in style) {
          const re = new RegExp(`^(\\s*)${style.line.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')} ?`);
          const allOn = active.every((l) => re.test(l));
          if (allOn) next = lines.map((l) => (blank(l) ? l : l.replace(re, '$1')));
          else {
            const indent = Math.min(...active.map((l) => /^[ \t]*/.exec(l)![0].length)); // comment at the shallowest indent
            next = lines.map((l) => (blank(l) ? l : `${l.slice(0, indent)}${style.line} ${l.slice(indent)}`));
          }
        } else {
          const esc = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
          const re = new RegExp(`^(\\s*)${esc(style.open)} ?(.*?) ?${esc(style.close)}\\s*$`);
          const allOn = active.every((l) => re.test(l));
          next = lines.map((l) => (blank(l) ? l : allOn ? l.replace(re, '$1$2') : l.replace(/^(\s*)(.*)$/, `$1${style.open} $2 ${style.close}`)));
        }
        const tr = state.tr.insertText(next.join('\n'), c.start + a, c.start + b);
        return setSelection(tr, c.start, a, a + next.join('\n').length);
      }));

      // ---- line operations
      editor.registerCommand('duplicateLine', run((c, state) => {
        const [a, b] = selectedLines(c);
        const block = c.text.slice(a, b);
        const tr = state.tr.insertText(`\n${block}`, c.start + b);
        const shift = block.length + 1;
        return setSelection(tr, c.start, c.anchor + shift, c.head + shift); // the caret follows the copy
      }));
      editor.registerCommand('moveLineDown', run((c, state) => {
        const [a, b] = selectedLines(c);
        if (b >= c.text.length) return null;
        const nextEnd = lineEnd(c.text, b + 1);
        const moved = c.text.slice(b + 1, nextEnd);
        const block = c.text.slice(a, b);
        const tr = state.tr.insertText(`${moved}\n${block}`, c.start + a, c.start + nextEnd);
        const shift = moved.length + 1;
        return setSelection(tr, c.start, c.anchor + shift, c.head + shift);
      }));
      editor.registerCommand('moveLineUp', run((c, state) => {
        const [a, b] = selectedLines(c);
        if (a === 0) return null;
        const prevStart = lineStart(c.text, a - 1);
        const moved = c.text.slice(prevStart, a - 1);
        const block = c.text.slice(a, b);
        const tr = state.tr.insertText(`${block}\n${moved}`, c.start + prevStart, c.start + b);
        const shift = moved.length + 1;
        return setSelection(tr, c.start, c.anchor - shift, c.head - shift);
      }));
      editor.registerCommand('deleteLine', run((c, state) => {
        const [a, b] = selectedLines(c);
        const last = b >= c.text.length;
        // Remove the line's newline too: the following one, or (for the last line) the preceding one.
        const from = last ? Math.max(0, a - 1) : a;
        const to = last ? b : b + 1;
        const tr = state.tr.delete(c.start + from, c.start + to);
        const caret = last ? lineStart(c.text, Math.max(0, a - 1)) : a;
        return setSelection(tr, c.start, caret, caret);
      }));
      editor.registerCommand('selectLine', run((c, state) => {
        const [a, b] = selectedLines(c);
        return setSelection(state.tr, c.start, a, Math.min(b + 1, c.text.length));
      }));
      editor.registerCommand('goToLine', (e, line?: number) => {
        const go = (n: number) => {
          if (!Number.isFinite(n)) return false; // junk input must not move the caret (Math.max(1, NaN) is NaN)
          const c = context(e.view.state);
          if (!c) return false;
          const lines = c.text.split('\n');
          const target = Math.max(1, Math.min(lines.length, Math.floor(n)));
          const offset = lines.slice(0, target - 1).reduce((s, l) => s + l.length + 1, 0);
          e.view.dispatch(setSelection(e.view.state.tr, c.start, offset, offset).scrollIntoView());
          e.view.focus();
          return true;
        };
        if (typeof line === 'number' && Number.isFinite(line)) return go(line);
        const form = document.createElement('div');
        const label = document.createElement('label');
        label.textContent = 'Line number';
        const input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        label.append(input);
        form.append(label);
        input.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            (e.root.querySelector('.wy-dialog button.primary') as HTMLElement | null)?.click();
          }
        });
        openDialog(e.root, { title: 'Go to line', body: form, actions: [{ label: 'Cancel' }, { label: 'Go', primary: true, onClick: () => go(parseInt(input.value, 10)) }] });
        input.focus();
        return true;
      });

      const move = (name: string) => (_s: EditorState, _d: unknown, view?: EditorView) => !!view && editor.execute(name);

      return [
        keymap({
          'Mod-/': move('toggleComment'),
          'Alt-ArrowUp': move('moveLineUp'),
          'Alt-ArrowDown': move('moveLineDown'),
          'Shift-Alt-ArrowDown': move('duplicateLine'),
          'Mod-Shift-k': move('deleteLine'),
          'Mod-l': move('selectLine'),
          'Mod-g': move('goToLine'),
          // Backspace between a pair removes both characters.
          Backspace: (state, dispatch) => {
            const c = context(state);
            if (!c || c.from !== c.to || c.head === 0) return false;
            const prev = c.text[c.head - 1];
            if (PAIRS[prev] !== c.text[c.head] || options.autoClose === false) return false;
            dispatch?.(state.tr.delete(state.selection.from - 1, state.selection.from + 1));
            return true;
          },
        }),
        new Plugin({
          props: {
            // ---- pairing of brackets and quotes
            handleTextInput(view, from, to, text) {
              if (options.autoClose === false || text.length !== 1) return false;
              const { state } = view;
              const c = context(state);
              if (!c) return false;
              const a = from - c.start;
              const b = to - c.start;
              const prev = c.text[a - 1];
              const next = c.text[b];
              // typing a closer in front of the same closer just steps over it
              if (a === b && next === text && (CLOSERS.has(text) || QUOTES.has(text))) {
                view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, from + 1)));
                return true;
              }
              const close = PAIRS[text];
              if (!close) return false;
              if (a !== b) {
                // wrap the selection: (text), "text", ...
                const sel = c.text.slice(a, b);
                const tr = state.tr.insertText(text + sel + close, from, to);
                view.dispatch(setSelection(tr, c.start, a + 1, a + 1 + sel.length));
                return true;
              }
              if (QUOTES.has(text)) {
                const lang = (c.language ?? '').toLowerCase();
                if (!lang || lang === 'plain' || lang === 'markdown') return false; // apostrophes in prose
                if (isWord(prev) || prev === text) return false; // don't, 'a''b', triple quotes
              }
              if (isWord(next)) return false; // only pair in front of whitespace, a closer, or the end
              const tr = state.tr.insertText(text + close, from, to);
              view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)).scrollIntoView());
              return true;
            },
            // ---- matching bracket highlight
            decorations(state) {
              const c = context(state);
              if (!c || c.from !== c.to) return null;
              const at = [c.head - 1, c.head].find((i) => i >= 0 && i < c.text.length && (CLOSERS.has(c.text[i]) || (c.text[i] in PAIRS && !QUOTES.has(c.text[i]))));
              if (at === undefined) return null;
              // brackets inside strings and comments do not count
              const masks = maskCache(highlight, c.text, c.language);
              const ignored = (pos: number) => {
                // masks are sorted and disjoint: binary search instead of scanning every token per character
                let lo = 0;
                let hi = masks.length - 1;
                while (lo <= hi) {
                  const mid = (lo + hi) >> 1;
                  const t = masks[mid];
                  if (pos < t.from) hi = mid - 1;
                  else if (pos >= t.to) lo = mid + 1;
                  else return true;
                }
                return false;
              };
              if (ignored(at)) return null;
              const match = findMatchingBracket(c.text, at, ignored);
              const mark = (i: number, cls: string) => Decoration.inline(c.start + i, c.start + i + 1, { class: cls });
              return DecorationSet.create(state.doc, match === null ? [mark(at, 'wy-bracket-error')] : [mark(at, 'wy-bracket-match'), mark(match, 'wy-bracket-match')]);
            },
          },
          // ---- active line highlight and cursor reporting
          view(view) {
            const host = view.dom.parentElement;
            const bar = document.createElement('div');
            bar.className = 'wy-active-line';
            bar.setAttribute('aria-hidden', 'true');
            host?.prepend(bar);
            let last: EditorState | null = null;
            const update = () => {
              const { state } = view;
              if (last && last.doc === state.doc && last.selection.eq(state.selection)) return;
              last = state;
              const c = context(state);
              if (options.onCursor) {
                if (c) {
                  const before = c.text.slice(0, c.head);
                  options.onCursor({ line: before.split('\n').length, col: c.head - lineStart(c.text, c.head) + 1, selected: Math.abs(c.head - c.anchor), lines: c.text.split('\n').length, language: c.language });
                }
              }
              if (!c || c.from !== c.to || !host) return void (bar.hidden = true);
              try {
                const start = lineStart(c.text, c.head);
                const end = lineEnd(c.text, c.head);
                // The end is measured on the last character *before* the position: a coordinate at the newline itself
                // can come back from the next line, which made the highlight several lines tall.
                const a = view.coordsAtPos(c.start + start, 1);
                const b = end > start ? view.coordsAtPos(c.start + end, -1) : a;
                const box = host.getBoundingClientRect();
                // coordsAtPos gives the glyph box (about 17px); the highlight should cover the whole line box.
                const lineHeight = parseFloat(getComputedStyle(view.dom.querySelector('code') ?? view.dom).lineHeight) || a.bottom - a.top;
                const pad = Math.max(0, (lineHeight - (a.bottom - a.top)) / 2);
                const top = Math.min(a.top, b.top) - pad - box.top;
                bar.hidden = false;
                bar.style.top = `${top}px`;
                bar.style.height = `${Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top) + 2 * pad}px`;
              } catch {
                bar.hidden = true; // no layout
              }
            };
            update();
            // Wrapping, font size and panel size change the layout without changing the document or selection.
            const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => ((last = null), update())) : null;
            observer?.observe(view.dom);
            return { update, destroy: () => (observer?.disconnect(), bar.remove()) };
          },
        }),
      ];
    },
  };
}
