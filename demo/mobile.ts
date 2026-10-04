import { createEditor } from '../src';
import { $, ARTICLE, button, el } from './samples';

const frame = el('div', { class: 'phone' }, el('div', { id: 'editor' }));
const touch = button('Touch-size controls: on', () => {
  const on = frame.classList.toggle('touch');
  touch.textContent = `Touch-size controls: ${on ? 'on' : 'off'}`;
});
$('#app').append(
  el('div', { class: 'demo-note' }, 'A 375px-wide frame. The toolbar wraps, and controls are 40px tall for fingers. Resize the browser window to see the full-width editors adapt too.'),
  el('div', { class: 'actions' }, touch),
  frame,
);
frame.classList.add('touch');
createEditor({ element: $('#editor'), toolbar: ['bold', 'italic', 'underline', '|', 'heading', 'bulletList', 'orderedList', '|', 'link', 'image', 'insertTable'], content: ARTICLE });
