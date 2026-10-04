import { DOMParser, DOMSerializer, Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { isRtlLocale, translate } from './i18n';
import { Toolbar } from './toolbar';
import { getStats, type Stats } from './plugins/word-count';
import { markdownToDoc, docToMarkdown } from './markdown';
import type { Command, EditorPlugin, ToolbarItem } from './types';

export interface EditorConfig {
  /** Element the editor is mounted into. */
  element: HTMLElement;
  plugins: EditorPlugin[];
  /** Toolbar item names, in order. Use '|' for a separator. Defaults to every plugin's items. */
  toolbar?: string[];
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
}

const baseNodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  text: { group: 'inline' },
};

export class Editor {
  readonly schema: Schema;
  readonly view: EditorView;
  readonly toolbar: Toolbar;
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
  private transformers: NonNullable<EditorPlugin['transformTransaction']>[] = [];
  readonly uploadImage: (file: File) => Promise<string>;
  private commands = new Map<string, Command>();
  private readOnlySafe = new Set<string>();
  

  constructor(config: EditorConfig) {

    this.config = config;
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
    const pmPlugins = byPriority.flatMap((p) => p.setup?.(this) ?? []);
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
        const next = this.state.apply(tr);
        this.updateState(next);
        if (!editor.ready) return;
        editor.toolbar.update(next);
        if (tr.docChanged) config.onChange?.(editor.getHTML());
      },
    });

    const items = this.resolveToolbar(config);
    this.toolbar = new Toolbar(this, items);
    this.root.prepend(this.toolbar.el);
    this.toolbar.update(this.view.state);
    if (this.readOnly) this.root.classList.add('is-readonly');
    this.ready = true;
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
    if (this.readOnly && !this.readOnlySafe.has(name)) return false;
    const result = cmd(this, ...args);
    this.view.focus();
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
    this.view.destroy();
    this.root.remove();
  }

  private parseHTML(html: string) {
    const el = document.createElement('div');
    el.innerHTML = html;
    return DOMParser.fromSchema(this.schema).parse(el);
  }

  private resolveToolbar(config: EditorConfig): ToolbarItem[] {
    const all = config.plugins.flatMap((p) => p.toolbar ?? []);
    if (!config.toolbar) return all;
    const byName = new Map(all.map((i) => [i.name, i]));
    return config.toolbar.flatMap((n, i): ToolbarItem[] => {
      if (n === '|') return [{ type: 'separator', name: `sep-${i}` }];
      const item = byName.get(n);
      return item ? [item] : [];
    });
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
