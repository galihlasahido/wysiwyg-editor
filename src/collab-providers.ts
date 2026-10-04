import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

/** Connect two documents in-process (tests, demos). Returns a function that disconnects them. */
export function linkDocs(a: Y.Doc, b: Y.Doc): () => void {
  const toB = (u: Uint8Array, origin: unknown) => origin !== 'link' && Y.applyUpdate(b, u, 'link');
  const toA = (u: Uint8Array, origin: unknown) => origin !== 'link' && Y.applyUpdate(a, u, 'link');
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a), 'link');
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b), 'link');
  a.on('update', toB);
  b.on('update', toA);
  return () => (a.off('update', toB), b.off('update', toA));
}

type Msg =
  | { t: 'update'; d: Uint8Array }
  | { t: 'sv'; d: Uint8Array }
  | { t: 'awareness'; d: Uint8Array };

/**
 * Sync a document (and cursors) between browser tabs of the same origin with BroadcastChannel.
 * No server needed; useful for demos and offline-first apps. Use a WebSocket provider across machines.
 */
export function createBroadcastProvider(room: string, ydoc: Y.Doc) {
  const channel = new BroadcastChannel(`wysiwyg-${room}`);
  const awareness = new Awareness(ydoc);
  const send = (m: Msg) => channel.postMessage(m);

  const onUpdate = (d: Uint8Array, origin: unknown) => origin !== 'broadcast' && send({ t: 'update', d });
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === 'broadcast') return;
    send({ t: 'awareness', d: encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]) });
  };
  channel.onmessage = ({ data }: MessageEvent<Msg>) => {
    if (data.t === 'update') Y.applyUpdate(ydoc, data.d, 'broadcast');
    else if (data.t === 'sv') send({ t: 'update', d: Y.encodeStateAsUpdate(ydoc, data.d) }); // send what the peer is missing
    else applyAwarenessUpdate(awareness, data.d, 'broadcast');
  };
  ydoc.on('update', onUpdate);
  awareness.on('update', onAwareness);
  send({ t: 'sv', d: Y.encodeStateVector(ydoc) }); // ask peers for what we are missing
  send({ t: 'awareness', d: encodeAwarenessUpdate(awareness, [ydoc.clientID]) });

  return {
    awareness,
    destroy() {
      removeAwarenessStates(awareness, [ydoc.clientID], 'local');
      ydoc.off('update', onUpdate);
      awareness.off('update', onAwareness);
      channel.close();
    },
  };
}

export type ProviderStatus = 'connecting' | 'connected' | 'disconnected' | 'denied';

export interface WebSocketProviderOptions {
  awareness?: Awareness;
  /** Inject a WebSocket implementation (Node tests: the `ws` package). Defaults to the global one. */
  WebSocketImpl?: typeof WebSocket;
  onStatus?: (s: ProviderStatus) => void;
  /** Reconnect with exponential backoff (max 10s). Default true. */
  reconnect?: boolean;
}

/**
 * Sync a document over a WebSocket speaking the Yjs sync + awareness protocols (the `server/` relay in this
 * repo, or y-websocket-compatible servers). `synced` resolves after the first full sync, which is the right
 * moment to seed an empty document.
 */
export function createWebSocketProvider(url: string, ydoc: Y.Doc, options: WebSocketProviderOptions = {}) {
  const awareness = options.awareness ?? new Awareness(ydoc);
  const WS = options.WebSocketImpl ?? WebSocket;
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveSynced!: () => void;
  const synced = new Promise<void>((r) => (resolveSynced = r));
  const status = (s: ProviderStatus) => options.onStatus?.(s);

  const frame = (type: number, write: (e: encoding.Encoder) => void) => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, type);
    write(e);
    return encoding.toUint8Array(e);
  };
  const sendFrame = (data: Uint8Array) => ws?.readyState === 1 && ws.send(data as Uint8Array<ArrayBuffer>);

  const onDocUpdate = (u: Uint8Array, origin: unknown) => origin !== provider && sendFrame(frame(0, (e) => syncProtocol.writeUpdate(e, u)));
  const onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== provider) sendFrame(frame(1, (e) => encoding.writeVarUint8Array(e, encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]))));
  };

  const provider = { awareness, synced, destroy() {} };

  function connect() {
    status('connecting');
    ws = new WS(url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      attempt = 0;
      status('connected');
      sendFrame(frame(0, (e) => syncProtocol.writeSyncStep1(e, ydoc)));
      if (awareness.getLocalState() !== null) sendFrame(frame(1, (e) => encoding.writeVarUint8Array(e, encodeAwarenessUpdate(awareness, [ydoc.clientID]))));
    };
    ws.onmessage = (ev: MessageEvent) => {
      const dec = decoding.createDecoder(new Uint8Array(ev.data as ArrayBuffer));
      const type = decoding.readVarUint(dec);
      if (type === 0) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, 0);
        const kind = syncProtocol.readSyncMessage(dec, reply, ydoc, provider);
        if (encoding.length(reply) > 1) sendFrame(encoding.toUint8Array(reply));
        if (kind === syncProtocol.messageYjsSyncStep2) resolveSynced();
      } else if (type === 1) {
        applyAwarenessUpdate(awareness, decoding.readVarUint8Array(dec), provider);
      }
    };
    ws.onclose = (ev: CloseEvent) => {
      removeAwarenessStates(awareness, [...awareness.getStates().keys()].filter((c) => c !== ydoc.clientID), provider);
      if (closed) return;
      if (ev.code === 4403 || ev.code === 4401) return status('denied'); // revoked: retrying would not help
      status('disconnected');
      if (options.reconnect !== false) timer = setTimeout(connect, Math.min(10000, 250 * 2 ** attempt++));
    };
    ws.onerror = () => {}; // `onclose` follows and handles reconnecting
  }

  ydoc.on('update', onDocUpdate);
  awareness.on('update', onAwareness);
  connect();
  provider.destroy = () => {
    closed = true;
    clearTimeout(timer);
    ydoc.off('update', onDocUpdate);
    awareness.off('update', onAwareness);
    removeAwarenessStates(awareness, [ydoc.clientID], provider);
    ws?.close();
  };
  return provider;
}
