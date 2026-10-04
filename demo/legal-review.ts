import { Comments, RestrictedEditing, TrackChanges, Versions, createEditor, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';

const content =
  '<section data-locked data-variant="legal" data-label="Standard clause"><h2>1. Definitions</h2><p>"Confidential Information" means all non-public information disclosed by one party to the other.</p></section>' +
  '<h2>2. Term</h2><p>This agreement lasts for twelve months from the effective date.</p>' +
  '<h2>3. Liability</h2><p>Each party is liable for direct damages up to the fees paid in the previous year.</p>' +
  '<section data-locked data-variant="legal" data-label="Standard clause"><h2>4. Governing law</h2><p>This agreement is governed by the laws of the Republic of Indonesia.</p></section>';

$('#app').append(el('div', { id: 'editor' }));
const editor = createEditor({
  element: $('#editor'),
  content,
  plugins: [...defaultPlugins, Comments({ author: 'Reviewer' }), TrackChanges({ author: 'Reviewer' }), Versions({ author: 'Reviewer' }), RestrictedEditing({ authorControls: false })],
  ribbon: true,
  pages: { header: 'Agreement (draft)', footer: 'Page {page} of {pages}', height: '70vh' },
});
editor.execute('setTracking', true);
$('#app').prepend(el('div', { class: 'demo-note' }, 'Suggesting mode is on: edits become tracked suggestions. The two ', el('strong', {}, 'Standard clause'), ' blocks are locked and cannot be changed, only commented on in the Review tab.'));
$('#app').append(el('div', { class: 'actions', style: 'margin-top:10px' }, button('Accept all', () => editor.execute('acceptAll'), true), button('Reject all', () => editor.execute('rejectAll')), button('Next change', () => editor.execute('nextChange'))));
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Comments({ author }), TrackChanges({ author }), Versions({ author }), RestrictedEditing()],
editor.execute('setTracking', true);
`));
