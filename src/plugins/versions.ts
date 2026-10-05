import { askDialog, openDialog } from '../dialog';
import { diffDocuments } from '../diff';
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
      /** Show what changed between a version and the current document (or another version). */
      editor.registerCommand('compareVersion', (e, id: string, againstId?: string) => {
        const v = store.get(id);
        if (!v) return false;
        const body = document.createElement('div');
        body.className = 'wy-diff';
        const pick = document.createElement('select');
        pick.setAttribute('aria-label', 'Compare with');
        pick.add(new Option('Current document', ''));
        for (const o of store.list()) if (o.id !== id) pick.add(new Option(`${o.label} · ${new Date(o.createdAt).toLocaleString()}`, o.id));
        if (againstId && store.get(againstId)) pick.value = againstId;
        const legend = document.createElement('div');
        legend.className = 'wy-diff-legend';
        const page = document.createElement('div');
        page.className = 'wy-content wy-diff-page';
        const text = document.createElement('div');
        text.className = 'ProseMirror wy-diff-text';
        page.append(text);
        const head = document.createElement('div');
        head.className = 'wy-diff-head';
        const label = document.createElement('label');
        label.append(`“${v.label}” compared with `, pick);
        head.append(label, legend);
        body.append(head, page);
        const render = () => {
          const other = pick.value ? store.get(pick.value)?.html ?? '' : e.getHTML();
          const r = diffDocuments(v.html, other);
          text.innerHTML = r.html || '<p class="wy-diff-none">Both are empty.</p>'; // diffDocuments removes scripts and handlers
          legend.replaceChildren();
          const chip = (cls: string, t: string) => { const s = document.createElement('span'); s.className = cls; s.textContent = t; legend.append(s); };
          if (!r.stats.changedBlocks) chip('wy-diff-same', 'No differences');
          else { chip('wy-diff-ins', `+${r.stats.added} words`); chip('wy-diff-del', `−${r.stats.removed} words`); chip('wy-diff-count', `${r.stats.changedBlocks} blocks changed`); }
        };
        pick.addEventListener('change', render);
        render();
        openDialog(e.root, { title: 'Compare versions', body, wide: true, actions: [{ label: 'Close', primary: true }] });
        return true;
      }, { readOnlySafe: true });
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
        save.addEventListener('click', () => void askDialog(editor.root, { title: 'Save version', label: 'Version name', description: 'Optional. A name makes it easy to find later.', placeholder: 'e.g. Sent to legal', required: false, submitLabel: 'Save', maxLength: 120 }).then((name) => name !== null && editor.execute('saveVersion', name || undefined)));
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
          const compare = document.createElement('button');
          compare.type = 'button';
          compare.className = 'wy-btn';
          compare.textContent = 'Compare';
          compare.title = 'See what changed since this version';
          compare.addEventListener('click', () => editor.execute('compareVersion', v.id));
          row.append(name, meta, restore, compare);
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
