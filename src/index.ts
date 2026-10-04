import './styles.css';
import { Editor, type EditorConfig } from './editor';
import { Pages, Outline, type PageOptions } from './plugins';
import { FindReplace, Alignment, Autoformat, Colors, Fonts, TaskList, BasicStyles, Blocks, Essentials, Heading, Image, Link, List, Table } from './plugins';

export { Editor } from './editor';
export type { EditorConfig } from './editor';
export type { EditorPlugin, ToolbarItem, Command } from './types';
export * from './plugins';

export const defaultPlugins = [Essentials, BasicStyles, Heading, Fonts, Alignment, Colors, List, TaskList, Blocks, Link, Image, Table, FindReplace, Autoformat];

/** Create an editor with the default feature set. */
export function createEditor(
  config: Omit<EditorConfig, 'plugins'> & {
    plugins?: EditorConfig['plugins'];
    /** Enable the paged (Google Docs-style) view. */
    pages?: boolean | PageOptions;
    /** Show the outline sidebar. */
    outline?: boolean;
  },
): Editor {
  const { pages, outline, ...rest } = config;
  const plugins = [...(rest.plugins ?? defaultPlugins)];
  if (pages) plugins.push(Pages(pages === true ? {} : pages));
  if (outline) plugins.push(Outline);
  return new Editor({ ...rest, plugins });
}
