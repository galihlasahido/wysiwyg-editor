import { NodeSelection, Plugin } from 'prosemirror-state';
import type { Editor } from '../editor';
import { addFiles, DEFAULT_BLOCKED, openFileManager, type FileManagerOptions } from '../file-manager';
import { cleanFileName, createFileStore, isRasterImage, type FileStore, type StoredFile } from '../files';
import { formatBytes } from '../image-ops';
import { openImageEditor } from '../image-editor';
import type { EditorPlugin } from '../types';
import { isSafeHref } from '../url';

export interface FileManagerPluginOptions {
  /** Where files are kept. Default: IndexedDB in the browser (memory when it is not available). */
  store?: FileStore;
  /** Largest file, in bytes. Default 10 MB. */
  maxFileSize?: number;
  accept?: string;
  blockedExtensions?: string[];
  /**
   * Turn a stored file into the address the document will contain. Default: images become base64 data URLs and other
   * files are inserted without an address (they open from this browser's library). Give this your upload function
   * (it returns an https URL) to make attachments work for every reader.
   */
  resolveUrl?: (file: StoredFile, blob: Blob) => Promise<string>;
  /** Get the bytes of a remote picture for "Edit image" (a picture from another site needs CORS, or your own proxy here). */
  fetchImage?: (url: string) => Promise<Blob>;
  /** Also keep images that are dropped, pasted or uploaded in the library. Default true. */
  captureImages?: boolean;
  /** Accept non-image files dropped or pasted into the document. Default true. */
  captureFiles?: boolean;
}

const blobToDataURL = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

const cleanType = (v: unknown) => (typeof v === 'string' && /^[\w.+-]{1,60}\/[\w.+-]{1,100}$/.test(v) ? v : '');
const cleanSize = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0; };

/**
 * A file library and image editing for the editor: upload files (button, drag and drop, paste), browse them in a modal,
 * insert pictures or attachments, and edit pictures (crop, rotate, resize, adjust, draw, text) in place or in the library.
 */
export function FileManager(options: FileManagerPluginOptions = {}): EditorPlugin & { store: FileStore } {
  const store = options.store ?? createFileStore();
  const limits: Pick<FileManagerOptions, 'maxFileSize' | 'accept' | 'blockedExtensions'> = { maxFileSize: options.maxFileSize, accept: options.accept, blockedExtensions: options.blockedExtensions ?? DEFAULT_BLOCKED };

  const plugin: EditorPlugin = {
    name: 'file-manager',
    nodes: {
      attachment: {
        group: 'inline',
        inline: true,
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { fileId: { default: null }, name: { default: 'file' }, size: { default: 0 }, type: { default: '' }, href: { default: null } },
        parseDOM: [{
          tag: 'a[data-file-id]',
          priority: 70,
          getAttrs: (n) => {
            const a = n as HTMLElement;
            const id = a.getAttribute('data-file-id') ?? '';
            if (!/^[\w-]{1,64}$/.test(id)) return false;
            const href = a.getAttribute('href');
            return { fileId: id, name: cleanFileName(a.getAttribute('data-name') ?? a.textContent ?? '', 'file'), size: cleanSize(a.getAttribute('data-size')), type: cleanType(a.getAttribute('data-type')), href: isSafeHref(href) ? href : null };
          },
        }],
        toDOM: (n) => {
          const href = isSafeHref(n.attrs.href) ? n.attrs.href : null; // checked again: collaboration skips parseDOM
          return ['a', { class: 'wy-attachment', 'data-file-id': n.attrs.fileId ?? '', 'data-name': n.attrs.name, 'data-size': String(n.attrs.size), 'data-type': n.attrs.type, ...(href ? { href, rel: 'noopener noreferrer', download: n.attrs.name } : { role: 'button', tabindex: '0' }), title: `${n.attrs.name} (${formatBytes(n.attrs.size)})` },
            ['span', { class: 'wy-att-ico', 'aria-hidden': 'true' }, '📎'], ['span', { class: 'wy-att-name' }, n.attrs.name], ['span', { class: 'wy-att-size' }, formatBytes(n.attrs.size)]];
        },
      },
    },
    setup(editor: Editor) {
      editor.extensions.fileManager = { store };

      const addressOf = async (file: StoredFile, blob: Blob) => (options.resolveUrl ? options.resolveUrl(file, blob) : blobToDataURL(blob));

      /** Put files into the document: pictures as images, everything else as an attachment. */
      const insertStored = async (files: StoredFile[]) => {
        const nodes = [];
        for (const f of files) {
          const rec = await store.get(f.id);
          if (!rec) continue;
          if (isRasterImage(f.type)) {
            const src = await addressOf(f, rec.blob);
            nodes.push(editor.schema.nodes.image.create({ src, alt: f.name.replace(/\.[^.]+$/, '') }));
          } else {
            const href = options.resolveUrl ? await options.resolveUrl(f, rec.blob) : null;
            nodes.push(editor.schema.nodes.attachment.create({ fileId: f.id, name: f.name, size: f.size, type: cleanType(f.type), href: isSafeHref(href) ? href : null }));
          }
        }
        if (!nodes.length) return;
        const { state, dispatch } = editor.view;
        let tr = state.tr;
        nodes.forEach((n, i) => { tr = tr.replaceSelectionWith(n, false); if (i < nodes.length - 1) tr = tr.insertText(' '); });
        dispatch(tr.scrollIntoView());
      };

      editor.registerCommand('openFiles', (e) => {
        openFileManager(e.root, { store, ...limits, imageEditor: true, onInsert: insertStored, title: 'Files' });
        return true;
      });
      editor.registerCommand('insertFile', (_e, id: string) => {
        void store.list().then((all) => insertStored(all.filter((f) => f.id === id)));
        return true;
      });
      /** Add files to the library (and optionally insert them). Resolves with what was added and what was refused. */
      editor.registerCommand('uploadFiles', (_e, files: File[], insert = false) => {
        void addFiles(store, files, limits).then(({ added }) => insert && insertStored(added));
        return true;
      });

      const selectedImage = (e: Editor) => {
        const sel = e.view.state.selection;
        return sel instanceof NodeSelection && sel.node.type.name === 'image' ? { from: sel.from, node: sel.node } : null;
      };
      editor.registerCommand('editImage', (e) => {
        const sel = selectedImage(e);
        if (!sel) return false;
        const { from, node } = sel;
        void (async () => {
          try {
            const result = await openImageEditor(e.root, { source: node.attrs.src, name: node.attrs.alt ?? undefined, saveLabel: 'Apply to document', fetchSource: options.fetchImage });
            if (!result) return;
            const ext = result.type === 'image/jpeg' ? 'jpg' : result.type === 'image/webp' ? 'webp' : 'png';
            const base = cleanFileName(node.attrs.alt || 'image', 'image');
            const rec = await store.put(result.blob, { name: `${base}-edited.${ext}`, width: result.width, height: result.height }).catch(() => null);
            const src = rec && options.resolveUrl ? await options.resolveUrl(rec, result.blob) : await blobToDataURL(result.blob);
            const { state, dispatch } = e.view;
            const at = state.doc.nodeAt(from);
            if (!at || at.type.name !== 'image') return; // moved or removed while editing
            // the old crop describes the old bitmap: start the new picture uncropped
            dispatch(state.tr.setNodeMarkup(from, undefined, { ...at.attrs, src, crop: null, nw: null, nh: null }).scrollIntoView());
          } catch (err) {
            e.root.dispatchEvent(new CustomEvent('wy-error', { detail: err, bubbles: true }));
            const { openDialog } = await import('../dialog');
            openDialog(e.root, { title: 'Could not edit this picture', body: err instanceof Error ? err.message : 'The picture could not be opened.' });
          }
        })();
        return true;
      });

      // Pictures that are uploaded, dropped or pasted also land in the library.
      if (options.captureImages !== false) {
        const original = editor.uploadImage;
        editor.uploadImage = async (file: File) => {
          const { added } = await addFiles(store, [file], limits).catch(() => ({ added: [] as StoredFile[] }));
          if (added[0] && options.resolveUrl) return options.resolveUrl(added[0], file);
          return original(file);
        };
      }

      const nonImages = (list: FileList | null | undefined) => [...(list ?? [])].filter((f) => !f.type.startsWith('image/'));
      return [
        new Plugin({
          props: {
            handleDrop: (_v, ev) => {
              if (options.captureFiles === false) return false;
              const files = nonImages((ev as DragEvent).dataTransfer?.files);
              if (!files.length) return false;
              ev.preventDefault();
              void addFiles(store, files, limits).then(({ added }) => insertStored(added));
              return true;
            },
            handlePaste: (_v, ev) => {
              if (options.captureFiles === false) return false;
              const files = nonImages(ev.clipboardData?.files);
              if (!files.length) return false;
              ev.preventDefault();
              void addFiles(store, files, limits).then(({ added }) => insertStored(added));
              return true;
            },
            // An attachment without an address opens from this browser's library.
            handleClickOn: (_v, _pos, node, _nodePos, ev) => {
              if (node.type.name !== 'attachment' || isSafeHref(node.attrs.href)) return false;
              ev.preventDefault();
              void store.get(node.attrs.fileId).then((rec) => {
                if (!rec) return;
                const a = document.createElement('a');
                a.href = URL.createObjectURL(rec.blob);
                a.download = node.attrs.name;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              });
              return true;
            },
          },
        }),
      ];
    },
    toolbar: [
      { name: 'files', label: 'File library', icon: '📁', command: 'openFiles' },
      { name: 'editImage', label: 'Edit image', icon: '✎', command: 'editImage' },
    ],
  };
  return Object.assign(plugin, { store });
}
