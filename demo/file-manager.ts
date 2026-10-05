import { FileManager, createEditor, createFileStore, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';

// Files are kept in this browser (IndexedDB). Nothing is uploaded anywhere.
const store = createFileStore('wysiwyg-demo-files'); // IndexedDB, or memory when the browser refuses to store files

/** A few sample pictures drawn on a canvas, so there is something to crop and adjust on first visit. */
function sample(w: number, h: number, hue: number, label: string): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${hue} 80% 55%)`);
  grad.addColorStop(1, `hsl(${(hue + 70) % 360} 75% 40%)`);
  g.fillStyle = grad; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,.18)';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(((i * 2654435761) % w), ((i * 40503) % h), 30 + i * 22, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#fff'; g.font = `700 ${Math.round(h / 7)}px system-ui, sans-serif`; g.textBaseline = 'bottom';
  g.fillText(label, 24, h - 20);
  return new Promise((ok) => c.toBlob((b) => ok(b!), 'image/png'));
}
async function seed() {
  if ((await store.list()).length) return;
  await store.put(await sample(1200, 800, 215, 'Mountains'), { name: 'mountains.png', width: 1200, height: 800 });
  await store.put(await sample(900, 900, 330, 'Sunset'), { name: 'sunset.png', width: 900, height: 900 });
  await store.put(await sample(1280, 720, 140, 'Forest'), { name: 'forest.png', width: 1280, height: 720 });
  await store.put(new Blob(['Meeting notes\n\n- Ship the beta on Friday\n- Review pricing\n'], { type: 'text/plain' }), { name: 'meeting-notes.txt' });
  await store.put(new Blob(['%PDF-1.4\n% a tiny placeholder, not a real document\n'], { type: 'application/pdf' }), { name: 'annual-report.pdf' });
}

$('#app').append(
  el('div', { class: 'demo-note' }, 'Press ', el('strong', {}, 'Insert → Picture → From the file library…'), ' (or the 📁 button) to open the library. Insert a picture, click it, then ', el('strong', {}, 'Picture → Edit image'), ' to edit it. Drop files straight into the document too. Everything stays in this browser.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);

await seed();
const editor = createEditor({
  element: $('#editor'),
  content: '<h1>Field report</h1><p>Open the file library, insert a picture, and edit it in place. Attachments such as a PDF appear as chips like this: </p><p></p>',
  plugins: [...defaultPlugins, FileManager({ store })],
  ribbon: true,
});
(window as unknown as { editor: typeof editor }).editor = editor;

$('#actions').append(
  button('📁 Open file library', () => editor.execute('openFiles'), true),
  button('Reset demo files', async () => { for (const f of await store.list()) await store.remove(f.id); await seed(); }),
);
$('#app').append(codePanel(`
plugins: [...defaultPlugins, FileManager({
  store: new IndexedDBFileStore('my-files'),     // or your own FileStore that talks to a server
  maxFileSize: 10 * 1024 * 1024,
  resolveUrl: async (file, blob) => (await upload(blob)).url,   // optional: give attachments a real address
})],

editor.execute('openFiles');                    // the library
editor.execute('editImage');                    // edit the selected picture
await openImageEditor(root, { source: blob });  // the editor on its own: resolves with { blob, width, height }
`));
