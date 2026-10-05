import { DOMParser, DOMSerializer, Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { isRtlLocale, translate } from './i18n';
import { Toolbar, resolveLayout } from './toolbar';
import { Ribbon, type RibbonOptions } from './ribbon';
import { getStats, type Stats } from './plugins/word-count';
import { inertElement } from './inert';
import { markdownToDoc, docToMarkdown } from './markdown';
import type { Command, EditorEvent, EditorPlugin, ToolbarEntry, ToolbarItem, ToolbarOptions } from './types';

export interface EditorConfig {
  /** Element the editor is mounted into. */
  element: HTMLElement;
  plugins: EditorPlugin[];
  /**
   * The toolbar layout. A list of item names (`'|'` separator, `'-'` new row, `'>'` spacer to the far end), or an options
   * object with `items`, `position`, `sticky`, `overflow`, `align` and `hide`. Defaults to every plugin's items.
   * `false` hides the toolbar (e.g. an inline editor with a balloon). Change it later with `setToolbar`.
   */
  toolbar?: ToolbarEntry[] | ToolbarOptions | false;
  /** Initial HTML content. */
  content?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
  /** Uploads an image file and resolves to its URL. Defaults to embedding as a Base64 data URL. */
  uploadImage?: (file: File) => Promise<string>;
  /** Start in read-only mode. */
  readOnly?: boolean;
  /** Text direction of the document. Default 'ltr'. */
  direction?: 'ltr' | 'rtl' | 'auto';
  /** UI language for toolbar labels (see `registerLocale`). Default 'en'. */
  locale?: string;
  /** Show the Office-style tabbed ribbon instead of the compact toolbar. */
  ribbon?: boolean | RibbonOptions;
  /** Chrome theme. 'auto' follows the system setting. The paper follows it unless changed with `setPageDark`. Default 'light'. */
  theme?: 'light' | 'dark' | 'auto';
}

const baseNodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  text: { group: 'inline' },
};

export class Editor {
  readonly schema: Schema;
  readonly view: EditorView;
  /** The toolbar or ribbon. Replaced when `setToolbar` is called. */
  toolbar: Toolbar | Ribbon;
  readonly root: HTMLElement;
  /** Flex row holding optional side panels (outline) and the workspace. */
  readonly body: HTMLElement;
  /** Scroll area holding the ruler and the editable content. */
  readonly workspace: HTMLElement;
  readonly config: EditorConfig;
  /** Plugins publish read-only helpers here (e.g. `pageSettings`) for exporters to use. */
  readonly extensions: Record<string, unknown> = {};
  private readOnly: boolean;
  private ready = false;
  private systemQuery: MediaQueryList | null = null;
  private onSystemTheme: ((e: MediaQueryListEvent) => void) | null = null;
  private transformers: NonNullable<EditorPlugin['transformTransaction']>[] = [];
  /** Turns a dropped, pasted or uploaded image into a URL for the document. Base64 by default; a plugin (the file manager) may wrap it. */
  uploadImage: (file: File) => Promise<string>;
  private commands = new Map<string, Command>();
  private destroyed = false;
  private listeners = new Map<string, Set<(payload: any) => void>>();
  private readOnlySafe = new Set<string>();
  

  constructor(config: EditorConfig) {

    this.config = config;
    const names = new Set(config.plugins.map((p) => p.name));
    for (const p of config.plugins) for (const need of p.requires ?? []) if (!names.has(need)) throw new Error(`Plugin "${p.name}" requires the plugin "${need}", which is not installed.`);
    this.readOnly = config.readOnly ?? false;
    this.uploadImage = config.uploadImage ?? readAsDataURL;
    const nodes: Record<string, NodeSpec> = { ...baseNodes };
    const marks: Record<string, MarkSpec> = {};
    for (const p of config.plugins) {
      Object.assign(nodes, p.nodes);
      Object.assign(marks, p.marks);
    }
    this.schema = new Schema({ nodes, marks });

    this.root = document.createElement('div');
    this.root.className = 'wy-editor';
    const direction = config.direction ?? (isRtlLocale(config.locale) ? 'rtl' : 'ltr');
    this.root.dir = direction;
    const system = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
    const initial = config.theme === 'auto' ? (system?.matches ? 'dark' : 'light') : config.theme ?? 'light';
    this.root.dataset.theme = initial;
    this.root.dataset.page = initial;
    if (config.theme === 'auto' && system?.addEventListener) {
      this.onSystemTheme = (e: MediaQueryListEvent) => this.setTheme(e.matches ? 'dark' : 'light');
      system.addEventListener('change', this.onSystemTheme);
      this.systemQuery = system;
    }
    this.body = document.createElement('div');
    this.body.className = 'wy-body';
    this.workspace = document.createElement('div');
    this.workspace.className = 'wy-workspace';
    const content = document.createElement('div');
    content.className = 'wy-content';
    this.workspace.append(content);
    this.body.append(this.workspace);
    this.root.append(this.body);
    config.element.append(this.root);

    const byPriority = [...config.plugins].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    this.transformers = byPriority.flatMap((p) => (p.transformTransaction ? [p.transformTransaction.bind(p)] : []));
    const pmPlugins = byPriority.flatMap((p) => {
      const own = p.setup?.(this) ?? [];
      if (!p.keymap) return own;
      // string = a command name; function = your own handler. Typing in read-only mode is already refused by `execute`.
      const bindings = Object.fromEntries(Object.entries(p.keymap).map(([key, target]) => [key, () => (typeof target === 'string' ? this.execute(target) : target(this))]));
      return [keymap(bindings), ...own];
    });
    const doc = this.parseHTML(config.content ?? '');
    const state = EditorState.create({ doc, plugins: pmPlugins });
    const editor = this; // eslint-disable-line @typescript-eslint/no-this-alias

    this.view = new EditorView(content, {
      state,
      editable: () => !this.readOnly,
      attributes: {
        'data-placeholder': config.placeholder ?? '',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': config.placeholder || 'Rich text editor',
        dir: direction,
      },
      // Plugin views may dispatch while EditorView is still being constructed (e.g. Yjs sync), when
      // `editor.view` is not assigned yet. ProseMirror calls this with the view as `this`.
      dispatchTransaction(this: EditorView, tr) {
        if (tr.docChanged && !tr.getMeta('wy-raw')) {
          for (const t of editor.transformers) tr = t(tr, this.state);
        }
        const before = this.state.doc;
        const beforeSel = this.state.selection;
        const next = this.state.apply(tr);
        this.updateState(next);
        if (!editor.ready) return;
        editor.toolbar.update(next);
        // A plugin may have rejected the transaction (restricted editing): then nothing changed and nobody is told.
        if (tr.docChanged && next.doc !== before) {
          config.onChange?.(editor.getHTML());
          editor.emit('change', { state: next });
        }
        if (!next.selection.eq(beforeSel)) editor.emit('selection', { state: next });
      },
    });

    this.toolbar = this.buildToolbar(config.toolbar);
    this.mountToolbar(config.toolbar);
    this.toolbar.update(this.view.state);
    if (this.readOnly) this.root.classList.add('is-readonly');
    this.view.dom.addEventListener('focus', () => this.emit('focus', {}));
    this.view.dom.addEventListener('blur', () => this.emit('blur', {}));
    this.ready = true;
    for (const p of config.plugins) p.onReady?.(this);
    this.emit('ready', {});
  }

  // ---- toolbar

  private buildToolbar(layout: EditorConfig['toolbar']): Toolbar | Ribbon {
    if (this.config.ribbon) return new Ribbon(this, this.config.ribbon === true ? {} : this.config.ribbon);
    const all = this.config.plugins.flatMap((p) => p.toolbar ?? []);
    const options: ToolbarOptions = Array.isArray(layout) ? { items: layout } : layout || {};
    const entries: ToolbarEntry[] = options.items ?? all.map((i) => i.name);
    const known: ToolbarItem[] = [...all];
    return new Toolbar(this, resolveLayout(entries, known, options.hide), options);
  }

  private mountToolbar(layout: EditorConfig['toolbar']) {
    if (layout === false) return;
    const bottom = !Array.isArray(layout) && layout?.position === 'bottom';
    this.root.classList.toggle('has-toolbar-bottom', bottom);
    if (bottom) this.root.append(this.toolbar.el);
    else this.root.prepend(this.toolbar.el);
  }

  /** Rearrange the toolbar at runtime: same forms as the `toolbar` option. Not used with the ribbon. */
  setToolbar(layout: EditorConfig['toolbar']): void {
    if (this.config.ribbon) return;
    this.toolbar.el.remove();
    (this.toolbar as Toolbar).destroy?.();
    this.config.toolbar = layout;
    this.toolbar = this.buildToolbar(layout);
    this.mountToolbar(layout);
    this.toolbar.update(this.view.state);
  }

  // ---- events

  /**
   * Listen to editor events: `ready`, `change`, `selection`, `focus`, `blur`, `command` (`{ name, args, result }`),
   * `destroy`, and any event a plugin emits itself. Returns a function that removes the listener.
   */
  on<T = any>(event: EditorEvent, handler: (payload: T) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(handler);
    return () => this.off(event, handler);
  }

  off(event: EditorEvent, handler: (payload: any) => void): void {
    this.listeners.get(event)?.delete(handler);
  }

  /** Tell listeners something happened. A listener that throws is reported and does not stop the others. */
  emit(event: EditorEvent, payload: unknown = {}): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`Listener for "${event}" failed`, e);
      }
    }
  }

  /** Translate a UI label for the configured locale, falling back to `fallback` (English). */
  t(key: string, fallback: string): string {
    return translate(this.config.locale, key, fallback);
  }

  /** `readOnlySafe` commands (e.g. adding comments) keep working in read-only mode. */
  registerCommand(name: string, command: Command, options: { readOnlySafe?: boolean } = {}): void {
    this.commands.set(name, command);
    if (options.readOnlySafe) this.readOnlySafe.add(name);
  }

  execute(name: string, ...args: any[]): boolean {
    const cmd = this.commands.get(name);
    if (!cmd) throw new Error(`Unknown command: ${name}`);
    if (this.destroyed) return false; // a late callback (an upload that finished after the editor was removed) must not touch a dead view
    if (this.readOnly && !this.readOnlySafe.has(name)) return false;
    const result = cmd(this, ...args);
    this.view.focus();
    this.emit('command', { name, args, result });
    return result;
  }

  getHTML(): string {
    const frag = DOMSerializer.fromSchema(this.schema).serializeFragment(this.view.state.doc.content);
    const div = document.createElement('div');
    div.append(frag);
    return div.innerHTML;
  }

  /** Replace the whole document as one undoable transaction (unlike `setHTML`, history is kept). */
  replaceHTML(html: string): void {
    const doc = this.parseHTML(html);
    const { state } = this.view;
    this.view.dispatch(state.tr.replaceWith(0, state.doc.content.size, doc.content).setMeta('wy-raw', true));
  }

  setHTML(html: string): void {
    const doc = this.parseHTML(html);
    const state = EditorState.create({ doc, plugins: this.view.state.plugins });
    this.view.updateState(state);
    this.toolbar.update(state);
  }

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  setReadOnly(value: boolean): void {
    this.readOnly = value;
    this.root.classList.toggle('is-readonly', value);
    this.view.dispatch(this.view.state.tr.setMeta('addToHistory', false)); // re-evaluate `editable`
  }

  get theme(): 'light' | 'dark' {
    return this.root.dataset.theme === 'dark' ? 'dark' : 'light';
  }

  /** Dark chrome. The paper follows unless it was switched separately afterwards. */
  setTheme(theme: 'light' | 'dark'): void {
    this.root.dataset.theme = theme;
    this.root.dataset.page = theme;
    this.toolbar.update(this.view.state);
  }

  get isPageDark(): boolean {
    return this.root.dataset.page === 'dark';
  }

  /** Make the paper dark or light independently of the chrome ("Switch Background"). */
  setPageDark(dark: boolean): void {
    this.root.dataset.page = dark ? 'dark' : 'light';
    this.toolbar.update(this.view.state);
  }

  /** Whether a command is registered (used to hide ribbon buttons whose plugin is not installed). */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  getStats(): Stats {
    return getStats(this.view.state.doc);
  }

  getMarkdown(): string {
    return docToMarkdown(this.view.state.doc);
  }

  setMarkdown(md: string): void {
    const state = EditorState.create({ doc: markdownToDoc(this.schema, md), plugins: this.view.state.plugins });
    this.view.updateState(state);
    this.toolbar.update(state);
  }

  destroy(): void {
    this.emit('destroy', {});
    this.destroyed = true;
    for (const p of this.config.plugins) {
      try { p.destroy?.(this); } catch (e) { console.error(`Plugin "${p.name}" failed to clean up`, e); }
    }
    (this.toolbar as Toolbar).destroy?.();
    this.listeners.clear();
    if (this.systemQuery && this.onSystemTheme) this.systemQuery.removeEventListener('change', this.onSystemTheme);
    this.view.destroy();
    this.root.remove();
  }

  private parseHTML(html: string) {
    const el = inertElement(html); // not document.createElement: that would run onerror handlers before the schema drops them
    return DOMParser.fromSchema(this.schema).parse(el);
  }
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
