import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, TextSelection } from 'prosemirror-state';
import { askDialog, avatar } from '../dialog';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';
import { docIndex } from './helpers';

export interface CommentReply { /** Identifies the reply when comments are shared between editors. Added automatically. */ id?: string; author: string; text: string; createdAt: number }
export interface CommentThread {
  id: string;
  author: string;
  text: string;
  createdAt: number;
  resolved: boolean;
  replies: CommentReply[];
}

const newId = () => (globalThis.crypto?.randomUUID?.() ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

/** The part of a Yjs `Y.Map` the store uses, so this file needs no Yjs import. */
export interface SharedMap<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): unknown;
  delete(key: string): void;
  forEach(fn: (value: T, key: string) => void): void;
  observe(fn: (event: { transaction: { local: boolean } }) => void): void;
  unobserve?(fn: (event: { transaction: { local: boolean } }) => void): void;
  doc?: { transact(fn: () => void, origin?: unknown): void } | null;
}

type ThreadBase = Omit<CommentThread, 'replies'>;
type SharedReply = CommentReply & { id: string; threadId: string };

/** Comment threads live outside the document (the document only carries `comment` marks with an id). */
export class CommentStore {
  private threads = new Map<string, CommentThread>();
  private listeners = new Set<() => void>();
  private shared: { threads: SharedMap<ThreadBase>; replies: SharedMap<SharedReply>; off: () => void } | null = null;

  constructor(initial: CommentThread[] = [], private onChange?: (threads: CommentThread[]) => void) {
    for (const t of initial) this.threads.set(t.id, this.withReplyIds(t));
  }
  list(): CommentThread[] { return [...this.threads.values()]; }
  get(id: string): CommentThread | undefined { return this.threads.get(id); }
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  load(threads: CommentThread[]): void {
    const before = this.threads;
    this.threads = new Map(threads.map((t) => [t.id, this.withReplyIds(t)]));
    this.pushShared(before);
    this.emit();
  }
  toJSON(): CommentThread[] { return this.list(); }
  add(t: CommentThread): void {
    const before = this.threads;
    this.threads = new Map(before).set(t.id, this.withReplyIds(t));
    this.pushShared(before);
    this.emit();
  }
  update(id: string, patch: Partial<CommentThread>): boolean {
    const t = this.threads.get(id);
    if (!t) return false;
    const before = this.threads;
    this.threads = new Map(before).set(id, this.withReplyIds({ ...t, ...patch }));
    this.pushShared(before);
    this.emit();
    return true;
  }
  remove(id: string): boolean {
    if (!this.threads.has(id)) return false;
    const before = this.threads;
    this.threads = new Map(before);
    this.threads.delete(id);
    this.pushShared(before);
    this.emit();
    return true;
  }
  private emit() {
    this.onChange?.(this.list());
    for (const l of this.listeners) l();
  }

  private withReplyIds(t: CommentThread): CommentThread {
    // A reply saved before replies had ids gets one made from its content, so two editors that load the same saved thread agree on it.
    const stable = (r: CommentReply) => { let h = 5381; for (const ch of `${r.author}|${r.createdAt}|${r.text}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0; return `r${h.toString(36)}`; };
    return t.replies.every((r) => r.id) ? t : { ...t, replies: t.replies.map((r) => (r.id ? r : { ...r, id: stable(r) })) };
  }

  // ---- sharing between editors (real-time collaboration)

  /**
   * Keep the threads in two shared maps (a Yjs `Y.Map` each): one entry per thread and one per reply, so two people replying at the
   * same moment both keep their reply. Threads already in the store are added to the maps, those already there are loaded.
   * Changes from other editors arrive through the maps and update the panel. Returns a function that stops sharing.
   */
  bindShared(threads: SharedMap<ThreadBase>, replies: SharedMap<SharedReply>): () => void {
    this.shared?.off();
    const pull = () => {
      const next = new Map<string, CommentThread>();
      threads.forEach((base, id) => next.set(id, { ...base, replies: [] }));
      const all: SharedReply[] = [];
      replies.forEach((r) => all.push(r));
      for (const r of all.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))) {
        const t = next.get(r.threadId);
        if (t) t.replies.push({ id: r.id, author: r.author, text: r.text, createdAt: r.createdAt });
      }
      this.threads = next;
      this.emit();
    };
    const onChange = (e: { transaction: { local: boolean } }) => { if (!e.transaction.local) pull(); };
    // what this editor already has goes in (without overwriting what others wrote), then everything comes back out
    const write = () => {
      for (const t of this.threads.values()) {
        const { replies: rs, ...base } = t;
        if (!threads.get(t.id)) threads.set(t.id, base);
        for (const r of rs) if (!replies.get(`${t.id}/${r.id}`)) replies.set(`${t.id}/${r.id}`, { ...r, id: r.id!, threadId: t.id });
      }
    };
    threads.doc ? threads.doc.transact(write, 'comments-bind') : write();
    threads.observe(onChange);
    replies.observe(onChange);
    this.shared = { threads, replies, off: () => { threads.unobserve?.(onChange); replies.unobserve?.(onChange); this.shared = null; } };
    pull();
    return this.shared.off;
  }

  /** Write the difference between two states of the store into the shared maps. */
  private pushShared(before: Map<string, CommentThread>) {
    const s = this.shared;
    if (!s) return;
    const run = () => {
      for (const [id, t] of this.threads) {
        const { replies: rs, ...base } = t;
        const old = before.get(id);
        const { replies: _o, ...oldBase } = old ?? ({} as CommentThread);
        if (!old || JSON.stringify(oldBase) !== JSON.stringify(base)) s.threads.set(id, base);
        const had = new Set((old?.replies ?? []).map((r) => r.id));
        for (const r of rs) if (!had.has(r.id)) s.replies.set(`${id}/${r.id}`, { ...r, id: r.id!, threadId: id });
        for (const r of old?.replies ?? []) if (!rs.some((x) => x.id === r.id)) s.replies.delete(`${id}/${r.id}`);
      }
      for (const [id, old] of before) {
        if (this.threads.has(id)) continue;
        s.threads.delete(id);
        for (const r of old.replies) s.replies.delete(`${id}/${r.id}`);
      }
    };
    s.threads.doc ? s.threads.doc.transact(run, 'comments-local') : run();
  }
}

export interface CommentsOptions {
  /** Name shown on comments written in this editor. */
  author?: string;
  initial?: CommentThread[];
  onChange?: (threads: CommentThread[]) => void;
}

export type CommentsPlugin = EditorPlugin & { store: CommentStore };

interface Anchor { id: string; from: number; to: number }

function findAnchors(doc: PMNode): Map<string, Anchor> {
  const out = new Map<string, Anchor>();
  doc.descendants((node, pos) => {
    for (const m of node.marks) {
      if (m.type.name !== 'comment') continue;
      const a = out.get(m.attrs.id);
      if (a) a.to = pos + node.nodeSize;
      else out.set(m.attrs.id, { id: m.attrs.id, from: pos, to: pos + node.nodeSize });
    }
  });
  return out;
}

/** Comments with replies and resolve, shown in a side panel. Works in read-only mode too. */
export function Comments(options: CommentsOptions = {}): CommentsPlugin {
  const store = new CommentStore(options.initial, options.onChange);
  const author = options.author ?? 'Anonymous';
  const plugin: EditorPlugin = {
    name: 'comments',
    marks: {
      comment: {
        attrs: { id: {} },
        inclusive: false,
        excludes: '', // overlapping comments stack
        parseDOM: [{ tag: 'span[data-comment-id]', getAttrs: (n) => ({ id: (n as HTMLElement).getAttribute('data-comment-id') }) }],
        toDOM: (m) => ['span', { class: 'wy-comment', 'data-comment-id': m.attrs.id }, 0],
      },
    },
    setup(editor: Editor) {
      const safe = { readOnlySafe: true };
      editor.extensions.comments = store; // lets Autosave include the threads and notice reply/resolve changes
      // With real-time collaboration the threads are shared too (read from the plugin object: no Yjs import needed here)
      const collab = editor.config.plugins.find((p) => p.name === 'collaboration') as (EditorPlugin & { ydoc?: { getMap(name: string): SharedMap<any> } }) | undefined;
      if (collab?.ydoc) store.bindShared(collab.ydoc.getMap('wy-comments'), collab.ydoc.getMap('wy-comment-replies'));
      let hiddenByUser = false;
      let rerender = () => {};
      // where the commented ranges are: re-read only when a change touches commented text, otherwise moved along with the edit
      const anchorIndex = docIndex<Anchor>('comment-anchors', (n) => n.marks.some((m) => m.type.name === 'comment'), (doc) => [...findAnchors(doc).values()], (a, m) => ({ ...a, from: m.map(a.from, 1), to: m.map(a.to, -1) })); // text typed right at either edge is outside the (non-inclusive) mark
      const anchorMap = (state: import('prosemirror-state').EditorState) => new Map(anchorIndex.get(state).items.map((a) => [a.id, a]));
      const sortedAnchors = () => [...anchorIndex.get(editor.view.state).items].filter((a) => store.get(a.id)).sort((a, b) => a.from - b.from);
      const goTo = (a: Anchor) => editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc, a.from, a.to)).scrollIntoView());
      editor.registerCommand('toggleComments', () => ((hiddenByUser = !hiddenByUser), rerender(), true), safe);
      editor.registerCommand('nextComment', () => {
        const list = sortedAnchors();
        if (!list.length) return false;
        const pos = editor.view.state.selection.to;
        goTo(list.find((a) => a.from >= pos) ?? list[0]); // wraps around
        return true;
      }, safe);
      editor.registerCommand('prevComment', () => {
        const list = sortedAnchors();
        if (!list.length) return false;
        const pos = editor.view.state.selection.from;
        goTo([...list].reverse().find((a) => a.to <= pos) ?? list[list.length - 1]);
        return true;
      }, safe);
      editor.registerCommand('deleteCurrentComment', (e) => {
        const { from } = e.view.state.selection;
        const at = sortedAnchors().find((a) => a.from <= from && from <= a.to);
        return at ? e.execute('deleteComment', at.id) : false;
      }, safe);
      const attach = (e: Editor, from: number, to: number, quote: string, body: string) => {
        const { state, dispatch } = e.view;
        // The document may have changed while the dialog was open (a collaborator typing): find the same words again.
        let a = from;
        let b = to;
        if (state.doc.textBetween(Math.min(a, state.doc.content.size), Math.min(b, state.doc.content.size), ' ') !== quote) {
          let found = -1;
          state.doc.descendants((n, pos) => {
            if (found >= 0 || !n.isText) return;
            const i = (n.text ?? '').indexOf(quote);
            if (i >= 0) found = pos + i;
          });
          if (found < 0) return false;
          a = found;
          b = found + quote.length;
        }
        const id = newId();
        store.add({ id, author, text: body.trim(), createdAt: Date.now(), resolved: false, replies: [] });
        dispatch(state.tr.addMark(a, b, state.schema.marks.comment.create({ id })));
        return true;
      };
      editor.registerCommand('addComment', (e, text?: string) => {
        const { state } = e.view;
        const { from, to, empty } = state.selection;
        if (empty) return false;
        const quote = state.doc.textBetween(from, to, ' ');
        if (text !== undefined) return text.trim() ? attach(e, from, to, quote, text) : false;
        // No text given: ask for it in a modal that shows what is being commented on.
        void askDialog(e.root, { title: 'Add a comment', quote, author, placeholder: 'Write a comment…', multiline: true, submitLabel: 'Comment', maxLength: 4000 }).then((body) => body && attach(e, from, to, quote, body));
        return true;
      }, safe);
      editor.registerCommand('replyComment', (_e, id: string, text: string) => {
        const t = store.get(id);
        if (!t || !text?.trim()) return false;
        return store.update(id, { replies: [...t.replies, { id: newId(), author, text: text.trim(), createdAt: Date.now() }] });
      }, safe);
      editor.registerCommand('resolveComment', (_e, id: string, resolved = true) => store.update(id, { resolved }), safe);
      editor.registerCommand('deleteComment', (e, id: string) => {
        const { state, dispatch } = e.view;
        const tr = state.tr;
        state.doc.descendants((node, pos) => {
          const m = node.marks.find((x) => x.type.name === 'comment' && x.attrs.id === id);
          if (m) tr.removeMark(pos, pos + node.nodeSize, m);
        });
        if (tr.docChanged) dispatch(tr);
        return store.remove(id);
      }, safe);

      return [
        anchorIndex.plugin,
        new Plugin({
          view(view) {
            const panel = document.createElement('aside');
            panel.className = 'wy-comments';
            panel.setAttribute('aria-label', 'Comments');
            editor.body.append(panel);
            const render = () => {
              const anchors = anchorMap(view.state);
              const threads = store.list().filter((t) => anchors.has(t.id)).sort((a, b) => anchors.get(a.id)!.from - anchors.get(b.id)!.from);
              panel.replaceChildren();
              panel.hidden = hiddenByUser || store.list().length === 0;
              const cursor = view.state.selection.from;
              for (const t of threads) panel.append(card(t, anchors.get(t.id)!, cursor));
            };
            const card = (t: CommentThread, a: Anchor, cursor: number) => {
              const el = document.createElement('div');
              el.className = 'wy-comment-card' + (t.resolved ? ' is-resolved' : '') + (a.from <= cursor && cursor <= a.to ? ' is-current' : '');
              const add = (cls: string, text: string, tag = 'div') => {
                const n = document.createElement(tag);
                n.className = cls;
                n.textContent = text; // user text is only ever set as textContent
                el.append(n);
                return n;
              };
              add('wy-comment-quote', view.state.doc.textBetween(a.from, a.to, ' ').slice(0, 80));
              const head = add('wy-comment-head', `${t.author} · ${new Date(t.createdAt).toLocaleString()}`);
              head.setAttribute('data-author', t.author);
              head.prepend(avatar(t.author, 20));
              add('wy-comment-text', t.text);
              for (const r of t.replies) {
                const row = add('wy-comment-reply', `${r.author}: ${r.text}`);
                row.prepend(avatar(r.author, 16));
              }
              const btn = (label: string, fn: () => void) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'wy-btn';
                b.textContent = label;
                b.addEventListener('click', (ev) => (ev.stopPropagation(), fn()));
                return b;
              };
              const actions = document.createElement('div');
              actions.className = 'wy-comment-actions';
              actions.append(
                btn('Reply', () => {
                  const thread = document.createElement('div');
                  thread.className = 'wy-ask-thread';
                  for (const m of [{ author: t.author, text: t.text, createdAt: t.createdAt }, ...t.replies]) {
                    const row = document.createElement('div');
                    row.className = 'wy-ask-msg';
                    const body = document.createElement('div');
                    const who = document.createElement('b');
                    who.textContent = m.author;
                    const when = document.createElement('small');
                    when.textContent = new Date(m.createdAt).toLocaleString();
                    const txt = document.createElement('div');
                    txt.textContent = m.text; // user text only ever as textContent
                    body.append(who, when, txt);
                    row.append(avatar(m.author, 24), body);
                    thread.append(row);
                  }
                  void askDialog(editor.root, { title: 'Reply', quote: view.state.doc.textBetween(a.from, a.to, ' '), context: thread, author, placeholder: 'Write a reply…', multiline: true, submitLabel: 'Reply', maxLength: 4000 }).then((text) => text && editor.execute('replyComment', t.id, text));
                }),
                btn(t.resolved ? 'Reopen' : 'Resolve', () => editor.execute('resolveComment', t.id, !t.resolved)),
                btn('Delete', () => editor.execute('deleteComment', t.id)),
              );
              el.append(actions);
              el.addEventListener('click', () => {
                view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, a.from, a.to)).scrollIntoView());
              });
              return el;
            };
            rerender = render;
            const unsub = store.subscribe(render);
            render();
            return { update: render, destroy: () => (unsub(), panel.remove()) };
          },
        }),
      ];
    },
    toolbar: [{ name: 'comment', label: 'Add comment', icon: '💬', command: 'addComment' }],
  };
  return Object.assign(plugin, { store });
}
