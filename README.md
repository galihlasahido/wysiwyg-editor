# wysiwyg-editor

[![Support via PayPal](https://img.shields.io/badge/PayPal-Support-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/abahido)
[![Support via Lynk.id](https://img.shields.io/badge/Lynk.id-Support-FB6B35?style=for-the-badge&logo=kofi&logoColor=white)](https://lynk.id/abahido/s/z52m3ekew032)

A modular rich-text editor in TypeScript, inspired by [CKEditor 5](https://ckeditor.com/ckeditor-5/capabilities/),
built on [ProseMirror](https://prosemirror.net/). The long-term goal is a **Google Docs-style editor for the web**:
paged layout, comments, suggestions, real-time collaboration, `.docx` import/export, and a backend to store and share documents.

Everything is opt-in plugins; the core is small. It is **not published to npm yet**: clone, `pnpm install`, `pnpm build`.

```sh
pnpm install
pnpm dev        # the demo gallery at http://localhost:5173 (33 examples)
pnpm test       # 196 tests (unit, accessibility with axe-core, server integration)
pnpm build      # library in dist/
pnpm server     # reference backend on :8787
```

**Live demos:** https://galihlasahido.github.io/wysiwyg-editor/ — a landing page plus 33 small real pages (classic, inline and
document editors, a headless editor, developer docs with runnable code blocks, a notebook, a playground, a README editor,
real-time and asynchronous collaboration, Word import/export, email, merge fields, source editing, Markdown, AI, images, mobile).
Each has a "Show the code" section.

## Quick start

```ts
import { createEditor } from 'wysiwyg-editor';
import 'wysiwyg-editor/style.css';

const editor = createEditor({
  element: document.getElementById('editor')!,
  content: '<p>Hello</p>',
  ribbon: true,                                                       // Office-style tabbed ribbon (default is a compact toolbar)
  theme: 'light',                                                     // or 'dark'
  pages: { header: 'My document', footer: 'Page {page} of {pages}' }, // Google Docs-style pages (optional)
  outline: true,                                                      // heading outline sidebar (optional)
  onChange: (html) => console.log(html),
});

editor.execute('bold');
editor.getHTML();       editor.getMarkdown();     editor.getStats();
editor.setHTML('<p>…</p>');   editor.replaceHTML('<p>…</p>') // the latter is one undoable step
```

Choose your own features and toolbar:

```ts
import { Editor, Essentials, BasicStyles, Heading, Comments, TrackChanges } from 'wysiwyg-editor';

new Editor({
  element,
  plugins: [Essentials, BasicStyles, Heading, Comments({ author: 'Ana' }), TrackChanges({ author: 'Ana' })],
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic', 'comment', 'trackChanges'],
});
```

Entry points (optional peer dependencies are only needed for the ones you import):

| Import | Contents | Needs |
|---|---|---|
| `wysiwyg-editor` | editor, all plugins, HTML export, `DocumentClient` | – |
| `wysiwyg-editor/style.css` | styles | – |
| `wysiwyg-editor/docx` | `.docx` import/export | `docx`, `mammoth` |
| `wysiwyg-editor/collab` | Yjs collaboration + providers | `yjs`, `y-prosemirror`, `y-protocols` |
| `wysiwyg-editor/react` | `<WysiwygEditor value onChange />` | `react` |
| `wysiwyg-editor/vue` | `<WysiwygEditor v-model />` | `vue` |

## Features

**Editing**: bold/italic/underline/strike/code · headings · font family & size · text color & highlight · alignment ·
line spacing · bulleted, numbered and checklists with indent · block quote · code block · horizontal line · links ·
images (URL, upload, paste, drag & drop, resize, captions; pluggable `uploadImage`, Base64 by default) · tables
(add/delete rows & columns, merge/split cells, header row, cell color) · special characters · format painter ·
footnotes · @-mentions · table of contents · Markdown-style autoformat (`# `, `- `, `1. `, `> `, ` ``` `, `**bold**`) ·
find & replace · word count · spell check toggle · templates · per-paragraph LTR/RTL.

**Ribbon** (`ribbon: true`): tabs File, Home, Insert, Layout, References, Review, View, Help, plus a contextual
Table tab that appears while the cursor is in a table. Each tab has labelled groups with large and small buttons, dropdown
menus, color palettes, symbol/emoji pickers and numeric boxes (indent, spacing). Controls whose plugin is not installed are
hidden. It has an SVG icon set (original, outline style), **Dark Mode** and **Switch Background** (chrome and paper are themed
separately), **zoom** 25–500% (page layout stays exact), reading view, header/footer editing, page-number presets, margin
presets, page color, subscript/superscript, clear formatting, font size steps, cut/copy/paste. Tabs and panels follow the
WAI-ARIA tab/toolbar patterns. Customise with `ribbon: { tabs, onOpenDocx, onExportDocx }`.

**Code**: `CodeBlocks()` adds a language per code block (`data-language`, Markdown fences), a dependency-free syntax
highlighter (JS/TS, Python, JSON, CSS, HTML, shell, SQL; swap in your own), a header with language picker and Copy, custom
header actions (the demos add a sandboxed "Run"), Tab/Shift+Tab indentation and Enter that keeps and extends indentation.

**Code editor**: `createCodeEditor({ element, value, language })` is a full code editor on the same engine: line numbers
(aligned with wrapped lines, sticky when scrolling sideways), highlighting, auto-closing and wrapping of brackets and
quotes, bracket-match highlight, Tab indent and auto-indent, `Mod-/` comment toggling per language, duplicate / move /
delete line, go to line, find & replace, active-line highlight, code folding by indentation (gutter arrows, `Mod-Alt-[`), basic multi-cursor (`Alt+click`, `Mod-Alt-↑/↓`; typing, Enter, Backspace, Delete, arrows and paste apply to every caret), an optional minimap, several files (`openFile`) with separate undo, tab size,
word wrap, font size, themes and cursor reporting. See `demo/code-editor` (explorer, tabs, run, HTML preview, status bar,
command palette).

**Beyond text**: `TableFormulas` (spreadsheet formulas in ordinary tables: `=SUM(A2:A4)`, `=IF(...)`, cell and range references, a safe parser instead of `eval`, `computeFormulasInHTML` for export), `Diagram` (an editable flowchart block with shapes, arrows and colours,
stored as validated JSON and rendered as SVG) and `splitSlides` (turn a document into slides with speaker notes; the demo presents full screen and exports a standalone deck).

**Restricted editing**: `RestrictedEditing()` adds `locked_section` blocks (a title with the table of contents, legal
text) that cannot be changed, and `editable_region` blocks that can, while everything else stays ordinary text. It is
enforced by rejecting transactions, so typing, deleting, pasting, dropping and find & replace are all covered, including
a delete that spans a lock. Author mode (`authorMode` option, `toggleAuthorMode`, ribbon **Restrict** tab) lets a template
author lock, unlock and mark fill-in areas. Programmatic and remote (collaboration) changes are not blocked.

**Ruler** (paged view): cm scale with zero at the left margin, shaded margins you can drag, and Word-style paragraph
markers: first-line ▼ and hanging ▲ with the left-indent box, and right indent. Drags preview with a guide line and commit once
(one undo step); markers are keyboard-operable (arrows, Shift for 10px). Works at any zoom.

**Paged view** (`pages: true | {...}`): A4/Letter/Legal, portrait/landscape, margins, per-page header and footer with
`{page}`/`{pages}`, different first page, manual page breaks (Ctrl/Cmd+Enter), a ruler with draggable margins,
outline sidebar, print CSS. Paragraphs split between lines (two lines minimum per side); tables split between rows and
lists between items.

**Review**: `Comments` (threads, replies, resolve, works in read-only mode), `TrackChanges` (suggesting mode with
accept/reject), `Versions` (named snapshots, restore is undoable, optional autosave and `localStorage` persistence),
read-only mode (`readOnly` / `setReadOnly`).

**Import / export**: HTML (`exportHTML`), print / save as PDF (`execute('print')`), Markdown (`getMarkdown` / `setMarkdown`),
`.docx` (`exportDocx`, `importDocx`; keeps headings, formatting, lists, tables, images, footnotes, comments, tracked
changes, page size/margins/orientation, header/footer, TOC field).

**Collaboration & backend**: real-time co-editing with remote cursors and per-user undo (Yjs); a reference server with
REST API, owner/share-link permissions (view / comment / edit), optimistic concurrency, and a WebSocket relay;
`Autosave` with retry and conflict handling.

**AI**: `AIAssistant({ provider })` — improve, fix grammar, shorten, expand, summarize, translate, custom prompt.
Results are previewed and applied only when accepted.

**Accessibility & i18n**: ARIA roles/labels, WAI-ARIA toolbar keyboard navigation (roving tabindex), axe-core audit in the
test suite, contrast-checked styles, `forced-colors` support; toolbar translations for `id`, `es`, `ar` (`locale`,
`registerLocale`), RTL layout, React and Vue wrappers.

## Collaboration

Two browser tabs, no server (`BroadcastChannel`):

```ts
import * as Y from 'yjs';
import { Collaboration, createBroadcastProvider } from 'wysiwyg-editor/collab';

const ydoc = new Y.Doc();
const { awareness } = createBroadcastProvider('room-1', ydoc);
createEditor({ element, plugins: [...defaultPlugins, Collaboration({ ydoc, awareness, user: { name: 'Ana', color: '#e03131' } })] });
```

Across machines, use the reference server and `createWebSocketProvider(url, ydoc)`. Its `synced` promise resolves after the
first full sync: create the editor (and pass `seed`) after it, or two clients may both seed the same empty document.

## Backend (reference implementation)

`pnpm server` starts `server/index.ts` (file-based storage, zero infrastructure):

| Request | Who | |
|---|---|---|
| `POST /api/docs` | anyone | create → `{ id, ownerKey }` (the key is shown once; only its hash is stored) |
| `GET /api/docs/:id` | any role | load |
| `PUT /api/docs/:id` | edit, owner | save `{ version, html, … }`; `409` with the server copy on a stale version |
| `PUT /api/docs/:id/comments` | comment and up | comments only |
| `POST/GET/DELETE /api/docs/:id/shares` | owner | create `view`/`comment`/`edit` links, list, revoke |
| `DELETE /api/docs/:id` | owner | delete |
| `ws://…/collab/:id?token=…` | any role | Yjs relay; view/comment connections are read-only |

```ts
const client = new DocumentClient('http://localhost:8787');
const { id, ownerKey, version } = await client.create({ html: '<p>Hi</p>' });
createEditor({ element, plugins: [...defaultPlugins, Autosave({ save: createHttpSaver({ client, id, secret: ownerKey, version }) })] });
```

This is a **reference**, not a production server: single process, local files, no user accounts or rate limiting, and the
WebSocket token travels in the URL query (it can end up in logs). Put it behind TLS and your own auth before real use.

## AI assistant

```ts
AIAssistant({ provider: createFetchProvider('/api/ai') }) // your server calls the model; never put API keys in the browser
```

A provider is any `(req) => Promise<string> | AsyncIterable<string>`; stream chunks and the preview updates live.
Model output is parsed as Markdown with raw HTML disabled, so it cannot inject markup.

## Writing a plugin

```ts
const Hello: EditorPlugin = {
  name: 'hello',
  marks: { /* ProseMirror MarkSpec */ },
  setup(editor) {
    editor.registerCommand('hello', () => true);
    return [/* ProseMirror plugins */];
  },
  toolbar: [{ name: 'hello', label: 'Hello', icon: '👋', command: 'hello' }],
};
```

Plugins may set `priority` (keymap order) and `transformTransaction` (rewrite user edits, used by track changes).

## Known limitations

- **Pagination is visual.** The document stays one ProseMirror doc; blocks are measured in the browser and spaced across
  pages, so page geometry can differ slightly (a few px, occasionally ~15px on the page where a table turns into a list)
  from a true layout engine, and from print output. Verified in Chrome only. Header rows do not repeat across pages.
- Footnotes are collected at the end of the document (endnotes), not at the bottom of each page.
- **Restricted editing** is enforced in the browser only: it protects against accidental edits, not against someone who edits the stored HTML or talks to the server directly.
- **Track changes** tracks inline edits inside one paragraph; structural edits (splitting/joining blocks, tables) apply untracked.
- **PDF** is the browser's print dialog (Save as PDF), not a generated file.
- **.docx import** goes through mammoth: alignment, colors, page setup and comments are not imported. Export embeds
  `data:` images and fetches remote ones when CORS allows; otherwise it writes the alt text.
- Image cropping, resize, captions and alt text are supported; the .docx export crops with canvas in browsers and exports the full image where canvas is unavailable.
- The code editor's extra cursors are carets only (no multiple selections, no select-next-occurrence), folding is by indentation (not by syntax), and the built-in highlighter is a scanner, not a parser (no nested template literals or regex literals).
- Ribbon icons are drawn for this project (outline style, in the spirit of office suites); they are not Microsoft's assets.
  Dictation, the Microsoft Editor and add-ins from Word's ribbon are not included. Zoom uses CSS `zoom` (Chrome, Safari, Firefox 126+).
- Ribbon labels are translated for Indonesian only (toolbar labels also for Spanish and Arabic); menu entries stay English.
- Translations cover toolbar labels in 3 languages and have not been reviewed by native speakers.
- Tested with jsdom (unit), real Chrome (layout, ruler dragging, zoom, collaboration) and axe-core. Not yet tested in Firefox/Safari or with screen readers.

## Security notes

Pasted/loaded HTML goes through the schema: unknown tags and attributes are dropped; link and image URLs are limited to
safe schemes (`javascript:` is rejected); Markdown import disables raw HTML; user text (comments, mentions, footnotes, AI
output) is rendered with `textContent`; the server compares secrets in constant time, stores only hashes, bounds request
size and treats unknown documents and bad credentials identically.

## License

MIT
