import { EditorState } from 'prosemirror-state';
import { Editor } from './editor';
import type { Highlighter } from './highlight';
import { Blocks } from './plugins/blocks';
import { Minimap } from './code-minimap';
import { CodeAdvanced } from './plugins/code-advanced';
import { CodeBlocks } from './plugins/code-blocks';
import { CodeEditing, type CursorInfo } from './plugins/code-editing';
import { Essentials } from './plugins/essentials';
import { FindReplace } from './plugins/find-replace';
import type { EditorPlugin } from './types';

/** Language id for a file name ("main.ts" -> "typescript"), or null when unknown. */
export function languageForFilename(name: string): string | null {
  const lower = name.toLowerCase();
  const base = lower.split('/').pop()!;
  if (base === 'dockerfile') return 'dockerfile';
  if (base === 'makefile') return 'makefile';
  const ext = base.includes('.') ? base.split('.').pop()! : '';
  return EXTENSIONS[ext] ?? null;
}

const EXTENSIONS: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', json: 'json', jsonc: 'json',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'cs', php: 'php',
  html: 'html', htm: 'html', xml: 'xml', svg: 'svg', vue: 'html', css: 'css', scss: 'scss', less: 'less', sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'toml', md: 'markdown', markdown: 'markdown', txt: '',
};

export interface CodeEditorOptions {
  element: HTMLElement;
  value?: string;
  language?: string | null;
  theme?: 'light' | 'dark' | 'auto';
  /** Spaces per Tab. Default 2. */
  tabSize?: number;
  /** Wrap long lines. Default true. */
  wordWrap?: boolean;
  /** Font size in px. Default 14. */
  fontSize?: number;
  /** Height of the editor viewport (any CSS length). Default '100%'. */
  height?: string;
  readOnly?: boolean;
  lineNumbers?: boolean;
  /** Fold blocks of deeper-indented lines from the gutter. Default true. */
  folding?: boolean;
  /** Several cursors: Alt+click, Ctrl/Cmd+Alt+Up/Down. Default true. */
  multiCursor?: boolean;
  /** Show a minimap of the whole file next to the text. Default false. */
  minimap?: boolean;
  highlight?: Highlighter;
  onChange?: (value: string) => void;
  onCursor?: (info: CursorInfo) => void;
  /** Extra plugins (e.g. your own commands). */
  plugins?: EditorPlugin[];
}

export interface CodeFileInput { id: string; value: string; language?: string | null }

/** Restricts the document to a single code block: this is a code editor, not a rich-text one. */
const CodeOnly: EditorPlugin = { name: 'code-only', nodes: { doc: { content: 'code_block' } } };

/**
 * A code editor built on the same engine: line numbers, syntax highlighting, bracket matching and pairing,
 * auto-indent, comment toggling, line operations, find and replace, an active-line highlight, undo per file and
 * several open files. Single cursor (no multi-cursor) and no code folding.
 */
export class CodeEditor {
  readonly editor: Editor;
  private options: CodeEditorOptions;
  private states = new Map<string, EditorState>();
  private current: string | null = null;
  private cursor?: CursorInfo;

  constructor(options: CodeEditorOptions) {
    this.options = options;
    const advanced = CodeAdvanced({ folding: options.folding, multiCursor: options.multiCursor });
    const blockOptions = { lineNumbers: options.lineNumbers !== false, header: false, tabSize: options.tabSize ?? 2, highlight: options.highlight, folding: options.folding === false ? undefined : advanced.folding };
    this.blockOptions = blockOptions;
    this.editor = new Editor({
      element: options.element,
      toolbar: false,
      theme: options.theme ?? 'dark',
      readOnly: options.readOnly,
      placeholder: 'Code editor',
      plugins: [
        Essentials,
        Blocks,
        CodeOnly,
        advanced,
        CodeBlocks(blockOptions),
        CodeEditing({ highlight: options.highlight, onCursor: (c) => ((this.cursor = c), options.onCursor?.(c)) }),
        FindReplace,
        ...(options.plugins ?? []),
      ],
      onChange: () => { options.onChange?.(this.getValue()); this.minimap?.refresh(); },
    });
    const root = this.editor.root;
    root.classList.add('wy-code-editor');
    if (options.height) root.style.setProperty('--wy-code-height', options.height);
    this.setWordWrap(options.wordWrap !== false);
    this.setFontSize(options.fontSize ?? 14);
    this.setTabSize(options.tabSize ?? 2);
    this.replaceDocument(options.value ?? '', options.language ?? null, EditorState.create({ doc: this.editor.view.state.doc, plugins: this.editor.view.state.plugins }));
    this.editor.extensions.codeEditor = this;
    if (options.minimap) this.setMinimap(true);
  }

  private minimap: Minimap | null = null;
  /** Show or hide the minimap. */
  setMinimap(on: boolean): void {
    if (on && !this.minimap) {
      this.minimap = new Minimap(this.editor.workspace, () => this.getValue(), () => this.language, this.options.highlight);
      this.editor.root.append(this.minimap.dom);
      this.editor.root.classList.add('wy-has-minimap');
      this.minimap.refresh();
    } else if (!on && this.minimap) {
      this.minimap.destroy();
      this.minimap = null;
      this.editor.root.classList.remove('wy-has-minimap');
    }
  }
  get hasMinimap(): boolean {
    return !!this.minimap;
  }
  foldAll(): boolean {
    return this.editor.execute('foldAll');
  }
  unfoldAll(): boolean {
    return this.editor.execute('unfoldAll');
  }
  /** Number of cursors (1 unless extra carets were added). */
  get cursorCount(): number {
    return (this.editor.extensions.codeAdvanced as { cursorCount(): number } | undefined)?.cursorCount() ?? 1;
  }

  private blockOptions: { tabSize: number };

  private makeDoc(value: string, language: string | null) {
    const { doc, code_block } = this.editor.schema.nodes;
    const lang = language && /^[\w+#-]{1,20}$/.test(language) ? language.toLowerCase() : null;
    return doc.create(null, code_block.create({ language: lang }, value ? this.editor.schema.text(value) : null));
  }

  private replaceDocument(value: string, language: string | null, base: EditorState) {
    const state = EditorState.create({ doc: this.makeDoc(value, language), plugins: base.plugins });
    this.editor.view.updateState(state);
  }

  /** The whole text. */
  getValue(): string {
    return this.editor.view.state.doc.textContent;
  }

  /** Replace the text of the current file (undoable). */
  setValue(value: string): void {
    const { state, dispatch } = this.editor.view;
    dispatch(state.tr.replaceWith(0, state.doc.content.size, this.makeDoc(value, this.language).content));
  }

  get language(): string | null {
    return this.editor.view.state.doc.firstChild?.attrs.language ?? null;
  }

  setLanguage(language: string | null): void {
    const { state, dispatch } = this.editor.view;
    dispatch(state.tr.setNodeMarkup(0, undefined, { ...state.doc.firstChild!.attrs, language: language && /^[\w+#-]{1,20}$/.test(language) ? language.toLowerCase() : null }));
    this.minimap?.refresh();
  }

  // ---- files: each has its own text, cursor and undo history

  get fileId(): string | null {
    return this.current;
  }
  fileIds(): string[] {
    return [...this.states.keys(), ...(this.current && !this.states.has(this.current) ? [this.current] : [])];
  }

  /** Open (or switch to) a file. The previous file's text, cursor and undo history are kept. */
  openFile(file: CodeFileInput): void {
    if (this.current) this.states.set(this.current, this.editor.view.state);
    this.current = file.id;
    const saved = this.states.get(file.id);
    if (saved) this.editor.view.updateState(saved);
    else this.replaceDocument(file.value, file.language ?? null, this.editor.view.state);
    this.options.onChange?.(this.getValue());
    this.minimap?.refresh();
  }

  /** Forget a file's state. Closing the open file is up to the caller (open another one). */
  closeFile(id: string): boolean {
    if (id === this.current) return false;
    return this.states.delete(id);
  }

  /** Text of any open file. */
  getFileValue(id: string): string | null {
    if (id === this.current) return this.getValue();
    return this.states.get(id)?.doc.textContent ?? null;
  }

  // ---- view settings

  setTabSize(n: number): void {
    const size = Math.max(1, Math.min(8, Math.round(n) || 2));
    this.blockOptions.tabSize = size;
    this.editor.root.style.setProperty('--wy-tab', String(size));
  }
  get tabSize(): number {
    return this.blockOptions.tabSize;
  }
  setWordWrap(on: boolean): void {
    this.editor.root.classList.toggle('wy-nowrap', !on);
  }
  get wordWrap(): boolean {
    return !this.editor.root.classList.contains('wy-nowrap');
  }
  setFontSize(px: number): void {
    this.editor.root.style.setProperty('--wy-code-size', `${Math.max(8, Math.min(32, Math.round(px)))}px`);
  }
  get fontSize(): number {
    return parseInt(this.editor.root.style.getPropertyValue('--wy-code-size'), 10) || 14;
  }
  setTheme(theme: 'light' | 'dark'): void {
    this.editor.setTheme(theme);
    this.minimap?.refresh();
  }

  goToLine(line: number): boolean {
    return this.editor.execute('goToLine', line);
  }
  get cursorInfo(): CursorInfo | undefined {
    return this.cursor;
  }
  focus(): void {
    this.editor.view.focus();
  }
  destroy(): void {
    this.minimap?.destroy();
    this.editor.destroy();
  }
}

export function createCodeEditor(options: CodeEditorOptions): CodeEditor {
  return new CodeEditor(options);
}
