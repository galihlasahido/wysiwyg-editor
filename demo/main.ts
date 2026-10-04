import { createEditor } from '../src';

const out = document.getElementById('out')!;
const editor = createEditor({
  element: document.getElementById('editor')!,
  placeholder: 'Start typing… try "# " or "- " or **bold**',
  content: '<h1>Hello 👋</h1><p>This is a <strong>WYSIWYG</strong> editor built on ProseMirror.</p>',
  onChange: (html) => (out.textContent = html),
});
out.textContent = editor.getHTML();
