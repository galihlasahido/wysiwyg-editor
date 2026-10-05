import { Mapping } from 'prosemirror-transform';
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Editor } from '../editor';
import { markdownToDoc } from '../markdown';
import type { AIProvider } from './ai';

export interface InlineSuggestOptions {
  /** Start switched on. Default true when `inline` is given. */
  enabled?: boolean;
  /** Wait this long after typing stops. Default 900 ms. */
  delayMs?: number;
  /** Only suggest once the paragraph has this many characters. Default 20. */
  minChars?: number;
  /** Longest suggestion kept. Default 160 characters. */
  maxChars?: number;
}
export interface ChatOptions {
  /** Longest part of the document sent as context. Default 6000 characters. */
  contextChars?: number;
}
export interface ReviewOptions {
  /** Author name on the tracked changes. Default "AI". */
  author?: string;
  /** Most paragraphs reviewed in one run. Default 200. */
  maxBlocks?: number;
  /** Instruction for the model. Default: fix spelling and grammar. */
  instruction?: string;
}

const ghostKey = new PluginKey<{ pos: number; text: string } | null>('ai-ghost');

/** Collect a model reply (text or stream) into one string, stopping early once `limit` characters are in. */
async function collect(res: Promise<string> | AsyncIterable<string>, signal: AbortSignal, limit = Infinity): Promise<string> {
  if (typeof (res as AsyncIterable<string>)[Symbol.asyncIterator] !== 'function') return (await (res as Promise<string>)).slice(0, limit);
  let out = '';
  for await (const chunk of res as AsyncIterable<string>) {
    if (signal.aborted) return '';
    out += chunk;
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/** Word-level edit script between two texts: deletions and insertions by character offset in `a`. */
export function wordEdits(a: string, b: string): { del: [number, number][]; ins: [number, string][] } | null {
  const ta = a.split(/(\s+)/).filter(Boolean);
  const tb = b.split(/(\s+)/).filter(Boolean);
  if (ta.length > 1500 || tb.length > 1500) return null;
  const n = ta.length, m = tb.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const del: [number, number][] = [];
  const ins: [number, string][] = [];
  let i = 0, j = 0, off = 0;
  const push = (arr: [number, number][], a0: number, b0: number) => { const last = arr[arr.length - 1]; if (last && last[1] === a0) last[1] = b0; else arr.push([a0, b0]); };
  let pending = '';
  let pendingAt = 0;
  const flush = () => { if (pending) { ins.push([pendingAt, pending]); pending = ''; } };
  while (i < n || j < m) {
    if (i < n && j < m && ta[i] === tb[j]) { flush(); off += ta[i].length; i++; j++; }
    else if (j < m && (i === n || dp[i][j + 1] >= dp[i + 1][j])) { if (!pending) pendingAt = off; pending += tb[j]; j++; }
    else { push(del, off, off + ta[i].length); off += ta[i].length; i++; }
  }
  flush();
  return { del, ins };
}

export function aiExtras(editor: Editor, provider: AIProvider, opts: { inline?: InlineSuggestOptions | boolean; chat?: ChatOptions | boolean; review?: ReviewOptions }): Plugin[] {
  const inline = opts.inline ? (opts.inline === true ? {} : opts.inline) : null;
  let suggesting = inline ? inline.enabled !== false : false;
  const delay = inline?.delayMs ?? 900;
  const minChars = inline?.minChars ?? 20;
  const maxChars = inline?.maxChars ?? 160;
  const announce = (message: string) => editor.emit('ai-status', { message });

  // ---- inline suggestions ("ghost text": Tab accepts, Esc or typing dismisses)
  let timer = 0;
  let ctl: AbortController | null = null;
  const setGhost = (v: { pos: number; text: string } | null) => editor.view.dispatch(editor.view.state.tr.setMeta(ghostKey, v ?? 'clear').setMeta('addToHistory', false));
  const request = async () => {
    const { state } = editor.view;
    const { empty, $from } = state.selection;
    if (!suggesting || !empty || !editor.view.editable || editor.view.composing || !$from.parent.isTextblock || $from.parentOffset !== $from.parent.content.size || $from.parent.textContent.length < minChars) return;
    if ($from.parent.type.spec.code) return;
    const pos = $from.pos;
    ctl?.abort();
    const mine = (ctl = new AbortController());
    const before = state.doc.textBetween(Math.max(0, pos - 1200), pos, '\n', ' ');
    try {
      const raw = await collect(provider({ action: 'complete', instruction: 'Continue the text with the next few words or one short sentence, in the same language and style. Return only the continuation: no quotes, no explanation, no repetition of the given text.', text: before, signal: mine.signal }), mine.signal, maxChars * 2);
      if (mine.signal.aborted) return;
      let s = raw.replace(/\r/g, '').split('\n')[0].replace(/[\u0000-\u001f]/g, ' ');
      if (!s.trim()) return;
      s = s.slice(0, maxChars);
      if (!/\s$/.test(before) && !/^[\s.,;:!?)\]}]/.test(s)) s = ` ${s}`;
      const cur = editor.view.state;
      if (cur.selection.from !== pos || !cur.selection.empty) return; // the person moved on
      setGhost({ pos, text: s });
    } catch { /* a failed suggestion is simply not shown */ }
  };
  const schedule = () => { window.clearTimeout(timer); ctl?.abort(); if (suggesting) timer = window.setTimeout(() => void request(), delay); };
  editor.registerCommand('toggleAISuggestions', (e) => {
    suggesting = !suggesting;
    if (!suggesting) { window.clearTimeout(timer); ctl?.abort(); if (ghostKey.getState(e.view.state)) setGhost(null); }
    e.emit('ai-status', { message: suggesting ? 'Suggestions on' : 'Suggestions off' });
    return true;
  });
  editor.registerCommand('acceptAISuggestion', (e) => {
    const g = ghostKey.getState(e.view.state);
    if (!g || e.view.state.selection.from !== g.pos) return false;
    const tr = e.view.state.tr.insertText(g.text, g.pos).setMeta(ghostKey, 'clear');
    e.view.dispatch(tr.scrollIntoView());
    return true;
  });
  editor.registerCommand('dismissAISuggestion', (e) => (ghostKey.getState(e.view.state) ? (setGhost(null), true) : false));

  // ---- review the whole document as tracked changes
  let reviewing: AbortController | null = null;
  let trackMap: Mapping | null = null;
  editor.registerCommand('aiReview', (e, instruction?: string) => {
    if (reviewing) return false;
    if (!e.schema.marks.insertion || !e.schema.marks.deletion) { announce('Reviewing as tracked changes needs the TrackChanges plugin.'); return false; }
    if (!e.view.editable) return false;
    const blocks: { pos: number; text: string }[] = [];
    e.view.state.doc.descendants((n, pos) => {
      if (!n.isTextblock) return;
      if (n.type.spec.code || !n.textContent.trim()) return false;
      let plain = true;
      n.forEach((c) => { if (!c.isText || c.marks.some((m) => m.type.name === 'insertion' || m.type.name === 'deletion')) plain = false; });
      if (plain && n.textContent.length <= 4000 && blocks.length < (opts.review?.maxBlocks ?? 200)) blocks.push({ pos, text: n.textContent });
      return false;
    });
    if (!blocks.length) { announce('Nothing to review.'); return false; }
    const mine = (reviewing = new AbortController());
    trackMap = new Mapping();
    const results: { pos: number; text: string; next: string }[] = [];
    let done = 0;
    const bar = document.createElement('div');
    bar.className = 'wy-aic-bar';
    bar.setAttribute('role', 'status');
    const label = document.createElement('span');
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'wy-btn'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => mine.abort());
    bar.append(label, cancel);
    e.root.append(bar);
    const paint = () => { label.textContent = `Reviewing ${done}/${blocks.length}…`; };
    paint();
    const ins = instruction ?? opts.review?.instruction ?? 'Fix spelling and grammar. Do not change the meaning, tone, language or formatting. Return only the corrected text, as a single paragraph.';
    void (async () => {
      let next = 0;
      const worker = async () => {
        while (next < blocks.length && !mine.signal.aborted) {
          const b = blocks[next++];
          try {
            const out = (await collect(provider({ action: 'review', instruction: ins, text: b.text, signal: mine.signal }), mine.signal, b.text.length * 3 + 200)).trim();
            if (out && !/\n/.test(out) && out !== b.text) results.push({ ...b, next: out });
          } catch { /* that paragraph stays as it is */ }
          done++; paint();
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      bar.remove();
      const map = trackMap!;
      reviewing = null; trackMap = null;
      if (mine.signal.aborted || e.view.isDestroyed) { announce('Review cancelled.'); return; }
      const { state } = e.view;
      const tr = state.tr;
      const author = opts.review?.author ?? 'AI';
      const date = Date.now();
      let changed = 0, skipped = 0;
      for (const r of results.sort((a, b) => b.pos - a.pos)) {
        const pos = map.map(r.pos);
        const node: PMNode | null = state.doc.nodeAt(pos);
        if (!node || !node.isTextblock || node.textContent !== r.text) { skipped++; continue; } // edited while the model worked
        const edits = wordEdits(r.text, r.next);
        if (!edits) { skipped++; continue; }
        const base = pos + 1;
        const marksAt = (off: number) => state.doc.resolve(base + Math.max(0, Math.min(off, r.text.length))).marks().filter((m) => m.type.name !== 'insertion' && m.type.name !== 'deletion');
        const ops: { at: number; run: () => void }[] = [];
        for (const [a, b] of edits.del) ops.push({ at: a, run: () => void tr.addMark(base + a, base + b, state.schema.marks.deletion.create({ author, date })) });
        for (const [at, text] of edits.ins) {
          const struck = edits.del.find(([a]) => a === at); // a replacement lands after the words it replaces
          const insertAt = struck ? struck[1] : at;
          ops.push({ at: insertAt + 0.5, run: () => void tr.insert(base + insertAt, state.schema.text(text, [...marksAt(Math.max(0, insertAt - 1)), state.schema.marks.insertion.create({ author, date })])) });
        }
        for (const op of ops.sort((a, b) => b.at - a.at)) op.run();
        changed++;
      }
      if (changed) {
        e.view.dispatch(tr.setMeta('wy-raw', true).scrollIntoView());
        announce(`${changed} paragraph${changed === 1 ? '' : 's'} changed${skipped ? `, ${skipped} skipped because they were edited meanwhile` : ''}. Accept or reject in Review.`);
      } else announce(skipped ? 'Nothing applied: the text changed during the review.' : 'No changes suggested.');
      e.emit('ai-review', { changed, skipped });
    })();
    return true;
  });
  editor.registerCommand('aiReviewCancel', () => (reviewing ? (reviewing.abort(), true) : false));

  // ---- chat about the document
  const chatOn = !!opts.chat;
  const history: { role: 'user' | 'assistant'; text: string }[] = [];
  const buildChat = () => {
    const p = document.createElement('aside');
    p.className = 'wy-aic-chat';
    p.setAttribute('aria-label', 'AI chat');
    p.hidden = true;
    p.innerHTML = '<div class="wy-aic-head"><strong>Ask about this document</strong><button type="button" class="wy-btn wy-aic-close" aria-label="Close chat">✕</button></div><div class="wy-aic-log" role="log" aria-live="polite"></div><form class="wy-aic-form"><textarea rows="2" maxlength="2000" aria-label="Your message" placeholder="Ask a question or request a rewrite…"></textarea><button type="submit" class="wy-btn">Send</button></form>';
    editor.root.append(p);
    const log = p.querySelector('.wy-aic-log') as HTMLElement;
    const form = p.querySelector('form') as HTMLFormElement;
    const input = p.querySelector('textarea') as HTMLTextAreaElement;
    p.querySelector('.wy-aic-close')!.addEventListener('click', () => { p.hidden = true; });
    const addMsg = (role: 'user' | 'assistant' | 'error', text: string) => {
      const m = document.createElement('div');
      m.className = `wy-aic-msg is-${role}`;
      const body = document.createElement('div');
      body.className = 'wy-aic-text';
      body.textContent = text; // model output is only ever shown as text
      m.append(body);
      if (role === 'assistant') {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'wy-btn'; b.textContent = 'Insert into document';
        b.addEventListener('click', () => {
          const { state, dispatch } = editor.view;
          if (!editor.view.editable) return;
          const parsed = markdownToDoc(state.schema, (body.textContent ?? '').trim()); // the reply as it ended up; raw HTML is disabled in this parser
          const $to = state.doc.resolve(state.selection.to);
          dispatch(state.tr.insert($to.depth ? $to.after(1) : $to.pos, parsed.content).scrollIntoView());
        });
        m.append(b);
      }
      log.append(m);
      log.scrollTop = log.scrollHeight;
      return body;
    };
    let busy: AbortController | null = null;
    const send = async (message: string) => {
      if (busy || !message.trim()) return;
      const mine = (busy = new AbortController());
      addMsg('user', message);
      history.push({ role: 'user', text: message });
      const body = addMsg('assistant', '…');
      const { state } = editor.view;
      const sel = state.selection;
      const ctxMax = (typeof opts.chat === 'object' ? opts.chat.contextChars : undefined) ?? 6000;
      const selected = sel.empty ? '' : state.doc.textBetween(sel.from, sel.to, '\n', ' ').slice(0, 2000);
      const doc = state.doc.textBetween(0, state.doc.content.size, '\n\n', ' ').slice(0, ctxMax);
      const instruction = `You are helping the user with the document below. Answer in the user's language. Be concise. If asked to write or rewrite text, return only that text (Markdown allowed).\n${selected ? `The user selected this text: """${selected}"""\n` : ''}Conversation so far:\n${history.slice(-12, -1).map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.text}`).join('\n')}\nUser: ${message}`;
      try {
        const res = provider({ action: 'chat', instruction, text: doc, signal: mine.signal });
        let out = '';
        if (typeof (res as AsyncIterable<string>)[Symbol.asyncIterator] === 'function') for await (const c of res as AsyncIterable<string>) { if (mine.signal.aborted) return; out += c; body.textContent = out; }
        else { out = await (res as Promise<string>); body.textContent = out; }
        if (!out.trim()) throw new Error('empty response');
        history.push({ role: 'assistant', text: out });
        body.parentElement!.classList.add('is-done');
        const btn = body.parentElement!.querySelector('button') as HTMLElement | null;
        if (btn) btn.hidden = false;
      } catch (err) {
        body.parentElement!.className = 'wy-aic-msg is-error';
        body.parentElement!.querySelector('button')?.remove();
        body.textContent = err instanceof Error ? err.message : 'The request failed.';
        history.pop();
      } finally { busy = null; log.scrollTop = log.scrollHeight; }
    };
    form.addEventListener('submit', (ev) => { ev.preventDefault(); const v = input.value; input.value = ''; void send(v); });
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); form.requestSubmit(); } if (ev.key === 'Escape') p.hidden = true; });
    return { el: p, input, send };
  };
  let chat: ReturnType<typeof buildChat> | null = null;
  if (chatOn) {
    editor.registerCommand('aiChat', (_e, message?: string) => {
      chat ??= buildChat();
      chat.el.hidden = message === undefined ? !chat.el.hidden : false;
      if (message) void chat.send(message);
      else if (!chat.el.hidden) chat.input.focus();
      return true;
    }, { readOnlySafe: true });
  }

  return [
    new Plugin<{ pos: number; text: string } | null>({
      key: ghostKey,
      state: {
        init: () => null,
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(ghostKey);
          if (meta === 'clear') return null;
          if (meta) return meta;
          if (!prev) return null;
          if (tr.docChanged) return null; // typing dismisses it
          // moving the cursor dismisses it; the browser re-reporting the same position (Firefox does after the widget is drawn) does not
          if (tr.selectionSet && (!state.selection.empty || state.selection.from !== prev.pos)) return null;
          return prev;
        },
      },
      props: {
        decorations(state) {
          const g = ghostKey.getState(state);
          if (!g) return null;
          const w = document.createElement('span');
          w.className = 'wy-ghost';
          w.textContent = g.text;
          w.setAttribute('aria-hidden', 'true');
          return DecorationSet.create(state.doc, [Decoration.widget(g.pos, w, { side: 1, key: `ghost${g.pos}${g.text}`, ignoreSelection: true })]);
        },
        handleKeyDown(view, e) {
          const g = ghostKey.getState(view.state);
          if (g && e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); return editor.execute('acceptAISuggestion'); }
          if (g && e.key === 'Escape') { setGhost(null); return true; }
          return false;
        },
      },
      view: () => ({
        update(view, prev) {
          if (inline && !view.state.doc.eq(prev.doc)) schedule();
        },
        destroy() { window.clearTimeout(timer); ctl?.abort(); reviewing?.abort(); chat?.el.remove(); },
      }),
      appendTransaction(trs) {
        if (trackMap) for (const t of trs) if (t.docChanged) trackMap.appendMapping(t.mapping);
        return null;
      },
    }),
  ];
}
