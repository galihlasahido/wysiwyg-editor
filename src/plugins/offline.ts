import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';
import type { CommentThread } from './comments';

export interface Draft {
  html: string;
  comments: CommentThread[];
  savedAt: number;
}

/** Where drafts are kept. */
export interface DraftStore {
  get(id: string): Promise<Draft | null>;
  put(id: string, draft: Draft): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryDraftStore implements DraftStore {
  private map = new Map<string, Draft>();
  async get(id: string) { return this.map.get(id) ?? null; }
  async put(id: string, d: Draft) { this.map.set(id, d); }
  async remove(id: string) { this.map.delete(id); }
}

/** Drafts in the browser's IndexedDB: they survive a reload, a crash and a closed tab. */
export class IndexedDBDraftStore implements DraftStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private name = 'wysiwyg-drafts') {}
  private open() {
    this.db ??= new Promise((ok, fail) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('drafts');
      req.onsuccess = () => ok(req.result);
      req.onerror = () => fail(req.error);
    });
    return this.db;
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise((ok, fail) => { const r = fn(db.transaction('drafts', mode).objectStore('drafts')); r.onsuccess = () => ok(r.result); r.onerror = () => fail(r.error); });
  }
  async get(id: string) { return ((await this.tx('readonly', (s) => s.get(id) as IDBRequest<Draft | undefined>)) as Draft | undefined) ?? null; }
  async put(id: string, d: Draft) { await this.tx('readwrite', (s) => s.put(d, id)); }
  async remove(id: string) { await this.tx('readwrite', (s) => s.delete(id)); }
}

export interface OfflineOptions {
  /** Identifies this document (one draft per id). Required: e.g. the post id. */
  id: string;
  /** Default: IndexedDB (memory where it is not available). */
  store?: DraftStore;
  /** Wait this long after the last change before writing the draft. Default 400. */
  delayMs?: number;
  /** Ask before restoring (a banner with Restore / Discard). Default true; false restores silently. */
  confirm?: boolean;
  /** Called when a draft is found, before the banner: return false to ignore it (for example when the server copy is newer). */
  shouldRestore?: (draft: Draft) => boolean;
}

/**
 * Work that survives a reload: every change is also written to a local draft; when the page opens again and a draft is found, the editor
 * offers to restore it. The draft is removed when `Autosave` reports that the server has the document (or by `discardDraft`).
 * A small badge says when you are offline and that changes are kept on this device.
 */
export function Offline(options: OfflineOptions): EditorPlugin & { store: DraftStore } {
  const store = options.store ?? (typeof indexedDB !== 'undefined' ? new IndexedDBDraftStore() : new MemoryDraftStore());
  const delay = options.delayMs ?? 400;
  const plugin: EditorPlugin = {
    name: 'offline',
    setup(editor: Editor) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let restoring = true; // the draft found at startup must not be overwritten by the (older) initial content
      const comments = () => (editor.extensions.comments as { toJSON(): CommentThread[] } | undefined)?.toJSON() ?? [];
      const write = () => store.put(options.id, { html: editor.getHTML(), comments: comments(), savedAt: Date.now() }).catch(() => { /* storage refused: nothing to restore later, nothing to break now */ });
      const schedule = () => { if (restoring) return; clearTimeout(timer); timer = setTimeout(() => void write(), delay); };

      const badge = document.createElement('div');
      badge.className = 'wy-offline';
      badge.setAttribute('role', 'status');
      badge.hidden = true;
      editor.root.append(badge);
      const onNet = () => {
        const off = typeof navigator !== 'undefined' && navigator.onLine === false;
        badge.hidden = !off;
        badge.textContent = off ? 'You are offline. Changes are kept on this device and will be saved when you are back.' : '';
      };
      window.addEventListener('online', onNet);
      window.addEventListener('offline', onNet);
      onNet();

      const banner = document.createElement('div');
      banner.className = 'wy-draft-banner';
      banner.setAttribute('role', 'alert');
      banner.hidden = true;
      editor.root.prepend(banner);
      const apply = (d: Draft) => {
        editor.replaceHTML(d.html); // one undo step: Undo brings back what was loaded
        (editor.extensions.comments as { load(t: CommentThread[]): void } | undefined)?.load(d.comments);
      };

      editor.registerCommand('discardDraft', () => { clearTimeout(timer); void store.remove(options.id); return true; }, { readOnlySafe: true });
      editor.registerCommand('saveDraft', () => { clearTimeout(timer); void write(); return true; }, { readOnlySafe: true });

      void store.get(options.id).then((d) => {
        restoring = false;
        if (!d || d.html === editor.getHTML() || options.shouldRestore?.(d) === false) return;
        if (options.confirm === false) { apply(d); return; }
        banner.hidden = false;
        banner.replaceChildren();
        const text = document.createElement('span');
        text.textContent = `Unsaved changes from ${new Date(d.savedAt).toLocaleString()} were found on this device.`;
        const restore = document.createElement('button');
        restore.type = 'button';
        restore.className = 'wy-btn wy-btn-primary';
        restore.textContent = 'Restore';
        restore.addEventListener('click', () => { apply(d); banner.hidden = true; });
        const discard = document.createElement('button');
        discard.type = 'button';
        discard.className = 'wy-btn';
        discard.textContent = 'Discard';
        discard.addEventListener('click', () => { void store.remove(options.id); banner.hidden = true; });
        banner.append(text, restore, discard);
        editor.emit('draft-found', { draft: d });
      }, () => { restoring = false; });

      const offChange = editor.on('change', schedule);
      // The comment threads can change without the text changing
      const commentsStore = editor.extensions.comments as { subscribe?(fn: () => void): () => void } | undefined;
      const offComments = commentsStore?.subscribe?.(schedule);
      // A saved document needs no draft any more
      // (Autosave announces "saved" when it starts, before anything was typed: only a save that follows a change counts)
      let changed = false;
      const offSave = editor.on('save', (e: { status?: string }) => {
        if (e?.status === 'unsaved' || e?.status === 'saving') changed = true;
        else if (e?.status === 'saved' && changed) { changed = false; clearTimeout(timer); void store.remove(options.id); }
      });
      const onHide = () => { if (document.visibilityState === 'hidden' && !restoring) { clearTimeout(timer); void write(); } };
      document.addEventListener('visibilitychange', onHide);
      editor.on('destroy', () => {
        clearTimeout(timer);
        offChange(); offComments?.(); offSave();
        window.removeEventListener('online', onNet);
        window.removeEventListener('offline', onNet);
        document.removeEventListener('visibilitychange', onHide);
        badge.remove();
        banner.remove();
      });
    },
  };
  return Object.assign(plugin, { store });
}
