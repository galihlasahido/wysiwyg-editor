import { Autosave, createEditor, defaultPlugins } from '../src';
import { $, codePanel, el } from './samples';

const content = `<h1>Yearly expenses</h1><p>The toolbar sits in a floating card: rounded, with a soft shadow, and it stays in view while you scroll. Open <b>File</b>, <b>Edit</b>, <b>Insert</b> or <b>Format</b> in the menu bar; rename the document at the top left; type and watch the status change.</p><ul><li>Header: name, save status and your own controls</li><li>Menu bar with drop-downs built from the commands the editor has</li><li>The toolbar below it</li></ul>${'<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>'.repeat(14)}`;

const avatars = el('div', { class: 'fl-end' },
  ...['B', 'C', 'M', 'A'].map((n, i) => el('span', { class: 'fl-avatar', style: `background:${['#e8b08e', '#e6c4ea', '#f0cfa3', '#bfdff0'][i]}` }, n)),
  el('button', { class: 'fl-share', type: 'button' }, 'Share'),
);

$('#app').append(el('div', { class: 'panel' }, el('div', { id: 'editor' })));
const editor = createEditor({
  element: $('#editor'),
  content,
  pages: false,
  toolbar: { overflow: 'more', items: ['undo', 'redo', '|', 'bold', 'italic', 'underline', 'strike', '|', 'heading', 'fontFamily', 'fontSize', '|', 'bulletList', 'orderedList', 'taskList', '|', 'link', 'image', 'insertTable'] },
  floating: { title: 'Yearly expenses', onTitle: (t) => { document.title = `${t} · Floating menu`; }, end: avatars },
  plugins: [...defaultPlugins, Autosave({ save: () => new Promise((r) => setTimeout(r, 400)) })],
});
(window as unknown as { editor: typeof editor }).editor = editor;
$('#app').append(codePanel(`
createEditor({
  element,
  floating: true,                              // the card with the default menus
  toolbar: { overflow: 'more' },               // one row; what does not fit goes into ⋯
  // or choose what goes in it
  floating: {
    title: 'Yearly expenses',
    onTitle: (name) => rename(name),           // makes the name editable
    menus: [{ label: 'File', entries: [{ label: 'New', command: 'newDocument' }] }],   // false hides the menu bar
    end: shareButtonAndAvatars,                // your own element, right side of the header
  },
  plugins: [...defaultPlugins, Autosave({ save })],   // the status shows Saving… / Saved
});
`));
