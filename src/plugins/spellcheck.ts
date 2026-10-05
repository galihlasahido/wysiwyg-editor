import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

export interface ProofIssue {
  /** Character offset of the problem inside the text that was sent, and its length. */
  offset: number;
  length: number;
  message: string;
  /** Suggested replacements, best first. */
  replacements?: string[];
  /** Id of the rule that fired; "Ignore rule" hides every issue with it. */
  rule?: string;
  kind?: 'spelling' | 'grammar' | 'style';
}
/** A proofreading service: send it one paragraph, get the problems back. */
export type ProofProvider = (req: { text: string; lang: string; signal: AbortSignal }) => Promise<ProofIssue[]>;

export interface SpellCheckOptions {
  lang?: string;
  enabled?: boolean;
  /** Spelling and grammar from a service you choose (LanguageTool-style). When set, the browser's own squiggles are switched off. */
  provider?: ProofProvider;
  /** Wait this long after typing stops before checking. Default 800 ms. */
  delayMs?: number;
  /** Paragraphs longer than this are not sent. Default 5000 characters. */
  maxChars?: number;
}

const key = new PluginKey<{ set: DecorationSet; ignored: Set<string> }>('proofread');
const KINDS = ['spelling', 'grammar', 'style'];

/** Clean what a service returned: integers in range, plain strings, a few suggestions. */
export function cleanIssues(raw: unknown, text: string): ProofIssue[] {
  if (!Array.isArray(raw)) return [];
  const out: ProofIssue[] = [];
  for (const r of raw.slice(0, 200)) {
    const offset = Number(r?.offset), length = Number(r?.length);
    if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length < 1 || offset + length > text.length) continue;
    out.push({
      offset, length,
      message: String(r.message ?? '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 300),
      replacements: (Array.isArray(r.replacements) ? r.replacements : []).filter((x: unknown): x is string => typeof x === 'string' && x.length <= 200 && !/[\u0000-\u001f]/.test(x)).slice(0, 5),
      rule: typeof r.rule === 'string' ? r.rule.slice(0, 80) : undefined,
      kind: KINDS.includes(r.kind) ? r.kind : 'spelling',
    });
  }
  return out;
}

/** A provider for a LanguageTool server (`https://api.languagetool.org/v2/check` or your own). The paragraph text is sent to that server. */
export function createLanguageToolProvider(url = 'https://api.languagetool.org/v2/check', init: { fetchImpl?: typeof fetch; headers?: Record<string, string> } = {}): ProofProvider {
  const doFetch = init.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return async ({ text, lang, signal }) => {
    const res = await doFetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', ...init.headers }, body: new URLSearchParams({ text, language: lang || 'auto' }).toString() });
    if (!res.ok) throw new Error(`Proofreading service returned ${res.status}`);
    const data = await res.json();
    return (Array.isArray(data?.matches) ? data.matches : []).map((m: any) => ({
      offset: m.offset, length: m.length, message: m.message,
      replacements: (m.replacements ?? []).map((r: { value?: unknown }) => r.value),
      rule: m.rule?.id,
      kind: m.rule?.issueType === 'misspelling' ? 'spelling' : m.rule?.issueType === 'style' ? 'style' : 'grammar',
    }));
  };
}

/** Browser spell check (red squiggles), or with `provider` spelling and grammar from a service, with suggestions on click. */
export function SpellCheck(options: SpellCheckOptions = {}): EditorPlugin {
  let enabled = options.enabled ?? true;
  const provider = options.provider;
  return {
    name: 'spellcheck',
    setup(editor: Editor) {
      const cache = new Map<string, ProofIssue[]>(); // `${lang}\0${text}` -> issues
      let ctl: AbortController | null = null;
      let timer = 0;
      let menu: HTMLElement | null = null;
      const lang = () => options.lang || document.documentElement.lang || 'en-US';
      const status = (message: string) => editor.emit('proofread-status', { message });

      const closeMenu = () => { menu?.remove(); menu = null; };

      /** Decorations for the document from what is known so far. */
      const build = (doc: import('prosemirror-model').Node, ignored: Set<string>): DecorationSet => {
        const decos: Decoration[] = [];
        doc.descendants((node, pos) => {
          if (!node.isTextblock) return;
          if (node.type.spec.code) return false;
          const text = node.textBetween(0, node.content.size, undefined, '￼');
          const found = cache.get(`${lang()}\0${text}`);
          if (found) {
            for (const is of found) {
              const word = text.slice(is.offset, is.offset + is.length);
              if (ignored.has(`w:${word}`) || (is.rule && ignored.has(`r:${is.rule}`))) continue;
              // offsets are in text characters; the block's inline atoms count as one character (￼), as in `text`
              decos.push(Decoration.inline(pos + 1 + is.offset, pos + 1 + is.offset + is.length, { class: `wy-proof wy-proof-${is.kind ?? 'spelling'}`, title: is.message }, { issue: is, word }));
            }
          }
          return false;
        });
        return DecorationSet.create(doc, decos);
      };
      const publish = (ignored?: Set<string>) => {
        const cur = key.getState(editor.view.state)!;
        editor.view.dispatch(editor.view.state.tr.setMeta(key, { set: build(editor.view.state.doc, ignored ?? cur.ignored), ignored: ignored ?? cur.ignored }).setMeta('addToHistory', false));
      };

      const run = async () => {
        if (!provider || !enabled || editor.view.isDestroyed) return;
        const l = lang();
        const todo: string[] = [];
        editor.view.state.doc.descendants((node) => {
          if (!node.isTextblock) return;
          if (node.type.spec.code) return false;
          const text = node.textBetween(0, node.content.size, undefined, '￼');
          if (text.trim().length > 1 && text.length <= (options.maxChars ?? 5000) && !cache.has(`${l}\0${text}`) && !todo.includes(text)) todo.push(text);
          return false;
        });
        if (!todo.length) { publish(); return; }
        ctl?.abort();
        const mine = (ctl = new AbortController());
        let next = 0;
        let failed = false;
        const worker = async () => {
          while (next < todo.length && !mine.signal.aborted) {
            const text = todo[next++];
            try { cache.set(`${l}\0${text}`, cleanIssues(await provider({ text: text.replace(/￼/g, ' '), lang: l, signal: mine.signal }), text)); }
            catch (err) { if (!mine.signal.aborted && !failed) { failed = true; status(err instanceof Error ? err.message : 'Proofreading failed.'); } }
          }
        };
        await Promise.all([worker(), worker(), worker()]);
        if (!mine.signal.aborted) {
          if (cache.size > 2000) [...cache.keys()].slice(0, 1000).forEach((k) => cache.delete(k));
          publish();
        }
      };
      const schedule = () => { window.clearTimeout(timer); if (provider && enabled) timer = window.setTimeout(() => void run(), options.delayMs ?? 800); };

      const issues = () => { const s = key.getState(editor.view.state); return s ? s.set.find().sort((a, b) => a.from - b.from) : []; };
      const apply = (from: number, to: number, text: string) => {
        const { state, dispatch } = editor.view;
        dispatch(state.tr.insertText(text, from, to).scrollIntoView());
        closeMenu();
        editor.view.focus();
      };
      const ignore = (kind: 'w' | 'r', value: string) => {
        const cur = key.getState(editor.view.state)!;
        const ignored = new Set(cur.ignored);
        ignored.add(`${kind}:${value}`);
        closeMenu();
        publish(ignored);
      };
      const showMenu = (deco: Decoration) => {
        closeMenu();
        const is: ProofIssue = (deco as unknown as { spec: { issue: ProofIssue } }).spec.issue;
        const word = (deco as unknown as { spec: { word: string } }).spec.word;
        const m = (menu = document.createElement('div'));
        m.className = 'wy-proof-menu';
        m.setAttribute('role', 'menu');
        const msg = document.createElement('div');
        msg.className = 'wy-proof-msg';
        msg.textContent = is.message || 'Possible mistake'; // from a service: text only
        m.append(msg);
        const add = (label: string, fn: () => void, cls = '') => {
          const b = document.createElement('button');
          b.type = 'button'; b.className = `wy-menu-item ${cls}`.trim(); b.setAttribute('role', 'menuitem'); b.textContent = label;
          b.addEventListener('mousedown', (e) => e.preventDefault());
          b.addEventListener('click', fn);
          m.append(b);
        };
        for (const r of is.replacements ?? []) add(r, () => apply(deco.from, deco.to, r), 'wy-proof-suggest');
        if (!is.replacements?.length) { const none = document.createElement('div'); none.className = 'wy-proof-none'; none.textContent = 'No suggestions'; m.append(none); }
        add(`Ignore “${word.length > 24 ? `${word.slice(0, 23)}…` : word}”`, () => ignore('w', word));
        if (is.rule) add('Ignore this rule', () => ignore('r', is.rule!));
        editor.root.append(m);
        const c = editor.view.coordsAtPos(deco.from);
        const root = editor.root.getBoundingClientRect();
        m.style.left = `${Math.max(4, Math.min(c.left - root.left, root.width - m.offsetWidth - 4))}px`;
        m.style.top = `${c.bottom - root.top + 4}px`;
        (m.querySelector('button') as HTMLElement | null)?.focus();
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && menu) { e.stopPropagation(); closeMenu(); editor.view.focus(); } };
      editor.root.addEventListener('keydown', onKey, true);
      const onDown = (e: MouseEvent) => { if (menu && !menu.contains(e.target as Node)) closeMenu(); };
      document.addEventListener('mousedown', onDown);

      editor.registerCommand('toggleSpellcheck', (e) => {
        enabled = !enabled;
        if (provider && enabled) schedule();
        if (provider && !enabled) { ctl?.abort(); closeMenu(); publish(); }
        e.view.dispatch(e.view.state.tr.setMeta('addToHistory', false)); // re-evaluate props.attributes
        return true;
      });
      editor.registerCommand('setLanguage', (e, l: string) => {
        options = { ...options, lang: l };
        e.view.dispatch(e.view.state.tr.setMeta('addToHistory', false));
        schedule();
        return true;
      });
      editor.registerCommand('checkDocument', () => (provider ? (cache.clear(), window.clearTimeout(timer), void run(), true) : false));
      editor.registerCommand('nextIssue', (e, backwards = false) => {
        const list = issues();
        if (!list.length) return false;
        const at = e.view.state.selection.from;
        const target = backwards ? [...list].reverse().find((d) => d.to <= at - 1) ?? list[list.length - 1] : list.find((d) => d.from > at) ?? list[0];
        e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, target.from, target.to)).scrollIntoView());
        showMenu(target);
        return true;
      }, { readOnlySafe: true });
      editor.registerCommand('proofreadStatus', () => true);
      editor.extensions.proofread = { issues: () => issues().map((d) => ({ from: d.from, to: d.to, ...(d as unknown as { spec: { issue: ProofIssue } }).spec.issue })) };

      return [
        new Plugin({
          key,
          state: {
            init: () => ({ set: DecorationSet.empty, ignored: new Set<string>() }),
            apply(tr, prev) {
              const meta = tr.getMeta(key);
              if (meta) return meta;
              return tr.docChanged ? { ...prev, set: prev.set.map(tr.mapping, tr.doc) } : prev;
            },
          },
          props: {
            decorations: (state) => (provider && enabled ? key.getState(state)!.set : null),
            attributes: () => ({ spellcheck: String(enabled && !provider), ...(options.lang ? { lang: options.lang } : {}) }),
            handleClick(view, pos) {
              if (!provider || !enabled) return false;
              const d = key.getState(view.state)!.set.find(pos, pos)[0];
              if (d) { showMenu(d); return false; }
              closeMenu();
              return false;
            },
            handleDOMEvents: {
              contextmenu(view, e) {
                if (!provider || !enabled) return false;
                const at = view.posAtCoords({ left: (e as MouseEvent).clientX, top: (e as MouseEvent).clientY });
                const d = at && key.getState(view.state)!.set.find(at.pos, at.pos)[0];
                if (!d) return false;
                e.preventDefault();
                showMenu(d);
                return true;
              },
            },
          },
          view: () => ({
            update(view, prev) { if (!view.state.doc.eq(prev.doc)) { closeMenu(); schedule(); } },
            destroy() { window.clearTimeout(timer); ctl?.abort(); closeMenu(); editor.root.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown); },
          }),
        }),
      ];
    },
    onReady(editor: Editor) { if (provider && enabled) editor.execute('checkDocument'); },
    toolbar: [
      { name: 'spellcheck', label: 'Toggle spell check', icon: 'abc✓', command: 'toggleSpellcheck', isActive: () => enabled },
      ...(provider ? [{ name: 'nextIssue', label: 'Next spelling or grammar issue', icon: '⚑', command: 'nextIssue' }] : []),
    ],
  };
}
