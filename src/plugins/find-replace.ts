import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import type { EditorPlugin } from '../types';

export interface Match { from: number; to: number; /** The matched text (used to expand `$1` in a regex replacement). */ text?: string }

export interface FindOptions {
  caseSensitive?: boolean;
  /** Treat the query as a regular expression (JavaScript syntax, Unicode mode). */
  regex?: boolean;
  /** Only match whole words. */
  wholeWord?: boolean;
}

const MAX_BLOCK = 100_000; // longest paragraph searched with a pattern
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Patterns that can take exponential time on some input (nested quantifiers such as `(a+)+` or `(.*)*`). Refused rather than risked. */
export function isRiskyRegex(source: string): boolean {
  return /\([^()]*[+*][^()]*\)\s*[+*{]/.test(source) || /\((?:[^()]*\|)+[^()]*\)\s*[+*]\s*[+*]/.test(source) || source.length > 300;
}

/** The expression for a query, or an error message when it is invalid or unsafe. `null` means "plain text, use indexOf". */
export function buildMatcher(query: string, o: FindOptions = {}): { re: RegExp | null; error: string | null } {
  if (!query) return { re: null, error: null };
  if (!o.regex && !o.wholeWord) return { re: null, error: null };
  const source = o.regex ? query : escapeRe(query);
  if (o.regex && isRiskyRegex(source)) return { re: null, error: 'This pattern could be very slow. Simplify it (avoid nested repeats like (a+)+).' };
  try {
    const wrapped = o.wholeWord ? `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])` : source;
    return { re: new RegExp(wrapped, `gu${o.caseSensitive ? '' : 'i'}`), error: null };
  } catch (e) {
    return { re: null, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Invalid pattern' };
  }
}

/** Find all occurrences per textblock (so matches can span mark boundaries). */
export function findMatches(doc: PMNode, query: string, caseSensitive = false, options: Omit<FindOptions, 'caseSensitive'> = {}): Match[] {
  if (!query) return [];
  const { re, error } = buildMatcher(query, { ...options, caseSensitive });
  if (error) return [];
  const needle = caseSensitive ? query : query.toLowerCase();
  const out: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = '';
    const map: number[] = []; // index in `text` -> doc position
    node.descendants((child, childPos) => {
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) map.push(pos + 1 + childPos + i);
        text += child.text;
      } else if (child.isLeaf) {
        map.push(pos + 1 + childPos);
        text += '\n'; // never matches a plain query
      }
    });
    if (re) {
      if (text.length > MAX_BLOCK) return false;
      re.lastIndex = 0;
      for (let m = re.exec(text); m; m = re.exec(text)) {
        if (!m[0].length) { re.lastIndex++; continue; } // an empty match would loop forever and selects nothing
        out.push({ from: map[m.index], to: map[m.index + m[0].length - 1] + 1, text: m[0] });
      }
      return false;
    }
    const hay = caseSensitive ? text : text.toLowerCase();
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) {
      out.push({ from: map[i], to: map[i + needle.length - 1] + 1, text: text.slice(i, i + needle.length) });
    }
    return false;
  });
  return out;
}

interface FindState { query: string; caseSensitive: boolean; regex: boolean; wholeWord: boolean; error: string | null; matches: Match[]; current: number; open: boolean }
const key = new PluginKey<FindState>('find-replace');

export const FindReplace: EditorPlugin = {
  name: 'find-replace',
  setup(editor) {
    const get = () => key.getState(editor.view.state)!;
    const set = (patch: Partial<FindState>) => editor.view.dispatch(editor.view.state.tr.setMeta(key, patch).setMeta('addToHistory', false));

    const select = (i: number) => {
      const s = get();
      if (!s.matches.length) return false;
      const idx = (i + s.matches.length) % s.matches.length;
      const m = s.matches[idx];
      const { state, dispatch } = editor.view;
      dispatch(state.tr.setMeta(key, { current: idx }).setSelection(TextSelection.create(state.doc, m.from, m.to)).scrollIntoView().setMeta('addToHistory', false));
      return true;
    };

    editor.registerCommand('find', (_e, query: string, caseSensitive = false, options: Omit<FindOptions, 'caseSensitive'> = {}) => (set({ query, caseSensitive, regex: !!options.regex, wholeWord: !!options.wholeWord, current: 0, open: true }), get().matches.length > 0));
    editor.registerCommand('findNext', () => select(get().current + 1));
    editor.registerCommand('findPrev', () => select(get().current - 1));
    editor.registerCommand('replace', (_e, text: string) => {
      const s = get();
      const m = s.matches[s.current];
      if (!m) return false;
      editor.view.dispatch(editor.view.state.tr.insertText(replacement(s, m, text), m.from, m.to));
      return true;
    });
    editor.registerCommand('replaceAll', (_e, text: string) => {
      const restricted = editor.extensions.restricted as { canEdit(from: number, to: number): boolean } | undefined;
      // With restricted editing a locked match must be skipped: one rejected step would otherwise cancel every replacement.
      const matches = get().matches.filter((m) => !restricted || restricted.canEdit(m.from, m.to));
      if (!matches.length) return false;
      const tr = editor.view.state.tr;
      const state = get();
      for (const m of [...matches].reverse()) tr.insertText(replacement(state, m, text), m.from, m.to);
      editor.view.dispatch(tr);
      return true;
    });
    editor.registerCommand('toggleFind', () => (set({ open: !get().open }), true));

    const compute = (doc: PMNode, s: FindState) => findMatches(doc, s.query, s.caseSensitive, { regex: s.regex, wholeWord: s.wholeWord });
    /** What a match is replaced with: in regex mode `$1`, `$&` and `$<name>` are expanded from the match. */
    const replacement = (s: FindState, m: Match, text: string) => {
      if (!s.regex) return text;
      const { re } = buildMatcher(s.query, { caseSensitive: s.caseSensitive, regex: true, wholeWord: s.wholeWord });
      return re && m.text !== undefined ? m.text.replace(new RegExp(re.source, re.flags.replace('g', '')), text) : text;
    };

    return [
      new Plugin<FindState>({
        key,
        state: {
          init: () => ({ query: '', caseSensitive: false, regex: false, wholeWord: false, error: null, matches: [], current: 0, open: false }),
          apply(tr, s) {
            const meta = tr.getMeta(key) as Partial<FindState> | undefined;
            if (!meta && !tr.docChanged) return s;
            const next = { ...s, ...meta };
            next.error = buildMatcher(next.query, { caseSensitive: next.caseSensitive, regex: next.regex, wholeWord: next.wholeWord }).error;
            next.matches = compute(tr.doc, next);
            next.current = Math.min(next.current, Math.max(0, next.matches.length - 1));
            return next;
          },
        },
        props: {
          decorations(state) {
            const s = key.getState(state)!;
            if (!s.open || !s.matches.length) return null;
            return DecorationSet.create(state.doc, s.matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === s.current ? 'wy-find wy-find-current' : 'wy-find' })));
          },
        },
        view(view) {
          const panel = document.createElement('div');
          panel.className = 'wy-find-panel';
          panel.hidden = true;
          panel.innerHTML =
            '<input class="wy-find-q" placeholder="Find" aria-label="Find">' +
            '<span class="wy-find-count"></span>' +
            '<button type="button" class="wy-btn wy-find-prev" title="Previous">↑</button>' +
            '<button type="button" class="wy-btn wy-find-next" title="Next">↓</button>' +
            '<label class="wy-find-case" title="Match case"><input type="checkbox"> Aa</label>' +
            '<label class="wy-find-word" title="Whole words"><input type="checkbox"> W</label>' +
            '<label class="wy-find-re" title="Regular expression"><input type="checkbox"> .*</label>' +
            '<span class="wy-find-err" role="alert"></span>' +
            '<input class="wy-find-r" placeholder="Replace with" aria-label="Replace with">' +
            '<button type="button" class="wy-btn wy-find-rep">Replace</button>' +
            '<button type="button" class="wy-btn wy-find-all">All</button>' +
            '<button type="button" class="wy-btn wy-find-close" title="Close">✕</button>';
          editor.root.append(panel);
          const $ = <T extends HTMLElement>(sel: string) => panel.querySelector(sel) as T;
          const q = $<HTMLInputElement>('.wy-find-q');
          const r = $<HTMLInputElement>('.wy-find-r');
          const cs = $<HTMLInputElement>('.wy-find-case input');
          const word = $<HTMLInputElement>('.wy-find-word input');
          const rx = $<HTMLInputElement>('.wy-find-re input');
          const run = () => editor.execute('find', q.value, cs.checked, { wholeWord: word.checked, regex: rx.checked });
          q.addEventListener('input', run);
          for (const box of [cs, word, rx]) box.addEventListener('change', run);
          q.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') (e.preventDefault(), editor.execute(e.shiftKey ? 'findPrev' : 'findNext'));
            if (e.key === 'Escape') set({ open: false });
          });
          $('.wy-find-next').addEventListener('click', () => editor.execute('findNext'));
          $('.wy-find-prev').addEventListener('click', () => editor.execute('findPrev'));
          $('.wy-find-rep').addEventListener('click', () => editor.execute('replace', r.value));
          $('.wy-find-all').addEventListener('click', () => editor.execute('replaceAll', r.value));
          $('.wy-find-close').addEventListener('click', () => set({ open: false }));
          let wasOpen = false;
          const render = () => {
            const s = key.getState(view.state)!;
            panel.hidden = !s.open;
            $('.wy-find-count').textContent = s.query ? `${s.matches.length ? s.current + 1 : 0}/${s.matches.length}` : '';
            $('.wy-find-err').textContent = s.error ?? '';
            q.classList.toggle('is-invalid', !!s.error);
            q.setAttribute('aria-invalid', String(!!s.error));
            if (s.open && !wasOpen) q.focus();
            wasOpen = s.open;
          };
          render();
          return { update: render, destroy: () => panel.remove() };
        },
      }),
      keymap({
        'Mod-f': (state) => {
          if (!key.getState(state)!.open) set({ open: true });
          else (editor.root.querySelector('.wy-find-q') as HTMLInputElement)?.focus();
          return true;
        },
      }),
    ];
  },
  toolbar: [{ name: 'find', label: 'Find & replace (Ctrl+F)', icon: '🔍', command: 'toggleFind' }],
};
