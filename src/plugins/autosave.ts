import { Plugin } from 'prosemirror-state';
import { ApiError } from '../storage';
import type { EditorPlugin } from '../types';

export type SaveStatus = 'saved' | 'unsaved' | 'saving' | 'error' | 'conflict';

export interface AutosaveOptions {
  /** Persist the document. Reject to signal failure (retried with backoff). */
  save: (html: string) => Promise<void>;
  /** Wait this long after the last change before saving. Default 1000. */
  delayMs?: number;
  /** Save at least this often while the user keeps typing. Default 10000. */
  maxWaitMs?: number;
  onStatus?: (status: SaveStatus, error?: unknown) => void;
}

/**
 * Debounced autosave with retry and a status indicator. Never runs two saves at once, always saves the
 * latest content, and warns before the page is closed with unsaved changes. A 409 conflict stops retrying.
 */
export function Autosave(options: AutosaveOptions): EditorPlugin {
  const delay = options.delayMs ?? 1000;
  const maxWait = options.maxWaitMs ?? 10000;
  return {
    name: 'autosave',
    setup(editor) {
      let status: SaveStatus = 'saved';
      let dirty = false;
      let saving: Promise<void> | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let firstChangeAt = 0;
      let failures = 0;
      let destroyed = false;

      const badge = document.createElement('span');
      badge.className = 'wy-save-status';
      badge.setAttribute('role', 'status');
      editor.root.append(badge);
      const LABEL: Record<SaveStatus, string> = { saved: 'Saved', unsaved: 'Unsaved changes', saving: 'Saving…', error: 'Save failed, retrying…', conflict: 'Conflict: reload to see the latest version' };
      const setStatus = (s: SaveStatus, err?: unknown) => {
        status = s;
        badge.textContent = LABEL[s];
        badge.dataset.status = s;
        options.onStatus?.(s, err);
      };
      setStatus('saved');

      const run = (): Promise<void> => {
        if (saving) return saving; // the in-flight save re-checks `dirty` when it finishes
        if (!dirty || status === 'conflict') return Promise.resolve();
        dirty = false;
        firstChangeAt = 0;
        setStatus('saving');
        saving = options.save(editor.getHTML()).then(
          () => {
            failures = 0;
            saving = null;
            if (dirty) { setStatus('unsaved'); schedule(); return run(); }
            setStatus('saved');
          },
          (err) => {
            saving = null;
            dirty = true; // the content was not stored
            if (err instanceof ApiError && err.status === 409) return setStatus('conflict', err);
            failures++;
            setStatus('error', err);
            if (!destroyed) timer = setTimeout(() => void run(), Math.min(30000, 1000 * 2 ** (failures - 1)));
          },
        );
        return saving;
      };

      const schedule = () => {
        clearTimeout(timer);
        const waited = firstChangeAt ? Date.now() - firstChangeAt : 0;
        timer = setTimeout(() => void run(), Math.max(0, Math.min(delay, maxWait - waited)));
      };

      const prev = editor.config.onChange;
      editor.config.onChange = (html) => {
        prev?.(html);
        if (status === 'conflict') return;
        dirty = true;
        firstChangeAt ||= Date.now();
        if (status !== 'saving' && status !== 'error') setStatus('unsaved');
        if (status !== 'error') schedule(); // while failing, the backoff timer owns retries
      };

      editor.registerCommand('saveNow', () => {
        clearTimeout(timer);
        void run();
        return true;
      }, { readOnlySafe: true });

      const warn = (e: BeforeUnloadEvent) => {
        if (dirty || saving) {
          e.preventDefault();
          e.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', warn);
      // Flush when the tab is hidden: it may never come back (mobile browsers).
      const onHide = () => document.visibilityState === 'hidden' && void run();
      document.addEventListener('visibilitychange', onHide);

      return [
        new Plugin({
          view: () => ({
            destroy() {
              destroyed = true;
              clearTimeout(timer);
              window.removeEventListener('beforeunload', warn);
              document.removeEventListener('visibilitychange', onHide);
              badge.remove();
            },
          }),
        }),
      ];
    },
  };
}
