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
  return async (html: string, ctx?: { comments: unknown[] }) => {
    const r = await options.client.save(options.id, options.secret, {
      version,
      html,
      title: options.title?.(),
      comments: options.getComments?.() ?? ctx?.comments,
    });
    version = r.version;
  };
}

export interface EndpointSaverOptions {
  /** Where to send the document. */
  url: string | (() => string);
  /** Default POST. */
  method?: 'POST' | 'PUT' | 'PATCH';
  /** Extra headers, such as `Authorization` or a CSRF token. May be async. */
  headers?: Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);
  title?: () => string;
  /** Reshape the payload (default `{ title, html, comments }`) to match your API. */
  body?: (payload: { title?: string; html: string; comments: unknown[] }) => unknown;
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
  /** Called with the parsed JSON response (or undefined), e.g. to remember a new version number. */
  onSaved?: (response: unknown) => void;
}

/**
 * A `save` function for `Autosave` that sends the document to any HTTP endpoint (your own API in front of your database).
 * The body is JSON `{ title, html, comments }`: the comment threads travel with the HTML because they are stored apart from it.
 * A 409 response stops retrying and shows the conflict state; other failures are retried with backoff.
 */
export function createEndpointSaver(options: EndpointSaverOptions) {
  return async (html: string, ctx?: { comments: unknown[] }): Promise<void> => {
    const payload = { title: options.title?.(), html, comments: ctx?.comments ?? [] };
    const headers = typeof options.headers === 'function' ? await options.headers() : options.headers ?? {};
    const res = await (options.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)))(typeof options.url === 'function' ? options.url() : options.url, {
      method: options.method ?? 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(options.body ? options.body(payload) : payload),
      credentials: options.credentials,
    });
    if (!res.ok) throw new ApiError(res.status, (await res.text().catch(() => '')).slice(0, 200) || res.statusText);
    options.onSaved?.(res.status === 204 ? undefined : await res.json().catch(() => undefined));
  };
}
