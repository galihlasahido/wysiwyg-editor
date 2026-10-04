export type ShareRole = 'view' | 'comment' | 'edit';

export interface RemoteDocument {
  id: string;
  title: string;
  html: string;
  comments: unknown[];
  version: number;
  updatedAt: number;
  role: 'view' | 'comment' | 'edit' | 'owner';
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The document changed on the server since `version`; `current` is the server's copy. */
export class ConflictError extends ApiError {
  constructor(public current: RemoteDocument) {
    super(409, 'Version conflict');
    this.name = 'ConflictError';
  }
}

/** Client for the REST API in `server/`. `secret` is an owner key or a share token. */
export class DocumentClient {
  constructor(private baseUrl: string, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  private async request<T>(path: string, secret: string | null, init: { method?: string; json?: unknown } = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'),
      headers: {
        ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
    if (res.status === 204) return undefined as T;
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.current) throw new ConflictError(body.current);
    if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText);
    return body as T;
  }

  create(doc: { title?: string; html?: string; comments?: unknown[] } = {}) {
    return this.request<{ id: string; ownerKey: string; version: number }>('/api/docs', null, { json: doc });
  }
  load(id: string, secret: string) {
    return this.request<RemoteDocument>(`/api/docs/${id}`, secret);
  }
  save(id: string, secret: string, doc: { version: number; html?: string; title?: string; comments?: unknown[] }) {
    return this.request<{ version: number; updatedAt: number }>(`/api/docs/${id}`, secret, { method: 'PUT', json: doc });
  }
  saveComments(id: string, secret: string, comments: unknown[]) {
    return this.request<{ ok: true }>(`/api/docs/${id}/comments`, secret, { method: 'PUT', json: { comments } });
  }
  remove(id: string, ownerKey: string) {
    return this.request<void>(`/api/docs/${id}`, ownerKey, { method: 'DELETE' });
  }
  createShare(id: string, ownerKey: string, role: ShareRole) {
    return this.request<{ id: string; role: ShareRole; token: string }>(`/api/docs/${id}/shares`, ownerKey, { json: { role } });
  }
  listShares(id: string, ownerKey: string) {
    return this.request<{ id: string; role: ShareRole }[]>(`/api/docs/${id}/shares`, ownerKey);
  }
  revokeShare(id: string, ownerKey: string, shareId: string) {
    return this.request<void>(`/api/docs/${id}/shares/${shareId}`, ownerKey, { method: 'DELETE' });
  }
}

/** A `save` function for `Autosave` that tracks the document version and surfaces conflicts. */
export function createHttpSaver(options: { client: DocumentClient; id: string; secret: string; version: number; getComments?: () => unknown[]; title?: () => string }) {
  let version = options.version;
  return async (html: string) => {
    const r = await options.client.save(options.id, options.secret, {
      version,
      html,
      title: options.title?.(),
      comments: options.getComments?.(),
    });
    version = r.version;
  };
}
