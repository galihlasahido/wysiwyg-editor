import './styles.css';
import { Editor, type EditorConfig } from './editor';
import { Pages, Outline, type PageOptions } from './plugins';
import { Office, ParagraphFormat, Direction, TableOfContents, Footnotes, SpellCheck, SpecialCharacters, FormatPainter, WordCount, FindReplace, Alignment, Autoformat, Colors, Fonts, TaskList, BasicStyles, Blocks, Essentials, Heading, Image, Link, List, Table } from './plugins';

export { Editor } from './editor';
export type { EditorConfig } from './editor';
export type { EditorPlugin, ToolbarItem, Command } from './types';
export * from './plugins';

export const defaultPlugins = [Essentials, BasicStyles, Heading, Fonts, Alignment, Colors, List, TaskList, Blocks, Link, Image, Table, FindReplace, WordCount, SpecialCharacters, FormatPainter, Footnotes, TableOfContents, SpellCheck(), Direction, ParagraphFormat, Office, Autoformat];

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
export { exportHTML, download } from './export';
export type { PageSettings } from './plugins/pages';
export { DocumentClient, ApiError, ConflictError, createHttpSaver } from './storage';
export type { RemoteDocument, ShareRole } from './storage';
export { registerLocale, translate, isRtlLocale } from './i18n';
export type { Locale } from './i18n';
export { openDialog } from './dialog';
export { Ribbon, DEFAULT_RIBBON } from './ribbon';
export type { RibbonOptions, RibbonTab, RibbonGroup, RibbonControl } from './ribbon';
export { icon, ICONS, hasIcon } from './icons';
export * from './crop';
export { toEmailHTML, toEmailText } from './email';
export type { EmailOptions } from './email';
export { simpleHighlight, resolveLanguage } from './highlight';
export type { Highlighter, Token, TokenType } from './highlight';
export { CodeEditor, createCodeEditor, languageForFilename } from './code-editor';
export type { CodeEditorOptions, CodeFileInput } from './code-editor';
export { splitSlides } from './slides';
export type { Slide, SlideOptions } from './slides';
