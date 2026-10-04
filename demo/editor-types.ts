import { BalloonToolbar, SlashCommands, createEditor, defaultPlugins } from '../src';
import { $, ARTICLE, el, codePanel } from './samples';

$('#app').append(
  el('div', { class: 'panel' }, el('h2', {}, 'Classic ', el('small', {}, '— toolbar on top')), el('div', { id: 'classic' })),
  el('div', { class: 'panel', style: 'margin-top:16px' }, el('h2', {}, 'Inline / balloon ', el('small', {}, '— no toolbar; select text, or type "/" on an empty line')), el('div', { id: 'inline' })),
  el('div', { class: 'panel', style: 'margin-top:16px' }, el('h2', {}, 'Document ', el('small', {}, '— ribbon, pages, ruler and outline')), el('div', { id: 'document' })),
);

createEditor({ element: $('#classic'), content: '<h2>Classic editor</h2><p>The toolbar is always visible at the top. Good for forms and CMS fields.</p>', placeholder: 'Write something…' });

createEditor({
  element: $('#inline'),
  toolbar: false,
  plugins: [...defaultPlugins, BalloonToolbar(), SlashCommands()],
  content: '<h2>Inline editor</h2><p>There is no toolbar here. <strong>Select some of this text</strong> and a small toolbar floats above it. On an empty line, type <code>/</code> to insert a block.</p><p></p>',
});

createEditor({ element: $('#document'), content: ARTICLE, ribbon: true, pages: { header: 'The case for small, modular editors', footer: 'Page {page} of {pages}', height: '70vh' }, outline: true });

$('#app').append(codePanel(`
createEditor({ element });                                              // classic
createEditor({ element, toolbar: false, plugins: [...defaultPlugins, BalloonToolbar(), SlashCommands()] }); // inline
createEditor({ element, ribbon: true, pages: true, outline: true });    // document
`));
