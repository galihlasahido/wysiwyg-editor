import type { MarkSpec, NodeSpec } from 'prosemirror-model';
import type { EditorState, Plugin as PMPlugin, Transaction } from 'prosemirror-state';
import type { Editor } from './editor';
import type { RibbonGroup } from './ribbon';

export type Command = (editor: Editor, ...args: any[]) => boolean;

export interface ToolbarButton {
  type?: 'button';
  name: string;
  label: string;
  icon?: string;
  /** The command to execute. Give this or `run`. */
  command?: string;
  /** Call your own code instead of a command (handy for a one-off button in the toolbar config). */
  run?: (editor: Editor) => void;
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

/** A named cluster of items. It gets its own `role="group"` and a subtle divider. */
export interface ToolbarGroup {
  group: string;
  items: ToolbarEntry[];
}

/**
 * One entry of a toolbar layout:
 * - an item name from a plugin (`'bold'`),
 * - `'|'` a separator, `'-'` a new row, `'>'` a spacer that pushes everything after it to the far end,
 * - an item object you define yourself (`{ name, label, icon, run }`),
 * - a group of entries.
 */
export type ToolbarEntry = string | ToolbarItem | ToolbarGroup;

export interface ToolbarOptions {
  /** The layout, in order. Default: every plugin's items. */
  items?: ToolbarEntry[];
  /** Above the text (default) or below it. */
  position?: 'top' | 'bottom';
  /** Stay in view while the page scrolls. */
  sticky?: boolean;
  /** What happens when the items do not fit: wrap onto more rows (default), collapse into a "⋯" menu, or scroll sideways. */
  overflow?: 'wrap' | 'more' | 'scroll';
  /** Where the items sit in the bar. */
  align?: 'start' | 'center' | 'end';
  /** Item names to leave out of the default layout. */
  hide?: string[];
  /** Accessible name of the toolbar. */
  label?: string;
}

/** A feature module, similar to a CKEditor 5 plugin. */
export interface EditorPlugin {
  name: string;
  /** Higher runs first for keymaps/ProseMirror plugins. Default 0. */
  priority?: number;
  nodes?: Record<string, NodeSpec>;
  marks?: Record<string, MarkSpec>;
  /** Names of plugins that must also be installed. A missing one throws a clear error when the editor starts. */
  requires?: string[];
  /** Called once the schema is built. Returns ProseMirror plugins and may register commands. */
  setup?(editor: Editor): PMPlugin[] | void;
  /** Called once, after the editor is fully built (toolbar and view exist). */
  onReady?(editor: Editor): void;
  /** Called when the editor is destroyed: remove listeners, timers and DOM you added. */
  destroy?(editor: Editor): void;
  toolbar?: ToolbarItem[];
  /** Keyboard shortcuts: key (`'Mod-Shift-k'`) to a command name or a function. Runs before the base keymap. */
  keymap?: Record<string, string | ((editor: Editor) => boolean)>;
  /** Add a group (and, if needed, a tab) to the ribbon. */
  ribbon?: RibbonContribution | RibbonContribution[];
  /**
   * Rewrite a user transaction before it is applied (used by track changes). Not called for transactions
   * carrying the `wy-raw` meta, so a plugin can apply its own edits without re-entering itself.
   */
  transformTransaction?(tr: Transaction, state: EditorState): Transaction;
}

/** Where a plugin's controls go in the ribbon. The tab is created when it does not exist. */
export interface RibbonContribution {
  /** Tab id (`'home'`, `'insert'`, `'review'` … or your own). */
  tab: string;
  /** Label for a new tab. */
  tabLabel?: string;
  group: RibbonGroup;
  /** Put the group after / before this group id. Default: at the end of the tab. */
  after?: string;
  before?: string;
}

/** Identity helper that gives a plugin object full type checking and autocompletion. */
export function definePlugin<T extends EditorPlugin>(plugin: T): T {
  return plugin;
}

export type EditorEvent = 'ready' | 'change' | 'selection' | 'focus' | 'blur' | 'command' | 'destroy' | (string & {});
