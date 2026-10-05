import { Autosave, Comments, createEditor, createEndpointSaver, defaultPlugins, type CommentThread } from '../src';
import { $, button, codePanel, el } from './samples';

// ---- A simulated backend: one "database row", with controllable failures ---------------------------------------------
interface Row { id: number; title: string; html: string; comments: CommentThread[]; version: number; updated_at: string }
let row: Row = {
  id: 1,
  title: 'Quarterly update',
  html: '<h1>Quarterly update</h1><p>Revenue grew <span data-comment-id="c1">twelve percent</span> this quarter. Select any text and add a comment: the thread is saved with the post.</p>',
  comments: [{ id: 'c1', author: 'Ana', text: 'Can we add the source for this number?', createdAt: Date.now() - 3600_000, resolved: false, replies: [] }],
  version: 1,
  updated_at: new Date().toISOString(),
};
const state = { offline: false, conflict: false, latency: 300 };
const logEl = el('tbody');
const rowEl = el('pre', { class: 'se-row' });
const showRow = () => { rowEl.textContent = JSON.stringify({ ...row, html: row.html.length > 220 ? `${row.html.slice(0, 220)}…` : row.html }, null, 2); };

function log(method: string, status: number | string, bytes: number, note: string) {
  const cls = typeof status === 'number' ? (status < 300 ? 'se-ok' : status === 409 ? 'se-warn' : 'se-bad') : 'se-bad';
  const tr = el('tr', {}, el('td', {}, new Date().toLocaleTimeString()), el('td', {}, method), el('td', { class: cls }, String(status)), el('td', {}, `${bytes} B`), el('td', {}, note));
  logEl.prepend(tr);
  while (logEl.children.length > 12) logEl.lastElementChild!.remove();
}

/** A stand-in for `fetch`: what your server would do with the body. */
const fakeFetch = (async (url: string, init: RequestInit) => {
  const body = String(init.body ?? '');
  await new Promise((r) => setTimeout(r, state.latency));
  if (state.offline) { log(init.method ?? 'POST', 'network error', body.length, 'no connection: Autosave retries with backoff'); throw new TypeError('Failed to fetch'); }
  if (state.conflict) { log(init.method ?? 'POST', 409, body.length, 'someone else changed this post'); return new Response('Conflict', { status: 409 }); }
  const data = JSON.parse(body) as { title?: string; html: string; comments: CommentThread[] };
  row = { ...row, title: data.title ?? row.title, html: data.html, comments: data.comments, version: row.version + 1, updated_at: new Date().toISOString() };
  showRow();
  log(init.method ?? 'POST', 200, body.length, `saved v${row.version}: ${data.comments.length} comment thread(s)`);
  return new Response(JSON.stringify({ version: row.version }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

// ---- The page -------------------------------------------------------------------------------------------------------
const title = el('input', { class: 'se-title', value: row.title, 'aria-label': 'Title' }) as HTMLInputElement;
const mount = el('div', { id: 'editor' });
const checks = (label: string, key: 'offline' | 'conflict') => { const c = el('input', { type: 'checkbox' }) as HTMLInputElement; c.addEventListener('change', () => (state[key] = c.checked)); return el('label', {}, c, label); };
const latency = el('select', { 'aria-label': 'Latency' }, ...[0, 300, 1500].map((n) => el('option', { value: String(n), textContent: `${n} ms`, selected: n === 300 }))) as HTMLSelectElement;
latency.addEventListener('change', () => (state.latency = Number(latency.value)));

$('#app').append(
  el('div', { class: 'demo-note' }, 'Type, comment, reply or resolve: the badge under the editor shows the save state. Tick ', el('strong', {}, 'Offline'), ' to watch retries, ', el('strong', {}, 'Conflict'), ' to see the 409 state. A reply changes only the comment thread, not the text, and still triggers a save.'),
  el('div', { class: 'se-controls' }, checks('Offline (network errors)', 'offline'), checks('Conflict (409)', 'conflict'), el('label', {}, 'Latency ', latency), button('Reload from the database', () => mountEditor(), false)),
  el('div', { class: 'se-grid' },
    el('div', {}, title, el('div', { class: 'panel' }, mount)),
    el('div', {}, el('h2', { style: 'font-size:15px;margin:0 0 6px' }, 'The database row'), rowEl, el('h2', { style: 'font-size:15px;margin:14px 0 6px' }, 'Requests'), el('table', { class: 'se-log' }, el('thead', {}, el('tr', {}, ...['Time', 'Method', 'Status', 'Size', 'What happened'].map((h) => el('th', {}, h)))), logEl)),
  ),
);

let current: ReturnType<typeof createEditor> | null = null;
function mountEditor() {
  current?.destroy();
  mount.replaceChildren();
  // Loading: the saved threads go back in through Comments({ initial })
  current = createEditor({
    element: mount,
    content: row.html,
    plugins: [
      ...defaultPlugins,
      Comments({ author: 'You', initial: structuredClone(row.comments) }),
      Autosave({
        delayMs: 600,
        save: createEndpointSaver({ url: `/api/posts/${row.id}`, method: 'PUT', headers: { Authorization: 'Bearer demo-token' }, title: () => title.value, fetch: fakeFetch }),
      }),
    ],
    ribbon: { initialTab: 'review' },
  });
  (window as unknown as { editor: typeof current }).editor = current;
}
title.addEventListener('input', () => current?.execute('saveNow'));
showRow();
mountEditor();

$('#app').append(codePanel(`
const comments = Comments({ author: 'Ana', initial: post.comments });          // load saved threads
createEditor({
  element, content: post.html,
  plugins: [...defaultPlugins, comments, Autosave({
    save: createEndpointSaver({
      url: '/api/posts/42', method: 'PUT',
      headers: () => ({ Authorization: \`Bearer \${token}\` }),
      title: () => titleInput.value,
    }),                                      // sends { title, html, comments } as JSON
  })],
});
// 5xx / network error: retried with backoff.  409: stops and shows "Conflict".
// Your server stores html in a text column and comments in a JSON column.
`));
