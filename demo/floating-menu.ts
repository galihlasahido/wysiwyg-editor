import { Autosave, Comments, TrackChanges, Versions, createEditor, defaultPlugins } from '../src';
import { $, codePanel, el } from './samples';

const para = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>';
const content =
  '<h1>Yearly expenses</h1><div data-toc></div>' + para.repeat(3) +
  '<h2>Background</h2>' + para.repeat(6) +
  '<h2>Plan</h2><ul data-task-list><li data-task data-checked="true"><p>Research</p></li><li data-task data-checked="false"><p>Build</p></li></ul>' + para.repeat(8) +
  '<h2>Conclusion</h2>' + para.repeat(4);

const avatars = el('div', { class: 'fl-end' },
  ...['B', 'C', 'M', 'A'].map((n, i) => el('span', { class: 'fl-avatar', style: `background:${['#e8b08e', '#e6c4ea', '#f0cfa3', '#bfdff0'][i]}` }, n)),
  el('button', { class: 'fl-share', type: 'button' }, 'Share'),
);

$('#app').append(el('div', { id: 'editor' }));
const editor = createEditor({
  element: $('#editor'),
  content,
  pages: { header: 'Yearly expenses', footer: 'Page {page} of {pages}', height: '82vh' },
  outline: true,
  ribbon: true,
  floating: { title: 'Yearly expenses', onTitle: (t) => { document.title = `${t} · Floating menu`; }, end: avatars },
  plugins: [...defaultPlugins, Comments({ author: 'Guest' }), TrackChanges({ author: 'Guest' }), Versions({ author: 'Guest' }), Autosave({ save: () => new Promise((r) => setTimeout(r, 400)) })],
});
editor.execute('toggleOutline'); // the outline starts hidden; View → Outline opens it
(window as unknown as { editor: typeof editor }).editor = editor;
$('#app').append(codePanel(`
createEditor({
  element,
  pages: { header: 'Title', footer: 'Page {page} of {pages}' },
  outline: true,
  floating: true,                              // the card with the default menus
  ribbon: true,                                // or the compact toolbar, with toolbar: { overflow: 'more' } for one row
  // or choose what goes in it
  floating: {
    title: 'Yearly expenses',
    onTitle: (name) => rename(name),           // makes the name editable
    menus: [{ label: 'File', entries: [{ label: 'New', command: 'newDocument' }] }],   // false hides the menu bar
    end: shareButtonAndAvatars,                // your own element, right side of the header
  },
  plugins: [...defaultPlugins, Comments({ author: 'Guest' }), TrackChanges({ author: 'Guest' }), Versions({ author: 'Guest' }), Autosave({ save })],   // the status shows Saving… / Saved
});
`));
