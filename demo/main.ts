import * as Y from 'yjs';
import { Collaboration, Comments, TrackChanges, Versions, createBroadcastProvider, createEditor, defaultPlugins } from '../src';

const params = new URLSearchParams(location.search);
const para = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>';
const content =
  '<h1>Project proposal</h1><div data-toc></div>' + para.repeat(3) +
  '<h2>Background</h2>' + para.repeat(6) +
  '<h2>Plan</h2><ul data-task-list><li data-task data-checked="true"><p>Research</p></li><li data-task data-checked="false"><p>Build</p></li></ul>' + para.repeat(8) +
  '<h2>Conclusion</h2>' + para.repeat(4);

const author = params.get('name') ?? 'Guest';
const plugins = [...defaultPlugins, Comments({ author }), TrackChanges({ author }), Versions({ author })];

// ?collab=<room> syncs open tabs of this origin; add &seed=1 on the first tab only.
const room = params.get('collab');
if (room) {
  const ydoc = new Y.Doc();
  const { awareness } = createBroadcastProvider(room, ydoc);
  plugins.push(Collaboration({ ydoc, awareness, user: { name: author, color: params.get('color') ?? '#2563eb' }, seed: params.get('seed') ? content : undefined }));
}

const editor = createEditor({
  element: document.getElementById('editor')!,
  content: room ? undefined : content,
  plugins,
  pages: { header: 'Project proposal', footer: 'Page {page} of {pages}', height: '80vh' },
  outline: true,
});
(window as any).editor = editor;
