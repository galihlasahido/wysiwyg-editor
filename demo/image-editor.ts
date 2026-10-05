import { formatBytes, openImageEditor } from '../src';
import { $, button, codePanel, el } from './samples';

const msg = el('div', { class: 'ie-msg' });
const result = el('div', { class: 'ie-result' });
const input = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', hidden: true }) as HTMLInputElement;
const drop = el('div', { class: 'ie-drop' }, el('strong', {}, 'Drop a picture here'), el('p', {}, 'PNG, JPEG, WebP or GIF. It never leaves your browser.'),
  el('div', { class: 'actions' }, button('Choose a file…', () => input.click(), true), button('Use a sample picture', () => void edit(sample(), 'sample.png'))));
const urlInput = el('input', { type: 'url', placeholder: 'https://example.com/photo.jpg  (needs CORS, or it explains why not)', 'aria-label': 'Picture address' }) as HTMLInputElement;

$('#app').append(
  el('div', { class: 'demo-note' }, el('strong', {}, 'Tools: '), 'Crop (free or fixed ratio), Rotate / flip / any angle, Resize, Adjust (brightness, contrast, saturation, warmth, blur) with nine filters, Draw (pen and highlighter), Text. ', el('strong', {}, 'View: '), el('kbd', {}, '+'), ' ', el('kbd', {}, '−'), ' zoom, ', el('kbd', {}, '0'), ' fit, ', el('kbd', {}, '1'), ' 100%, ', el('kbd', {}, 'Ctrl/Cmd + wheel'), ', hold ', el('kbd', {}, 'Space'), ' and drag to pan. ', el('kbd', {}, 'Ctrl/Cmd+Z'), ' undo.'),
  drop, input,
  el('div', { class: 'ie-url' }, urlInput, button('Open address', () => void edit(urlInput.value.trim(), urlInput.value.split('/').pop() || 'picture'))),
  msg, result,
);

/** A picture drawn on a canvas, so there is always something to try. */
function sample(): Blob | string {
  const c = document.createElement('canvas');
  c.width = 1400; c.height = 900;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 1400, 900);
  grad.addColorStop(0, '#0ea5e9'); grad.addColorStop(0.55, '#8b5cf6'); grad.addColorStop(1, '#f43f5e');
  g.fillStyle = grad; g.fillRect(0, 0, 1400, 900);
  g.fillStyle = 'rgba(255,255,255,.2)';
  for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(150 + i * 150, 250 + ((i * 97) % 400), 40 + i * 14, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#fff'; g.font = '700 110px system-ui, sans-serif'; g.fillText('Edit me', 80, 780);
  return c.toDataURL('image/png');
}

let last: { src: Blob | string; name: string } | null = null;
async function edit(src: Blob | string, name: string) {
  if (!src) return;
  msg.className = 'ie-msg';
  msg.textContent = 'Opening…';
  last = { src, name };
  try {
    const before = typeof src === 'string' ? src : URL.createObjectURL(src);
    const r = await openImageEditor(document.body, { source: src, name, saveLabel: 'Done' });
    msg.textContent = r ? '' : 'Cancelled: nothing changed.';
    if (!r) return;
    const after = URL.createObjectURL(r.blob);
    const dl = el('a', { href: after, download: `edited-${name.replace(/\.[^.]+$/, '')}.${r.type === 'image/jpeg' ? 'jpg' : r.type === 'image/webp' ? 'webp' : 'png'}`, textContent: 'Download' });
    result.replaceChildren(
      el('figure', {}, el('img', { src: before, alt: 'Before' }), el('figcaption', {}, 'Before')),
      el('figure', {}, el('img', { src: after, alt: 'After' }), el('figcaption', {}, `After · ${r.width} × ${r.height} px · ${formatBytes(r.blob.size)} · ${r.type} · `, dl, ' · ', button('Edit again', () => void edit(r.blob, name)))),
    );
  } catch (e) {
    msg.className = 'ie-msg error';
    msg.textContent = e instanceof Error ? e.message : 'The picture could not be opened.';
  }
}
input.addEventListener('change', () => { const f = input.files?.[0]; if (f) void edit(f, f.name); input.value = ''; });
for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
for (const t of ['dragleave', 'drop']) drop.addEventListener(t, () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); const f = (e as DragEvent).dataTransfer?.files[0]; if (f) void edit(f, f.name); });
void last;

$('#app').append(codePanel(`
const result = await openImageEditor(document.body, {
  source: fileOrBlobOrUrl,            // a File/Blob, a data: URL, or an https URL (needs CORS)
  name: 'photo.png',
  fetchSource: (url) => fetchViaMyServer(url),   // optional: for servers without CORS
  type: 'image/jpeg', quality: 0.9,    // optional output format
});
if (result) upload(result.blob);       // { blob, width, height, type } — or null when cancelled
`));
