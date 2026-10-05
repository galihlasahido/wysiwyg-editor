import { Comments, createEditor, defaultPlugins, download, exportHTML } from '../src';
import { $, ARTICLE, button, el, makeImage, codePanel } from './samples';

const content = `${ARTICLE}
<h2>Results</h2>
<table><tr><th>Quarter</th><th>Revenue</th><th>Growth</th></tr><tr><td>Q1</td><td>1.2M</td><td>+4%</td></tr><tr><td>Q2</td><td>1.5M</td><td>+25%</td></tr></table>
<p><img src="${makeImage(480, 240, 'Chart', 150)}" alt="A placeholder chart" width="360" data-caption="Figure 1. A placeholder chart"></p>
<p>Footnotes<sup data-footnote="Footnotes become real Word footnotes."></sup> and a table of contents are exported too.</p>`;

$('#app').append(
  el('div', { class: 'demo-note' }, 'The .docx keeps headings, formatting, lists, tables, images (including crops), footnotes, comments, tracked changes, page size, margins, orientation and header/footer. ', el('strong', {}, 'PDF'), ' uses the browser print dialog with the real page margins ("Save as PDF").'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);

const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, Comments({ author: 'You' }), { name: 'quick-docx', keymap: { 'Mod-Shift-s': 'exportDocx' } }], ribbon: true, pages: { header: 'Annual report', footer: 'Page {page} of {pages}', height: '65vh' }, outline: true });

(window as unknown as { editor: typeof editor }).editor = editor; // handy for experimenting in the console
$('#actions').append(
  button('Download .docx', () => void editor.exportDocx({ download: 'report.docx' }), true),
  button('Print / Save as PDF', () => editor.execute('print')),
  button('Download HTML', () => download(exportHTML(editor, { title: 'Annual report' }), 'report.html', 'text/html')),
  button('Download Markdown', () => download(editor.getMarkdown(), 'report.md', 'text/markdown')),
);


// ---- Creating the .docx from your own code ------------------------------------------------------------------------------
const log = el('pre', { class: 'out', style: 'max-height:200px' }, 'Every export is reported here by the editor’s "export" event.');
const note = (text: string) => { log.textContent = `${new Date().toLocaleTimeString()}  ${text}\n${log.textContent?.startsWith('Every') ? '' : log.textContent}`.split('\n').slice(0, 30).join('\n'); };
editor.on('export', (p: { format: string; blob: Blob }) => note(`export event: ${p.format}, ${(p.blob.size / 1024).toFixed(1)} KB`));
editor.on('exportError', (err: unknown) => note(`export failed: ${err instanceof Error ? err.message : err}`));

const auto = el('input', { type: 'checkbox', id: 'auto' }) as HTMLInputElement;
let timer: ReturnType<typeof setTimeout> | undefined;
editor.on('change', () => {
  if (!auto.checked) return;
  clearTimeout(timer);
  timer = setTimeout(() => void editor.exportDocx().then((b) => note(`auto-created after you stopped typing (${b.size} bytes, not downloaded)`)), 3000);
});
let last: Blob | null = null;
editor.on('export', (p: { blob: Blob }) => (last = p.blob));

$('#app').append(
  el('h2', { style: 'font-size:16px;margin:22px 0 6px' }, 'Call it from your own code'),
  el('p', { class: 'status' }, 'The same API works from a button, a shortcut, an editor event or a server upload. It returns the file as a Blob.'),
  el('div', { class: 'actions' },
    button('From a button: editor.exportDocx({ download: true })', () => void editor.exportDocx({ download: 'from-button.docx' })),
    button('Run the command: editor.execute("exportDocx")', () => editor.execute('exportDocx', { download: 'from-command.docx' })),
    button('Send to a server (simulated upload)', async () => {
      const blob = await editor.exportDocx(); // no download: just the Blob
      const form = new FormData();
      form.append('file', blob, 'report.docx');
      // await fetch('/api/documents', { method: 'POST', body: form, headers: { Authorization: token } });
      note(`would upload report.docx: ${blob.size} bytes, ${blob.type.split('.').pop()}`);
    }),
    button('Download the last one', () => last && download(last, 'last.docx'))),
  el('div', { class: 'status' }, el('label', {}, auto, ' On the "change" event: create a .docx 3 seconds after I stop typing'), ' · Shortcut: ', el('kbd', {}, 'Ctrl/Cmd+Shift+S'), ' downloads one (a plugin with ', el('code', {}, "keymap: { 'Mod-Shift-s': 'exportDocx' }"), ')'),
  log,
);

$('#app').append(codePanel(`
// Create a .docx from anywhere (needs the optional "docx" package; it is loaded only when you call this)
const blob = await editor.exportDocx();                      // returns a Blob
await editor.exportDocx({ download: 'report.docx' });        // ...and saves it in the browser
await editor.exportDocx({ title: 'Q3', comments: threads, fetchImages: false });

editor.execute('exportDocx', { download: true });           // the same, as a command (buttons, shortcuts, your own UI)
editor.on('export', ({ format, blob }) => upload(blob));    // react to every export
editor.on('exportError', (err) => report(err));

// from an event, a shortcut or a server upload
editor.on('change', debounce(() => editor.exportDocx(), 3000));
{ name: 'quick-docx', keymap: { 'Mod-Shift-s': 'exportDocx' } }   // a plugin that binds a key
const form = new FormData(); form.append('file', await editor.exportDocx(), 'report.docx');
await fetch('/api/documents', { method: 'POST', body: form });

await editor.importDocx(fileOrBlob);                         // the other direction (needs "mammoth")
editor.execute('print');                                     // PDF: the browser print dialog
`));
