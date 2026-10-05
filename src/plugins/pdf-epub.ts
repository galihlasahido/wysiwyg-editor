import { download } from '../export';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';
import type { EpubOptions } from '../epub';
import type { PdfImportOptions } from '../pdf';

export interface PdfEpubOptions {
  pdf?: PdfImportOptions;
  epub?: EpubOptions;
}

const fail = (e: Editor, err: unknown) => e.emit('error', { message: err instanceof Error ? err.message : String(err) });

/** Open a PDF (its text, as a new document) and save the document as an EPUB book. Each needs an optional package: `pdfjs-dist`, `jszip`. */
export function PdfEpub(options: PdfEpubOptions = {}): EditorPlugin {
  return {
    name: 'pdf-epub',
    setup(editor: Editor) {
      editor.registerCommand('importPdf', (e, source: Blob | ArrayBuffer) => {
        void import('../pdf').then((m) => m.importPdf(e, source, options.pdf)).then((warnings) => e.emit('import', { format: 'pdf', warnings })).catch((err) => fail(e, err));
        return true;
      });
      editor.registerCommand('openPdf', (e) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,application/pdf';
        input.addEventListener('change', () => { const f = input.files?.[0]; if (f) e.execute('importPdf', f); });
        input.click();
        return true;
      });
      editor.registerCommand('exportEpub', (e, name?: string) => {
        void import('../epub').then(async (m) => {
          const blob = await m.exportEpub(e, options.epub);
          if (name !== '') download(blob, `${(name ?? options.epub?.title ?? 'document').replace(/[^\w .-]/g, '_')}.epub`, 'application/epub+zip');
          e.emit('export', { format: 'epub', blob });
        }).catch((err) => fail(e, err));
        return true;
      }, { readOnlySafe: true });
      return [];
    },
    toolbar: [
      { name: 'openPdf', label: 'Open PDF (text)', icon: '📥', command: 'openPdf' },
      { name: 'exportEpub', label: 'Download as EPUB', icon: '📖', command: 'exportEpub' },
    ],
  };
}
