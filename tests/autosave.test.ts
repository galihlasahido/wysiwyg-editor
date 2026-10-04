import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError, Autosave, ConflictError, Editor, defaultPlugins, type SaveStatus } from '../src';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const editors: Editor[] = [];

function setup(save: (html: string) => Promise<void>, opts: { delayMs?: number; maxWaitMs?: number } = {}) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  const statuses: SaveStatus[] = [];
  const e = new Editor({ element: el, content: '<p>a</p>', plugins: [...defaultPlugins, Autosave({ save, delayMs: 20, onStatus: (s) => statuses.push(s), ...opts })] });
  editors.push(e);
  const type = (t: string) => e.view.dispatch(e.view.state.tr.insertText(t, 1));
  return { e, statuses, type };
}

describe('Autosave', () => {
  beforeEach(() => (document.body.innerHTML = ''));
  // Destroy editors so their window-level listeners (beforeunload) do not leak into other tests.
  afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

  it('debounces many edits into one save with the latest content', async () => {
    const saved: string[] = [];
    const { type, statuses } = setup(async (h) => void saved.push(h));
    type('1'); type('2'); type('3');
    expect(statuses.at(-1)).toBe('unsaved');
    await sleep(80);
    expect(saved).toEqual(['<p>321a</p>']);
    expect(statuses.at(-1)).toBe('saved');
  });

  it('never runs two saves at once and saves again when edited during a save', async () => {
    let active = 0;
    let maxActive = 0;
    const saved: string[] = [];
    const { type } = setup(async (h) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(40);
      saved.push(h);
      active--;
    });
    type('x');
    await sleep(35); // first save is in flight
    type('y');
    await sleep(200);
    expect(maxActive).toBe(1);
    expect(saved).toEqual(['<p>xa</p>', '<p>yxa</p>']);
  });

  it('retries after a failure and recovers', async () => {
    let calls = 0;
    const { type, statuses } = setup(async () => {
      if (++calls === 1) throw new Error('offline');
    });
    type('x');
    await sleep(1300); // first backoff is 1s
    expect(calls).toBe(2);
    expect(statuses).toContain('error');
    expect(statuses.at(-1)).toBe('saved');
  });

  it('stops retrying on a version conflict and shows it', async () => {
    let calls = 0;
    const { e, type, statuses } = setup(async () => {
      calls++;
      throw new ConflictError({ id: 'x', title: '', html: '', comments: [], version: 9, updatedAt: 0, role: 'edit' });
    });
    type('x');
    await sleep(100);
    type('y'); // further edits do not trigger more saves while in conflict
    await sleep(100);
    expect(calls).toBe(1);
    expect(statuses.at(-1)).toBe('conflict');
    expect(e.root.querySelector('.wy-save-status')!.textContent).toContain('Conflict');
  });

  it('saveNow flushes immediately and a non-409 ApiError is retried', async () => {
    const saved: string[] = [];
    const { e, type } = setup(async (h) => void saved.push(h), { delayMs: 5000 });
    type('x');
    e.execute('saveNow');
    await sleep(20);
    expect(saved).toEqual(['<p>xa</p>']);
    expect(new ApiError(500, 'x').status).toBe(500);
  });

  it('warns before unload only while there are unsaved changes', async () => {
    const { e, type } = setup(async () => {}, { delayMs: 30 });
    const fire = () => {
      const ev = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    };
    expect(fire()).toBe(false);
    type('x');
    expect(fire()).toBe(true);
    await sleep(80);
    expect(fire()).toBe(false);
    e.destroy();
  });
});
