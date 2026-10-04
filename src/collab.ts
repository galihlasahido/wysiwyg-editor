/** Real-time collaboration (needs the optional `yjs`, `y-prosemirror` and `y-protocols` packages). */
export { Collaboration } from './plugins/collaboration';
export type { CollaborationOptions } from './plugins/collaboration';
export { linkDocs, linkAwareness, createBroadcastProvider, createWebSocketProvider } from './collab-providers';
export type { ProviderStatus, WebSocketProviderOptions } from './collab-providers';
