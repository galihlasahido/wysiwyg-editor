// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createExampleApi } from '../server/examples/api';
import { createEndpointSaver, createFetchProvider, createLanguageToolProvider } from '../src';

let api: ReturnType<typeof createExampleApi>;
let base: string;
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wy-ex-'));
  api = createExampleApi({ dataDir: dir, maxBody: 7 * 1024 * 1024 });
  base = `http://127.0.0.1:${await api.listen(0)}`;
});
afterAll(async () => { await api.close(); await rm(dir, { recursive: true, force: true }); });

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const collect = async (p: AsyncIterable<string> | Promise<string>) => { if (typeof p === 'object' && Symbol.asyncIterator in p) { let o = ''; for await (const c of p as AsyncIterable<string>) o += c; return o; } return p as Promise<string>; };

describe('example API, used by the editor\'s own helpers', () => {
  it('createFetchProvider reads the plain-text reply for each action', async () => {
    const provider = createFetchProvider(`${base}/api/ai`);
    const sig = new AbortController().signal;
    expect(await collect(provider({ action: 'grammar', instruction: 'fix', text: 'i recieve teh report', signal: sig }))).toBe('I receive the report');
    expect(await collect(provider({ action: 'complete', instruction: '', text: 'The story begins', signal: sig }))).toMatch(/^ and then/);
    expect(await collect(provider({ action: 'review', instruction: '', text: 'dont know', signal: sig }))).toBe("Don't know");
  });
  it('the AI route rejects bad bodies and does not leak internals', async () => {
    const bad = await fetch(`${base}/api/ai`, { method: 'POST', body: 'not json' });
    expect(bad.status).toBe(400);
    expect((await fetch(`${base}/api/ai`, { method: 'POST', body: JSON.stringify({ action: 1 }) })).status).toBe(400);
    expect((await fetch(`${base}/api/nothing`)).status).toBe(404);
  });
  it('createEndpointSaver saves JSON and the post can be read back; a stale version is a 409', async () => {
    let saved: unknown;
    const save = createEndpointSaver({ url: `${base}/api/posts/post-1`, method: 'PUT', onSaved: (r) => (saved = r) });
    await save('<p>hello</p>', { comments: [{ id: 'c1' }] });
    expect(saved).toMatchObject({ id: 'post-1', version: 1 });
    const back = await (await fetch(`${base}/api/posts/post-1`)).json();
    expect(back).toMatchObject({ html: '<p>hello</p>', comments: [{ id: 'c1' }], version: 1 });
    const stale = await fetch(`${base}/api/posts/post-1`, { method: 'PUT', headers: { 'if-match': '0', 'content-type': 'application/json' }, body: JSON.stringify({ html: 'x', comments: [] }) });
    expect(stale.status).toBe(409);
    expect((await fetch(`${base}/api/posts/..%2Fevil`, { method: 'PUT', body: '{}' })).status).toBe(404); // ids are validated
    expect((await fetch(`${base}/api/posts/p2`, { method: 'PUT', body: JSON.stringify({ title: 1 }) })).status).toBe(400);
  });
  it('upload checks the bytes, returns a URL, and serves the file back safely', async () => {
    const ok = await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG });
    expect(ok.status).toBe(201);
    const { url } = await ok.json();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/uploads\/[a-f0-9]{32}\.png$/);
    const file = await fetch(url);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await file.arrayBuffer()).equals(PNG)).toBe(true);
    // the claimed type does not matter: HTML sent as image/png is refused, and so is an empty body
    expect((await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: '<script>alert(1)</script>' })).status).toBe(415);
    expect((await fetch(`${base}/api/upload`, { method: 'POST', body: '' })).status).toBe(400);
    expect((await fetch(`${base}/uploads/..%2F..%2Fpackage.json`)).status).toBe(404);
  });
  it('createLanguageToolProvider talks to the proofread route', async () => {
    const provider = createLanguageToolProvider(`${base}/api/proofread`);
    const issues = await provider({ text: 'I recieve teh report and the the end', lang: 'en-US', signal: new AbortController().signal });
    expect(issues.map((i) => [i.offset, i.length, i.replacements, i.kind])).toEqual([[2, 7, ['receive'], 'spelling'], [10, 3, ['the'], 'spelling'], [29, 3, [''], 'style']]);
  });
  it('mentions filter by the typed text', async () => {
    const list = await (await fetch(`${base}/api/mentions?q=an`)).json();
    expect(list.map((x: any) => x.label)).toEqual(['Ana Lestari', 'Andi Pratama']);
    expect(list[0]).toEqual({ id: '1', label: 'Ana Lestari' });
  });
  it('only the listed origins get CORS headers', async () => {
    const yes = await fetch(`${base}/api/mentions`, { headers: { origin: 'http://localhost:5173' } });
    expect(yes.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const no = await fetch(`${base}/api/mentions`, { headers: { origin: 'https://evil.example' } });
    expect(no.headers.get('access-control-allow-origin')).toBeNull();
  });
});
