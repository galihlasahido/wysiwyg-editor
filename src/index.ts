import './styles.css';
import { Editor, type EditorConfig } from './editor';
import { Alignment, Autoformat, Colors, Fonts, TaskList, BasicStyles, Blocks, Essentials, Heading, Image, Link, List, Table } from './plugins';

export { Editor } from './editor';
export type { EditorConfig } from './editor';
export type { EditorPlugin, ToolbarItem, Command } from './types';
export * from './plugins';

export const defaultPlugins = [Essentials, BasicStyles, Heading, Fonts, Alignment, Colors, List, TaskList, Blocks, Link, Image, Table, Autoformat];

/** Create an editor with the default feature set. */
export function createEditor(config: Omit<EditorConfig, 'plugins'> & { plugins?: EditorConfig['plugins'] }): Editor {
  return new Editor({ ...config, plugins: config.plugins ?? defaultPlugins });
}
