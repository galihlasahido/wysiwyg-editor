import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
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
