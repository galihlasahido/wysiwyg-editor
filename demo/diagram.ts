import { TextSelection } from 'prosemirror-state';
import { Diagram, createEditor, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';

const out = el('pre', { class: 'out', hidden: true });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Use the ◇ toolbar button to insert a diagram. In edit mode: ', el('strong', {}, 'Arrow'), ' then click two shapes to connect them; drag to move; double-click to change the text; ', el('code', {}, 'Delete'), ' removes the selected shape. The diagram is stored as validated JSON and rendered as SVG, so it also exports as plain HTML.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  out,
);
const editor = createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, Diagram],
  content: '<h1>Release process</h1><p>The flow below is a diagram block, editable in place.</p><p></p>',
});
editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.atEnd(editor.view.state.doc)));
editor.execute('insertDiagram');
$('#actions').append(
  button('Insert another', () => editor.execute('insertDiagram'), true),
  button('Show HTML', () => { out.hidden = false; out.textContent = editor.getHTML(); }),
);
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Diagram],
editor.execute('insertDiagram');                 // or pass your own model
editor.execute('insertDiagram', { w: 400, h: 200, shapes: [{ id: 'a', type: 'rect', x: 20, y: 20, w: 120, h: 50, text: 'Hello', fill: '#dbeafe' }], arrows: [] });
`));
