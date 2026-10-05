/**
 * Example endpoints for the editor's callbacks, in one small file with no dependencies beyond Node. Each route shows what the editor
 * sends and what it expects back (see "Endpoints your app provides" in the README):
 *
 *   POST /api/ai          AIAssistant provider      body {action, instruction, text}  ->  plain text (streamed)
 *   PUT  /api/posts/:id   createEndpointSaver       body {title, html, comments}      ->  JSON {id, savedAt}  (409 on conflict)
 *   POST /api/upload      uploadImage               raw image bytes                   ->  JSON {url}
 *   POST /api/proofread   createLanguageToolProvider  form text=…&language=…          ->  LanguageTool-style {matches}
 *   GET  /api/mentions    Mentions({ search })      ?q=an                             ->  [{id, label}]
 *
 * It is an example, not a product: the "model" is a set of text rules, files go to a local folder, and there are no user accounts.
 * Run it with `pnpm server:examples` (port 8788) and point the editor at it, e.g. `?endpoint=http://127.0.0.1:8788/api/ai` on the AI demo.
 */
import { createHash } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ExampleApiOptions {
  /** Where posts and uploads are kept. Default `./data/examples`. */
  dataDir?: string;
  /** Browser origins allowed to call the API. Default: the Vite dev server. */
  allowOrigins?: string[];
  /** Largest request body in bytes. Default 6 MB (uploads are capped at 5 MB). */
  maxBody?: number;
}

// ---- the "model": replace `complete` with a call to your provider. Keep API keys here, on the server, never in the browser.
const FIXES: [RegExp, string][] = [[/\bteh\b/gi, 'the'], [/\brecieve(d?)\b/gi, 'receive$1'], [/\bdont\b/gi, "don't"], [/\bwich\b/gi, 'which'], [/\balot\b/gi, 'a lot'], [/\bi\b/g, 'I'], [/ {2,}/g, ' ']];
const fix = (t: string) => FIXES.reduce((s, [re, to]) => s.replace(re, to), t).replace(/(^|[.!?]\s+)([a-z])/g, (_m, a, b) => a + b.toUpperCase());
const sentences = (t: string) => t.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [t];

/** What your model call must return per `action`: the text itself, with no preface ("Here is…") and no quotes. */
async function* complete(action: string, instruction: string, text: string): AsyncGenerator<string> {
  let out: string;
  switch (action) {
    case 'grammar': case 'review': case 'improve': out = fix(text); break;               // the corrected text, same paragraph
    case 'shorten': { const s = sentences(fix(text)); out = s.slice(0, Math.max(1, Math.ceil(s.length / 2))).join(' '); break; }
    case 'expand': out = `${fix(text)} In other words, the details matter, and small improvements add up over time.`; break;
    case 'summarize': out = `Summary: ${sentences(fix(text))[0]}`; break;
    case 'complete': out = ' and then the next part follows.'; break;                    // only the continuation, one line
    case 'chat': out = `This document has ${text.split(/\s+/).filter(Boolean).length} words. (Replace this with a model answer; Markdown is fine.)`; break;
    default: out = `[example] ${instruction.slice(0, 80)}\n\n${fix(text)}`;                // translate, custom prompt…
  }
  for (const word of out.split(/(\s+)/)) { yield word; await new Promise((r) => setTimeout(r, 15)); }
}

// ---- proofreading rules in LanguageTool's response shape
const TYPOS: Record<string, string> = { teh: 'the', recieve: 'receive', definately: 'definitely', seperate: 'separate', alot: 'a lot', wich: 'which', occured: 'occurred' };
function proofread(text: string) {
  const matches: unknown[] = [];
  for (const m of text.matchAll(/[A-Za-z']+/g)) {
    const fixTo = TYPOS[m[0].toLowerCase()];
    if (fixTo) matches.push({ offset: m.index, length: m[0].length, message: `Possible spelling mistake: “${m[0]}”.`, replacements: [{ value: fixTo }], rule: { id: 'EXAMPLE_SPELL', issueType: 'misspelling' } });
  }
  for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) matches.push({ offset: m.index! + m[1].length + 1, length: m[1].length, message: 'Repeated word.', replacements: [{ value: '' }], rule: { id: 'EXAMPLE_REPEAT', issueType: 'style' } });
  return { matches };
}

const PEOPLE = ['Ana Lestari', 'Andi Pratama', 'Bagus Santoso', 'Citra Dewi', 'Dian Kusuma', 'Eko Wijaya', 'Fitri Handayani'];

// ---- images: trust the bytes, not the Content-Type the client claims
const IMAGE_TYPES: [string, string, (b: Buffer) => boolean][] = [
  ['png', 'image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['jpg', 'image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['gif', 'image/gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['webp', 'image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];
const MAX_IMAGE = 5 * 1024 * 1024;

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

export function createExampleApi(options: ExampleApiOptions = {}): { server: Server; listen(port?: number): Promise<number>; close(): Promise<void> } {
  const dataDir = options.dataDir ?? join(process.cwd(), 'data', 'examples');
  const allow = new Set(options.allowOrigins ?? ['http://127.0.0.1:5173', 'http://localhost:5173']);
  const maxBody = options.maxBody ?? 6 * 1024 * 1024;
  const versions = new Map<string, number>();

  const body = (req: IncomingMessage) => new Promise<Buffer>((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > maxBody) { reject(new HttpError(413, 'Request body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
  const json = (res: ServerResponse, status: number, value: unknown) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(value)); };
  const parseJSON = async (req: IncomingMessage) => { try { return JSON.parse((await body(req)).toString('utf8')); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(400, 'Body must be JSON'); } };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    if (origin && allow.has(origin)) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'origin'); res.setHeader('access-control-allow-headers', 'content-type, authorization'); res.setHeader('access-control-allow-methods', 'GET, POST, PUT, OPTIONS'); }
    if (req.method === 'OPTIONS') { res.writeHead(204); return void res.end(); }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    // The editor sends {action, instruction, text} and reads the reply as plain text, streamed as it arrives.
    if (req.method === 'POST' && path === '/api/ai') {
      const b = await parseJSON(req);
      if (typeof b?.action !== 'string' || typeof b?.text !== 'string' || b.text.length > 100_000) throw new HttpError(400, 'Expected {action, instruction, text}');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      for await (const chunk of complete(b.action, String(b.instruction ?? ''), b.text)) { if (res.destroyed) return; res.write(chunk); }
      return void res.end();
    }

    // createEndpointSaver: JSON {title, html, comments}. Any 2xx is success; JSON in the reply goes to onSaved(). 409 = conflict.
    const post = /^\/api\/posts\/([\w-]{1,64})$/.exec(path);
    if (post && (req.method === 'PUT' || req.method === 'POST')) {
      const id = post[1];
      const b = await parseJSON(req);
      if (typeof b?.html !== 'string' || b.html.length > 5_000_000 || !Array.isArray(b.comments ?? [])) throw new HttpError(400, 'Expected {title, html, comments}');
      // Always sanitise on the server too: the editor's schema cleans HTML, but a server must not trust a client.
      const baseVersion = req.headers['if-match'] ? Number(req.headers['if-match']) : undefined;
      const current = versions.get(id) ?? 0;
      if (baseVersion !== undefined && baseVersion !== current) throw new HttpError(409, `Document is at version ${current}`);
      const version = current + 1;
      versions.set(id, version);
      await mkdir(join(dataDir, 'posts'), { recursive: true });
      const file = join(dataDir, 'posts', `${id}.json`);
      await writeFile(`${file}.tmp`, JSON.stringify({ id, title: String(b.title ?? '').slice(0, 300), html: b.html, comments: b.comments ?? [], version, savedAt: Date.now() }));
      await rename(`${file}.tmp`, file);
      return json(res, 200, { id, version, savedAt: Date.now() });
    }
    if (post && req.method === 'GET') {
      try { return json(res, 200, JSON.parse(await readFile(join(dataDir, 'posts', `${post[1]}.json`), 'utf8'))); } catch { throw new HttpError(404, 'No such post'); }
    }

    // uploadImage: the app sends the file's bytes; the reply is {url}. The editor only accepts https, same-site paths or data: URLs.
    if (req.method === 'POST' && path === '/api/upload') {
      const bytes = await body(req);
      if (bytes.length === 0 || bytes.length > MAX_IMAGE) throw new HttpError(bytes.length ? 413 : 400, `Images must be 1 byte to ${MAX_IMAGE / 1048576} MB`);
      const kind = IMAGE_TYPES.find(([, , is]) => is(bytes));
      if (!kind) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images are accepted');
      const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}.${kind[0]}`; // content-addressed: the client picks no file name
      await mkdir(join(dataDir, 'uploads'), { recursive: true });
      await writeFile(join(dataDir, 'uploads', name), bytes);
      // an absolute address: the page and this API are on different origins while developing (behind one proxy, '/uploads/…' would do)
      return json(res, 201, { url: `http://${req.headers.host ?? '127.0.0.1:8788'}/uploads/${name}` });
    }
    const up = /^\/uploads\/([a-f0-9]{32}\.(?:png|jpg|gif|webp))$/.exec(path);
    if (up && req.method === 'GET') {
      try {
        const data = await readFile(join(dataDir, 'uploads', up[1]));
        const type = IMAGE_TYPES.find(([ext]) => up[1].endsWith(`.${ext}`))![1];
        res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'public, max-age=31536000, immutable', 'content-security-policy': "default-src 'none'" });
        return void res.end(data);
      } catch { throw new HttpError(404, 'No such file'); }
    }

    // createLanguageToolProvider posts a form (text, language) and reads {matches:[{offset, length, message, replacements:[{value}], rule:{id, issueType}}]}.
    if (req.method === 'POST' && path === '/api/proofread') {
      const form = new URLSearchParams((await body(req)).toString('utf8'));
      const text = form.get('text') ?? '';
      if (text.length > 20_000) throw new HttpError(413, 'Text too long');
      return json(res, 200, proofread(text));
    }

    // Mentions({ search }) -> [{id, label}]
    if (req.method === 'GET' && path === '/api/mentions') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase().slice(0, 50);
      return json(res, 200, PEOPLE.filter((n) => n.toLowerCase().split(' ').some((w) => w.startsWith(q))).slice(0, 8).map((label) => ({ id: String(PEOPLE.indexOf(label) + 1), label })));
    }
    throw new HttpError(404, 'Not found');
  };

  const server = createHttpServer((req, res) => {
    handle(req, res).catch((err) => {
      if (res.headersSent) return void res.end();
      const status = err instanceof HttpError ? err.status : 500;
      json(res, status, { error: err instanceof HttpError ? err.message : 'Internal error' }); // never leak internals
      if (!(err instanceof HttpError)) console.error(err);
    });
  });
  return {
    server,
    listen: (port = 8788) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve((server.address() as { port: number }).port))),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// `pnpm server:examples`
if (process.argv[1] && /server[\\/]examples[\\/]api\.ts$/.test(process.argv[1])) {
  const api = createExampleApi();
  api.listen(Number(process.env.PORT) || 8788).then((p) => console.log(`Example API on http://127.0.0.1:${p}  (POST /api/ai, PUT /api/posts/:id, POST /api/upload, POST /api/proofread, GET /api/mentions)`));
}
