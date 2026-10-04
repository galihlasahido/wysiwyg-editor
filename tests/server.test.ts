// @vitest-environment node
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { createServer, type RunningServer } from '../server';
import { createWebSocketProvider } from '../src/collab-providers';

let app: RunningServer;
let base: string;
let port: number;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wy-'));
  app = createServer({ dataDir: dir });
  port = await app.listen(0);
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const call = (path: string, init: RequestInit & { key?: string; json?: unknown } = {}) =>
  fetch(base + path, {
    ...init,
    method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
    headers: { ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.key ? { authorization: `Bearer ${init.key}` } : {}) },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });

async function create(html = '<p>hello</p>') {
  const res = await call('/api/docs', { json: { title: 'T', html } });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; ownerKey: string; version: number };
}

describe('documents API', () => {
  it('creates and reads a document as owner', async () => {
    const { id, ownerKey } = await create();
    const doc = await (await call(`/api/docs/${id}`, { key: ownerKey })).json();
    expect(doc).toMatchObject({ id, title: 'T', html: '<p>hello</p>', version: 1, role: 'owner' });
  });

  it('requires credentials and does not reveal whether a document exists', async () => {
    const { id, ownerKey } = await create();
    expect((await call(`/api/docs/${id}`)).status).toBe(401);
    expect((await call(`/api/docs/${id}`, { key: 'wrong' })).status).toBe(403);
    expect((await call(`/api/docs/${'0'.repeat(24)}`, { key: ownerKey })).status).toBe(403); // unknown id looks the same
    expect((await call(`/api/docs/..%2f..%2fetc%2fpasswd`, { key: ownerKey })).status).toBe(404);
    expect((await call('/api/other')).status).toBe(404);
  });

  it('updates with optimistic concurrency', async () => {
    const { id, ownerKey } = await create();
    const ok = await call(`/api/docs/${id}`, { method: 'PUT', key: ownerKey, json: { version: 1, html: '<p>v2</p>' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ version: 2 });
    const stale = await call(`/api/docs/${id}`, { method: 'PUT', key: ownerKey, json: { version: 1, html: '<p>stale</p>' } });
    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body.current).toMatchObject({ html: '<p>v2</p>', version: 2 });
    expect((await call(`/api/docs/${id}`, { method: 'PUT', key: ownerKey, json: { html: 'x' } })).status).toBe(400);
  });

  it('serializes concurrent writes: exactly one wins per version', async () => {
    const { id, ownerKey } = await create();
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => call(`/api/docs/${id}`, { method: 'PUT', key: ownerKey, json: { version: 1, html: `<p>${i}</p>` } })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7);
    const doc = await (await call(`/api/docs/${id}`, { key: ownerKey })).json();
    expect(doc.version).toBe(2);
  });

  it('rejects malformed and oversized bodies', async () => {
    const { id, ownerKey } = await create();
    const bad = await fetch(`${base}/api/docs/${id}`, { method: 'PUT', headers: { authorization: `Bearer ${ownerKey}`, 'content-type': 'application/json' }, body: '{nope' });
    expect(bad.status).toBe(400);
    const big = await call(`/api/docs/${id}`, { method: 'PUT', key: ownerKey, json: { version: 1, html: 'x'.repeat(6 * 1024 * 1024) } }).catch(() => null);
    if (big) expect(big.status).toBe(413);
  });

  it('deletes a document (owner only)', async () => {
    const { id, ownerKey } = await create();
    expect((await call(`/api/docs/${id}`, { method: 'DELETE', key: ownerKey })).status).toBe(204);
    expect((await call(`/api/docs/${id}`, { key: ownerKey })).status).toBe(403);
  });
});

describe('sharing and permissions', () => {
  const share = async (id: string, key: string, role: string) => (await call(`/api/docs/${id}/shares`, { key, json: { role } })).json();

  it('enforces view / comment / edit roles', async () => {
    const { id, ownerKey } = await create();
    const view = await share(id, ownerKey, 'view');
    const comment = await share(id, ownerKey, 'comment');
    const edit = await share(id, ownerKey, 'edit');
    expect((await (await call(`/api/docs/${id}`, { key: view.token })).json()).role).toBe('view');

    const put = (key: string) => call(`/api/docs/${id}`, { method: 'PUT', key, json: { version: 1, html: '<p>x</p>' } });
    expect((await put(view.token)).status).toBe(403);
    expect((await put(comment.token)).status).toBe(403);
    expect((await put(edit.token)).status).toBe(200);

    const putComments = (key: string) => call(`/api/docs/${id}/comments`, { method: 'PUT', key, json: { comments: [{ id: 'c' }] } });
    expect((await putComments(view.token)).status).toBe(403);
    expect((await putComments(comment.token)).status).toBe(200);
    expect((await (await call(`/api/docs/${id}`, { key: ownerKey })).json()).comments).toEqual([{ id: 'c' }]);
  });

  it('only the owner can manage shares or delete, and list never leaks tokens', async () => {
    const { id, ownerKey } = await create();
    const edit = await share(id, ownerKey, 'edit');
    expect((await call(`/api/docs/${id}/shares`, { key: edit.token, json: { role: 'view' } })).status).toBe(403);
    expect((await call(`/api/docs/${id}`, { method: 'DELETE', key: edit.token })).status).toBe(403);
    const list = await (await call(`/api/docs/${id}/shares`, { key: ownerKey })).json();
    expect(list).toEqual([{ id: edit.id, role: 'edit' }]);
    expect(JSON.stringify(list)).not.toContain(edit.token);
    expect((await call(`/api/docs/${id}/shares`, { key: ownerKey, json: { role: 'owner' } })).status).toBe(400);
  });

  it('revokes a share link', async () => {
    const { id, ownerKey } = await create();
    const s = await share(id, ownerKey, 'view');
    expect((await call(`/api/docs/${id}`, { key: s.token })).status).toBe(200);
    expect((await call(`/api/docs/${id}/shares/${s.id}`, { method: 'DELETE', key: ownerKey })).status).toBe(204);
    expect((await call(`/api/docs/${id}`, { key: s.token })).status).toBe(403);
  });

  it('accepts a share token in the query string (for share links)', async () => {
    const { id, ownerKey } = await create();
    const s = await share(id, ownerKey, 'view');
    expect((await call(`/api/docs/${id}?token=${s.token}`)).status).toBe(200);
  });
});

describe('collaboration relay', () => {
  const wsUrl = (id: string, token: string) => `ws://127.0.0.1:${port}/collab/${id}?token=${token}`;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const open = (id: string, token: string, ydoc = new Y.Doc()) => ({ ydoc, p: createWebSocketProvider(wsUrl(id, token), ydoc, { WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket, reconnect: false }) });

  it('syncs edits between two writers and a viewer, ignoring the viewer’s own writes', async () => {
    const { id, ownerKey } = await create();
    const view = await (await call(`/api/docs/${id}/shares`, { key: ownerKey, json: { role: 'view' } })).json();
    const a = open(id, ownerKey);
    const b = open(id, ownerKey);
    const v = open(id, view.token);
    await Promise.all([a.p.synced, b.p.synced, v.p.synced]);

    a.ydoc.getText('t').insert(0, 'hello');
    await sleep(100);
    expect(b.ydoc.getText('t').toString()).toBe('hello');
    expect(v.ydoc.getText('t').toString()).toBe('hello');

    v.ydoc.getText('t').insert(0, 'EVIL');
    await sleep(100);
    expect(a.ydoc.getText('t').toString()).toBe('hello'); // the viewer's update never reached others
    [a, b, v].forEach((c) => c.p.destroy());
  });

  it('rejects connections without valid credentials', async () => {
    const { id } = await create();
    const ws = new WebSocket(wsUrl(id, 'nope'));
    const result = await new Promise<string>((resolve) => {
      ws.on('error', () => resolve('rejected'));
      ws.on('unexpected-response', () => resolve('rejected'));
      ws.on('open', () => resolve('open'));
    });
    expect(result).toBe('rejected');
  });

  it('persists the shared document across a server restart', async () => {
    const { id, ownerKey } = await create();
    const a = open(id, ownerKey);
    await a.p.synced;
    a.ydoc.getText('t').insert(0, 'persist me');
    await sleep(500);
    a.p.destroy();
    await sleep(100);

    const dir2 = dir; // same data directory, new server instance
    const app2 = createServer({ dataDir: dir2 });
    const port2 = await app2.listen(0);
    const ydoc = new Y.Doc();
    const p = createWebSocketProvider(`ws://127.0.0.1:${port2}/collab/${id}?token=${ownerKey}`, ydoc, { WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket, reconnect: false });
    await p.synced;
    expect(ydoc.getText('t').toString()).toBe('persist me');
    p.destroy();
    await app2.close();
  });

  it('closes live connections when their share is revoked', async () => {
    const { id, ownerKey } = await create();
    const s = await (await call(`/api/docs/${id}/shares`, { key: ownerKey, json: { role: 'edit' } })).json();
    const statuses: string[] = [];
    const ydoc = new Y.Doc();
    const p = createWebSocketProvider(wsUrl(id, s.token), ydoc, { WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket, reconnect: false, onStatus: (x) => statuses.push(x) });
    await p.synced;
    await call(`/api/docs/${id}/shares/${s.id}`, { method: 'DELETE', key: ownerKey });
    await sleep(200);
    expect(statuses).toContain('denied');
    p.destroy();
  });
});

import { DocumentClient, ConflictError, createHttpSaver } from '../src/storage';

describe('DocumentClient against the real server', () => {
  const client = () => new DocumentClient(base);

  it('creates, loads, saves with version tracking, and surfaces conflicts', async () => {
    const c = client();
    const { id, ownerKey, version } = await c.create({ title: 'Doc', html: '<p>a</p>' });
    const save = createHttpSaver({ client: c, id, secret: ownerKey, version });
    await save('<p>b</p>');
    await save('<p>c</p>'); // version advanced locally, so no conflict
    expect((await c.load(id, ownerKey)).html).toBe('<p>c</p>');

    // someone else saves in between
    const other = await c.load(id, ownerKey);
    await c.save(id, ownerKey, { version: other.version, html: '<p>theirs</p>' });
    await expect(save('<p>mine</p>')).rejects.toBeInstanceOf(ConflictError);
  });

  it('shares and revokes through the client, and maps errors', async () => {
    const c = client();
    const { id, ownerKey } = await c.create({ html: '<p>x</p>' });
    const s = await c.createShare(id, ownerKey, 'view');
    expect((await c.load(id, s.token)).role).toBe('view');
    await expect(c.save(id, s.token, { version: 1, html: 'y' })).rejects.toMatchObject({ status: 403 });
    expect(await c.listShares(id, ownerKey)).toEqual([{ id: s.id, role: 'view' }]);
    await c.revokeShare(id, ownerKey, s.id);
    await expect(c.load(id, s.token)).rejects.toMatchObject({ status: 403 });
    await c.remove(id, ownerKey);
    await expect(c.load(id, ownerKey)).rejects.toMatchObject({ status: 403 });
  });
});

describe('shutdown', () => {
  it('writes nothing to the data directory after close() has resolved', async () => {
    const d = await mkdtemp(join(tmpdir(), 'wy-close-'));
    const srv = createServer({ dataDir: d });
    const p = await srv.listen(0);
    const created = await (await fetch(`http://127.0.0.1:${p}/api/docs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const ydoc = new Y.Doc();
    const prov = createWebSocketProvider(`ws://127.0.0.1:${p}/collab/${created.id}?token=${created.ownerKey}`, ydoc, { WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket, reconnect: false });
    await prov.synced;
    ydoc.getText('t').insert(0, 'edited just before shutdown'); // starts the 300ms debounce
    await new Promise((r) => setTimeout(r, 30));
    await srv.close();
    const before = (await readdir(d)).sort();
    await new Promise((r) => setTimeout(r, 450)); // longer than the debounce
    expect((await readdir(d)).sort()).toEqual(before); // no late write, no leftover temp files
    expect(before.some((f) => f.endsWith('.tmp'))).toBe(false);
    expect(before.some((f) => f.endsWith('.ydoc'))).toBe(true); // the final state was saved before closing
    prov.destroy();
    await rm(d, { recursive: true, force: true });
  });
});

