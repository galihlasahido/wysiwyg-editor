import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

export interface Version { id: string; label: string; createdAt: number; author: string; html: string }

export interface VersionPersistence {
  load(): Version[];
  save(versions: Version[]): void;
}

/** Persist versions in `localStorage` (falls back to memory if storage is unavailable). */
export function localStorageVersions(key: string): VersionPersistence {
  return {
    load() {
      try {
        const v = JSON.parse(localStorage.getItem(key) ?? '[]');
        return Array.isArray(v) ? v : [];
      } catch {
        return [];
      }
    },
    save(versions) {
      try {
        localStorage.setItem(key, JSON.stringify(versions));
      } catch {
        /* quota or disabled storage: keep working in memory */
      }
    },
  };
}

export class VersionStore {
  private versions: Version[];
  private listeners = new Set<() => void>();
  constructor(private max: number, private persistence?: VersionPersistence) {
    this.versions = persistence?.load() ?? [];
  }
  /** Newest first. */
  list(): Version[] { return [...this.versions].reverse(); }
  get(id: string): Version | undefined { return this.versions.find((v) => v.id === id); }
  add(v: Version): void {
    this.versions.push(v);
    if (this.versions.length > this.max) this.versions.splice(0, this.versions.length - this.max);
    this.changed();
  }
  remove(id: string): boolean {
    const i = this.versions.findIndex((v) => v.id === id);
    if (i < 0) return false;
    this.versions.splice(i, 1);
    this.changed();
    return true;
  }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    this.persistence?.save(this.versions);
    for (const l of this.listeners) l();
  }
}

export interface VersionsOptions {
  author?: string;
  /** Keep at most this many versions (oldest dropped). Default 50. */
  max?: number;
  persistence?: VersionPersistence;
  /** Also save an automatic version this often while the document changes. Off by default. */
  autoSaveMs?: number;
}
export type VersionsPlugin = EditorPlugin & { store: VersionStore };

let counter = 0;
const newId = () => `v${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Named versions with restore. Restoring is undoable and first snapshots the current document. */
export function Versions(options: VersionsOptions = {}): VersionsPlugin {
  const store = new VersionStore(options.max ?? 50, options.persistence);
  const author = options.author ?? 'Anonymous';
  const plugin: EditorPlugin = {
    name: 'versions',
    setup(editor: Editor) {
      const snapshot = (label: string) => {
        const html = editor.getHTML();
        const last = store.list()[0];
        if (last && last.html === html && !label.startsWith('Before restore')) return null; // nothing changed
        const v: Version = { id: newId(), label, createdAt: Date.now(), author, html };
        store.add(v);
        return v;
      };
      editor.registerCommand('saveVersion', (_e, label?: string) => !!snapshot(label?.trim() || `Version ${store.list().length + 1}`));
      editor.registerCommand('restoreVersion', (e, id: string) => {
        const v = store.get(id);
        if (!v) return false;
        snapshot(`Before restore of "${v.label}"`);
        e.replaceHTML(v.html);
        return true;
      });
      editor.registerCommand('deleteVersion', (_e, id: string) => store.remove(id));
      editor.registerCommand('toggleVersions', () => {
        panel.hidden = !panel.hidden;
        return true;
      });

      const panel = document.createElement('aside');
      panel.className = 'wy-versions';
      panel.setAttribute('aria-label', 'Version history');
      panel.hidden = true;
      editor.body.append(panel);
      const render = () => {
        panel.replaceChildren();
        const title = document.createElement('div');
        title.className = 'wy-versions-title';
        title.textContent = 'Version history';
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'wy-btn';
        save.textContent = 'Save version';
        save.addEventListener('click', () => editor.execute('saveVersion', window.prompt('Version name') ?? undefined));
        panel.append(title, save);
        for (const v of store.list()) {
          const row = document.createElement('div');
          row.className = 'wy-version';
          const name = document.createElement('div');
          name.textContent = v.label;
          const meta = document.createElement('div');
          meta.className = 'wy-version-meta';
          meta.textContent = `${v.author} · ${new Date(v.createdAt).toLocaleString()}`;
          const restore = document.createElement('button');
          restore.type = 'button';
          restore.className = 'wy-btn';
          restore.textContent = 'Restore';
          restore.addEventListener('click', () => editor.execute('restoreVersion', v.id));
          row.append(name, meta, restore);
          panel.append(row);
        }
      };
      store.subscribe(render);
      render();

      if (options.autoSaveMs) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const prev = editor.config.onChange;
        editor.config.onChange = (html) => {
          prev?.(html);
          clearTimeout(timer);
          timer = setTimeout(() => snapshot('Autosave'), options.autoSaveMs);
        };
      }
    },
    toolbar: [{ name: 'versions', label: 'Version history', icon: '🕘', command: 'toggleVersions' }],
  };
  return Object.assign(plugin, { store });
}
