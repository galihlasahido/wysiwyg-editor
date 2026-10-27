import type { FullExample } from '../full-code';

export const core: Record<string, FullExample> = {
  'feature-rich': {
    code: `
import { Comments, TrackChanges, Versions, createEditor, defaultPlugins } from 'wysiwygido';
import 'wysiwygido/style.css';

const author = 'Guest';

const editor = createEditor({
  element: document.getElementById('editor'),
  content: '<h1>Project proposal</h1><p>Edit me. Comments, suggestions and version history are in the ribbon.</p>',
  ribbon: true,                                  // Office-style tabs
  pages: { header: 'Project proposal', footer: 'Page {page} of {pages}', height: '82vh' },
  outline: true,                                 // heading outline sidebar
  plugins: [...defaultPlugins, Comments({ author }), TrackChanges({ author }), Versions({ author })],
  onChange: (html) => console.log(html),
});

editor.execute('bold');                          // every button is also a command
console.log(editor.getHTML());
`,
  },
};
