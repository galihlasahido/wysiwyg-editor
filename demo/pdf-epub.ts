import { PdfEpub, createEditor, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import samplePdf from './sample.pdf?url';
import { dataUrlToBlob } from '../src/image-editor';

const status = el('div', { class: 'status', id: 'status', 'aria-live': 'polite' }, 'Load the sample PDF, or open your own.');
$('#app').append(
  el('div', { class: 'demo-note' }, 'Importing reads the ', el('strong', {}, 'text'), ' of a PDF: paragraphs, headings (from larger type) and lists. Pictures, tables, columns and scanned pages are not recovered. The EPUB starts a new chapter at each top-level heading.'),
  el('div', { class: 'actions' },
    button('Load the sample PDF', async () => editor.execute('importPdf', samplePdf.startsWith('data:') ? dataUrlToBlob(samplePdf) : await (await fetch(samplePdf)).blob()), true),
    button('Open a PDF…', () => editor.execute('openPdf')),
    button('Download EPUB', () => editor.execute('exportEpub')),
  ),
  status,
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({ element: $('#editor'), content: '<h1>Nothing yet</h1><p>Press “Load the sample PDF”.</p>', plugins: [...defaultPlugins, PdfEpub({ loadPdf: () => import('../src/pdf'), loadEpub: () => import('../src/epub'), pdf: { workerSrc }, epub: { title: 'My book', author: 'Me' } })] });
(window as unknown as { editor: typeof editor }).editor = editor;
editor.on('import', (e) => { const w = (e as { warnings: string[] }).warnings; status.textContent = w.length ? w.join(' ') : 'PDF imported.'; });
editor.on('export', (e) => { status.textContent = `EPUB ready (${Math.round((e as { blob: Blob }).blob.size / 1024)} KB).`; });
editor.on('error', (e) => { status.textContent = (e as { message: string }).message; });
$('#app').append(codePanel(`
// pnpm add pdfjs-dist jszip   (both optional)
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
plugins: [...defaultPlugins, PdfEpub({ loadPdf: () => import('wysiwygido/pdf'), loadEpub: () => import('wysiwygido/epub'), pdf: { workerSrc: workerUrl }, epub: { title, author, language: 'id' } })],
editor.execute('openPdf');            // file picker; or editor.execute('importPdf', blob)
editor.execute('exportEpub');         // download; editor.execute('exportEpub', '') only emits the 'export' event
// or without the plugin: import { importPdf } from 'wysiwygido/pdf'; import { exportEpub } from 'wysiwygido/epub';
`));
