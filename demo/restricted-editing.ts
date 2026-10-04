import { Comments, RestrictedEditing, TrackChanges, createEditor, defaultPlugins } from '../src';
import { codePanel } from './samples';

const para = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.</p>';
const content =
  '<section data-locked data-label="Title block"><h1>Service agreement</h1><div data-toc></div></section>' +
  '<h2>Parties</h2><div data-editable-region data-label="Fill in"><p>Client: <i>type the client name here</i></p><p>Provider: <i>type the provider name here</i></p></div>' +
  '<h2>Scope of work</h2>' + para + para +
  '<p>This part is outside any lock, so it is ordinary text that anyone can change.</p>' +
  '<h2>Terms</h2><section data-locked data-label="Legal text"><p>Both parties agree to the standard terms below. These clauses are fixed and cannot be changed by the person filling in the document.</p><ol><li><p>Payment is due within 30 days of the invoice date.</p></li><li><p>Either party may end this agreement with 14 days written notice.</p></li></ol></section>' +
  '<h2>Notes</h2><div data-editable-region data-label="Fill in"><p>Add any extra notes here.</p></div>';

const editor = createEditor({
  element: document.getElementById('editor')!,
  content,
  plugins: [...defaultPlugins, Comments({ author: 'Guest' }), TrackChanges({ author: 'Guest' }), RestrictedEditing()],
  pages: { header: 'Service agreement', footer: 'Page {page} of {pages}', height: '82vh' },
  outline: true,
  ribbon: true,
});
(window as any).editor = editor;

document.querySelector('.demo-main')!.append(codePanel(`
createEditor({
  element,
  ribbon: true,
  plugins: [...defaultPlugins, RestrictedEditing()],   // { authorMode: true } for the template author
  content: \`
    <section data-locked data-label="Title block"><h1>Title</h1><div data-toc></div></section>
    <div data-editable-region><p>Fill me in</p></div>
  \`,
});
editor.execute('toggleAuthorMode');   // lockBlocks, unlockBlocks, insertEditableRegion ...
`));
