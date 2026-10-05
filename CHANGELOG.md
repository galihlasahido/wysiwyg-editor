# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Until 1.0, minor versions may contain breaking changes; they are listed under "Changed" or "Removed".

## [Unreleased]

## [0.1.0] - first public release

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

[Unreleased]: https://github.com/galihlasahido/wysiwyg-editor/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/galihlasahido/wysiwyg-editor/releases/tag/v0.1.0
