# wysiwyg-editor

A modular, plugin-based WYSIWYG rich-text editor in TypeScript, inspired by
[CKEditor 5](https://ckeditor.com/ckeditor-5/capabilities/) and built on [ProseMirror](https://prosemirror.net/).

## Quick start

```ts
import { createEditor } from 'wysiwyg-editor';
import 'wysiwyg-editor/style.css';

const editor = createEditor({
  element: document.getElementById('editor')!,
  content: '<p>Hello</p>',
  onChange: (html) => console.log(html),
});

editor.execute('bold');
editor.getHTML();
```

Pick your own features and toolbar:

```ts
import { Editor, Essentials, BasicStyles, Heading } from 'wysiwyg-editor';

new Editor({
  element,
  plugins: [Essentials, BasicStyles, Heading],
  toolbar: ['undo', 'redo', '|', 'heading', 'bold', 'italic'],
});
```

## Features (v0.1)

Bold / italic / underline / strike / inline code · headings · text alignment · text color & highlight ·
bulleted & numbered lists with indent · block quote · code block · horizontal line · links ·
images (URL, file picker, paste, drag & drop; pluggable `uploadImage` adapter, Base64 by default) · tables ·
undo/redo · font family/size · line spacing · checklists · Markdown import/export (`getMarkdown()` / `setMarkdown()`) ·
Markdown-style autoformat (`# `, `- `, `1. `, `> `, ` ``` `, `**bold**`).

### Paged view (Google Docs-style)

```ts
createEditor({
  element,
  pages: { size: 'a4', header: 'My document', footer: 'Page {page} of {pages}' },
  outline: true,
});
```

Page cards with A4/Letter/Legal sizes, margins, per-page header and footer with page numbers, manual page
breaks (Ctrl/Cmd+Enter), a ruler with draggable left/right margins, a heading outline sidebar and print CSS.
Pagination is visual: the document stays one ProseMirror doc and blocks are measured and spaced across pages.
Known limitation: a single block taller than a page is not split; it overflows onto its own page.
Link and image URLs are restricted to safe schemes.

## Writing a plugin

```ts
const MyPlugin: EditorPlugin = {
  name: 'my-plugin',
  marks: { /* ProseMirror MarkSpec */ },
  setup(editor) { editor.registerCommand('hello', () => true); },
  toolbar: [{ name: 'hello', label: 'Hello', command: 'hello' }],
};
```

## Roadmap — goal: a Google Docs-style editor on the web

- [x] Core editing, lists, tables, images, links, alignment, colors, Markdown
- [x] **Docs-style editing (partial):** font family/size, line spacing, checklists
- [ ] Still to do: table cell merge/styling, image resize/crop/captions
- [x] **Page layout:** paginated view, page size/margins, header/footer, page numbers, page breaks, ruler, outline sidebar
- [ ] Still to do: splitting long blocks/tables across pages, different first-page header, table of contents block, orientation
- [ ] **Productivity:** find & replace, word count, format painter, special characters, footnotes, spell check, templates
- [ ] **Collaboration:** real-time co-editing with cursors (Yjs), comments, suggesting mode / track changes, version history, mentions
- [ ] **Import/export:** .docx import/export, PDF, HTML, Markdown, print
- [ ] **Sharing & storage:** document model/storage backend, permissions, share links, autosave
- [ ] **AI assistant** hooks (summarize, rewrite, grammar)
- [ ] React / Vue wrappers, i18n, RTL, WCAG audit

## Development

```sh
pnpm install
pnpm dev        # demo at http://localhost:5173
pnpm test
pnpm build
```

## License

MIT
