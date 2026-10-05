import { DEFAULT_EMBED_PROVIDERS, Embeds, askDialog, createEditor, defaultPlugins, resolveEmbed, type EmbedProvider } from '../src';
import { $, button, codePanel, el } from './samples';

// A provider you add yourself: any service, as long as it returns an https address on its own host.
const loom: EmbedProvider = {
  id: 'loom',
  name: 'Loom',
  match: (u) => (u.hostname === 'www.loom.com' ? ((id) => (id ? { src: `https://www.loom.com/embed/${id}`, aspect: 16 / 9, title: 'Loom video' } : null))(/^\/share\/([a-f0-9]{32})/.exec(u.pathname)?.[1]) : null),
};

const out = el('pre', { class: 'out', hidden: true });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Try pasting ', el('code', {}, 'https://www.youtube.com/watch?v=jNQXAC9IVRw'), ' or ', el('code', {}, 'https://vimeo.com/76979871'), ' on an empty line. Anything from another host is refused. Printing and Word export keep the link instead of the player.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  out,
);
const editor = createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, Embeds({ providers: [...DEFAULT_EMBED_PROVIDERS, loom] })],
  content: '<h1>Field trip</h1><p>Where we went:</p><figure data-embed-url="https://www.openstreetmap.org/#map=14/-6.1754/106.8272"></figure><p>The talk, recorded:</p><figure data-embed-url="https://www.youtube.com/watch?v=jNQXAC9IVRw"></figure><p></p>',
});
(window as unknown as { editor: typeof editor }).editor = editor;
$('#actions').append(
  button('Insert media…', () => editor.execute('insertEmbed'), true),
  button('Show the saved HTML', () => { out.hidden = false; out.textContent = editor.getHTML(); }),
  button('Test an address', () => void askDialog(document.body, { title: 'Test an address', label: 'Address', required: false, submitLabel: 'Check' }).then((v) => { if (v === null) return; const r = resolveEmbed(v); out.hidden = false; out.textContent = r ? `OK: ${r.provider.name} → ${r.src}` : 'Not a supported address'; })),
);
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Embeds({ providers: [...DEFAULT_EMBED_PROVIDERS, myProvider] })],

const myProvider = { id: 'loom', name: 'Loom',
  match: (url) => /* return { src: 'https://…', aspect: 16 / 9 } for your service, or null */ null };
editor.execute('insertEmbed', 'https://youtu.be/dQw4w9WgXcQ');
// saved as <figure data-embed-url="…"><a href="…">…</a></figure>: no iframe, rebuilt (and re-checked) on load
`));
