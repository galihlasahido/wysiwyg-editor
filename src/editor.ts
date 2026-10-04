import { DOMParser, DOMSerializer, Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Toolbar } from './toolbar';
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
  readonly uploadImage: (file: File) => Promise<string>;
  private commands = new Map<string, Command>();
  

  constructor(config: EditorConfig) {

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
    const pmPlugins = byPriority.flatMap((p) => p.setup?.(this) ?? []);
    const doc = this.parseHTML(config.content ?? '');
    const state = EditorState.create({ doc, plugins: pmPlugins });

    this.view = new EditorView(content, {
      state,
      attributes: { 'data-placeholder': config.placeholder ?? '' },
      dispatchTransaction: (tr) => {
        const next = this.view.state.apply(tr);
        this.view.updateState(next);
        this.toolbar.update(next);
        if (tr.docChanged) config.onChange?.(this.getHTML());
      },
    });

    const items = this.resolveToolbar(config);
    this.toolbar = new Toolbar(this, items);
    this.root.prepend(this.toolbar.el);
    this.toolbar.update(this.view.state);
  }

  registerCommand(name: string, command: Command): void {
    this.commands.set(name, command);
  }

  execute(name: string, ...args: any[]): boolean {
    const cmd = this.commands.get(name);
    if (!cmd) throw new Error(`Unknown command: ${name}`);
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

  setHTML(html: string): void {
    const doc = this.parseHTML(html);
    const state = EditorState.create({ doc, plugins: this.view.state.plugins });
    this.view.updateState(state);
    this.toolbar.update(state);
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
