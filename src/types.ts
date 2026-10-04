import type { MarkSpec, NodeSpec } from 'prosemirror-model';
import type { EditorState, Plugin as PMPlugin, Transaction } from 'prosemirror-state';
import type { Editor } from './editor';

export type Command = (editor: Editor, ...args: any[]) => boolean;

export interface ToolbarButton {
  type?: 'button';
  name: string;
  label: string;
  icon?: string;
  command: string;
  args?: any[];
  isActive?: (state: EditorState) => boolean;
}

export interface ToolbarSelect {
  type: 'select';
  name: string;
  label: string;
  options: { label: string; value: string }[];
  command: string;
  getValue: (state: EditorState) => string;
}

export interface ToolbarSeparator {
  type: 'separator';
  name: string;
}

export type ToolbarItem = ToolbarButton | ToolbarSelect | ToolbarSeparator;

/** A feature module, similar to a CKEditor 5 plugin. */
export interface EditorPlugin {
  name: string;
  /** Higher runs first for keymaps/ProseMirror plugins. Default 0. */
  priority?: number;
  nodes?: Record<string, NodeSpec>;
  marks?: Record<string, MarkSpec>;
  /** Called once the schema is built. Returns ProseMirror plugins and may register commands. */
  setup?(editor: Editor): PMPlugin[] | void;
  toolbar?: ToolbarItem[];
  /**
   * Rewrite a user transaction before it is applied (used by track changes). Not called for transactions
   * carrying the `wy-raw` meta, so a plugin can apply its own edits without re-entering itself.
   */
  transformTransaction?(tr: Transaction, state: EditorState): Transaction;
}
