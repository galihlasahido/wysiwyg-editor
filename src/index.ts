import './styles.css';
import { Editor, type EditorConfig } from './editor';
import { Pages, Outline, type PageOptions } from './plugins';
import { Office, ParagraphFormat, Direction, TableOfContents, Footnotes, SpellCheck, SpecialCharacters, FormatPainter, WordCount, FindReplace, Alignment, Autoformat, Colors, Fonts, TaskList, BasicStyles, Blocks, Essentials, Heading, Image, Link, List, Table } from './plugins';

export { Editor } from './editor';
export type { EditorConfig, DocxExportOptions } from './editor';
export type { EditorPlugin, ToolbarItem, ToolbarEntry, ToolbarGroup, ToolbarOptions, Command, RibbonContribution, EditorEvent } from './types';
export { definePlugin } from './types';
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
export { DocumentClient, ApiError, ConflictError, createHttpSaver, createEndpointSaver } from './storage';
export type { RemoteDocument, ShareRole, EndpointSaverOptions } from './storage';
export { registerLocale, translate, isRtlLocale } from './i18n';
export type { Locale } from './i18n';
export { openDialog, askDialog, avatar, avatarColor } from './dialog';
export type { AskOptions } from './dialog';
export { Ribbon, DEFAULT_RIBBON, applyContributions } from './ribbon';
export type { RibbonOptions, RibbonTab, RibbonGroup, RibbonControl } from './ribbon';
export { icon, ICONS, hasIcon, registerIcon } from './icons';
export * from './crop';
export { toEmailHTML, toEmailText } from './email';
export type { EmailOptions } from './email';
export { simpleHighlight, resolveLanguage } from './highlight';
export type { Highlighter, Token, TokenType } from './highlight';
export { CodeEditor, createCodeEditor, languageForFilename } from './code-editor';
export type { CodeEditorOptions, CodeFileInput } from './code-editor';
export { splitSlides } from './slides';
export type { Slide, SlideOptions } from './slides';
export { openFileManager, addFiles, rejectReason, matchesAccept, readImageSize, DEFAULT_BLOCKED } from './file-manager';
export type { FileManagerOptions } from './file-manager';
export { MemoryFileStore, IndexedDBFileStore, createFileStore, fileKind, cleanFileName, uniqueName, isRasterImage } from './files';
export type { FileStore, StoredFile, FileKind } from './files';
export { openImageEditor } from './image-editor';
export type { ImageEditorOptions, ImageEditResult } from './image-editor';
export { applyAdjustments, boxBlur, FILTER_PRESETS, NEUTRAL as NEUTRAL_ADJUSTMENTS, formatBytes } from './image-ops';
export type { Adjustments } from './image-ops';
export { cleanPastedHTML, isWordHTML, isGoogleDocsHTML, hasPasteableText } from './paste';
export { markerStyle } from './paste';
export { printDocument, buildPrintHTML, marginContent } from './print';
export type { PrintOptions } from './print';
