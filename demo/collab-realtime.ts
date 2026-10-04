import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createEditor, defaultPlugins } from '../src';
import { Collaboration, linkAwareness, linkDocs } from '../src/collab';
import { $, ARTICLE, button, el, codePanel } from './samples';

const app = $('#app');
const status = el('span', { class: 'status', textContent: 'Both editors are connected.' });
const toggle = button('Disconnect Bob', () => {});
app.append(
  el('div', { class: 'demo-note' }, 'Both editors run in this page and are joined by ', el('code', {}, 'linkDocs()'), ' and ', el('code', {}, 'linkAwareness()'), '. In a real app use ', el('code', {}, 'createWebSocketProvider'), ' with the reference server. ', 'Undo only reverts ', el('strong', {}, 'your own'), ' changes.'),
  el('div', { class: 'actions' }, toggle, status),
  el('div', { class: 'cols' }, el('div', { class: 'panel' }, el('h2', {}, 'Ana ', el('small', {}, '(red cursor)')), el('div', { id: 'ana' })), el('div', { class: 'panel' }, el('h2', {}, 'Bob ', el('small', {}, '(blue cursor)')), el('div', { id: 'bob' }))),
  el('ul', { class: 'tips' }, el('li', {}, 'Click in one editor and type: the other updates and shows your cursor.'), el('li', {}, 'Disconnect Bob, type in both editors, then reconnect: both edits are kept.')),
);

const ya = new Y.Doc();
const yb = new Y.Doc();
const aa = new Awareness(ya);
const ab = new Awareness(yb);
let unlink = linkDocs(ya, yb);
linkAwareness(aa, ab);

const bar = ['undo', 'redo', '|', 'bold', 'italic', 'underline', '|', 'heading', 'bulletList', 'orderedList'];
const make = (sel: string, ydoc: Y.Doc, awareness: Awareness, name: string, color: string, seed?: string) =>
  createEditor({ element: $(sel), toolbar: bar, plugins: [...defaultPlugins, Collaboration({ ydoc, awareness, user: { name, color }, seed })] });

make('#ana', ya, aa, 'Ana', '#e03131', ARTICLE);
make('#bob', yb, ab, 'Bob', '#1971c2');

let connected = true;
toggle.addEventListener('click', () => {
  connected = !connected;
  if (connected) unlink = linkDocs(ya, yb); // syncs both ways, merging what each side typed meanwhile
  else unlink();
  toggle.textContent = connected ? 'Disconnect Bob' : 'Reconnect Bob';
  status.textContent = connected ? 'Both editors are connected.' : 'Bob is offline: edits are kept locally and merged on reconnect.';
});

$('#app').append(codePanel(`
import * as Y from 'yjs';
import { Collaboration, createWebSocketProvider } from 'wysiwyg-editor/collab';

const ydoc = new Y.Doc();
const provider = createWebSocketProvider('wss://host/collab/<id>?token=<token>', ydoc);
await provider.synced;                         // create the editor after the first sync
createEditor({ element, plugins: [...defaultPlugins, Collaboration({ ydoc, awareness: provider.awareness, user: { name, color } })] });
`));
