import { chainCommands } from 'prosemirror-commands';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view';
import { simpleHighlight, type Highlighter } from '../highlight';
import type { EditorPlugin } from '../types';

export interface CodeLanguage { id: string; label: string }

export const DEFAULT_LANGUAGES: CodeLanguage[] = [
  { id: '', label: 'Plain text' }, { id: 'javascript', label: 'JavaScript' }, { id: 'typescript', label: 'TypeScript' }, { id: 'json', label: 'JSON' },
  { id: 'python', label: 'Python' }, { id: 'html', label: 'HTML' }, { id: 'css', label: 'CSS' }, { id: 'bash', label: 'Bash' }, { id: 'sql', label: 'SQL' },
  { id: 'java', label: 'Java' }, { id: 'go', label: 'Go' }, { id: 'rust', label: 'Rust' }, { id: 'php', label: 'PHP' },
];

/** An extra button in a code block's header, e.g. "Run". */
export interface CodeAction {
  label: string;
  title?: string;
  /** Show only for these languages (ids). Default: all. */
  languages?: string[];
  run: (code: string, language: string | null) => void;
}

export interface CodeBlocksOptions {
  languages?: CodeLanguage[];
  /** Replace the built-in highlighter, e.g. with one backed by highlight.js or Shiki. */
  highlight?: Highlighter;
  actions?: CodeAction[];
  /** Spaces inserted by Tab. Default 2. */
  tabSize?: number;
}

const leadingIndent = (line: string) => /^[ \t]*/.exec(line)![0];

/**
 * Developer-friendly code blocks: per-block language with a picker, syntax highlighting, a Copy button, optional
 * header actions, Tab / Shift+Tab indentation and auto-indent on Enter (extra indent after an opening bracket or colon).
 */
export function CodeBlocks(options: CodeBlocksOptions = {}): EditorPlugin {
  const languages = options.languages ?? DEFAULT_LANGUAGES;
  const highlight = options.highlight ?? simpleHighlight;
  const tab = ' '.repeat(options.tabSize ?? 2);
  const cache = new Map<string, DecorationSpec[]>();
  type DecorationSpec = { from: number; to: number; cls: string };

  return {
    name: 'code-blocks',
    setup(editor) {
      editor.registerCommand('codeBlockLanguage', (e, language: string | null) => {
        const lang = language && /^[\w+#-]{1,20}$/.test(language) ? language.toLowerCase() : null;
        if (language && !lang) return false;
        const { state, dispatch } = e.view;
        const { $from } = state.selection;
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name === 'code_block') {
            dispatch(state.tr.setNodeMarkup($from.before(d), undefined, { ...node.attrs, language: lang }));
            return true;
          }
        }
        return false;
      });

      const inCode = (view: EditorView) => view.state.selection.$from.parent.type.name === 'code_block';

      const indentLines = (view: EditorView, outdent: boolean): boolean => {
        const { state, dispatch } = view;
        const { $from, $to } = state.selection;
        if (!inCode(view)) return false;
        const block = $from.parent;
        const start = $from.start();
        const text = block.textContent;
        const a = text.lastIndexOf('\n', $from.parentOffset - 1) + 1; // start of the first selected line
        const bEnd = text.indexOf('\n', $to.parentOffset);
        const end = bEnd < 0 ? text.length : bEnd;
        if (!outdent && state.selection.empty) {
          dispatch(state.tr.insertText(tab)); // plain Tab at the caret
          return true;
        }
        const lines = text.slice(a, end).split('\n');
        const next = lines.map((l) => (outdent ? l.replace(new RegExp(`^(?:${tab}|\\t| {1,${tab.length}})`), '') : tab + l)).join('\n');
        if (next === text.slice(a, end)) return true;
        const tr = state.tr.insertText(next, start + a, start + end);
        dispatch(tr.setSelection(TextSelection.create(tr.doc, Math.max(start + a, $from.pos + (outdent ? 0 : tab.length)), start + a + next.length)));
        return true;
      };

      const enterWithIndent = (state: any, dispatch?: any) => {
        const { $from, empty } = state.selection;
        if (!empty || $from.parent.type.name !== 'code_block') return false;
        if (dispatch) {
          const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
          const line = before.slice(before.lastIndexOf('\n') + 1);
          let indent = leadingIndent(line);
          const after = $from.parent.textBetween($from.parentOffset, $from.parent.content.size, undefined, '￼');
          const opens = /[{[(:]\s*$/.test(line.trimEnd()) && !/^\s*[)\]}]/.test(after);
          const closesNext = /^[)\]}]/.test(after) && /[{[(]\s*$/.test(line.trimEnd());
          if (closesNext) {
            // "{|}": put the closer on its own line, with the caret on an indented line between
            const tr = state.tr.insertText(`\n${indent}${tab}\n${indent}`);
            dispatch(tr.setSelection(TextSelection.create(tr.doc, $from.pos + 1 + indent.length + tab.length)).scrollIntoView());
            return true;
          }
          if (opens) indent += tab;
          dispatch(state.tr.insertText(`\n${indent}`).scrollIntoView());
        }
        return true;
      };

      return [
        keymap({
          Tab: (_s, _d, view) => (view ? indentLines(view, false) : false),
          'Shift-Tab': (_s, _d, view) => (view ? indentLines(view, true) : false),
          Enter: chainCommands(enterWithIndent),
        }),
        new Plugin({
          props: {
            nodeViews: { code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos, languages, options.actions ?? []) },
            decorations(state) {
              const decos: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (node.type.name !== 'code_block') return;
                const code = node.textContent;
                const key = `${node.attrs.language}\u0000${code}`;
                let specs = cache.get(key);
                if (!specs) {
                  specs = highlight(code, node.attrs.language).map((t) => ({ from: t.from, to: t.to, cls: `wy-tok wy-tok-${t.type}` }));
                  if (cache.size > 200) cache.clear();
                  cache.set(key, specs);
                }
                const base = pos + 1;
                for (const s of specs) if (s.to <= code.length) decos.push(Decoration.inline(base + s.from, base + s.to, { class: s.cls }));
                return false;
              });
              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ];
    },
  };
}

/** `<pre>` with a non-editable header (language picker, Copy, actions) and the editable `<code>`. */
class CodeBlockView implements NodeView {
  dom = document.createElement('pre');
  contentDOM = document.createElement('code');
  private select = document.createElement('select');
  private actionBtns: { btn: HTMLButtonElement; action: CodeAction }[] = [];

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, languages: CodeLanguage[], actions: CodeAction[]) {
    const bar = document.createElement('div');
    bar.className = 'wy-code-bar';
    bar.setAttribute('contenteditable', 'false');

    this.select.className = 'wy-code-lang';
    this.select.setAttribute('aria-label', 'Code language');
    for (const l of languages) this.select.add(new Option(l.label, l.id));
    // `update()` only runs when the node changes, so read-only mode is checked at the moment of use.
    this.select.addEventListener('mousedown', (e) => !this.view.editable && e.preventDefault());
    this.select.addEventListener('change', () => {
      const pos = this.getPos();
      if (pos === undefined || !this.view.editable) return void this.sync(); // revert the picker

      this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, language: this.select.value || null }));
    });
    bar.append(this.select);

    for (const action of actions) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wy-code-btn';
      btn.textContent = action.label;
      if (action.title) btn.title = action.title;
      btn.addEventListener('click', () => action.run(this.node.textContent, this.node.attrs.language));
      this.actionBtns.push({ btn, action });
      bar.append(btn);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'wy-code-btn wy-code-copy';
    copy.textContent = 'Copy';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(this.node.textContent);
        copy.textContent = 'Copied!';
      } catch {
        copy.textContent = 'Copy failed';
      }
      setTimeout(() => (copy.textContent = 'Copy'), 1500);
    });
    bar.append(copy);

    this.dom.append(bar, this.contentDOM);
    this.dom.dataset.language = node.attrs.language ?? '';
    this.sync();
  }

  private sync() {
    const lang: string | null = this.node.attrs.language;
    this.dom.dataset.language = lang ?? '';
    this.select.value = [...this.select.options].some((o) => o.value === (lang ?? '')) ? lang ?? '' : '';
    if (lang && this.select.value !== lang) this.select.add(new Option(lang, lang, false, true)); // unknown language: keep it visible
    for (const { btn, action } of this.actionBtns) btn.hidden = !!action.languages && !action.languages.includes(lang ?? '');
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.sync();
    return true;
  }
  stopEvent(e: Event) {
    const t = e.target as Node;
    return !this.contentDOM.contains(t) && this.dom.contains(t); // clicks in the header are not editor events
  }
  ignoreMutation(m: MutationRecord | { type: string; target: Node }) {
    // Changes in the header (select, button text) are not document edits.
    return !this.contentDOM.contains(m.target as Node) && m.type !== 'selection';
  }
}
