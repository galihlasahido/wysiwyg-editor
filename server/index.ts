/**
 * Reference backend: JSON document storage with owner/share-link permissions, optimistic concurrency,
 * and a WebSocket relay for Yjs real-time collaboration. File-based on purpose (zero infrastructure);
 * swap `FileStore` for a database in production.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

export type Role = 'view' | 'comment' | 'edit' | 'owner';
const RANK: Record<Role, number> = { view: 0, comment: 1, edit: 2, owner: 3 };

interface Share { id: string; role: Exclude<Role, 'owner'>; hash: string }
interface DocRecord {
  id: string;
  title: string;
  html: string;
  comments: unknown[];
  version: number;
  createdAt: number;
  updatedAt: number;
  ownerHash: string;
  shares: Share[];
}

const ID = /^[a-f0-9]{24}$/;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const token = () => randomBytes(24).toString('hex');

/** One JSON file per document. Writes are atomic (write temp, rename) and serialized per document. */
export class FileStore {
  private locks = new Map<string, Promise<unknown>>();
  constructor(private dir: string) {}

  async init() {
    await mkdir(this.dir, { recursive: true });
  }
  private path(id: string, ext = 'json') {
    if (!ID.test(id)) throw new Error('bad id'); // ids are validated, so no path traversal is possible
    return join(this.dir, `${id}.${ext}`);
  }
  async get(id: string): Promise<DocRecord | null> {
    try {
      return JSON.parse(await readFile(this.path(id), 'utf8'));
    } catch {
      return null;
    }
  }
  /** Run `fn` with exclusive access to a document; returns its result. */
  async update<T>(id: string, fn: (doc: DocRecord | null) => { doc: DocRecord | null; result: T }): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const { doc, result } = fn(await this.get(id));
      if (doc) {
        const tmp = this.path(id, `${randomBytes(4).toString('hex')}.tmp`);
        await writeFile(tmp, JSON.stringify(doc));
        await rename(tmp, this.path(id));
      } else await rm(this.path(id), { force: true });
      return result;
    });
    this.locks.set(id, run.catch(() => {}));
    return run;
  }
  async readBinary(id: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(id, 'ydoc')));
    } catch {
      return null;
    }
  }
  async writeBinary(id: string, data: Uint8Array) {
    const tmp = this.path(id, `${randomBytes(4).toString('hex')}.tmp`);
    await writeFile(tmp, data);
    await rename(tmp, this.path(id, 'ydoc'));
  }
}

function roleFor(doc: DocRecord, secret: string | null): Role | null {
  if (!secret) return null;
  const h = sha(secret);
  if (safeEqual(h, doc.ownerHash)) return 'owner';
  const share = doc.shares.find((s) => safeEqual(s.hash, h));
  return share ? share.role : null;
}

const MAX_BODY = 5 * 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Body too large');
    chunks.push(c as Buffer);
  }
  if (!size) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error();
    return v;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7).trim() : null;
}

export interface ServerOptions {
  dataDir: string;
  /** Origin allowed for cross-origin browser requests. Omit to allow same-origin only. */
  allowedOrigin?: string;
}

export interface RunningServer {
  server: Server;
  store: FileStore;
  listen(port?: number): Promise<number>;
  close(): Promise<void>;
}

export function createServer(options: ServerOptions): RunningServer {
  const store = new FileStore(options.dataDir);
  const rooms = new Map<string, Room>();
  /** Writes in flight, so `close()` can wait for them: nothing may touch the data directory after it resolves. */
  const inflight = new Set<Promise<unknown>>();
  let closing = false;

  const send = (res: ServerResponse, status: number, body?: unknown) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
      ...(options.allowedOrigin ? { 'access-control-allow-origin': options.allowedOrigin, vary: 'Origin' } : {}),
    });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };

  const publicDoc = (d: DocRecord, role: Role) => ({ id: d.id, title: d.title, html: d.html, comments: d.comments, version: d.version, updatedAt: d.updatedAt, role });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean); // ['api','docs',id,...]
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...(options.allowedOrigin ? { 'access-control-allow-origin': options.allowedOrigin, vary: 'Origin' } : {}),
        'access-control-allow-methods': 'GET,POST,PUT,DELETE',
        'access-control-allow-headers': 'authorization,content-type',
      });
      return res.end();
    }
    if (parts[0] !== 'api' || parts[1] !== 'docs') throw new HttpError(404, 'Not found');

    if (parts.length === 2 && req.method === 'POST') {
      const body = await readJson(req);
      const id = randomBytes(12).toString('hex');
      const ownerKey = token();
      const now = Date.now();
      const doc: DocRecord = {
        id,
        title: typeof body.title === 'string' ? body.title.slice(0, 200) : 'Untitled',
        html: typeof body.html === 'string' ? body.html : '',
        comments: Array.isArray(body.comments) ? body.comments : [],
        version: 1,
        createdAt: now,
        updatedAt: now,
        ownerHash: sha(ownerKey),
        shares: [],
      };
      await store.update(id, () => ({ doc, result: null }));
      return send(res, 201, { id, ownerKey, version: 1 });
    }

    const id = parts[2];
    if (!id || !ID.test(id)) throw new HttpError(404, 'Not found');
    const secret = bearer(req) ?? url.searchParams.get('token');
    const current = await store.get(id);
    // Unknown document and missing/invalid credentials are indistinguishable, so ids cannot be probed.
    const role = current ? roleFor(current, secret) : null;
    if (!current || !role) throw new HttpError(secret ? 403 : 401, secret ? 'Forbidden' : 'Authentication required');
    const need = (r: Role) => {
      if (RANK[role] < RANK[r]) throw new HttpError(403, 'Insufficient permissions');
    };

    if (parts.length === 3) {
      if (req.method === 'GET') return send(res, 200, publicDoc(current, role));
      if (req.method === 'PUT') {
        need('edit');
        const body = await readJson(req);
        if (typeof body.version !== 'number') throw new HttpError(400, 'version is required');
        type PutResult = { status: 404 } | { status: 409; current: ReturnType<typeof publicDoc> } | { status: 200; version: number; updatedAt: number };
        const out = await store.update<PutResult>(id, (d) => {
          if (!d) return { doc: null, result: { status: 404 } };
          if (d.version !== body.version) return { doc: d, result: { status: 409, current: publicDoc(d, role) } };
          const next: DocRecord = {
            ...d,
            title: typeof body.title === 'string' ? body.title.slice(0, 200) : d.title,
            html: typeof body.html === 'string' ? body.html : d.html,
            comments: Array.isArray(body.comments) ? body.comments : d.comments,
            version: d.version + 1,
            updatedAt: Date.now(),
          };
          return { doc: next, result: { status: 200, version: next.version, updatedAt: next.updatedAt } };
        });
        if (out.status === 404) throw new HttpError(404, 'Not found');
        return send(res, out.status, out.status === 409 ? { error: 'Version conflict', current: out.current } : out);
      }
      if (req.method === 'DELETE') {
        need('owner');
        await store.update(id, () => ({ doc: null, result: null }));
        await rm(join(options.dataDir, `${id}.ydoc`), { force: true });
        return send(res, 204);
      }
    }

    if (parts[3] === 'comments' && parts.length === 4 && req.method === 'PUT') {
      need('comment'); // commenters may change comments but not the document
      const body = await readJson(req);
      if (!Array.isArray(body.comments)) throw new HttpError(400, 'comments must be an array');
      const next = await store.update(id, (d) => (d ? { doc: { ...d, comments: body.comments as unknown[], updatedAt: Date.now() }, result: true } : { doc: null, result: false }));
      return send(res, next ? 200 : 404, next ? { ok: true } : { error: 'Not found' });
    }

    if (parts[3] === 'shares') {
      need('owner');
      if (parts.length === 4 && req.method === 'GET') return send(res, 200, current.shares.map(({ id: sid, role: r }) => ({ id: sid, role: r })));
      if (parts.length === 4 && req.method === 'POST') {
        const body = await readJson(req);
        if (body.role !== 'view' && body.role !== 'comment' && body.role !== 'edit') throw new HttpError(400, 'role must be view, comment or edit');
        const t = token();
        const share: Share = { id: randomBytes(6).toString('hex'), role: body.role, hash: sha(t) };
        await store.update(id, (d) => (d ? { doc: { ...d, shares: [...d.shares, share] }, result: null } : { doc: null, result: null }));
        return send(res, 201, { id: share.id, role: share.role, token: t });
      }
      if (parts.length === 5 && req.method === 'DELETE') {
        await store.update(id, (d) => (d ? { doc: { ...d, shares: d.shares.filter((s) => s.id !== parts[4]) }, result: null } : { doc: null, result: null }));
        for (const room of rooms.values()) room.revalidate();
        return send(res, 204);
      }
    }
    throw new HttpError(404, 'Not found');
  }

  const server = createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      if (err instanceof HttpError) {
        if (err.status === 413) {
          // Stop the upload only after the response has gone out, and do not reuse the connection.
          res.setHeader('connection', 'close');
          res.once('finish', () => req.destroy());
        }
        if (!res.headersSent) send(res, err.status, { error: err.message });
        return;
      }
      console.error(err);
      if (!res.headersSent) send(res, 500, { error: 'Internal error' });
    });
  });

  // ---- Yjs collaboration relay ----
  const MSG_SYNC = 0;
  const MSG_AWARENESS = 1;

  class Room {
    doc = new Y.Doc();
    awareness = new awarenessProtocol.Awareness(this.doc);
    conns = new Map<WebSocket, { secret: string; role: Role; clientIds: Set<number> }>();
    timer?: ReturnType<typeof setTimeout>;

    constructor(public id: string) {
      this.awareness.setLocalState(null);
      this.doc.on('update', (update: Uint8Array, origin: unknown) => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.writeUpdate(enc, update);
        this.broadcast(encoding.toUint8Array(enc), origin as WebSocket | null);
        clearTimeout(this.timer);
        if (!closing) this.timer = setTimeout(() => void this.persist(), 300);
      });
      this.awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
        const changed = [...added, ...updated, ...removed];
        const conn = origin as WebSocket | null;
        if (conn && this.conns.has(conn)) {
          const ids = this.conns.get(conn)!.clientIds;
          added.forEach((c) => ids.add(c));
          removed.forEach((c) => ids.delete(c));
        }
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_AWARENESS);
        encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
        this.broadcast(encoding.toUint8Array(enc), null);
      });
    }
    broadcast(data: Uint8Array, except: WebSocket | null) {
      for (const ws of this.conns.keys()) if (ws !== except && ws.readyState === 1) ws.send(data);
    }
    persist(): Promise<void> {
      const write = store.writeBinary(this.id, Y.encodeStateAsUpdate(this.doc)).catch((e) => console.error('persist failed', e));
      inflight.add(write);
      void write.finally(() => inflight.delete(write));
      return write;
    }
    /** Drop connections whose credentials were revoked, and downgrade changed roles. */
    async revalidate() {
      const rec = await store.get(this.id);
      for (const [ws, c] of this.conns) {
        const role = rec ? roleFor(rec, c.secret) : null;
        if (!role) ws.close(4403, 'Access revoked');
        else c.role = role;
      }
    }
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_BODY });
  async function getRoom(id: string) {
    let room = rooms.get(id);
    if (!room) {
      room = new Room(id);
      const saved = await store.readBinary(id);
      if (saved) Y.applyUpdate(room.doc, saved);
      // A concurrent connection may have created the room while we were loading.
      if (rooms.has(id)) return rooms.get(id)!;
      rooms.set(id, room);
    }
    return room;
  }

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = /^\/collab\/([a-f0-9]{24})$/.exec(url.pathname);
    const secret = url.searchParams.get('token');
    const reject = (code: number) => (socket.write(`HTTP/1.1 ${code} Error\r\nConnection: close\r\n\r\n`), socket.destroy());
    if (!m || !secret) return reject(401);
    store.get(m[1]).then(async (rec) => {
      const role = rec ? roleFor(rec, secret) : null;
      if (!role) return reject(403);
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.binaryType = 'nodebuffer';
        // The room may need to be loaded from disk, but the client sends its first message right after
        // connecting: listen immediately and queue messages until the room is ready, or they are lost.
        let room: Room | null = null;
        const queue: Buffer[] = [];
        const onMessage = (r: Room, data: Buffer) => {
          const conn = r.conns.get(ws);
          if (!conn) return;
          try {
            const decoder = decoding.createDecoder(new Uint8Array(data));
            const enc = encoding.createEncoder();
            const type = decoding.readVarUint(decoder);
            if (type === MSG_SYNC) {
              encoding.writeVarUint(enc, MSG_SYNC);
              if (RANK[conn.role] >= RANK.edit) syncProtocol.readSyncMessage(decoder, enc, r.doc, ws);
              else if (decoding.readVarUint(decoder) === syncProtocol.messageYjsSyncStep1) syncProtocol.readSyncStep1(decoder, enc, r.doc);
              // viewers/commenters: updates are silently ignored, only reads are served
              if (encoding.length(enc) > 1) ws.send(encoding.toUint8Array(enc));
            } else if (type === MSG_AWARENESS) {
              awarenessProtocol.applyAwarenessUpdate(r.awareness, decoding.readVarUint8Array(decoder), ws);
            }
          } catch {
            ws.close(1003, 'Bad message');
          }
        };
        ws.on('message', (data: Buffer) => (room ? onMessage(room, data) : queue.push(data)));
        ws.on('close', () => {
          const r = room;
          if (!r) return;
          const c = r.conns.get(ws);
          r.conns.delete(ws);
          if (c) awarenessProtocol.removeAwarenessStates(r.awareness, [...c.clientIds], null);
          if (r.conns.size === 0 && !closing) {
            void r.persist().then(() => {
              if (r.conns.size === 0) rooms.delete(r.id);
            });
          }
        });

        getRoom(m[1]).then((r) => {
          if (ws.readyState !== 1) return; // client left while the room was loading
          room = r;
          r.conns.set(ws, { secret, role, clientIds: new Set() });
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, MSG_SYNC);
          syncProtocol.writeSyncStep1(enc, r.doc);
          ws.send(encoding.toUint8Array(enc));
          const states = r.awareness.getStates();
          if (states.size) {
            const a = encoding.createEncoder();
            encoding.writeVarUint(a, MSG_AWARENESS);
            encoding.writeVarUint8Array(a, awarenessProtocol.encodeAwarenessUpdate(r.awareness, [...states.keys()]));
            ws.send(encoding.toUint8Array(a));
          }
          for (const d of queue.splice(0)) onMessage(r, d);
        }, () => ws.close(1011, 'Room unavailable'));
      });
    }, () => reject(500));
  });

  return {
    server,
    store,
    async listen(port = 0) {
      await store.init();
      await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
      return (server.address() as { port: number }).port;
    },
    async close() {
      closing = true; // no new debounced writes from here on
      for (const room of rooms.values()) {
        clearTimeout(room.timer);
        await room.persist(); // final state first, then drop the connections
        for (const ws of room.conns.keys()) ws.terminate();
      }
      wss.close();
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
      await Promise.allSettled([...inflight]); // wait for every write that was already started
    },
  };
}

// Run directly: `pnpm server`
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const port = Number(process.env.PORT ?? 8787);
  const app = createServer({ dataDir: process.env.DATA_DIR ?? './data', allowedOrigin: process.env.ALLOWED_ORIGIN });
  app.listen(port).then((p) => console.log(`wysiwyg server listening on http://127.0.0.1:${p}`));
}
