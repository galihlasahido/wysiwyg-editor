# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes; they are listed under "Changed" or "Removed".

## 0.3.0

- Added: change case (UPPER, lower, toggle, snake_case, camelCase, Title, Sentence, PascalCase, kebab-case) with shortcuts, a Home-tab menu and a right-click submenu; `Shift+F3` cycles.
- Added: cover page (`Cover` plugin, Layout and Insert tabs): a picture over the whole first page, exported to Word anchored to the page.


## 0.2.2

- Added: right-click menu (`ContextMenu`, in the default set) with table, list, link, picture and text-format items, and a `contextMenu(context)` hook for plugins to add their own.
- Added: `addRowBefore`, `addColumnBefore`, `toggleHeaderColumn`, `selectTable`, `selectRow`, `selectColumn`, `distributeColumns`, `listStyle` and `restartNumbering` commands.
- Fixed: a table reduced to one row, one column or one empty cell could not be deleted. Deleting its last row or column now removes the table, and Backspace/Delete in an empty single cell does too.
- Changed: `bulletList` / `orderedList` inside a list of the other kind now convert it instead of lifting out.

## [Unreleased]

## [0.2.1] - 2026-10-11

The first release that includes the 0.2.0 changes below: 0.2.0 itself was never published to npm.

### Fixed
- Tables and lists pasted from Word (and Google Docs) were far too loose: every cell and list item carried the browser's 1em paragraph margins, so a one-line table row was about 70 px tall. Paragraphs inside table cells and list items now have no margin, and cell padding and line height are compact (`--wy-cell-pad-y`, `--wy-cell-pad-x`, `--wy-cell-line-height` adjust them). Spacing set on purpose through the paragraph menu still applies.

## [0.2.0] - 2026-10-06

### Changed (breaking)
- Optional packages are no longer imported by the editor itself. Angular's esbuild builder (and webpack-based builds) failed with `Could not resolve "katex"` (also `mermaid`, `docx`, `mammoth`, `jszip`, `pdfjs-dist`) when those packages were not installed, even though the code only loaded them lazily. Now you pass a loader: `createEditor({ docx: () => import('wysiwygido/docx') })`, `Equations({ katex: () => import('katex') })`, `Mermaid({ mermaid: () => import('mermaid') })`, `PdfEpub({ loadPdf, loadEpub })`. Without one, the feature explains what to add. `pnpm check:optional` fails the build if the main entry ever imports an optional package again.
- Verified in real apps: React, Vue, Svelte (Vite) and Angular 20 builds, plus a no-build page loading the package from a CDN.

### Changed
- Large documents: plugins that derive data from the whole document (captions, table of contents, outline, footnotes, comment anchors) update incrementally instead of rescanning on every keystroke; the word count waits for a pause on big documents; Markdown export is linear. Typing at 10,000 blocks: 33 ms to 1.3 ms per key.

## [0.1.1] - 2026-10-06

### Fixed
- `wysiwygido/package.json` can be imported (it is now listed in `exports`), which tools that read the package version expect.

## [0.1.0] - 2026-10-05 - first public release

The package is named `wysiwygido` (the `wysiwyg-editor` name on npm belongs to another project). Builds are not minified and ship with source maps; your bundler minifies.

A modular rich-text editor on ProseMirror with a plugin architecture. Everything below ships in this release.

### Editing
- Plugin architecture (`EditorPlugin`, `definePlugin`), command registry, events, toolbar layout configuration, Office-style ribbon, balloon toolbar, slash commands, dark mode, i18n (en, id, es, ar) and RTL.
- Text, headings, lists and checklists, tables (merge, split, header, cell colour), images (upload, resize, crop, alt text, captions), links, code blocks with highlighting, footnotes, special characters, format painter, find and replace (regular expressions, whole words), word count, spell check.
- Paged view with header, footer, page numbers, ruler, margins, orientation, page breaks and outline; print with real page setup.
- Columns (2 to 4, column breaks, whole-page columns), captions with cross-references and lists of figures, charts from tables, form fields (checkbox, drop-down, date, text), embedded media (YouTube, Vimeo, OpenStreetMap, custom providers), equations (KaTeX) and diagrams (Mermaid), table formulas, merge fields.
- Restricted editing (locked sections and fill-in regions), templates, mentions, comments with replies and resolve, track changes (suggesting mode), version history with visual compare.

### Collaboration and storage
- Real-time collaboration with Yjs (cursors, per-user undo, presence bar, shared comments), reference server with documents API, share links, permissions and a WebSocket relay, autosave and save-to-endpoint, offline drafts (IndexedDB).
- File manager and image editor.

### Import and export
- `.docx` import and export (native equations, diagrams and charts as pictures, comments, tracked changes, real Word columns), HTML, Markdown, email-safe HTML, PDF import (text), EPUB export, print.

### AI and proofreading
- `AIAssistant` with your own provider: actions, streaming preview, inline suggestions, whole-document review as tracked changes, chat panel.
- Spelling and grammar from a proofreading service (LanguageTool-style) with suggestions and ignore rules.
- Audio and screen recording, dictation.

### Frameworks
- `<wysiwyg-editor>` web component, React, Vue, a Svelte action and a framework-neutral `bindEditor` for Angular and others.

### Quality
- 560+ unit tests (Vitest, jsdom), end-to-end tests in Chromium, Firefox and WebKit (Playwright), axe accessibility and stylesheet contrast checks, Content-Security-Policy on the built demos, hardened server, inert HTML parsing and URL allow-lists.

### Known limitations
See the README section "Known limitations".

[Unreleased]: https://github.com/galihlasahido/wysiwyg-editor/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/galihlasahido/wysiwyg-editor/compare/v0.1.1...v0.2.1
[0.2.0]: https://github.com/galihlasahido/wysiwyg-editor/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/galihlasahido/wysiwyg-editor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/galihlasahido/wysiwyg-editor/releases/tag/v0.1.0
