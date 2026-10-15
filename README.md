# wysiwygido

[![Support via PayPal](https://img.shields.io/badge/PayPal-Support-00457C?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/abahido)
[![Support via Lynk.id](https://img.shields.io/badge/Lynk.id-Support-FB6B35?style=for-the-badge&logo=kofi&logoColor=white)](https://lynk.id/abahido/s/z52m3ekew032)

A modular rich-text editor in TypeScript, inspired by [CKEditor 5](https://ckeditor.com/ckeditor-5/capabilities/),
built on [ProseMirror](https://prosemirror.net/). The long-term goal is a **Google Docs-style editor for the web**:
paged layout, comments, suggestions, real-time collaboration, `.docx` import/export, and a backend to store and share documents.

Everything is opt-in plugins; the core is small. Install from npm (the first release is tagged `next`): `pnpm add wysiwygido@next`, then `import { createEditor } from 'wysiwygido'` and `import 'wysiwygido/style.css'`. To work on the repository itself: clone, `pnpm install`, `pnpm dev`.

```sh
pnpm install
pnpm dev        # the demo gallery at http://localhost:5173 (49 examples)
pnpm test       # 196 tests (unit, accessibility with axe-core, server integration)
pnpm build      # library in dist/
pnpm server     # reference backend on :8787
```

**Live demos:** https://galihlasahido.github.io/wysiwyg-editor/ — a landing page plus 39 small real pages (classic, inline and
document editors, a headless editor, developer docs with runnable code blocks, a notebook, a playground, a README editor,
real-time and asynchronous collaboration, Word import/export, email, merge fields, source editing, Markdown, AI, images, mobile).
Each has a "Show the code" section.

## Without a framework: `<wysiwyg-editor>`

```html
<link rel="stylesheet" href="wysiwygido/style.css">
<wysiwyg-editor name="body" value="<p>Hello</p>" ribbon paged theme="dark"></wysiwyg-editor>
<script type="module">
  import { defineEditorElement } from 'wysiwygido';
  defineEditorElement();                       // registers the tag once (or pass your own name)
  const el = document.querySelector('wysiwyg-editor');
  el.addEventListener('editor-change', (e) => console.log(e.detail.html));
</script>
```

Attributes: `value`, `readonly`, `theme`, `placeholder`, `locale`, `ribbon`, `paged`, `outline`, `name`. Properties: `value`, `readOnly`, `plugins`, `config` (any `createEditor`
option, set before it is connected), `editor`. Events: `editor-ready`, `editor-change`. With `name` it is a form control: the HTML is submitted with the form and `reset` restores it.
It renders in the light DOM (no shadow root), so load the stylesheet in the page.

## Quick start

```ts
import { createEditor } from 'wysiwygido';
import 'wysiwygido/style.css';

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
import { Editor, Essentials, BasicStyles, Heading, Comments, TrackChanges } from 'wysiwygido';

new Editor({
  element,
  plugins: [Essentials, BasicStyles, Heading, Comments({ author: 'Ana' }), TrackChanges({ author: 'Ana' })],
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic', 'comment', 'trackChanges'],
});
```

**Optional packages are passed in, not imported by the editor.** `docx`, `mammoth`, `katex`, `mermaid`, `pdfjs-dist`, `jszip` and `yjs` are optional. The main entry never imports them (a check in `pnpm check:optional` enforces it), so Angular, webpack, Next.js and esbuild builds work without them installed. When you want a feature, install its package and hand the editor a loader:

```ts
createEditor({ element, docx: () => import('wysiwygido/docx'),                        // pnpm add docx mammoth
  plugins: [...defaultPlugins,
    Equations({ katex: () => import('katex') }),                                      // pnpm add katex
    Mermaid({ mermaid: () => import('mermaid') }),                                    // pnpm add mermaid
    PdfEpub({ loadPdf: () => import('wysiwygido/pdf'), loadEpub: () => import('wysiwygido/epub') })] }); // pdfjs-dist, jszip
```

Without a loader the feature says what to add (`exportDocx()` rejects with the exact line to write). Collaboration is its own entry, `wysiwygido/collab`.

Entry points (optional peer dependencies are only needed for the ones you import):

| Import | Contents | Needs |
|---|---|---|
| `wysiwygido` | editor, all plugins, HTML export, `DocumentClient` | – |
| `wysiwygido/style.css` | styles | – |
| `wysiwygido/docx` | `.docx` import/export | `docx`, `mammoth` |
| `wysiwygido/collab` | Yjs collaboration + providers | `yjs`, `y-prosemirror`, `y-protocols` |
| `wysiwygido/react` | `<WysiwygEditor value onChange />` | `react` |
| `wysiwygido/vue` | `<WysiwygEditor v-model />` | `vue` |

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

**Files and image editing**: `FileManager({ store })` adds a file library (modal: upload by button, drag and drop or paste, search, filter, sort, grid or list,
preview, rename, download, delete, multi-select) and `attachment` chips for non-image files; pictures go in as images. Files live in IndexedDB by default
(`IndexedDBFileStore`, or implement `FileStore` for a server) and are checked on the way in (size, accepted types, programs and scripts refused,
unique clean names). `editImage` / `openImageEditor` edit a picture on a canvas: crop (free or fixed ratio), rotate, flip and straighten, resize, brightness, contrast,
saturation, warmth, blur, nine filters, freehand pen and highlighter, text, undo and redo, zoom (buttons, Ctrl/Cmd + wheel, 100% / Fit) and pan (Space + drag), PNG / JPEG / WebP output. A picture from another site needs CORS; pass `fetchImage` (your own proxy) to edit it anyway. Give `resolveUrl` your upload function to make attachments work for every reader.

**Equations and diagrams** (optional peers `katex` and `mermaid`, passed in as shown above and loaded only when used): `Equations({ katex: () => import('katex') })` adds inline `$…$` and display
LaTeX equations drawn by KaTeX with MathML for screen readers; type `$x^2$`, use the ∑ / ∫ buttons or double-click to edit in a dialog with templates
(fraction, sum, integral, matrix …) and a live preview; invalid LaTeX shows the error in place. `Mermaid()` adds text-written diagrams (flowchart, sequence,
class, state, ER, Gantt, pie, mind map) with starter templates and a live preview; it forces `securityLevel: 'strict'`, draws labels as SVG text, strips scripts from the
SVG, follows the light or dark page colours, renders one diagram at a time, and shows Mermaid's message instead of throwing. Import KaTeX's CSS in your page
(`katex/dist/katex.min.css`). Markdown round-trips as `$x$`, `$$ … $$` and ```` ```mermaid ```` fences. Word export writes equations as **native Word equations** (fractions, roots, scripts, sums, integrals, limits, brackets, Greek letters; a formula outside that subset is kept as its LaTeX text) and diagrams as **PNG pictures** (drawn on a canvas; without one the Mermaid source is written, labelled).

**Pasting from Word and Google Docs**: pasted HTML is cleaned before it is parsed (`cleanPastedHTML`): Word's fake list paragraphs become real nested
lists (with their `1.` / `a.` / `i.` numbering and start number), conditional comments, `<o:p>` and `mso-*` styles go, fonts and sizes are dropped while bold, italic,
underline, colour and alignment stay, pictures that point at local files are removed, and Google Docs' fake bold wrapper is unwrapped. Word and Excel also put a
*picture* of what you copied on the clipboard: when there is text or HTML too, the text wins, so a pasted list or table stays editable. A clipboard that holds only a
picture (or an `<img>` with no text) still pastes the picture.

**Embedded media**: `Embeds()` turns a pasted YouTube (privacy-enhanced), Vimeo or OpenStreetMap link (on an empty line, or Insert → Media) into a player or map. Only listed
services ever become a frame (add your own with `providers`, each must return an `https` address on its own host), the frame is sandboxed with no referrer, and the saved HTML
keeps only the address: the iframe is rebuilt and re-checked on load, so edited markup cannot point a frame elsewhere. Printing and Word/Markdown export keep the link. Allow the
provider hosts in your `frame-src` CSP.

**Form fields**: `FormFields()` puts real controls in the text: `insertField('checkbox' | 'select' | 'date' | 'text', { label, options, required, name })` (or the toolbar buttons). People can fill them
inside locked sections and in a read-only editor (`fillInReadOnly`, default on), while the text around stays locked. `editor.extensions.form.getData()` returns `{ name: value }`, `validate()` lists
and outlines the required fields still empty, `setFieldValue(name, value)` fills from code, and a `field-change` event reports each answer. Values are validated per kind (a drop-down value must be one of its options, a date must be a real
date), the saved HTML keeps the answer as visible text too, and Word / Markdown export show it (`☒`, `[x]`).

**Captions and cross-references**: `Captions()` adds numbered captions ("Figure 3. …", "Table 2. …", your own kinds and wording), cross-references that follow them (`insertCrossReference`) and a list of
figures or tables (`insertCaptionList`). Numbers come from the order in the document and renumber when captions are added, deleted or moved; the derived text is saved in the HTML (and written to Word and
Markdown), so exports show it. A reference to a deleted caption says "Missing reference".

**Columns**: `Columns()` flows blocks into 2–4 newspaper columns (`insertColumns(n)` wraps the selection, `setColumns({ count, rule, gap })`, `removeColumns`). `setDocumentColumns(count)` puts the whole page (below a leading heading) in columns and `insertColumnBreak` starts the next column. Columns collapse to one on narrow screens. Word export writes every top-level columns block as its own continuous **section** with the real column count, gap and rule (text before and after stays single-column; headers and footers stay on the first section); Markdown flows the text in one column. Columns nested inside columns are flattened in Word.

**Picture styles**: select an image and open Picture → Picture Styles for a gallery of 28 looks (frames, offset and soft shadows, rounded and oval shapes, soft edges, diagonal corners, tilt and perspective, reflections, metal frames), plus Clear Style; the right-click menu on an image has the same list. `pictureStyle(id)` applies one to the selected image and `pictureStyle(null)` clears it; `PICTURE_STYLES` from `wysiwygido` lists the ids and labels. The image stores only the id (`data-picture-style`); the CSS comes from a fixed table, so a document cannot inject styles, and it is written inline so the look also shows in exported HTML. Reflections use `-webkit-box-reflect`, which Firefox does not draw (the picture is shown without the reflection there), and the Word and Markdown exports write the picture without the effects.

**The Tab key**: `TabKey` (in `defaultPlugins`) makes Tab work as in Word instead of moving the focus out of the editor: in a paragraph or heading it indents (Shift+Tab takes it back, in steps of half an inch, over every paragraph in the selection), in a table it moves to the next cell and adds a row after the last one, in a list it changes the level, and in a code block it indents the code. So that keyboard users are never trapped, **Escape, then Tab** moves the focus on (any other key puts Tab back to work). Leave `TabKey` out of `plugins`, or filter it from `defaultPlugins`, to keep the browser's behaviour; it does nothing in a read-only editor.

**Collapsible headings**: `CollapsibleHeadings` (in `defaultPlugins`) puts a small arrow in the margin left of every top-level heading, as in Word: a click hides everything up to the next heading of the same or a higher level and shows "…" after the title, and a click again opens it. Commands: `toggleHeadingFold` (the heading at the cursor, or the nearest one above it), `collapseHeadings`, `expandHeadings` and `showHeadingLevel(n)` (only the headings down to level `n` stay open); they are also in the right-click menu on a heading and in the ribbon under View → Headings. Shortcuts: Ctrl/Cmd + Alt + Up collapses, Ctrl/Cmd + Alt + Down expands everything. Nothing is removed from the document: the HTML, undo, export and print are unchanged, the pages are laid out again without the hidden text, and a cursor that moves into hidden text (search, undo, the outline) opens that section. Which headings are collapsed is view state: it is not saved with the document.

**Charts**: `Charts()` draws bar, line and pie charts as SVG. With the cursor in a table, `insertChart('bar' | 'line' | 'pie')` uses the first row as series and the first column as labels (numbers like `1,200`, `$40` or `12%` are understood); `insertChart(type, { labels, series })` takes data directly and `setChart` changes the selected chart. The chart is saved as validated data (never markup) and redrawn on load; Word export writes it as a picture (needs a browser canvas) and Markdown as a table.

**Recording and dictation**: `Recording()` adds `recordAudio`, `recordScreen`, `stopRecording`, `cancelRecording` and `toggleDictation`. The browser asks permission each time, a bar shows the time while recording, Esc cancels and the tracks are always released. A recording becomes a player in the text, embedded as a data URL (capped by `maxBytes`) or stored by your `upload(blob, kind)` function (recommended for anything long); `maxSeconds` stops it automatically. Dictation uses the browser's speech recognition (Chrome, Edge, Safari; not Firefox), types only text at the cursor, and can be set to a language with `dictationLang`. Word and Markdown export keep a link or label, not the media.

**PDF import and EPUB export**: `PdfEpub({ loadPdf: () => import('wysiwygido/pdf'), loadEpub: () => import('wysiwygido/epub') })` adds `openPdf` / `importPdf(blob)` and `exportEpub(name?)`; without the plugin use `importPdf` from `wysiwygido/pdf` and `exportEpub` from `wysiwygido/epub`. They need the optional packages `pdfjs-dist` and `jszip` (PDF import also needs `pdf: { workerSrc }`, the URL where you serve pdf.js's worker; with Vite `import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`). PDF import reads **text only**: paragraphs (joined across line ends, hyphenation repaired), headings from larger type and bullet or numbered lists; pictures, tables, multi-column layouts and scanned pages are not recovered (a scan is reported as having no text). The EPUB 3 file starts a chapter at each top-level heading, packs embedded pictures, writes a navigation document, and reduces anything scripted (players, forms) to text; remote pictures are not packed.

**AI suggestions, review and chat** (options of `AIAssistant`, all through your own `provider`; the request carries `action: 'complete' | 'review' | 'chat'`):
`inline: true` (or `{ delayMs, minChars, maxChars }`) shows a grey continuation at the end of a paragraph after you pause: Tab accepts, Esc or any typing dismisses it (one line, plain text, never markup). `aiReview` sends each plain paragraph to the provider and applies the answers as **tracked changes** (needs `TrackChanges`); paragraphs edited meanwhile are skipped, a reply of several lines is ignored, and one Undo takes the whole review back. `chat: true` adds an `aiChat` panel that sends your question, the selection and the document text (up to `contextChars`) and shows replies as text, with "Insert into document" (parsed as Markdown, raw HTML disabled). Document text is sent to your provider: put API keys and any filtering on your server.

**Spelling and grammar from a service**: `SpellCheck({ provider })` replaces the browser's squiggles with issues from a proofreading service. `createLanguageToolProvider(url)` talks to a LanguageTool server (the paragraph text is sent to it; run your own for private documents), or write `provider({ text, lang, signal })` returning `[{ offset, length, message, replacements, rule, kind }]`. Only paragraphs that changed are sent again (results are cached), underlines follow your edits, a click or right-click offers the suggestions, "Ignore" (a word) and "Ignore this rule", `nextIssue` jumps through them, and `checkDocument` rechecks everything. A correction is an ordinary edit, so it is tracked when Track Changes is on. The service's messages are shown as text only.

Remember to leave the default `SpellCheck` out of the plugin list when you add this one (`defaultPlugins.filter((p) => p.name !== 'spellcheck')`).

**Frameworks**: React (`wysiwygido/react`), Vue (`wysiwygido/vue`), a Svelte action and a framework-neutral binding for Angular and the rest. Plain `<wysiwyg-editor>` (web component) works everywhere too.

```svelte
<script>
  import { wysiwyg } from 'wysiwygido/svelte';
  let html = '<p>Hello</p>';
</script>
<div use:wysiwyg={{ value: html, onChange: (h) => (html = h), readOnly: false }}></div>
```

`wysiwygido/adapter` exports `bindEditor(element, config)` returning `{ editor, writeValue, onChange, onTouched, setDisabled, destroy }`, which is exactly the shape of Angular's `ControlValueAccessor`. A component for reactive and template-driven forms is a few lines (not compiled against Angular in this repo's tests; the binding itself is tested):

```ts
@Component({
  selector: 'app-editor', standalone: true, template: '<div #host></div>',
  providers: [{ provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => EditorComponent), multi: true }],
})
export class EditorComponent implements ControlValueAccessor, AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLElement>;
  private binding?: EditorBinding;
  private pending: string | null = null; private disabled = false;
  private change: (v: string) => void = () => {}; private touched = () => {};
  ngAfterViewInit() {
    this.binding = bindEditor(this.host.nativeElement, { value: this.pending ?? '', disabled: this.disabled });
    this.binding.onChange((h) => this.change(h)); this.binding.onTouched(() => this.touched());
  }
  writeValue(v: string | null) { this.pending = v; this.binding?.writeValue(v); }
  registerOnChange(fn: (v: string) => void) { this.change = fn; }
  registerOnTouched(fn: () => void) { this.touched = fn; }
  setDisabledState(d: boolean) { this.disabled = d; this.binding?.setDisabled(d); }
  ngOnDestroy() { this.binding?.destroy(); }
}
```

**Large documents**: measured in Chromium on an Apple-silicon laptop with the defaults plus comments, track changes, captions, columns, charts, form fields and embeds (one "block" is a paragraph of about 300 characters, so 10,000 blocks is roughly 3 MB of HTML, well over a thousand printed pages):

| blocks | open | typing (median / p95) | getHTML | getMarkdown | setHTML |
| --- | --- | --- | --- | --- | --- |
| 500 | 29 ms | 0.8 / 1.6 ms | 9 ms | 8 ms | 35 ms |
| 2,000 | 73 ms | 0.4 / 2.3 ms | 14 ms | 14 ms | 0.17 s |
| 5,000 | 156 ms | 0.8 / 3.2 ms | 26 ms | 30 ms | 0.6 s |
| 10,000 | 289 ms | 1.3 / 3.1 ms | 50 ms | 52 ms | 1.8 s |
| 20,000 | 548 ms | 3.3 / 4.3 ms | 101 ms | 98 ms | 6 s |

Typing stays far inside one 60 Hz frame even at 20,000 blocks; the paged view adds about a millisecond per key at 2,000 blocks. Replacing a very large document (`setHTML`, opening a file) is bound by ProseMirror creating the DOM; there is no virtualisation, so past about 20,000 blocks split the content. The measurements drove three fixes: the word count no longer re-reads the whole text on every key in big documents (it waits for a pause), Markdown export is linear instead of quadratic (20,000 blocks took 10 s), and the plugins that derive something from the whole document (captions and cross-references, table of contents, outline, footnotes, comment anchors) no longer rescan it on every keystroke. They keep an index in the editor state and re-read it only when a change touches a heading, caption, footnote or commented text (`touchesDoc` and `docIndex` in `src/plugins/helpers.ts`, which your own plugins can use too); otherwise the stored positions are just moved along with the edit. At 10,000 blocks a keystroke went from 33 ms to 1.3 ms in total. A randomised test (`tests/incremental-index.test.ts`) compares every index with a full scan after each of 120 random edits (typing, splitting, headings, comments, footnotes, captions, undo) over 100 seeds. Reproduce the table with `PERF=1 pnpm e2e e2e/perf.spec.ts --project=chromium --workers=1` (`e2e/perf-plugins.spec.ts` shows which plugins cost the most per keystroke); other browsers and slower machines will differ.

**Restricted editing**: `RestrictedEditing()` adds `locked_section` blocks (a title with the table of contents, legal
text) that cannot be changed, and `editable_region` blocks that can, while everything else stays ordinary text. It is
enforced by rejecting transactions, so typing, deleting, pasting, dropping and find & replace are all covered, including
a delete that spans a lock. Author mode (`authorMode` option, `toggleAuthorMode`, ribbon **Restrict** tab) lets a template
author lock, unlock and mark fill-in areas. Programmatic and remote (collaboration) changes are not blocked. In an app where end users fill in a template, pass `RestrictedEditing({ authorControls: false })`: the author buttons and the ribbon's Restrict tab are then hidden (the commands stay available to your own code).

**Ruler** (paged view): cm scale with zero at the left margin, shaded margins you can drag, and Word-style paragraph
markers: first-line ▼ and hanging ▲ with the left-indent box, and right indent. Drags preview with a guide line and commit once
(one undo step); markers are keyboard-operable (arrows, Shift for 10px). Works at any zoom.

**Paged view** (`pages: true | {...}`): A4/Letter/Legal, portrait/landscape, margins, per-page header and footer with
`{page}`/`{pages}`, different first page, manual page breaks (Ctrl/Cmd+Enter), a ruler with draggable margins,
outline sidebar, print CSS. Paragraphs split between lines (two lines minimum per side); tables split between rows and
lists between items.

**Review**: `Comments` (threads, replies, resolve, works in read-only mode), `TrackChanges` (suggesting mode with
accept/reject), `Versions` (named snapshots, **Compare** shows what changed against the current document or another version: blocks first, then word by word; restore is undoable, optional autosave and `localStorage` persistence),
read-only mode (`readOnly` / `setReadOnly`).

**Import / export**: HTML (`exportHTML`), print / save as PDF (`editor.execute('print')`: the document alone in a hidden frame, with the real paper size and margins and the header, footer and page numbers on every page; Chrome and Edge 131+ draw those through `@page` margin boxes, other browsers print the pages without them), Markdown (`getMarkdown` / `setMarkdown`),
`.docx` (`exportDocx`, `importDocx`; keeps headings, formatting, lists, tables, images, footnotes, comments, tracked
changes, page size/margins/orientation, header/footer, TOC field).

**Collaboration & backend**: real-time co-editing with remote cursors and per-user undo (Yjs); comment threads, replies and resolve are shared through the same Yjs document (one entry per thread and per reply, so simultaneous replies are all kept); a reference server with
REST API, owner/share-link permissions (view / comment / edit), optimistic concurrency, and a WebSocket relay;
`Autosave` with retry and conflict handling.

**AI**: `AIAssistant({ provider })` — improve, fix grammar, shorten, expand, summarize, translate, custom prompt.
Results are previewed and applied only when accepted.

**Accessibility & i18n**: ARIA roles/labels, WAI-ARIA toolbar keyboard navigation (roving tabindex), axe-core audit in the
test suite, contrast-checked styles, `forced-colors` support; toolbar translations for `id`, `es`, `ar` (`locale`,
`registerLocale`), RTL layout, React, Vue, Svelte and Angular wrappers.

## Saving to your own endpoint (and database)

Comment threads are stored **apart from the HTML** (the document only carries `data-comment-id` marks), so save both. `Autosave`
hands the threads to your `save` function, and also saves when only a thread changed (a reply, resolve or delete):

```ts
const comments = Comments({ author: 'Ana', initial: post.comments });          // load saved threads
createEditor({
  element, content: post.html,
  plugins: [...defaultPlugins, comments, Autosave({
    save: createEndpointSaver({ url: `/api/posts/${post.id}`, method: 'PUT', headers: () => ({ Authorization: `Bearer ${token}` }) }),
  })],
});
// or write it yourself:  Autosave({ save: async (html, { comments }) => { await fetch(url, { method: 'PUT', body: JSON.stringify({ html, comments }) }); } })
```

`createEndpointSaver` sends JSON `{ title, html, comments }` (reshape it with `body`), retries failures with backoff and stops on a
`409`. On your side, store `html` in a text column and `comments` in a JSON column (or a `comments` table with `id, post_id, author, text,
created_at, resolved` and a `replies` table). Validate and sanitise on the server too: the editor's schema cleans HTML on the way in, but a
server must not trust a client.

## Working offline

`Offline({ id })` keeps a draft (HTML and comment threads) in IndexedDB as you type. If the page is closed or reloaded before the server has the latest version, the
editor offers to restore it (a banner with Restore / Discard; `confirm: false` restores silently, `shouldRestore(draft)` can refuse a stale one). The draft is removed when `Autosave`
reports a successful save, or with `editor.execute('discardDraft')`. While `navigator.onLine` is false a notice says changes are kept on this device. Combine it with `Autosave`
(which retries with backoff) and `createEndpointSaver` for a save path that survives a flaky network.

## Collaboration

Two browser tabs, no server (`BroadcastChannel`):

```ts
import * as Y from 'yjs';
import { Collaboration, createBroadcastProvider } from 'wysiwygido/collab';

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

This is a **reference**, not a production server: single process, local files, no user accounts, and only document creation is rate limited
(see `createKey`, `createLimitPerMinute`, `maxDocs`). The WebSocket token travels in the URL query (it can end up in logs).
Put it behind TLS and your own auth and rate limiting before real use.

## AI assistant

```ts
AIAssistant({ provider: createFetchProvider('/api/ai') }) // your server calls the model; never put API keys in the browser
```

A provider is any `(req) => Promise<string> | AsyncIterable<string>`; stream chunks and the preview updates live.
Model output is parsed as Markdown with raw HTML disabled, so it cannot inject markup. What the endpoint must return is described in
[Endpoints your app provides](#endpoints-your-app-provides).

## Stability and versioning

The package follows [semantic versioning](https://semver.org/). Since 1.0.0 only a major release may break the public API (before it, minor releases could). What counts as the public API:

- **Everything exported** from `wysiwygido` and its entry points (`/data-table`, `/docx`, `/pdf`, `/epub`, `/collab`, `/react`, `/vue`, `/svelte`, `/adapter`). The list of names is a test (`tests/api-surface.json`): removing or renaming one fails the build.
- **The plugin contract**: the `EditorPlugin` hooks, `editor.registerCommand` / `execute` / `on`, command names, and the events the editor emits.
- **What is stored in documents**: the HTML attributes (`data-data-table`, `data-chart`, `data-cover-page`…) and the JSON they hold. Each stored format is read by every later version; the data table's format carries a version number (`v`), and a table saved by a *newer* version than the one reading it is shown, kept untouched and not editable, so an older copy can never lose data. Golden files for these formats are tests (`tests/formats.test.ts`).
- **The CSS custom properties** (`--wy-*`) used for theming.

Not part of it: the `wy-*` class names and the exact DOM the editor builds, internal modules not exported from an entry point, and the exact wording of interface text and error messages. `defaultPlugins` may gain plugins in a minor release. Anything deprecated keeps working for at least one minor release and is listed in the changelog. Supported browsers are the current versions of Chrome, Edge, Firefox and Safari (all four are tested), and the oldest builds that were run with every check passing are Chrome / Edge 94, Firefox 91 and Safari 16.4 (the table of tested builds and what older browsers lack is on the demo site under "Browser support"; `scripts/compat` runs it again); the pure functions (`dataTableToCSV`, `dataTableToXlsx`, `queryDataTable`…) also run on Node 18+.

## Endpoints your app provides

The editor calls your code at a few points. Each contract below is exercised by `server/examples/api.ts` (`pnpm server:examples`, port 8788),
a dependency-free Node server with a test (`tests/example-api.test.ts`) that uses the editor's own helpers against it.
Try it with the AI demo: `…/demo/ai.html?endpoint=http://127.0.0.1:8788/api/ai`.

| Callback | Sends | Must return |
| --- | --- | --- |
| `AIAssistant({ provider: createFetchProvider(url) })` | `POST` JSON `{ action, instruction, text }` | **plain text** (not JSON), `200`, may be streamed. See the table below. |
| `createEndpointSaver({ url })` for `Autosave` | `PUT`/`POST` JSON `{ title, html, comments }` | any `2xx` (`204` is fine); JSON in the reply goes to `onSaved(json)`; `409` = conflict (stops retrying), other errors are retried with backoff |
| `uploadImage: (file) => Promise<string>` | whatever you send (the example takes the raw bytes) | the image **URL** as a string: `https`, `http`, a same-site path (`/uploads/a.png`) or a `data:image/…` URL; anything else is refused |
| `Recording({ upload: (blob, kind) => Promise<string> })` | the recording | the file's URL as a string (`https`, a same-site path, or `data:audio|video/…`) |
| `SpellCheck({ provider: createLanguageToolProvider(url) })` | `POST` form `text=…&language=…` | LanguageTool's JSON: `{ matches: [{ offset, length, message, replacements: [{ value }], rule: { id, issueType } }] }` |
| `SpellCheck({ provider })` (your own) | `{ text, lang, signal }` | `[{ offset, length, message, replacements?: string[], rule?, kind?: 'spelling' \| 'grammar' \| 'style' }]`, offsets in characters of the text sent |
| `Mentions({ search })` | the typed text | `[{ id, label }]` (may be a Promise) |
| `DataTable({ sources: { orders: createFetchDataSource(url) } })` | `GET url?page&pageSize&search&sort&filters` (`sort` and `filters` are JSON) | JSON `{ rows, total, totals? }`: one page, the number of matching rows, and footer totals over all of them. Try it with the data table demo: `…/demo/data-table.html?endpoint=http://127.0.0.1:8788/api/orders` |
| `PdfEpub`, `Embeds`, `Offline` | nothing to your server | they run in the browser |

**What an AI endpoint returns per `action`** (the full instruction is in `instruction`, pass it to the model as the system prompt and `text` as the user message). The reply is the text itself: no "Here is…", no quotes, no JSON wrapper.

| `action` | `text` is | return |
| --- | --- | --- |
| `improve`, `grammar`, `shorten`, `expand`, `translate`, `custom` | the selection (or the whole document) | the revised text only; Accept replaces the selection with it |
| `summarize` | the selection | the summary only; inserted below the selection |
| `complete` (suggestions while typing) | up to 1,200 characters before the cursor | only the continuation, **one line**, not repeating the given text (cut to `maxChars`) |
| `review` | one paragraph | the corrected paragraph as **one line**; a multi-line reply or an identical text means "no change" |
| `chat` | the document text as context (the question and earlier turns are in `instruction`) | the answer; Markdown is fine, raw HTML is not rendered |

```ts
// An endpoint that streams a model's answer (Express shown; any server works)
app.post('/api/ai', express.json(), async (req, res) => {
  const { instruction, text } = req.body;
  res.type('text/plain');
  for await (const chunk of model.stream({ system: instruction, user: text })) res.write(chunk.text);
  res.end();
});

// If your API replies with JSON, write the provider yourself and return a string (or an async iterable of strings)
AIAssistant({ provider: async ({ action, instruction, text, signal }) => {
  const r = await fetch('/api/ai', { method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, instruction, text }) });
  if (!r.ok) throw new Error(`AI failed (${r.status})`);
  return (await r.json()).text;
} })
```

Errors: throw (or return a non-2xx status from `createFetchProvider`) and the panel shows "AI request failed" with the message; an empty reply is treated as an error. Validate and limit everything on the server (size, rate, authentication): the editor's checks are for safety in the page, not for your API.

## Creating a .docx from your code

`editor.exportDocx(options?)` builds the Word file and resolves with a `Blob`; call it from a button, a shortcut, an editor event or before an upload.
It needs the optional `docx` package, which is loaded only when you call it: pass `docx: () => import('wysiwygido/docx')` to `createEditor` (see above).

```ts
const blob = await editor.exportDocx();                           // just the file
await editor.exportDocx({ download: 'report.docx' });             // and save it in the browser (true = named after the title)
await editor.exportDocx({ title: 'Q3', comments: threads, fetchImages: false });

editor.execute('exportDocx', { download: true });                 // the same as a command: toolbar items, keymap, ribbon
editor.on('export', ({ format, blob }) => upload(blob));          // fired after every export
editor.on('exportError', (err) => report(err));                   // missing "docx" package, a failed image, ...
editor.on('change', debounce(() => editor.exportDocx(), 3000));   // from an event

const form = new FormData(); form.append('file', await editor.exportDocx(), 'report.docx');   // to a server
await editor.importDocx(file);                                    // the other direction (needs "mammoth"); editor.on('import', ...)
```

Equations become native Word equations and diagrams become pictures (see below). The File tab of the ribbon uses the same commands, so
`ribbon: true` works without any `onExportDocx` / `onOpenDocx`. The lower-level `buildDocx(editor)` / `exportDocx(editor)` from `wysiwygido/docx` remain.
Generation needs a DOM (it reads the editor's document and uses a canvas for crops and diagrams), so run it in the browser or in a DOM environment such as jsdom, not in plain Node.

## Arranging the toolbar

`toolbar` takes a list of names, or an options object. Entries can be a plugin item name, `'|'` (separator), `'-'` (new row),
`'>'` (spacer: everything after it goes to the far end), an item you define on the spot, or a named group:

```ts
createEditor({
  element, plugins,
  toolbar: {
    items: [
      { group: 'Text', items: ['bold', 'italic', 'underline'] },
      '|', 'heading', 'bulletList', '-',                       // second row
      'link', 'image', '>',
      { name: 'clear', label: 'Clear', icon: '🧹', run: (editor) => editor.setHTML('<p></p>') },
    ],
    position: 'bottom',          // 'top' (default) | 'bottom'
    sticky: true,                // stay in view while scrolling
    overflow: 'more',            // 'wrap' (default) | 'more' (a "⋯" menu) | 'scroll'
    align: 'center',             // 'start' | 'center' | 'end'
    hide: ['strike'],            // leave items out of the default layout
  },
});
editor.setToolbar({ items: ['bold', 'italic'] });   // rearrange later; `false` removes the toolbar
```

Without `items` you get every plugin's buttons in plugin order. For the ribbon, `ribbon: { tabs, customize(tabs) => tabs }` lets you add, remove,
reorder or rename tabs, groups and controls.

## Writing a plugin

A plugin is a plain object. Everything is optional except `name`; `definePlugin` just gives you type checking:

```ts
import { definePlugin, registerIcon } from 'wysiwygido';

const Callout = definePlugin({
  name: 'callout',
  requires: ['word-count'],                       // fails fast with a clear message if it is not installed
  nodes: { callout: { /* ProseMirror NodeSpec */ } },
  marks: { /* ProseMirror MarkSpec */ },
  setup(editor) {                                  // once the schema exists
    editor.registerCommand('insertCallout', (e, kind = 'info') => { /* ... */ return true; });
    return [/* ProseMirror plugins: decorations, node views, input rules */];
  },
  toolbar: [{ name: 'callout', label: 'Callout', icon: '💡', command: 'insertCallout' }],
  keymap: { 'Mod-Alt-c': 'insertCallout' },        // a command name, or (editor) => boolean
  ribbon: { tab: 'insert', after: 'tables', group: { id: 'callout', label: 'Callouts', controls: [/* ... */] } },
  onReady(editor) { editor.on('change', () => {}); },
  destroy(editor) { /* remove listeners, timers, DOM */ },
  priority: 0,                                     // higher runs first (keymaps)
  transformTransaction(tr, state) { return tr; },  // rewrite user edits (track changes uses it)
});
```

Install it like any other: `plugins: [...defaultPlugins, Callout]`. A plugin can take options by being a function that returns the object
(`Comments({ author })`). Plugins talk to the page through **events**: `editor.on('ready' | 'change' | 'selection' | 'focus' | 'blur' | 'command' | 'destroy' | yourEvent, fn)`
returns an unsubscribe function, and `editor.emit('my-event', payload)` tells others (a listener that throws is reported and does not stop the rest).
`registerIcon(name, svgInner)` adds an icon for ribbon buttons. See `demo/custom-plugin` for a complete third-party plugin, and `src/plugins/` for the built-in ones.
Plugins are fixed when the editor is created (the schema cannot change afterwards); commands, toolbar layout and listeners can change at any time.

## Change case

`TextCase` (in `defaultPlugins`) changes the case of the selection, or of the word at the caret: UPPERCASE (`Ctrl/⌘+Alt+U`), lowercase (`Ctrl/⌘+Alt+L`),
tOGGLE cASE (`Ctrl/⌘+Alt+G`), snake_case (`Ctrl/⌘+Alt+S`), camelCase (`Ctrl/⌘+Alt+M`), plus Title Case, Sentence case, PascalCase and kebab-case from the menu.
`Shift+F3` cycles lowercase, UPPERCASE, Title Case and Sentence case like Word. The menu is the **Aa** button in the Home tab's Font group and *Change case*
in the right-click menu. Upper/lower/toggle/title/sentence keep every bold, link and colour in place; snake/camel/kebab join the words into one
identifier that takes the formatting of its first letter. From code: `editor.execute('changeCase', 'snake')` or the pure `convertCase(text, 'camel')`.

## Data table

A table of records that people can search, sort, filter, page through, edit and export, in the middle of a document. It is a separate block from the ordinary table: the rows are stored as data, so sorting or filtering changes only what is shown, never the document.

```ts
import { createEditor, defaultPlugins, DataTable } from 'wysiwygido';

const editor = createEditor({
  element,
  plugins: [...defaultPlugins, DataTable({
    buttons: [{ id: 'ship', label: 'Ship', needsSelection: true, onClick: ({ selected }) => ship(selected) }],
    rowActions: [{ label: 'View', onClick: (row, index) => open(row.id) }],
  })],
});

editor.execute('insertDataTable', {
  columns: [{ key: 'name', title: 'Product', type: 'text' }, { key: 'price', title: 'Price', type: 'currency', currency: 'USD', total: 'sum' }],
  rows: [['Tea', 4.5], ['Cake', 6]],
  options: { title: 'Menu', pageSize: 25, filters: true, selectable: true },
});
```

- **Columns** are `text`, `number`, `currency`, `date`, `boolean` or `select`, each with its own editor, format, alignment and an optional footer total (`sum`, `avg`, `count`, `min`, `max`). Add, edit, move, hide and delete them from the heading menu.
- **Search and filter:** a search box, and an optional filter row. Text filters match "contains"; number and date filters take `>5`, `>=5`, `<5`, `5..10`, `=5`, `!=5`.
- **Sort** by clicking a heading (Shift+click for a second column). Empty values always come last.
- **Paging** with 10, 25, 50, 100 or all rows per page. Nothing is drawn beyond the page. With paging off, a table of more than about 200 rows draws only the rows in view and scrolls (20,000 rows stay smooth).
- **Group by** one to three columns from the heading menu (or `options.groupBy`). Each group has a heading with its row count and the footer totals of its columns, and can be folded. A page that starts inside a group repeats the heading.
- **Editing:** double-click or press Enter on a cell, Enter or Tab to save and move, Esc to cancel. Arrow keys move between cells. Every edit is one undo step.
- **Buttons:** your own toolbar buttons (`needsSelection` keeps one disabled until rows are ticked) and a button on every row.
- **Export:** CSV, Excel (.xlsx) and PDF from the Export menu, using what is shown (filtered, sorted, visible columns), or only the ticked rows. The .xlsx file is written by the editor itself, with no library: a bold frozen header, filter buttons, number, currency and date formats. CSV text that starts with `=`, `+`, `-` or `@` is quoted so a spreadsheet does not run it. PDF uses the print dialog (choose "Save as PDF"), so every script and font works.
- **Convert both ways:** `tableToDataTable` turns the table at the cursor into a data table (the first row names the columns, types are guessed from the values), and `dataTableToTable` turns the selected data table back into an ordinary table. Also in the right-click menu.
- **Look:** follows the colour theme. Options: striped rows, cell borders, row height, a fixed height with a sticky heading. The block is exported to Word as a real table, to Markdown as a table, and to HTML with a plain table inside.
- **Import:** `editor.execute('dataTableFromFile')` opens a file picker for CSV, TSV or Excel (.xlsx); `dataTableFromCSV(text)` and `dataTableFromExcel(file)` take the content directly. The first row names the columns and each column's type is guessed (dates stay dates). The .xlsx reader is also written here, with no library, and reads the first visible sheet.
- **Formula columns:** give a column a formula over the other columns of the same row: `[Price] * [Qty]`, `IF([Stock] < 5, "Reorder", "OK")`, `ROUND([Total] / [Count], 2)`. The results are calculated, never stored, and can be searched, filtered, sorted, totalled and exported like any column. Operators `+ - * / % ^ &` and comparisons; functions `IF AND OR NOT ROUND FLOOR CEIL ABS SQRT POWER MOD MIN MAX SUM AVERAGE COUNT LEN UPPER LOWER TRIM LEFT RIGHT CONCAT CONTAINS ISEMPTY TODAY YEAR MONTH DAY DAYS`. Errors show as `#DIV/0!`, `#REF!`, `#CYCLE!` and so on. The formula language is its own small parser (no `eval`): it can only calculate from its row.
- **Highlight rules and bars:** Options → Highlight rules colours cells (or whole rows) that match a condition written like a filter box (`>100`, `5..10`, `Overdue`, `empty`) in red, green, amber, blue, gray or bold, using the theme's colours. The colours also go into .xlsx and PDF files. A column can draw a bar in each cell, in proportion to the largest value.
- **Saved views:** Views → Save current view keeps the search, filters, sort, grouping, hidden columns and rows per page under a name; readers can apply a view too (they get the search, filters and sort).
- **Details:** `options.detail` adds an open button to each row. By default it lists every field, including hidden columns; `DataTable({ detail: (row) => element })` shows what you build (it may be async).
- **Resize and reorder:** drag a heading's right edge (or focus it and use the arrow keys; double-click resets). With `options.reorder`, drag the ⠿ handle or press Alt+Up / Alt+Down to move a row, while no search, sort or filter makes the order on screen different from the stored one.
- **Charts:** Options → Chart of these rows makes a bar, line or pie chart (the Charts plugin) from the rows on screen, right after the table.
- **Rows from a server:** set `options.source` to a name and give the plugin a function for it. The table then asks for one page at a time and stores no rows in the document.

```ts
DataTable({
  sources: {
    orders: createFetchDataSource('/api/orders'),      // GET /api/orders?page=0&pageSize=25&search=…&sort=[…]&filters={…} -> { rows, total, totals }
    // or write your own: async ({ page, pageSize, search, filters, sort }) => ({ rows, total, totals: { amount } })   (rows as arrays or { columnKey: value })
  },
  onEdit: async ({ key, value, row }) => api.patch(row.id, { [key]: value }),      // optional: without it the table is read-only
});
editor.execute('insertDataTable', { columns: [...], rows: [], options: { source: 'orders', pageSize: 25, filters: true } });
```

  Search is sent after a short pause, only the newest answer is shown, a failure shows its message with a "Try again" button, and Export asks the source for every matching row. Ticked rows are those on the current page. Groups show the rows of the current page.

The pure parts (`dataTableToCSV`, `dataTableToXlsx`, `dataTableToPrintHTML`, `queryDataTable`, `cleanDataTable`, `dataTableWithFormulas`, `parseXlsx`) are exported too, so a server can build the same files.

### Add, edit and delete, with a guard

```ts
createDataTable({
  element, table,
  crud: {
    user: { id: 'eka', roles: ['editor'], permissions: ['tickets.create'] },   // or a function that returns the person
    access: {
      create: ['editor', 'admin'],                         // a role or a permission; 'tickets.*' matches a family
      update: (user, row) => hasDataTableAccess('admin', user) || row?.owner === user?.id,
      delete: { roles: ['admin'] },                        // roles: one of them; permissions: all of them
    },
    onCreate: async (row) => (await api.post('/tickets', row)).data,       // return the saved row (its new id)
    onUpdate: (row, before) => api.put(`/tickets/${before.id}`, row),
    onDelete: (rows) => api.delete('/tickets', rows.map((r) => r.id)),     // throw to refuse: the message shows in the dialog
  },
});
app.setUser(otherUser);   // after sign-in or sign-out (`editor.extensions.dataTable.setUser` in the editor)
```

`crud` adds a **New…** button, **Edit** and **Delete** on every row and a confirmation before anything is deleted; the dialogs have a field for every column that is not calculated. Without a rule an action is open to everyone; `create: false`, `update: false` or `delete: false` remove it altogether, and `confirmDelete: false` skips the question. A button the person may not use is not drawn, and typing in a cell, the keyboard and the API are refused as well. A save that fails keeps the dialog open with the message. This only shapes the interface: enforce the same rules on your server. The examples are on the demo site under "Data table" (roles, 5,000 rows from a server, budget, stock, directory, import and export).

### Without the editor

The same table works on its own: no editor, no ProseMirror. Import `wysiwygido/data-table` (a small entry point that pulls in nothing else; the build checks that) and the stylesheet.

```ts
import { createDataTable } from 'wysiwygido/data-table';
import 'wysiwygido/style.css';

const app = createDataTable({
  element: document.querySelector('#grid')!,
  table: { columns: [{ key: 'name', title: 'Name' }, { key: 'qty', title: 'Qty', type: 'number', total: 'sum' }], rows: [{ name: 'Tea', qty: 3 }], options: { pageSize: 25, filters: true } },
  theme: 'nord',                       // 'light' | 'dark' | 'auto' | a theme name | a theme object
  onChange: (table) => save(table),    // after every edit, new row, resized column…
  buttons: [{ id: 'ship', label: 'Ship', needsSelection: true, onClick: ({ selected }) => ship(selected) }],
  sources: { orders: createFetchDataSource('/api/orders') },   // for tables with options.source
});

app.getRows();  app.visibleRows();  app.selectedRows();
app.undo();  app.redo();             // its own history (Ctrl/⌘+Z and Ctrl+Y work too)
app.setTheme('dark');  app.setReadOnly(true);  app.setTable(newTable);
app.export('xlsx');  app.download('csv');
app.destroy();
```

Rows can be arrays in column order or objects by column key (objects are easier when some columns are calculated). Everything above (search, filters, sort, paging, groups, formulas, highlight rules, saved views, details, resizing, reordering, export, loading from a server) works the same way, and the table has its own right-click menu. As a custom element:

```html
<script type="module">import { defineDataTableElement } from 'wysiwygido/data-table'; defineDataTableElement();</script>
<wysiwyg-data-table theme="nord" readonly>
  <script type="application/json">{ "columns": [{ "title": "Language" }, { "title": "Year", "type": "number" }], "rows": [["C", 1972], ["TypeScript", 2012]] }</script>
</wysiwyg-data-table>
```

Events `table-ready` and `table-change` (`detail.table`); the element's `table` property sets or reads the table.

## Themes

Ten colour themes ship with the editor: `light`, `dark`, `sepia`, `ocean`, `forest`, `rose`, `solarized`, `midnight`, `nord` and `high-contrast`. A theme restyles the toolbar, ribbon, panels and the paper, and only inside the editor.

```ts
import { createEditor, defaultPlugins, Themes } from 'wysiwygido';

createEditor({ element, plugins: [...defaultPlugins, Themes({ initial: 'sepia' })] });
editor.execute('colorTheme', 'midnight');
editor.execute('cycleColorTheme');
editor.execute('clearColorTheme'); // back to the stock look
```

Pick one from **View → Themes** in the ribbon, or use `<wysiwyg-editor theme="nord">`. Dark Mode on its own returns to the stock look.

Your own theme is a handful of colours; hover, borders, selection and the rest are derived from them:

```ts
Themes({ extra: [{ name: 'brand', label: 'Brand', palette: { mode: 'light', bg: '#fff8f0', surface: '#ffeede', fg: '#2a1a10',
  muted: '#7a5a44', border: '#f0d6bf', accent: '#e8590c', workspace: '#f0d2b8', pageBg: '#fff', pageFg: '#2a1a10' } }] });
```

`editor.extensions.themes` gives `list()`, `current()`, `register(theme)`, `apply(name)` and `clear()`. A theme can also set any `--wy-*` variable through `vars`.

## Cover page

`Cover` (in `defaultPlugins`) adds a cover page: one picture that fills the whole first page, edge to edge, with the text starting on page 2. Use
**Layout → Cover Page** (also under Insert) to upload a picture or give its address; choosing it again replaces the picture, and *Remove cover page* takes it out.
It goes through your `uploadImage` handler like any picture, is exported to Word as a picture anchored to the page, and is a block named `cover_page` in the document.
`editor.execute('coverPage', url, alt)` does the same from code. Page numbers count the cover as page 1.

## Right-click menu

`ContextMenu` is in `defaultPlugins`. Right-click shows cut/copy/paste and then what applies at the click: table tools in a table (insert/delete
rows and columns, merge/split, header row/column, cell colour, select, even column widths), list tools in a list (bulleted/numbered/checklist,
indent, numbering style, restart numbering), link tools on a link (open, copy address, edit, remove), picture tools on a picture (alt text, caption,
size, crop, edit, delete), and text formatting on a selection. It opens from the keyboard with the Menu key or Shift+F10, works with the arrow keys,
Escape closes it, and Shift + right-click gives the browser's own menu. A read-only editor only gets copy, open link and select all.
Deleting the last row or column of a table now removes the table, and Backspace/Delete in an empty one-cell table removes it too.

Add your own lines from any plugin:

```ts
definePlugin({
  name: 'my-menu',
  contextMenu({ closest, readonly }) {
    if (readonly || !closest('blockquote')) return [];
    return ['-', { label: 'Remove quote', command: 'blockQuote' }, { label: 'Say hi', run: (editor) => alert('hi') }];
  },
});
```

Items take `label`, `command`/`args` or `run`, `icon`, `shortcut`, `disabled`, `checked`, `danger`, `readOnly` and `items` (a submenu); `'-'` is a separator.
Leave the plugin out of `plugins` to have no custom menu.

## Known limitations

- **Pagination is visual.** The document stays one ProseMirror doc; blocks are measured in the browser and spaced across
  pages, so page geometry can differ slightly (a few px, occasionally ~15px on the page where a table turns into a list)
  from a true layout engine, and from print output. Verified in Chrome only. Header rows do not repeat across pages.
- Footnotes are collected at the end of the document (endnotes), not at the bottom of each page.
- **Server hardening knobs:** `createServer({ createKey, createLimitPerMinute, maxDocs })` protect document creation (a key, a per-address rate and a total cap; the defaults are 60 per minute and 10,000 documents). Put the server behind a reverse proxy with TLS and your own rate limiting for public use; tokens in a URL are accepted for reads and WebSocket only.
- **Restricted editing** is enforced in the browser only: it protects against accidental edits, not against someone who edits the stored HTML or talks to the server directly.
- **Track changes** tracks inline edits inside one paragraph; structural edits (splitting/joining blocks, tables) apply untracked.
- **PDF** is the browser's print dialog (Save as PDF), not a generated file. Running headers and footers use `@page` margin boxes (Chrome / Edge 131+); Firefox and Safari print the document without them. Page breaks are the browser's own, so they can differ slightly from the on-screen pagination.
- **.docx import** goes through mammoth: alignment, colors, page setup and comments are not imported. Export embeds
  `data:` images and fetches remote ones when CORS allows; otherwise it writes the alt text.
- Image cropping, resize, captions and alt text are supported; the .docx export crops with canvas in browsers and exports the full image where canvas is unavailable.
- Formula columns follow merged cells (`colspan`/`rowspan`), but a formula only sees its own table.
- The code editor's extra cursors are carets only (no multiple selections, no select-next-occurrence), folding is by indentation (not by syntax), and the built-in highlighter is a scanner, not a parser (no nested template literals or regex literals).
- Ribbon icons are drawn for this project (outline style, in the spirit of office suites); they are not Microsoft's assets.
  Dictation, the Microsoft Editor and add-ins from Word's ribbon are not included. Zoom uses CSS `zoom` (Chrome, Safari, Firefox 126+).
- Ribbon labels are translated for Indonesian only (toolbar labels also for Spanish and Arabic); menu entries stay English.
- Translations cover toolbar labels in 3 languages and have not been reviewed by native speakers.
- Tested with jsdom (unit), axe-core, and Playwright end-to-end tests of the built demo site in **Chromium, Firefox and WebKit** (`pnpm e2e`: typing, paste from Word, pagination, comments, locked sections, collaboration, equations and diagrams, .docx, code editor, image editor, and every demo page loading without errors). Layout details such as exact page breaks were checked in Chrome only, and nothing was tested with screen readers.

## Security notes

Pasted/loaded HTML goes through the schema: unknown tags and attributes are dropped; link and image URLs are limited to
safe schemes (`javascript:` is rejected); Markdown import disables raw HTML; user text (comments, mentions, footnotes, AI
output) is rendered with `textContent`; the server compares secrets in constant time, stores only hashes, bounds request
size and treats unknown documents and bad credentials identically.

## License

MIT
