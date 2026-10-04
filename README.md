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

Bold / italic / underline / strike / inline code · headings · bulleted & numbered lists with indent ·
block quote · code block · horizontal line · links · images (URL) · tables · undo/redo ·
Markdown-style autoformat (`# `, `- `, `1. `, `> `, ` ``` `, `**bold**`).
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

## Roadmap

- [ ] Image upload adapters, resize, captions
- [ ] Text alignment, font family/size/color, highlight
- [ ] Markdown import/export
- [ ] Find & replace, special characters, format painter
- [ ] Mentions, merge fields
- [ ] Word / PDF export
- [ ] Comments, track changes, revision history
- [ ] Real-time collaboration (Yjs)
- [ ] AI assistant hooks
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
