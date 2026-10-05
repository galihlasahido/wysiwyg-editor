import { Comments, createEditor, defaultPlugins, Footnotes, askDialog, Versions } from '../src';
import { $, button, codePanel, el } from './samples';

const out = el('div', { class: 'dlg-result', 'aria-live': 'polite' }, 'Results appear here.');
const show = (what: string, v: string | null) => (out.textContent = `${what}: ${v === null ? 'cancelled (null)' : JSON.stringify(v)}`);
const root = document.body;

const card = (title: string, text: string, run: () => void) => el('div', { class: 'dlg-card' }, el('h2', {}, title), el('p', {}, text), button('Open', run, true));

const colour = (v: string) => {
  const s = new Option().style;
  s.color = v.trim();
  return s.color ? v.trim() : null;
};

$('#app').append(
  el('div', { class: 'demo-note' }, 'These are the same dialogs the editor opens for ', el('strong', {}, 'comments, links, alt text, footnotes and version names'), ' (try them in the editor below). ', el('code', {}, 'askDialog(root, options)'), ' returns a promise: the text, or ', el('code', {}, 'null'), ' when cancelled. Escape and Cancel close it, Tab stays inside, and a click outside only closes it while nothing is typed.'),
  el('div', { class: 'dlg-grid' },
    card('Replace window.prompt', 'One line, required. Enter confirms.', () => void askDialog(root, { title: 'Your name', label: 'Name', placeholder: 'e.g. Ana', submitLabel: 'Save', maxLength: 60 }).then((v) => show('name', v))),
    card('Validation', 'An address is checked before the dialog closes.', () => void askDialog(root, { title: 'Invite someone', label: 'Email', description: 'We will send them a link.', placeholder: 'name@example.com', submitLabel: 'Invite', validate: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'That does not look like an email address.') }).then((v) => show('email', v))),
    card('Comment style', 'Shows what it is about, who is writing, and sends with Ctrl/Cmd+Enter.', () => void askDialog(root, { title: 'Add a comment', quote: 'Revenue grew twelve percent this quarter.', author: 'Ana Lestari', multiline: true, placeholder: 'Write a comment…', submitLabel: 'Comment' }).then((v) => show('comment', v))),
    card('Live preview', 'Type a colour name or hex code; the preview updates as you type.', () => void askDialog(root, {
      title: 'Pick a colour', label: 'Colour', value: 'rebeccapurple', submitLabel: 'Use colour', wide: true,
      validate: (v) => (colour(v) ? null : 'Not a colour the browser understands.'),
      preview: (value, host) => { const c = colour(value); host.replaceChildren(el('div', { class: 'swatch', style: `background:${c ?? 'transparent'};color:${c ? '#fff' : 'inherit'};mix-blend-mode:normal` }, c ? c : 'no preview')); },
    }).then((v) => show('colour', v))),
    card('Snippets and monospace', 'Buttons insert text at the cursor, or replace everything for a starter.', () => void askDialog(root, {
      title: 'Edit a JSON config', label: 'JSON', multiline: true, monospace: true, rows: 6, wide: true, value: '{\n  "theme": "light"\n}',
      snippets: [{ label: 'dark theme', value: '{\n  "theme": "dark"\n}', replace: true }, { label: '+ autosave', value: '  "autosave": true,\n' }],
      validate: (v) => { try { JSON.parse(v); return null; } catch (e) { return e instanceof Error ? e.message : 'Invalid JSON'; } },
      preview: (value, host) => { try { host.textContent = JSON.stringify(JSON.parse(value), null, 2); } catch { host.textContent = '…'; } },
    }).then((v) => show('config', v))),
    card('Optional answer', 'An empty answer is allowed (required: false), so it can mean "remove".', () => void askDialog(root, { title: 'Image caption', label: 'Caption', description: 'Leave it empty to remove the caption.', required: false, value: 'A mountain lake', submitLabel: 'Save' }).then((v) => show('caption', v))),
  ),
  out,
  el('h2', { style: 'font-size:16px;margin:20px 0 6px' }, 'In the editor'),
  el('p', { class: 'status' }, 'Select text and use Review → New Comment, Insert → Link, or add a footnote; click a comment card’s Reply; open the version history and save a version.'),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);

createEditor({
  element: $('#editor'),
  content: '<h1>Try the dialogs</h1><p>Select this sentence and press <strong>Comment</strong> in the Review tab, or <strong>Link</strong> in the Insert tab. The window that opens is a modal with the quoted text, not a browser prompt.</p><p>Add a footnote here, or save a version of this document.</p>',
  plugins: [...defaultPlugins, Comments({ author: 'You' }), Footnotes, Versions({ author: 'You' })],
  ribbon: { initialTab: 'review' },
});

$('#app').append(codePanel(`
const text = await askDialog(root, {
  title: 'Add a comment',
  quote: selectedText,              // what it is about (shown as text, never as markup)
  author: 'Ana',                    // coloured initial next to the box
  multiline: true,                  // Ctrl/Cmd+Enter sends
  required: true, maxLength: 4000,
  validate: (v) => (ok(v) ? null : 'Message shown under the box'),
  preview: (value, host) => { host.textContent = value.toUpperCase(); },     // live preview
  snippets: [{ label: 'Template', value: '...', replace: true }],
});
if (text !== null) save(text);      // null = cancelled
`));
