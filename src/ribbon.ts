import { NodeSelection, type EditorState } from 'prosemirror-state';
import type { Editor } from './editor';
import { hasIcon, icon } from './icons';
import { SPECIAL_CHARACTERS } from './plugins/special-characters';
import { restrictedKey } from './plugins/restricted-editing';
import { runToolbarItem } from './toolbar';
import type { RibbonContribution, ToolbarItem } from './types';

// ---- layout description ---------------------------------------------------------------------------------------

type Size = 'large' | 'small';
export interface MenuEntry { label: string; command?: string; args?: unknown[]; icon?: string; checked?: (e: Editor) => boolean; heading?: boolean }

/** One control in a ribbon group. Controls whose command (or toolbar item) is not available are hidden. */
export type RibbonControl =
  /** A button backed by a plugin's toolbar item (keeps its command, arguments and active state). */
  | { kind: 'item'; item: string; label?: string; size?: Size; iconOnly?: boolean; icon?: string }
  | { kind: 'command'; id: string; command: string; args?: unknown[]; label: string; icon: string; size?: Size; iconOnly?: boolean; active?: (e: Editor) => boolean }
  | { kind: 'menu'; id: string; label: string; icon: string; need: string; size?: Size; iconOnly?: boolean; entries: (e: Editor) => MenuEntry[] }
  | { kind: 'palette'; id: string; label: string; icon: string; command: string; colors: string[]; none: string; size?: Size; iconOnly?: boolean }
  | { kind: 'chars'; id: string; label: string; icon: string; need: string; chars: string[]; size?: Size }
  | { kind: 'select'; item: string; width?: number }
  | { kind: 'zoom' }
  | { kind: 'spin'; id: string; label: string; icon?: string; command: string; get: (s: EditorState) => number; set: (v: number) => unknown; min: number; max: number; step: number; unit: string; /** `set` returns the full argument list instead of one argument. */ spread?: boolean }
  | { kind: 'stack'; controls: RibbonControl[] }
  | { kind: 'row'; controls: RibbonControl[] };

export interface RibbonGroup { id: string; label: string; controls: RibbonControl[] }
export interface RibbonTab {
  id: string;
  label: string;
  groups: RibbonGroup[];
  /** Contextual tabs only appear while this is true (e.g. table tools while the cursor is in a table). */
  when?: (state: EditorState) => boolean;
}
export interface RibbonOptions {
  tabs?: RibbonTab[];
  /** Final say over the tabs (after plugin contributions): add, remove, reorder or rename tabs, groups and controls. */
  customize?: (tabs: RibbonTab[]) => RibbonTab[];
  /** File tab actions that need optional packages are supplied by the app. */
  onOpenDocx?: () => void;
  onExportDocx?: () => void;
  /** Tab to show first. Default 'home'. */
  initialTab?: string;
}

const CM = 96 / 2.54;
const inTable = (s: EditorState) => {
  const { $from } = s.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') return true;
  return false;
};
const imageSelected = (s: EditorState) => s.selection instanceof NodeSelection && s.selection.node.type.name === 'image';
const block = (s: EditorState) => s.selection.$from.parent.attrs as Record<string, number | null>;
const flagOn = (cls: string) => (e: Editor) => !e.root.classList.contains(cls);
const panelOpen = (sel: string) => (e: Editor) => !!e.root.querySelector(`${sel}:not([hidden])`);
const cmd = (id: string, command: string, label: string, ic: string, extra: Partial<Extract<RibbonControl, { kind: 'command' }>> = {}): RibbonControl => ({ kind: 'command', id, command, label, icon: ic, ...extra });
const it = (item: string, extra: Partial<Extract<RibbonControl, { kind: 'item' }>> = {}): RibbonControl => ({ kind: 'item', item, ...extra });

const TEXT_COLORS = ['#000000', '#e03131', '#e8590c', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#868e96', '#c92a2a', '#74b816', '#0b7285', '#a61e4d'];
const HIGHLIGHTS = ['#fff3bf', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#d0bfff', '#ffd8a8', '#c3fae8', '#e9ecef'];
const PAGE_COLORS = ['#ffffff', '#fff9db', '#e7f5ff', '#ebfbee', '#fff0f6', '#f8f9fa'];
const EMOJI = ['😀', '😂', '😊', '😍', '😎', '🤔', '👍', '👎', '👏', '🙏', '🎉', '🔥', '⭐', '❤️', '✅', '❌', '⚠️', '💡', '📌', '📎', '📅', '🚀', '💬', '🔒'];
const sizes = (name: string, list: [string, string][]): MenuEntry[] => list.map(([label, value]) => ({ label, command: name, args: [value] }));

/** The default tabs, modelled on a word processor ribbon. Controls whose plugin is not installed are skipped. */
/** Insert the groups plugins contribute (creating tabs as needed) into a copy of `tabs`. */
export function applyContributions(tabs: RibbonTab[], plugins: { name: string; ribbon?: RibbonContribution | RibbonContribution[] }[]): RibbonTab[] {
  const out = tabs.map((t) => ({ ...t, groups: [...t.groups] }));
  for (const p of plugins) {
    for (const c of p.ribbon ? [p.ribbon].flat() : []) {
      let tab = out.find((t) => t.id === c.tab);
      if (!tab) {
        tab = { id: c.tab, label: c.tabLabel ?? c.tab, groups: [] };
        const view = out.findIndex((t) => t.id === 'view');
        if (view >= 0) out.splice(view, 0, tab); // before View, Help …: custom tabs sit with the main ones
        else out.push(tab);
      }
      const at = (id?: string) => (id ? tab!.groups.findIndex((g) => g.id === id) : -1);
      const after = at(c.after);
      const before = at(c.before);
      if (after >= 0) tab.groups.splice(after + 1, 0, c.group);
      else if (before >= 0) tab.groups.splice(before, 0, c.group);
      else tab.groups.push(c.group);
    }
  }
  return out;
}

export const DEFAULT_RIBBON: RibbonTab[] = [
  {
    id: 'file',
    label: 'File',
    groups: [
      { id: 'new', label: 'New', controls: [cmd('new', 'newDocument', 'New', 'newDocument', { size: 'large' }), it('versions', { size: 'large', label: 'Version history', icon: 'versions' })] },
      { id: 'export', label: 'Export', controls: [cmd('html', 'exportHtml', 'HTML', 'export', { size: 'large' }), cmd('md', 'exportMarkdown', 'Markdown', 'export', { size: 'large' }), cmd('opendocx', 'openDocx', 'Open .docx', 'openFile', { size: 'large' }), cmd('docx', 'exportDocx', 'Export .docx', 'export', { size: 'large' }), it('print', { size: 'large', label: 'Print / PDF', icon: 'print' })] },
    ],
  },
  {
    id: 'home',
    label: 'Home',
    groups: [
      { id: 'undo', label: 'Undo', controls: [{ kind: 'stack', controls: [it('undo', { iconOnly: true }), it('redo', { iconOnly: true })] }] },
      {
        id: 'clipboard',
        label: 'Clipboard',
        controls: [cmd('paste', 'paste', 'Paste', 'paste', { size: 'large' }), { kind: 'stack', controls: [cmd('cut', 'cut', 'Cut', 'cut'), cmd('copy', 'copy', 'Copy', 'copy'), it('formatPainter', { label: 'Format Painter', icon: 'formatPainter' })] }],
      },
      {
        id: 'font',
        label: 'Font',
        controls: [
          {
            kind: 'stack',
            controls: [
              { kind: 'row', controls: [{ kind: 'select', item: 'fontFamily', width: 128 }, { kind: 'select', item: 'fontSize', width: 56 }, cmd('grow', 'fontSizeStep', 'Increase font size', 'fontGrow', { args: [1], iconOnly: true }), cmd('shrink', 'fontSizeStep', 'Decrease font size', 'fontShrink', { args: [-1], iconOnly: true }), cmd('clear', 'clearFormatting', 'Clear all formatting', 'clearFormatting', { iconOnly: true })] },
              {
                kind: 'row',
                controls: [it('bold', { iconOnly: true }), it('italic', { iconOnly: true }), it('underline', { iconOnly: true }), it('strike', { iconOnly: true }), it('subscript', { iconOnly: true, icon: 'subscript' }), it('superscript', { iconOnly: true, icon: 'superscript' }), { kind: 'palette', id: 'textColor', label: 'Font color', icon: 'textColor', command: 'textColor', colors: TEXT_COLORS, none: 'Automatic', iconOnly: true }, { kind: 'palette', id: 'highlight', label: 'Text highlight color', icon: 'highlight', command: 'highlight', colors: HIGHLIGHTS, none: 'No color', iconOnly: true }],
              },
            ],
          },
        ],
      },
      {
        id: 'paragraph',
        label: 'Paragraph',
        controls: [
          {
            kind: 'stack',
            controls: [
              { kind: 'row', controls: [it('bulletList', { iconOnly: true }), it('orderedList', { iconOnly: true }), it('taskList', { iconOnly: true }), cmd('outdent', 'indentLess', 'Decrease indent', 'outdent', { iconOnly: true }), cmd('indent', 'indentMore', 'Increase indent', 'indent', { iconOnly: true }), it('direction-ltr', { iconOnly: true }), it('direction-rtl', { iconOnly: true })] },
              {
                kind: 'row',
                controls: [it('align-left', { iconOnly: true }), it('align-center', { iconOnly: true }), it('align-right', { iconOnly: true }), it('align-justify', { iconOnly: true }), { kind: 'menu', id: 'lineSpacing', label: 'Line spacing', icon: 'lineSpacing', need: 'lineHeight', iconOnly: true, entries: () => ['1', '1.15', '1.5', '2', '2.5', '3'].map((v) => ({ label: v, command: 'lineHeight', args: [v] })) }],
              },
            ],
          },
        ],
      },
      { id: 'styles', label: 'Styles', controls: [{ kind: 'stack', controls: [{ kind: 'select', item: 'heading', width: 140 }, { kind: 'row', controls: [it('blockQuote', { iconOnly: true }), it('codeBlock', { iconOnly: true }), it('code', { iconOnly: true })] }] }] },
      { id: 'editing', label: 'Editing', controls: [{ kind: 'stack', controls: [it('find', { label: 'Find', icon: 'find' }), cmd('replace', 'toggleFind', 'Replace', 'replace'), cmd('select', 'selectAll', 'Select all', 'selectAll')] }] },
    ],
  },
  {
    id: 'insert',
    label: 'Insert',
    groups: [
      { id: 'pages', label: 'Pages', controls: [it('pageBreak', { size: 'large', label: 'Page Break', icon: 'pageBreak' })] },
      { id: 'tables', label: 'Tables', controls: [{ kind: 'menu', id: 'table', label: 'Table', icon: 'insertTable', need: 'insertTable', size: 'large', entries: () => [2, 3, 4, 5].map((n) => ({ label: `${n} × ${n} table`, command: 'insertTable', args: [n, n] })).concat([{ label: '3 × 6 table', command: 'insertTable', args: [3, 6] }]) }] },
      {
        id: 'illustrations',
        label: 'Illustrations',
        controls: [{ kind: 'menu', id: 'picture', label: 'Picture', icon: 'image', need: 'image', size: 'large', entries: () => [{ label: 'Upload from device…', command: 'uploadImage', icon: 'uploadImage' }, { label: 'From URL…', command: 'image', icon: 'link' }, { label: 'From the file library…', command: 'openFiles', icon: 'folder' }, { label: 'Diagram (Mermaid)…', command: 'insertMermaid', icon: 'mermaid' }] }],
      },
      { id: 'equations', label: 'Equations', controls: [{ kind: 'menu', id: 'equation', label: 'Equation', icon: 'equation', need: 'insertMath', size: 'large', entries: () => [{ label: 'Inline equation…', command: 'insertMath', icon: 'equation' }, { label: 'Display equation…', command: 'insertMathBlock', icon: 'equation' }] }] },
      { id: 'links', label: 'Links', controls: [it('link', { size: 'large', label: 'Link', icon: 'link' })] },
      { id: 'toc', label: 'Table of Contents', controls: [it('toc', { size: 'large', label: 'Table of Contents', icon: 'toc' })] },
      { id: 'comments', label: 'Comments', controls: [it('comment', { size: 'large', label: 'New Comment', icon: 'comment' })] },
      {
        id: 'hf',
        label: 'Header & Footer',
        controls: [
          cmd('hf', 'headerFooterDialog', 'Header & Footer', 'headerFooter', { size: 'large' }),
          { kind: 'menu', id: 'pageNumber', label: 'Page Numbers', icon: 'pageNumber', need: 'pageNumberPreset', size: 'large', entries: () => [{ label: 'Bottom of page', heading: true }, { label: 'Page 1', command: 'pageNumberPreset', args: ['bottom'] }, { label: 'Page 1 of N', command: 'pageNumberPreset', args: ['bottom-total'] }, { label: 'Top of page', heading: true }, { label: 'Page 1', command: 'pageNumberPreset', args: ['top'] }, { label: 'Remove page numbers', command: 'pageNumberPreset', args: ['none'] }] },
        ],
      },
      { id: 'blocks', label: 'Blocks', controls: [{ kind: 'stack', controls: [it('horizontalRule', { label: 'Horizontal line', icon: 'horizontalRule' }), it('blockQuote', { label: 'Quote', icon: 'blockQuote' }), it('codeBlock', { label: 'Code block', icon: 'codeBlock' })] }] },
      { id: 'symbols', label: 'Symbols', controls: [{ kind: 'chars', id: 'symbol', label: 'Symbol', icon: 'specialCharacters', need: 'insertText', chars: SPECIAL_CHARACTERS, size: 'large' }] },
      { id: 'emoji', label: 'Emojis', controls: [{ kind: 'chars', id: 'emoji', label: 'Emoji', icon: 'emoji', need: 'insertText', chars: EMOJI, size: 'large' }] },
    ],
  },
  {
    id: 'layout',
    label: 'Layout',
    groups: [
      {
        id: 'setup',
        label: 'Page Setup',
        controls: [
          { kind: 'menu', id: 'margins', label: 'Margins', icon: 'margins', need: 'pageMarginPreset', size: 'large', entries: () => [['Normal', 'normal'], ['Narrow', 'narrow'], ['Moderate', 'moderate'], ['Wide', 'wide']].map(([label, v]) => ({ label, command: 'pageMarginPreset', args: [v] })) },
          { kind: 'menu', id: 'orientation', label: 'Orientation', icon: 'orientation', need: 'pageOrientation', size: 'large', entries: () => sizes('pageOrientation', [['Portrait', 'portrait'], ['Landscape', 'landscape']]) },
          { kind: 'menu', id: 'size', label: 'Size', icon: 'size', need: 'pageSize', size: 'large', entries: () => sizes('pageSize', [['A4', 'a4'], ['Letter', 'letter'], ['Legal', 'legal']]) },
          { kind: 'menu', id: 'breaks', label: 'Breaks', icon: 'pageBreak', need: 'pageBreak', size: 'large', entries: () => [{ label: 'Page break', command: 'pageBreak', icon: 'pageBreak' }] },
        ],
      },
      {
        id: 'para',
        label: 'Paragraph',
        controls: [
          { kind: 'stack', controls: [
            { kind: 'spin', id: 'indentLeft', label: 'Left', icon: 'indentLeft', command: 'paragraphIndent', get: (s) => Math.round(((block(s).indentLeft as number) ?? 0) / CM * 10) / 10, set: (v) => ({ left: Math.round(v * CM) }), min: 0, max: 20, step: 0.5, unit: 'cm' },
            { kind: 'spin', id: 'indentRight', label: 'Right', icon: 'indentRight', command: 'paragraphIndent', get: (s) => Math.round(((block(s).indentRight as number) ?? 0) / CM * 10) / 10, set: (v) => ({ right: Math.round(v * CM) }), min: 0, max: 20, step: 0.5, unit: 'cm' },
          ] },
          { kind: 'stack', controls: [
            { kind: 'spin', id: 'spaceBefore', label: 'Before', icon: 'spacingBefore', command: 'paragraphSpacing', get: (s) => (block(s).spaceBefore as number) ?? 0, set: (v) => ({ before: v }), min: 0, max: 100, step: 6, unit: 'pt' },
            { kind: 'spin', id: 'spaceAfter', label: 'After', icon: 'spacingAfter', command: 'paragraphSpacing', get: (s) => (block(s).spaceAfter as number) ?? 0, set: (v) => ({ after: v }), min: 0, max: 100, step: 6, unit: 'pt' },
          ] },
        ],
      },
      { id: 'background', label: 'Page Background', controls: [{ kind: 'palette', id: 'pageColor', label: 'Page Color', icon: 'pageColor', command: 'pageColor', colors: PAGE_COLORS, none: 'Automatic', size: 'large' }] },
    ],
  },
  {
    id: 'references',
    label: 'References',
    groups: [
      { id: 'toc', label: 'Table of Contents', controls: [it('toc', { size: 'large', label: 'Insert Table of Contents', icon: 'toc' }), { kind: 'stack', controls: [cmd('updateToc', 'updateToc', 'Update Table', 'updateToc'), cmd('removeToc', 'removeToc', 'Remove Table', 'removeToc')] }] },
      { id: 'notes', label: 'Footnotes', controls: [it('footnote', { size: 'large', label: 'Insert Footnote', icon: 'footnote' }), { kind: 'stack', controls: [cmd('endnote', 'footnote', 'Insert Endnote', 'endnote')] }] },
    ],
  },
  {
    id: 'review',
    label: 'Review',
    groups: [
      { id: 'proofing', label: 'Proofing', controls: [it('spellcheck', { size: 'large', label: 'Spelling', icon: 'spellcheck' }), cmd('wordCount', 'showWordCount', 'Word Count', 'wordCount', { size: 'large' })] },
      { id: 'ai', label: 'AI', controls: [{ kind: 'menu', id: 'ai', label: 'AI Assistant', icon: 'ai', need: 'ai', size: 'large', entries: (e) => ((e.extensions.aiActions as { id: string; label: string }[]) ?? []).map((a) => ({ label: a.label, command: 'ai', args: [a.id] })) }] },
      {
        id: 'comments',
        label: 'Comments',
        controls: [
          it('comment', { size: 'large', label: 'New Comment', icon: 'comment' }),
          { kind: 'stack', controls: [cmd('prevComment', 'prevComment', 'Previous', 'commentPrev'), cmd('nextComment', 'nextComment', 'Next', 'commentNext'), cmd('deleteComment', 'deleteCurrentComment', 'Delete', 'commentDelete')] },
          cmd('showComments', 'toggleComments', 'Show Comments', 'showComments', { size: 'large', active: panelOpen('.wy-comments') }),
        ],
      },
      {
        id: 'tracking',
        label: 'Tracking',
        controls: [
          it('trackChanges', { size: 'large', label: 'Track Changes', icon: 'trackChanges' }),
          { kind: 'menu', id: 'accept', label: 'Accept', icon: 'acceptChange', need: 'acceptChange', size: 'large', entries: () => [{ label: 'Accept change', command: 'acceptChange' }, { label: 'Accept all changes', command: 'acceptAll' }] },
          { kind: 'menu', id: 'reject', label: 'Reject', icon: 'rejectChange', need: 'rejectChange', size: 'large', entries: () => [{ label: 'Reject change', command: 'rejectChange' }, { label: 'Reject all changes', command: 'rejectAll' }] },
          { kind: 'stack', controls: [cmd('prevChange', 'prevChange', 'Previous', 'prevChange'), cmd('nextChange', 'nextChange', 'Next', 'nextChange')] },
        ],
      },
      { id: 'history', label: 'History', controls: [it('versions', { size: 'large', label: 'Versions', icon: 'versions' })] },
    ],
  },
  {
    id: 'view',
    label: 'View',
    groups: [
      { id: 'views', label: 'Document Views', controls: [cmd('pages', 'togglePages', 'Separate Pages', 'pages', { size: 'large', active: (e) => e.root.classList.contains('wy-paged') }), cmd('reading', 'toggleReadingView', 'Reading View', 'readView', { size: 'large', active: (e) => e.root.classList.contains('wy-reading') })] },
      { id: 'zoom', label: 'Zoom', controls: [{ kind: 'zoom' }, cmd('zoom100', 'setZoom', '100%', 'zoom100', { args: [100], size: 'large' })] },
      {
        id: 'show',
        label: 'Show',
        controls: [
          cmd('ruler', 'toggleRuler', 'Ruler', 'ruler', { size: 'large', active: flagOn('wy-hide-ruler') }),
          cmd('nav', 'toggleOutline', 'Navigation', 'navigation', { size: 'large', active: panelOpen('.wy-outline') }),
          cmd('hfv', 'toggleHeaderFooterVisibility', 'Header & Footer', 'showHeaderFooter', { size: 'large', active: flagOn('wy-hide-headerfooter') }),
          cmd('fnv', 'toggleFootnotesVisibility', 'Footnotes', 'showFootnotes', { size: 'large', active: flagOn('wy-hide-footnotes') }),
        ],
      },
      { id: 'dark', label: 'Dark Mode', controls: [cmd('theme', 'toggleTheme', 'Dark Mode', 'darkMode', { size: 'large', active: (e) => e.theme === 'dark' }), cmd('bg', 'togglePageBackground', 'Switch Background', 'switchBackground', { size: 'large' })] },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    groups: [{ id: 'help', label: 'Help', controls: [cmd('shortcuts', 'showShortcuts', 'Keyboard Shortcuts', 'keyboard', { size: 'large' }), cmd('about', 'showAbout', 'About', 'help', { size: 'large' })] }],
  },
  {
    id: 'restrict',
    label: 'Restrict',
    when: (s) => !!restrictedKey.getState(s)?.controls,
    groups: [
      { id: 'authoring', label: 'Template', controls: [cmd('authorMode', 'toggleAuthorMode', 'Author mode', 'authorMode', { size: 'large', active: (e) => !!(e.extensions.restricted as { isAuthor(): boolean } | undefined)?.isAuthor() })] },
      { id: 'locking', label: 'Locked sections', controls: [cmd('lock', 'lockBlocks', 'Lock blocks', 'lock', { size: 'large' }), cmd('unlock', 'unlockBlocks', 'Unlock', 'unlock', { size: 'large' })] },
      { id: 'regions', label: 'Fill-in regions', controls: [cmd('region', 'insertEditableRegion', 'Make fill-in', 'editRegion', { size: 'large' }), cmd('unregion', 'removeEditableRegion', 'Remove fill-in', 'editRegion', { size: 'large' })] },
    ],
  },
  {
    id: 'picture',
    label: 'Picture',
    when: imageSelected,
    groups: [
      { id: 'imgedit', label: 'Edit', controls: [cmd('editImg', 'editImage', 'Edit image', 'imageEdit', { size: 'large' })] },
      { id: 'crop', label: 'Crop', controls: [it('cropImage', { size: 'large', label: 'Crop', icon: 'crop' }), cmd('resetCrop', 'resetCrop', 'Reset crop', 'cropReset', { size: 'large' })] },
      {
        id: 'imgsize',
        label: 'Size',
        controls: [
          { kind: 'spin', id: 'imageWidth', label: 'Width', icon: 'size', command: 'imageWidth', get: (s) => (imageSelected(s) ? ((s.selection as NodeSelection).node.attrs.width ?? 0) : 0), set: (v) => [v], min: 24, max: 2000, step: 10, unit: 'px', spread: true },
        ],
      },
      { id: 'imgtext', label: 'Text', controls: [it('imageCaption', { size: 'large', label: 'Caption', icon: 'imageCaption' }), it('imageAlt', { size: 'large', label: 'Alt Text', icon: 'alt' })] },
    ],
  },
  {
    id: 'table',
    label: 'Table',
    when: inTable,
    groups: [
      { id: 'rows', label: 'Rows & Columns', controls: [it('addRow', { size: 'large', label: 'Insert Row', icon: 'addRow' }), it('addColumn', { size: 'large', label: 'Insert Column', icon: 'addColumn' }), { kind: 'stack', controls: [it('deleteRow', { label: 'Delete Row', icon: 'deleteRow' }), it('deleteColumn', { label: 'Delete Column', icon: 'deleteColumn' }), it('deleteTable', { label: 'Delete Table', icon: 'deleteTable' })] }] },
      { id: 'merge', label: 'Merge', controls: [it('mergeCells', { size: 'large', label: 'Merge Cells', icon: 'mergeCells' }), it('splitCell', { size: 'large', label: 'Split Cell', icon: 'splitCell' })] },
      { id: 'style', label: 'Table Style', controls: [it('toggleHeaderRow', { size: 'large', label: 'Header Row', icon: 'toggleHeaderRow' }), { kind: 'palette', id: 'shading', label: 'Shading', icon: 'cellColor', command: 'cellColor', colors: ['#fff3bf', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#e5e7eb', '#d0bfff'], none: 'No shading', size: 'large' }] },
    ],
  },
];

// ---- the component ---------------------------------------------------------------------------------------------

export class Ribbon {
  readonly el = document.createElement('div');
  private tabsEl = document.createElement('div');
  /** Only role=tab children belong in a tablist; the collapse button lives beside it. */
  private tablist = document.createElement('div');
  private panels = new Map<string, HTMLElement>();
  private tabButtons = new Map<string, HTMLButtonElement>();
  private updaters: ((state: EditorState) => void)[] = [];
  private items = new Map<string, ToolbarItem>();
  private tabs: RibbonTab[];
  private current: string;
  private collapsed = false;
  private openMenu: { el: HTMLElement; anchor: HTMLElement } | null = null;
  private onDocPointer = (e: Event) => {
    if (this.openMenu && !this.openMenu.el.contains(e.target as Node) && !this.openMenu.anchor.contains(e.target as Node)) this.closeMenu();
  };

  constructor(private editor: Editor, options: RibbonOptions = {}) {
    const merged = applyContributions(options.tabs ?? DEFAULT_RIBBON, editor.config.plugins);
    this.tabs = options.customize ? options.customize(merged) : merged;
    // .docx needs optional packages, so the app supplies the actions; without them the buttons stay hidden.
    if (options.onOpenDocx) editor.registerCommand('openDocx', () => (options.onOpenDocx!(), true));
    if (options.onExportDocx) editor.registerCommand('exportDocx', () => (options.onExportDocx!(), true), { readOnlySafe: true });
    for (const p of editor.config.plugins) for (const i of p.toolbar ?? []) this.items.set(i.name, i);

    this.el.className = 'wy-ribbon';
    this.tabsEl.className = 'wy-tabs';
    this.tablist.className = 'wy-tablist';
    this.tablist.setAttribute('role', 'tablist');
    this.tablist.setAttribute('aria-label', editor.t('ribbon', 'Ribbon'));
    this.tabsEl.append(this.tablist);
    this.el.append(this.tabsEl);
    this.current = options.initialTab ?? 'home';

    for (const tab of this.tabs) {
      const panel = this.buildPanel(tab);
      if (!panel) continue; // nothing in it is available
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wy-tab';
      btn.id = `wy-tab-${tab.id}`;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-controls', `wy-panel-${tab.id}`);
      btn.textContent = editor.t(`tab.${tab.id}`, tab.label);
      btn.addEventListener('click', () => this.select(tab.id, true));
      btn.addEventListener('dblclick', () => this.setCollapsed(!this.collapsed));
      btn.addEventListener('keydown', (e) => this.tabKeys(e));
      this.tablist.append(btn);
      this.tabButtons.set(tab.id, btn);
      panel.id = `wy-panel-${tab.id}`;
      panel.setAttribute('role', 'toolbar');
      panel.setAttribute('aria-labelledby', btn.id);
      this.panels.set(tab.id, panel);
      this.el.append(panel);
      this.rovingTabindex(panel);
    }
    const spacer = document.createElement('span');
    spacer.className = 'wy-tabs-spacer';
    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className = 'wy-rbtn wy-rbtn-small is-icon';
    collapse.title = editor.t('collapseRibbon', 'Collapse the ribbon');
    collapse.setAttribute('aria-label', collapse.title);
    collapse.innerHTML = icon('chevron', 14);
    collapse.addEventListener('click', () => this.setCollapsed(!this.collapsed));
    this.tabsEl.append(spacer, collapse);

    if (!this.panels.has(this.current)) this.current = [...this.panels.keys()][0];
    this.select(this.current);
    document.addEventListener('pointerdown', this.onDocPointer, true);
    editor.root.addEventListener('keydown', (e) => e.key === 'Escape' && this.closeMenu());
  }

  destroy(): void {
    document.removeEventListener('pointerdown', this.onDocPointer, true);
    this.closeMenu();
  }

  update(state: EditorState): void {
    for (const u of this.updaters) u(state);
    for (const tab of this.tabs) {
      const btn = this.tabButtons.get(tab.id);
      if (btn && tab.when) btn.hidden = !tab.when(state);
    }
    // A contextual tab that disappears hands over to Home.
    const cur = this.tabs.find((t) => t.id === this.current);
    if (cur?.when && !cur.when(state)) this.select('home');
  }

  // ---- tabs

  private select(id: string, focusPanel = false): void {
    if (!this.panels.has(id)) return;
    this.current = id;
    for (const [tid, panel] of this.panels) panel.hidden = tid !== id || this.collapsed;
    for (const [tid, btn] of this.tabButtons) {
      const on = tid === id;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
    if (this.collapsed && focusPanel) this.setCollapsed(false);
  }

  private setCollapsed(v: boolean): void {
    this.collapsed = v;
    this.select(this.current);
  }

  private tabKeys(e: KeyboardEvent): void {
    const visible = [...this.tabButtons.entries()].filter(([, b]) => !b.hidden);
    const i = visible.findIndex(([id]) => id === this.current);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? visible.length - 1 : null;
    if (next === null || !visible.length) return;
    e.preventDefault();
    const [id, btn] = visible[(next + visible.length) % visible.length];
    this.select(id);
    btn.focus();
  }

  /** One tab stop per panel; arrow keys move between its controls. */
  private rovingTabindex(panel: HTMLElement): void {
    const controls = () => [...panel.querySelectorAll<HTMLElement>('button, select, input')].filter((c) => !c.hasAttribute('disabled') && !c.closest('[hidden]'));
    controls().forEach((c, i) => (c.tabIndex = i === 0 ? 0 : -1));
    panel.addEventListener('focusin', (e) => controls().forEach((c) => (c.tabIndex = c === e.target ? 0 : -1)));
    panel.addEventListener('keydown', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || (target.tagName === 'SELECT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown'))) return;
      const list = controls();
      const i = list.indexOf(target);
      const rtl = getComputedStyle(panel).direction === 'rtl';
      const next = e.key === (rtl ? 'ArrowLeft' : 'ArrowRight') ? i + 1 : e.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : null;
      if (i < 0 || next === null) return;
      e.preventDefault();
      list[(next + list.length) % list.length].focus();
    });
  }

  // ---- building

  private buildPanel(tab: RibbonTab): HTMLElement | null {
    const panel = document.createElement('div');
    panel.className = 'wy-panel';
    let any = false;
    for (const g of tab.groups) {
      const body = document.createElement('div');
      body.className = 'wy-group-body';
      for (const c of g.controls) {
        const node = this.control(c);
        if (node) body.append(node);
      }
      if (!body.childElementCount) continue;
      any = true;
      const group = document.createElement('div');
      group.className = 'wy-group';
      group.setAttribute('role', 'group');
      const label = document.createElement('div');
      label.className = 'wy-group-label';
      label.textContent = this.editor.t(`group.${g.id}`, g.label);
      group.setAttribute('aria-label', label.textContent);
      group.append(body, label);
      panel.append(group);
    }
    return any ? panel : null;
  }

  private label(id: string, fallback: string): string {
    return this.editor.t(`r.${id}`, fallback);
  }

  private control(c: RibbonControl, defaultSize?: Size): HTMLElement | null {
    const ed = this.editor;
    switch (c.kind) {
      case 'stack':
      case 'row': {
        const wrap = document.createElement('div');
        wrap.className = c.kind === 'stack' ? 'wy-stack' : 'wy-rrow';
        for (const child of c.controls) {
          const n = this.control(child, 'small');
          if (n) wrap.append(n);
        }
        return wrap.childElementCount ? wrap : null;
      }
      case 'item': {
        const item = this.items.get(c.item);
        if (!item || item.type === 'separator' || item.type === 'select') return null;
        const label = this.label(c.item, c.label ?? ed.t(item.name, item.label));
        const ic = c.icon ?? (hasIcon(item.name) ? item.name : '');
        const btn = this.button({ label, icon: ic, size: c.size ?? defaultSize ?? 'small', iconOnly: c.iconOnly, onClick: () => runToolbarItem(ed, item) });
        if (item.isActive) {
          const isActive = item.isActive;
          this.updaters.push((s) => {
            const on = isActive(s);
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', String(on));
          });
        }
        return btn;
      }
      case 'command': {
        if (!ed.hasCommand(c.command)) return null;
        const btn = this.button({ label: this.label(c.id, c.label), icon: c.icon, size: c.size ?? defaultSize ?? 'small', iconOnly: c.iconOnly, onClick: () => ed.execute(c.command, ...(c.args ?? [])) });
        if (c.active) {
          const fn = c.active;
          this.updaters.push(() => {
            const on = fn(ed);
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', String(on));
          });
        }
        return btn;
      }
      case 'menu': {
        if (!ed.hasCommand(c.need)) return null;
        const btn = this.button({ label: this.label(c.id, c.label), icon: c.icon, size: c.size ?? defaultSize ?? 'small', iconOnly: c.iconOnly, chevron: true, onClick: () => this.toggleMenu(btn, () => this.menuBody(c.entries(ed))) });
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        return btn;
      }
      case 'palette': {
        if (!ed.hasCommand(c.command)) return null;
        const btn = this.button({ label: this.label(c.id, c.label), icon: c.icon, size: c.size ?? defaultSize ?? 'small', iconOnly: c.iconOnly, chevron: true, onClick: () => this.toggleMenu(btn, () => this.paletteBody(c)) });
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        return btn;
      }
      case 'chars': {
        if (!ed.hasCommand(c.need)) return null;
        const btn = this.button({ label: this.label(c.id, c.label), icon: c.icon, size: c.size ?? defaultSize ?? 'small', chevron: true, onClick: () => this.toggleMenu(btn, () => this.charsBody(c.chars)) });
        btn.setAttribute('aria-haspopup', 'menu');
        btn.setAttribute('aria-expanded', 'false');
        return btn;
      }
      case 'select': {
        const item = this.items.get(c.item);
        if (!item || item.type !== 'select') return null;
        const sel = document.createElement('select');
        sel.className = 'wy-rsel';
        const label = ed.t(item.name, item.label);
        sel.title = label;
        sel.setAttribute('aria-label', label);
        if (c.width) sel.style.width = `${c.width}px`;
        for (const o of item.options) sel.add(new Option(ed.t(`${item.name}.${o.value}`, o.label), o.value));
        sel.addEventListener('change', () => (ed.execute(item.command, sel.value), this.update(ed.view.state)));
        this.updaters.push((s) => (sel.value = item.getValue(s)));
        return sel;
      }
      case 'zoom': {
        if (!ed.hasCommand('setZoom')) return null;
        const sel = document.createElement('select');
        sel.className = 'wy-rsel';
        sel.setAttribute('aria-label', ed.t('zoom', 'Zoom'));
        sel.title = sel.getAttribute('aria-label')!;
        for (const z of [50, 75, 90, 100, 125, 150, 175, 200]) sel.add(new Option(`${z}%`, String(z)));
        sel.addEventListener('change', () => ed.execute('setZoom', Number(sel.value)));
        this.updaters.push(() => {
          const z = Math.round(((ed.extensions.zoom as number) ?? 1) * 100);
          if (![...sel.options].some((o) => o.value === String(z))) sel.add(new Option(`${z}%`, String(z)));
          sel.value = String(z);
        });
        return sel;
      }
      case 'spin': {
        if (!ed.hasCommand(c.command)) return null;
        const wrap = document.createElement('label');
        wrap.className = 'wy-spin';
        if (c.icon) wrap.insertAdjacentHTML('beforeend', icon(c.icon, 16));
        const text = document.createElement('span');
        text.className = 'wy-spin-label';
        text.textContent = this.label(c.id, c.label);
        const input = document.createElement('input');
        input.type = 'number';
        input.min = String(c.min);
        input.max = String(c.max);
        input.step = String(c.step);
        input.title = `${text.textContent} (${c.unit})`;
        input.setAttribute('aria-label', `${text.textContent} (${c.unit})`);
        const apply = () => {
          const v = Number(input.value);
          if (input.value !== '' && Number.isFinite(v)) {
            const arg = c.set(Math.max(c.min, Math.min(c.max, v)));
            ed.execute(c.command, ...(c.spread && Array.isArray(arg) ? arg : [arg]));
          }
          this.update(ed.view.state);
        };
        input.addEventListener('change', apply);
        input.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), apply(), ed.view.focus()));
        wrap.append(text, input);
        this.updaters.push((s) => {
          if (document.activeElement !== input) input.value = String(c.get(s));
        });
        return wrap;
      }
    }
  }

  private button(o: { label: string; icon: string; size: Size; iconOnly?: boolean; chevron?: boolean; onClick: () => void }): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    const large = o.size === 'large';
    btn.className = `wy-rbtn ${large ? 'wy-rbtn-large' : 'wy-rbtn-small'}${!large && o.iconOnly ? ' is-icon' : ''}`;
    btn.title = o.label;
    btn.setAttribute('aria-label', o.label);
    const glyph = o.icon ? icon(o.icon, large ? 28 : 16) : '';
    btn.insertAdjacentHTML('beforeend', glyph);
    if (!glyph) btn.append(document.createTextNode(o.label.slice(0, 1))); // never an empty button
    if (large || !o.iconOnly) {
      const span = document.createElement('span');
      span.textContent = o.label; // labels may come from locale files: always text
      btn.append(span);
    }
    if (o.chevron) btn.insertAdjacentHTML('beforeend', icon('chevron', 10).replace('class="wy-ic"', 'class="wy-ic wy-chev"'));
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // keep the editor selection
    btn.addEventListener('click', () => {
      o.onClick();
      this.update(this.editor.view.state);
    });
    return btn;
  }

  // ---- menus

  private toggleMenu(anchor: HTMLElement, build: () => HTMLElement): void {
    const wasOpen = this.openMenu?.anchor === anchor;
    this.closeMenu();
    if (wasOpen) return;
    const menu = document.createElement('div');
    menu.className = 'wy-menu';
    menu.setAttribute('role', 'menu');
    menu.append(build());
    this.editor.root.append(menu);
    const root = this.editor.root.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    menu.style.top = `${a.bottom - root.top + 2}px`;
    menu.style.left = `${Math.max(0, Math.min(a.left - root.left, root.width - menu.offsetWidth - 4))}px`;
    anchor.setAttribute('aria-expanded', 'true');
    this.openMenu = { el: menu, anchor };
    menu.addEventListener('keydown', (e) => this.menuKeys(e, menu));
    (menu.querySelector<HTMLElement>('button') ?? menu).focus();
  }

  private closeMenu(): void {
    if (!this.openMenu) return;
    this.openMenu.anchor.setAttribute('aria-expanded', 'false');
    this.openMenu.el.remove();
    this.openMenu = null;
  }

  private menuKeys(e: KeyboardEvent, menu: HTMLElement): void {
    const items = [...menu.querySelectorAll<HTMLElement>('button')];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const cols = menu.querySelector('.wy-palette, .wy-charpad') ? Number(getComputedStyle(menu.querySelector('.wy-palette, .wy-charpad')!).gridTemplateColumns.split(' ').length) || 1 : 1;
    const step = e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : e.key === 'ArrowRight' && cols > 1 ? 1 : e.key === 'ArrowLeft' && cols > 1 ? -1 : 0;
    if (e.key === 'Escape') {
      const anchor = this.openMenu?.anchor;
      this.closeMenu();
      anchor?.focus();
    } else if (step) {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, (i < 0 ? 0 : i) + step))]?.focus();
    }
  }

  private run(command: string, args: unknown[] = []): void {
    this.closeMenu();
    this.editor.execute(command, ...args);
    this.update(this.editor.view.state);
  }

  private menuBody(entries: MenuEntry[]): HTMLElement {
    const box = document.createElement('div');
    for (const en of entries) {
      if (en.heading) {
        const h = document.createElement('div');
        h.className = 'wy-menu-title';
        h.textContent = en.label;
        box.append(h);
        continue;
      }
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wy-menu-item';
      b.setAttribute('role', 'menuitem');
      if (en.icon) b.insertAdjacentHTML('beforeend', icon(en.icon, 16));
      const t = document.createElement('span');
      t.textContent = en.label;
      b.append(t);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => en.command && this.run(en.command, en.args));
      box.append(b);
    }
    return box;
  }

  private paletteBody(c: Extract<RibbonControl, { kind: 'palette' }>): HTMLElement {
    const box = document.createElement('div');
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'wy-menu-item';
    none.textContent = this.editor.t(`none.${c.id}`, c.none);
    none.addEventListener('mousedown', (e) => e.preventDefault());
    none.addEventListener('click', () => this.run(c.command, ['']));
    const grid = document.createElement('div');
    grid.className = 'wy-palette';
    for (const color of c.colors) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wy-swatch';
      b.style.background = color;
      b.title = color;
      b.setAttribute('aria-label', color);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.run(c.command, [color]));
      grid.append(b);
    }
    box.append(none, grid);
    return box;
  }

  private charsBody(chars: string[]): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'wy-charpad';
    for (const ch of chars) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = ch;
      b.setAttribute('aria-label', ch);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.run('insertText', [ch]));
      grid.append(b);
    }
    return grid;
  }
}
