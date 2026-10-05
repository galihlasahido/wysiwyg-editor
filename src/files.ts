/** File storage for the file manager: metadata + bytes, behind an interface so a server can replace the browser store. */

export interface StoredFile {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
  updatedAt: number;
  /** Pixel size, for images. */
  width?: number;
  height?: number;
  /** Optional folder / label to group files. */
  folder?: string;
}

export interface FileStore {
  list(): Promise<StoredFile[]>;
  get(id: string): Promise<{ meta: StoredFile; blob: Blob } | null>;
  put(blob: Blob, meta: { name: string; folder?: string; width?: number; height?: number }): Promise<StoredFile>;
  update(id: string, patch: { name?: string; folder?: string | null }): Promise<StoredFile | null>;
  /** Replace the bytes (an edited image), keeping the id and name. */
  replace(id: string, blob: Blob, size?: { width?: number; height?: number }): Promise<StoredFile | null>;
  remove(id: string): Promise<boolean>;
  /** Bytes used and (when the browser says) the quota. */
  usage?(): Promise<{ used: number; quota?: number }>;
}

export const RASTER_IMAGES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp'];
export const isRasterImage = (type: string): boolean => RASTER_IMAGES.includes(type.toLowerCase());

export type FileKind = 'image' | 'pdf' | 'text' | 'audio' | 'video' | 'archive' | 'document' | 'sheet' | 'other';
/** Rough category for the icon and the type filter. Decided by MIME type, then by extension. */
export function fileKind(type: string, name = ''): FileKind {
  const t = type.toLowerCase();
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (t.startsWith('image/')) return 'image';
  if (t === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  if (/zip|compressed|tar|gzip|7z|rar/.test(t) || ['zip', 'gz', 'tar', '7z', 'rar'].includes(ext)) return 'archive';
  if (/spreadsheet|excel|csv/.test(t) || ['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (/word|document|presentation|powerpoint|rtf/.test(t) || ['doc', 'docx', 'ppt', 'pptx', 'odt', 'rtf'].includes(ext)) return 'document';
  if (t.startsWith('text/') || ['txt', 'md', 'json', 'xml', 'yml', 'yaml', 'log'].includes(ext)) return 'text';
  return 'other';
}

/** A safe display name: no path, no control characters, no leading dots, at most 120 characters (the extension is kept). */
export function cleanFileName(name: string, fallback = 'file'): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  if (!base) return fallback;
  if (base.length <= 120) return base;
  const dot = base.lastIndexOf('.');
  const ext = dot > 0 && base.length - dot <= 12 ? base.slice(dot) : '';
  return base.slice(0, 120 - ext.length) + ext;
}

/** `photo.png` -> `photo (2).png` when the name is taken. */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const set = new Set([...taken].map((n) => n.toLowerCase()));
  if (!set.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; i < 10000; i++) {
    const c = `${stem} (${i})${ext}`;
    if (!set.has(c.toLowerCase())) return c;
  }
  return `${stem}-${Date.now()}${ext}`;
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Files kept in memory: for tests, demos, or as the fallback when IndexedDB is unavailable. */
export class MemoryFileStore implements FileStore {
  private files = new Map<string, { meta: StoredFile; blob: Blob }>();
  async list() { return [...this.files.values()].map((f) => ({ ...f.meta })); }
  async get(id: string) { const f = this.files.get(id); return f ? { meta: { ...f.meta }, blob: f.blob } : null; }
  async put(blob: Blob, meta: { name: string; folder?: string; width?: number; height?: number }) {
    const now = Date.now();
    const record: StoredFile = { id: newId(), name: cleanFileName(meta.name), type: blob.type || 'application/octet-stream', size: blob.size, createdAt: now, updatedAt: now, width: meta.width, height: meta.height, folder: meta.folder };
    this.files.set(record.id, { meta: record, blob });
    return { ...record };
  }
  async update(id: string, patch: { name?: string; folder?: string | null }) {
    const f = this.files.get(id);
    if (!f) return null;
    if (patch.name !== undefined) f.meta.name = cleanFileName(patch.name, f.meta.name);
    if (patch.folder !== undefined) f.meta.folder = patch.folder ?? undefined;
    f.meta.updatedAt = Date.now();
    return { ...f.meta };
  }
  async replace(id: string, blob: Blob, size?: { width?: number; height?: number }) {
    const f = this.files.get(id);
    if (!f) return null;
    f.blob = blob;
    f.meta = { ...f.meta, type: blob.type || f.meta.type, size: blob.size, width: size?.width, height: size?.height, updatedAt: Date.now() };
    return { ...f.meta };
  }
  async remove(id: string) { return this.files.delete(id); }
  async usage() { let used = 0; for (const f of this.files.values()) used += f.meta.size; return { used }; }
}

/** Files kept in the browser's IndexedDB: they survive reloads, and stay on this device. */
export class IndexedDBFileStore implements FileStore {
  private dbPromise: Promise<IDBDatabase> | null = null;
  constructor(private name = 'wysiwyg-files') {}

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'meta.id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction('files', mode).objectStore('files'));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async list() { return (await this.tx('readonly', (s) => s.getAll() as IDBRequest<{ meta: StoredFile }[]>)).map((r) => r.meta); }
  async get(id: string) { return (await this.tx('readonly', (s) => s.get(id) as IDBRequest<{ meta: StoredFile; blob: Blob } | undefined>)) ?? null; }
  async put(blob: Blob, meta: { name: string; folder?: string; width?: number; height?: number }) {
    const now = Date.now();
    const record: StoredFile = { id: newId(), name: cleanFileName(meta.name), type: blob.type || 'application/octet-stream', size: blob.size, createdAt: now, updatedAt: now, width: meta.width, height: meta.height, folder: meta.folder };
    await this.tx('readwrite', (s) => s.put({ meta: record, blob }));
    return record;
  }
  async update(id: string, patch: { name?: string; folder?: string | null }) {
    const cur = await this.get(id);
    if (!cur) return null;
    const meta = { ...cur.meta, updatedAt: Date.now() };
    if (patch.name !== undefined) meta.name = cleanFileName(patch.name, meta.name);
    if (patch.folder !== undefined) meta.folder = patch.folder ?? undefined;
    await this.tx('readwrite', (s) => s.put({ meta, blob: cur.blob }));
    return meta;
  }
  async replace(id: string, blob: Blob, size?: { width?: number; height?: number }) {
    const cur = await this.get(id);
    if (!cur) return null;
    const meta = { ...cur.meta, type: blob.type || cur.meta.type, size: blob.size, width: size?.width, height: size?.height, updatedAt: Date.now() };
    await this.tx('readwrite', (s) => s.put({ meta, blob }));
    return meta;
  }
  async remove(id: string) {
    if (!(await this.get(id))) return false;
    await this.tx('readwrite', (s) => s.delete(id));
    return true;
  }
  async usage() {
    const files = await this.list();
    const used = files.reduce((n, f) => n + f.size, 0);
    const est = await navigator.storage?.estimate?.().catch(() => undefined);
    return { used, quota: est?.quota };
  }
}

/**
 * Uses `primary` until it fails, then switches to `fallback` for good. Browsers can refuse to store files in IndexedDB (private
 * windows, some embedded or ephemeral contexts, a full disk): the library should keep working for this session instead of breaking.
 */
export class ResilientFileStore implements FileStore {
  private current: FileStore;
  private failed = false;
  constructor(private primary: FileStore, private fallback: FileStore, private onFallback?: (error: unknown) => void) {
    this.current = primary;
  }
  /** True once the primary store failed and files are kept in memory only. */
  get degraded(): boolean { return this.failed; }
  private async run<T>(fn: (s: FileStore) => Promise<T>): Promise<T> {
    if (this.failed) return fn(this.fallback);
    try {
      return await fn(this.primary);
    } catch (e) {
      this.failed = true;
      this.current = this.fallback;
      this.onFallback?.(e);
      return fn(this.fallback);
    }
  }
  list() { return this.run((s) => s.list()); }
  get(id: string) { return this.run((s) => s.get(id)); }
  put(blob: Blob, meta: { name: string; folder?: string; width?: number; height?: number }) { return this.run((s) => s.put(blob, meta)); }
  update(id: string, patch: { name?: string; folder?: string | null }) { return this.run((s) => s.update(id, patch)); }
  replace(id: string, blob: Blob, size?: { width?: number; height?: number }) { return this.run((s) => s.replace(id, blob, size)); }
  remove(id: string) { return this.run((s) => s.remove(id)); }
  async usage() { const s = this.current; return s.usage ? s.usage() : { used: 0 }; }
}

/** IndexedDB when the browser has it (falling back to memory if it refuses files), memory otherwise. */
export function createFileStore(name?: string): FileStore {
  if (typeof indexedDB === 'undefined') return new MemoryFileStore();
  return new ResilientFileStore(new IndexedDBFileStore(name), new MemoryFileStore(), (e) => console.warn('File storage in IndexedDB is not available here; files are kept in memory for this session.', e));
}
