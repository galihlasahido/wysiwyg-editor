import type { Mark } from 'prosemirror-model';
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state';
import type { ContextMenuEntry, EditorPlugin } from '../types';

export type CaseKind = 'upper' | 'lower' | 'title' | 'sentence' | 'toggle' | 'snake' | 'camel' | 'pascal' | 'kebab';

const WORD = /[\p{L}\p{N}]+/gu;
const upper1 = (w: string) => w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase();

/** The words of a text, however they are separated: spaces, punctuation, `_`, `-`, or a lower-to-upper step (`fooBar`). */
function words(text: string): string[] {
  return (text.replace(/(\p{Ll}|\p{N})(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2').match(WORD) ?? []);
}

/** Convert a piece of text. Pure, so it is easy to test and reuse. */
export function convertCase(text: string, kind: CaseKind): string {
  switch (kind) {
    case 'upper': return text.toLocaleUpperCase();
    case 'lower': return text.toLocaleLowerCase();
    case 'toggle': return [...text].map((c) => (c === c.toLocaleUpperCase() ? c.toLocaleLowerCase() : c.toLocaleUpperCase())).join('');
    case 'title': return text.toLocaleLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase());
    case 'sentence': return text.toLocaleLowerCase().replace(/(^|[.!?]\s+|\n)(\p{L})/gu, (_m, a: string, b: string) => a + b.toLocaleUpperCase());
    case 'snake': return words(text).map((w) => w.toLocaleLowerCase()).join('_');
    case 'kebab': return words(text).map((w) => w.toLocaleLowerCase()).join('-');
    case 'camel': return words(text).map((w, i) => (i === 0 ? w.toLocaleLowerCase() : upper1(w))).join('');
    case 'pascal': return words(text).map(upper1).join('');
  }
}

/** Kinds that keep the length of each letter, so every piece of formatting can stay where it is. */
const PER_NODE: CaseKind[] = ['upper', 'lower', 'toggle', 'title', 'sentence'];

/** The range to convert: the selection, or the word around the caret. */
function targetRange(state: EditorState): { from: number; to: number } | null {
  const { from, to, empty, $from } = state.selection;
  if (!empty) return { from, to };
  const block = $from.parent;
  if (!block.isTextblock) return null;
  const text = block.textBetween(0, block.content.size, undefined, '￼');
  const at = $from.parentOffset;
  const re = /[\p{L}\p{N}_-]+/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (at >= m.index && at <= m.index + m[0].length) return { from: $from.start() + m.index, to: $from.start() + m.index + m[0].length };
  }
  return null;
}

/** Change the case of the selected text (or of the word at the caret). Returns false when there is nothing to change. */
export function applyCase(state: EditorState, kind: CaseKind): Transaction | null {
  const range = targetRange(state);
  if (!range) return null;
  const tr = state.tr;
  if (PER_NODE.includes(kind)) {
    // Title and sentence case need the text before a piece to know whether a word starts there, so convert block by block and write each piece back with its own marks.
    const pieces: { from: number; to: number; text: string; marks: readonly Mark[] }[] = [];
    state.doc.nodesBetween(range.from, range.to, (node, pos) => {
      if (!node.isText) return;
      const from = Math.max(range.from, pos);
      const to = Math.min(range.to, pos + node.nodeSize);
      if (to > from) pieces.push({ from, to, text: node.text!.slice(from - pos, to - pos), marks: node.marks });
    });
    // The context for "does a word start here" is the character before the first piece.
    let prev = '';
    const first = pieces[0];
    if (first) prev = state.doc.textBetween(Math.max(0, first.from - 1), first.from, undefined, '￼');
    const joined = pieces.map((p) => p.text).join('');
    const converted = convertCase(prev + joined, kind).slice(prev.length);
    let offset = 0;
    let changed = false;
    const out = pieces.map((p) => { const t = converted.slice(offset, offset + p.text.length); offset += p.text.length; return t; });
    if (converted.length !== joined.length) return convertWhole(state, range, kind);
    for (let i = pieces.length - 1; i >= 0; i--) {
      const p = pieces[i];
      if (out[i] !== p.text) { tr.replaceWith(p.from, p.to, state.schema.text(out[i], p.marks)); changed = true; }
    }
    return changed ? tr : null;
  }
  return convertWhole(state, range, kind);
}

/** snake/camel/kebab change the length and join words, so a block's selected text is replaced as one piece that keeps the marks of its first letter. */
function convertWhole(state: EditorState, range: { from: number; to: number }, kind: CaseKind): Transaction | null {
  const tr = state.tr;
  const blocks: { from: number; to: number }[] = [];
  state.doc.nodesBetween(range.from, range.to, (node, pos) => {
    if (!node.isTextblock) return;
    const from = Math.max(range.from, pos + 1);
    const to = Math.min(range.to, pos + node.nodeSize - 1);
    if (to > from) blocks.push({ from, to });
    return false;
  });
  let changed = false;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const { from, to } = blocks[i];
    const text = state.doc.textBetween(from, to, undefined, '￼');
    if (text.includes('￼')) continue; // leave a selection that holds an image or other inline object alone
    const next = convertCase(text, kind);
    if (next === text || !next) continue;
    const marks = state.doc.resolve(from).marksAcross(state.doc.resolve(to)) ?? state.doc.resolve(from).marks();
    tr.replaceWith(from, to, state.schema.text(next, marks));
    changed = true;
  }
  if (changed && state.selection.empty) tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(tr.mapping.map(range.to), tr.doc.content.size))));
  return changed ? tr : null;
}

const CYCLE: CaseKind[] = ['sentence', 'lower', 'upper', 'title'];

const mod = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘⌥' : 'Ctrl+Alt+';
export const CASE_ITEMS: { kind: CaseKind; command: string; label: string; key?: string; sample: string }[] = [
  { kind: 'sentence', command: 'caseSentence', label: 'Sentence case', sample: 'Sentence case.' },
  { kind: 'lower', command: 'caseLower', label: 'lowercase', key: 'Mod-Alt-l', sample: 'lowercase' },
  { kind: 'upper', command: 'caseUpper', label: 'UPPERCASE', key: 'Mod-Alt-u', sample: 'UPPERCASE' },
  { kind: 'title', command: 'caseTitle', label: 'Title Case', sample: 'Title Case' },
  { kind: 'toggle', command: 'caseToggle', label: 'tOGGLE cASE', key: 'Mod-Alt-g', sample: 'tOGGLE cASE' },
  { kind: 'snake', command: 'caseSnake', label: 'snake_case', key: 'Mod-Alt-s', sample: 'snake_case' },
  { kind: 'camel', command: 'caseCamel', label: 'camelCase', key: 'Mod-Alt-m', sample: 'camelCase' },
  { kind: 'pascal', command: 'casePascal', label: 'PascalCase', sample: 'PascalCase' },
  { kind: 'kebab', command: 'caseKebab', label: 'kebab-case', sample: 'kebab-case' },
];

/** Change case: UPPERCASE, lowercase, Title Case, Sentence case, tOGGLE, snake_case, camelCase, PascalCase and kebab-case. Shift+F3 cycles through the first four, as in Word. */
export const TextCase: EditorPlugin = {
  name: 'text-case',
  setup(editor) {
    const run = (kind: CaseKind) => (e: typeof editor) => {
      const tr = applyCase(e.view.state, kind);
      if (!tr) return false;
      e.view.dispatch(tr.scrollIntoView());
      return true;
    };
    for (const i of CASE_ITEMS) editor.registerCommand(i.command, run(i.kind));
    editor.registerCommand('changeCase', (e, kind: CaseKind) => (CASE_ITEMS.some((i) => i.kind === kind) ? run(kind)(e) : false));
    /** Shift+F3: sentence → lower → UPPER → Title, by looking at what the text is now. */
    editor.registerCommand('cycleCase', (e) => {
      const range = targetRange(e.view.state);
      if (!range) return false;
      const text = e.view.state.doc.textBetween(range.from, range.to, ' ');
      const now = CYCLE.findIndex((k) => convertCase(text, k) === text);
      // the first style that would change the text and that it is not already in
      for (let step = 1; step <= CYCLE.length; step++) {
        const next = CYCLE[(now + step + CYCLE.length) % CYCLE.length];
        if (convertCase(text, next) !== text || step === CYCLE.length) return run(next)(e);
      }
      return false;
    });
  },
  keymap: {
    'Shift-F3': 'cycleCase',
    ...Object.fromEntries(CASE_ITEMS.filter((i) => i.key).map((i) => [i.key!, i.command])),
  },
  contextMenuOrder: 4,
  contextMenu({ state, readonly }) {
    if (readonly || state.selection.empty) return [];
    const entries: ContextMenuEntry[] = CASE_ITEMS.map((i) => ({ label: i.sample, command: i.command, shortcut: i.key ? mod + i.key.slice(-1).toUpperCase() : undefined }));
    return [{ label: 'Change case', icon: 'Aa', items: entries }];
  },
};
