import { createEditor, toEmailHTML, toEmailText } from '../src';
import { $, button, el, codePanel } from './samples';

const subject = el('input', { class: 'out', value: 'Welcome aboard!', 'aria-label': 'Subject' });
const preview = el('iframe', { class: 'preview', title: 'Email preview' });
preview.setAttribute('sandbox', ''); // the preview can run nothing
const source = el('pre', { class: 'out' });
const mode = { value: 'preview' as 'preview' | 'html' | 'text' };
const copyBtn = button('Copy HTML', async () => {
  try { await navigator.clipboard.writeText(toEmailHTML(editor.getHTML())); copyBtn.textContent = 'Copied!'; } catch { copyBtn.textContent = 'Copy failed'; }
  setTimeout(() => (copyBtn.textContent = 'Copy HTML'), 1500);
});

$('#app').append(
  el('div', { class: 'demo-note' }, 'Mail clients ignore most CSS, so ', el('code', {}, 'toEmailHTML()'), ' lays the content out in tables and inlines every style. ', el('code', {}, 'toEmailText()'), ' gives the plain-text part.'),
  el('div', { class: 'cols' },
    el('div', { class: 'panel' }, el('h2', {}, 'Compose'), el('label', { class: 'status' }, 'Subject'), subject, el('div', { id: 'editor', style: 'margin-top:8px' })),
    el('div', { class: 'panel' }, el('h2', {}, 'Output'), el('div', { class: 'actions', id: 'tabs' }), preview, source),
  ),
);

const editor = createEditor({
  element: $('#editor'),
  toolbar: ['bold', 'italic', 'underline', '|', 'heading', 'link', '|', 'bulletList', 'orderedList', '|', 'image'],
  content: '<h1>Welcome aboard!</h1><p>Hi there, thanks for signing up. Here is what to do next:</p><ol><li><p>Confirm your address</p></li><li><p>Pick a plan</p></li><li><p>Invite your team</p></li></ol><p><a href="https://example.com/start">Get started</a> — it only takes a minute.</p>',
  onChange: render,
});

function render() {
  const html = toEmailHTML(editor.getHTML());
  preview.srcdoc = `<!doctype html><meta charset="utf-8"><title>${subject.value.replace(/[<&]/g, '')}</title>${html}`;
  source.textContent = mode.value === 'text' ? toEmailText(editor.getHTML()) : html;
  preview.hidden = mode.value !== 'preview';
  source.hidden = mode.value === 'preview';
}
$('#tabs').append(
  button('Preview', () => ((mode.value = 'preview'), render()), true),
  button('HTML', () => ((mode.value = 'html'), render())),
  button('Plain text', () => ((mode.value = 'text'), render())),
  copyBtn,
);
subject.addEventListener('input', render);
render();

$('#app').append(codePanel(`
import { toEmailHTML, toEmailText } from 'wysiwygido';

const html = toEmailHTML(editor.getHTML(), { width: 600 });   // tables + inline styles
const text = toEmailText(editor.getHTML());                   // plain-text alternative
`));
