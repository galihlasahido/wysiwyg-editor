import { DOMParser as PMDOMParser } from 'prosemirror-model';
import { AllSelection } from 'prosemirror-state';
import type { Editor } from '../editor';
import { openDialog } from '../dialog';
import { inertElement } from '../inert';
import { cleanPastedHTML } from '../paste';
import { download, exportHTML } from '../export';
import type { EditorPlugin } from '../types';
import { FONT_SIZES } from './fonts';
import { getStats } from './word-count';

const KEEP_MARKS = new Set(['link', 'comment', 'insertion', 'deletion']); // review data is not "formatting"
const BASE_FONT_SIZE = 16;

const SHORTCUTS: [string, string][] = [
  ['Bold', 'Ctrl/Cmd + B'], ['Italic', 'Ctrl/Cmd + I'], ['Underline', 'Ctrl/Cmd + U'], ['Strikethrough', 'Ctrl/Cmd + Shift + X'],
  ['Inline code', 'Ctrl/Cmd + E'], ['Subscript / Superscript', 'Ctrl/Cmd + , / .'], ['Undo / Redo', 'Ctrl/Cmd + Z / Y'],
  ['Find & replace', 'Ctrl/Cmd + F'], ['Page break', 'Ctrl/Cmd + Enter'], ['Indent / outdent list item', 'Tab / Shift + Tab'],
  ['Markdown shortcuts', '# , - , 1. , > , ```'],
];

/** Commands behind the Office-style ribbon: clipboard, formatting helpers, view, theme, files and dialogs. */
export const Office: EditorPlugin = {
  name: 'office',
  setup(editor: Editor) {
    const safe = { readOnlySafe: true };
    const flag = (cls: string) => () => editor.root.classList.toggle(cls);

    // ---- clipboard
    editor.registerCommand('copy', (e) => (e.view.focus(), document.execCommand?.('copy') ?? false), safe);
    editor.registerCommand('cut', (e) => (e.view.focus(), document.execCommand?.('cut') ?? false));
    editor.registerCommand('paste', (e) => {
      const view = e.view;
      const clip = navigator.clipboard;
      const fail = () =>
        openDialog(e.root, { title: 'Paste', body: 'The browser blocked clipboard access. Use Ctrl/Cmd + V to paste.' });
      if (!clip) return (fail(), false);
      const insertText = (text: string) => view.dispatch(view.state.tr.insertText(text).scrollIntoView());
      const insertHtml = (html: string) => {
        // Parsed with the editor schema, so unknown tags/attributes and unsafe URLs are dropped like any other input.
        const box = inertElement(cleanPastedHTML(html));
        const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(box);
        view.dispatch(view.state.tr.replaceSelection(slice).scrollIntoView());
      };
      void (async () => {
        try {
          if (clip.read) {
            for (const item of await clip.read()) {
              if (item.types.includes('text/html')) return insertHtml(await (await item.getType('text/html')).text());
              if (item.types.includes('text/plain')) return insertText(await (await item.getType('text/plain')).text());
            }
          } else insertText(await clip.readText());
        } catch {
          fail();
        }
      })();
      return true;
    });
    editor.registerCommand('selectAll', (e) => {
      const { state, dispatch } = e.view;
      dispatch(state.tr.setSelection(new AllSelection(state.doc)));
      return true;
    }, safe);

    // ---- formatting helpers
    editor.registerCommand('clearFormatting', (e) => {
      const { state, dispatch } = e.view;
      const { from, to, empty } = state.selection;
      const tr = state.tr;
      if (empty) {
        tr.setStoredMarks([]); // typing continues unformatted
      } else {
        for (const type of Object.values(state.schema.marks)) {
          if (!KEEP_MARKS.has(type.name)) tr.removeMark(from, to, type);
        }
      }
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isTextblock) return;
        // Back to a plain paragraph with no paragraph formatting (code blocks and headings included).
        const attrs = Object.fromEntries(Object.keys(node.type.spec.attrs ?? {}).map((k) => [k, null]));
        if (node.type === state.schema.nodes.paragraph) {
          // setNodeMarkup always records a step, so skip paragraphs that are already plain.
          if (Object.keys(attrs).some((k) => node.attrs[k] !== null)) tr.setNodeMarkup(pos, undefined, attrs);
        } else if (node.type.name === 'heading') tr.setNodeMarkup(pos, state.schema.nodes.paragraph, { ...attrs, level: undefined });
      });
      if (!tr.docChanged && tr.storedMarks === state.storedMarks) return false;
      dispatch(tr);
      return true;
    });
    editor.registerCommand('fontSizeStep', (e, delta: 1 | -1) => {
      const { state } = e.view;
      const type = state.schema.marks.font_size;
      if (!type) return false;
      const { $from, from, empty } = state.selection;
      const marks = empty ? state.storedMarks ?? $from.marks() : (state.doc.nodeAt(from)?.marks ?? []);
      const current = Number(marks.find((m) => m.type === type)?.attrs.value ?? BASE_FONT_SIZE);
      const sizes = FONT_SIZES.map(Number).sort((x, y) => x - y);
      const next = delta > 0 ? sizes.find((x) => x > current) : [...sizes].reverse().find((x) => x < current);
      if (next === undefined) return false; // already at the largest / smallest size
      return e.execute('fontSize', String(next));
    });

    // Increase / decrease indent: list nesting inside lists, paragraph indent elsewhere (like Word).
    const inList = (e: Editor) => {
      const { $from } = e.view.state.selection;
      for (let d = $from.depth; d > 0; d--) if (/_list$|^list_item$|^task_item$/.test($from.node(d).type.name)) return true;
      return false;
    };
    const STEP = 48; // half an inch
    editor.registerCommand('indentMore', (e) => (inList(e) ? e.execute('indent') : e.execute('paragraphIndent', { left: (e.view.state.selection.$from.parent.attrs.indentLeft ?? 0) + STEP })));
    editor.registerCommand('indentLess', (e) => (inList(e) ? e.execute('outdent') : e.execute('paragraphIndent', { left: Math.max(0, (e.view.state.selection.$from.parent.attrs.indentLeft ?? 0) - STEP) })));

    // ---- view
    editor.registerCommand('toggleRuler', flag('wy-hide-ruler'), safe);
    editor.registerCommand('toggleHeaderFooterVisibility', flag('wy-hide-headerfooter'), safe);
    editor.registerCommand('toggleFootnotesVisibility', flag('wy-hide-footnotes'), safe);
    editor.registerCommand('setTheme', (e, t: 'light' | 'dark') => (t === 'light' || t === 'dark' ? (e.setTheme(t), true) : false), safe);
    editor.registerCommand('toggleTheme', (e) => (e.setTheme(e.theme === 'dark' ? 'light' : 'dark'), true), safe);
    editor.registerCommand('togglePageBackground', (e) => (e.setPageDark(!e.isPageDark), true), safe);
    let wasReadOnly = false;
    editor.registerCommand('toggleReadingView', (e) => {
      const on = !e.root.classList.contains('wy-reading');
      e.root.classList.toggle('wy-reading', on);
      if (on) {
        wasReadOnly = e.isReadOnly;
        e.setReadOnly(true);
      } else e.setReadOnly(wasReadOnly);
      return true;
    }, safe);
    editor.registerCommand('setZoom', (e, percent: number) => {
      if (!Number.isFinite(percent)) return false;
      const z = Math.max(25, Math.min(500, Math.round(percent))) / 100;
      e.root.style.setProperty('--wy-zoom', String(z));
      e.extensions.zoom = z;
      e.view.dispatch(e.view.state.tr.setMeta('addToHistory', false)); // let page layout and the ruler re-measure
      return true;
    }, safe);

    // ---- files
    editor.registerCommand('newDocument', (e) => (e.replaceHTML('<p></p>'), true));
    editor.registerCommand('exportHtml', (e) => (download(exportHTML(e, { title: 'Document' }), 'document.html', 'text/html'), true), safe);
    editor.registerCommand('exportMarkdown', (e) => (download(e.getMarkdown(), 'document.md', 'text/markdown'), true), safe);

    // ---- dialogs
    editor.registerCommand('showShortcuts', (e) => {
      const table = document.createElement('table');
      for (const [what, keys] of SHORTCUTS) {
        const tr = table.insertRow();
        tr.insertCell().textContent = what;
        const k = document.createElement('kbd');
        k.textContent = keys;
        tr.insertCell().append(k);
      }
      openDialog(e.root, { title: e.t('showShortcuts', 'Keyboard shortcuts'), body: table });
      return true;
    }, safe);
    editor.registerCommand('showWordCount', (e) => {
      const s = getStats(e.view.state.doc);
      const pages = e.root.dataset.pages;
      const rows: [string, string][] = [['Words', String(s.words)], ['Characters (with spaces)', String(s.characters)], ['Characters (no spaces)', String(s.charactersNoSpaces)], ...(pages ? ([['Pages', pages]] as [string, string][]) : [])];
      const table = document.createElement('table');
      for (const [k, v] of rows) {
        const tr = table.insertRow();
        tr.insertCell().textContent = k;
        tr.insertCell().textContent = v;
      }
      openDialog(e.root, { title: e.t('wordCount', 'Word count'), body: table });
      return true;
    }, safe);
    editor.registerCommand('showAbout', (e) => (openDialog(e.root, { title: 'About', body: 'wysiwygido: a modular rich-text editor built on ProseMirror.' }), true), safe);
  },
};
