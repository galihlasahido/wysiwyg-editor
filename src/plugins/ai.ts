import { Plugin, PluginKey } from 'prosemirror-state';
import type { Editor } from '../editor';
import { askDialog } from '../dialog';
import { markdownToDoc } from '../markdown';
import type { EditorPlugin } from '../types';

export interface AIRequest {
  action: string;
  /** What to do, ready to send to a model as the instruction. */
  instruction: string;
  /** The selected text (or the whole document when nothing is selected). */
  text: string;
  signal: AbortSignal;
}

/** A model call. Return the full text, or an async iterable of chunks to stream it. */
export type AIProvider = (req: AIRequest) => Promise<string> | AsyncIterable<string>;

export interface AIAction {
  id: string;
  label: string;
  instruction: string | ((extra: string) => string);
  /** `replace` swaps the selection; `below` inserts after it. Default 'replace'. */
  mode?: 'replace' | 'below';
  /** Ask the user for extra input (e.g. a target language or custom prompt). */
  prompt?: string;
}

export const DEFAULT_AI_ACTIONS: AIAction[] = [
  { id: 'improve', label: 'Improve writing', instruction: 'Improve the clarity and style of the text. Keep the meaning and language. Return only the revised text.' },
  { id: 'grammar', label: 'Fix grammar', instruction: 'Fix spelling and grammar. Do not change the meaning or style. Return only the corrected text.' },
  { id: 'shorten', label: 'Make shorter', instruction: 'Make the text shorter while keeping the key points. Return only the shortened text.' },
  { id: 'expand', label: 'Make longer', instruction: 'Expand the text with more detail. Return only the expanded text.' },
  { id: 'summarize', label: 'Summarize', mode: 'below', instruction: 'Summarize the text in a few sentences. Return only the summary.' },
  { id: 'translate', label: 'Translate…', prompt: 'Translate to which language?', instruction: (lang) => `Translate the text to ${lang}. Return only the translation.` },
  { id: 'custom', label: 'Custom prompt…', prompt: 'What should the AI do?', instruction: (p) => p },
];

export interface AIOptions {
  provider: AIProvider;
  actions?: AIAction[];
}

interface Target { from: number; to: number }
const key = new PluginKey<Target | null>('ai-target');

/**
 * AI writing assistant. It only talks to the `provider` you supply (put API keys on your server, never in
 * the browser). Output is shown in a preview and applied only when accepted; it is parsed as Markdown
 * with raw HTML disabled, so a model cannot inject markup.
 */
export function AIAssistant(options: AIOptions): EditorPlugin {
  const actions = options.actions ?? DEFAULT_AI_ACTIONS;
  return {
    name: 'ai',
    setup(editor: Editor) {
      editor.extensions.aiActions = actions.map((a) => ({ id: a.id, label: a.label }));
      let controller: AbortController | null = null;
      let panel!: HTMLElement;
      let output = '';
      let current: { action: AIAction; mode: 'replace' | 'below' } | null = null;
      const setTarget = (t: Target | null) => editor.view.dispatch(editor.view.state.tr.setMeta(key, t ?? 'clear').setMeta('addToHistory', false));

      const render = (state: 'working' | 'done' | 'error', text: string, label = '') => {
        panel.hidden = false;
        panel.dataset.state = state;
        panel.replaceChildren();
        const title = document.createElement('div');
        title.className = 'wy-ai-title';
        title.textContent = state === 'working' ? `${label}…` : state === 'error' ? 'AI request failed' : label;
        const body = document.createElement('div');
        body.className = 'wy-ai-body';
        body.textContent = text; // model output is only ever shown as text
        const bar = document.createElement('div');
        bar.className = 'wy-ai-actions';
        const btn = (t: string, fn: () => void) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'wy-btn';
          b.textContent = t;
          b.addEventListener('click', fn);
          bar.append(b);
        };
        if (state === 'done') btn('Accept', () => editor.execute('aiAccept'));
        btn(state === 'working' ? 'Cancel' : 'Discard', () => editor.execute('aiDiscard'));
        panel.append(title, body, bar);
      };

      const close = () => {
        controller?.abort();
        controller = null;
        current = null;
        output = '';
        if (panel) panel.hidden = true;
        if (key.getState(editor.view.state)) setTarget(null);
      };

      editor.registerCommand('ai', (e, id: string, extra?: string) => {
        const action = actions.find((a) => a.id === id);
        if (!action) return false;
        let input = extra;
        if (action.prompt && input === undefined) {
          void askDialog(e.root, { title: action.label, label: action.prompt, multiline: true, submitLabel: 'Run', maxLength: 1000 }).then((value) => value && e.execute('ai', id, value));
          return true;
        }
        const instruction = typeof action.instruction === 'function' ? action.instruction(input ?? '') : action.instruction;
        const { state } = e.view;
        let { from, to } = state.selection;
        if (from === to) {
          from = 0;
          to = state.doc.content.size;
        }
        const text = state.doc.textBetween(from, to, '\n\n', ' ');
        if (!text.trim()) return false;

        close();
        const mode = action.mode ?? 'replace';
        current = { action, mode };
        setTarget({ from, to });
        controller = new AbortController();
        const mine = controller;
        render('working', '', action.label);
        void (async () => {
          try {
            const res = options.provider({ action: action.id, instruction, text, signal: mine.signal });
            if (typeof (res as AsyncIterable<string>)[Symbol.asyncIterator] === 'function') {
              for await (const chunk of res as AsyncIterable<string>) {
                if (mine.signal.aborted) return;
                output += chunk;
                render('working', output, action.label);
              }
            } else output = await (res as Promise<string>);
            if (mine.signal.aborted) return;
            if (!output.trim()) throw new Error('empty response');
            render('done', output, action.label);
          } catch (err) {
            if (mine.signal.aborted) return;
            render('error', err instanceof Error ? err.message : 'Unknown error');
          }
        })();
        return true;
      });

      editor.registerCommand('aiAccept', (e) => {
        const target = key.getState(e.view.state);
        if (!current || !target || !output.trim()) return false;
        const { state, dispatch } = e.view;
        const parsed = markdownToDoc(state.schema, output.trim());
        const tr = state.tr;
        const single = parsed.childCount === 1 && parsed.firstChild!.isTextblock;
        if (current.mode === 'replace' && single && state.doc.resolve(target.from).sameParent(state.doc.resolve(target.to))) {
          tr.replaceWith(target.from, target.to, parsed.firstChild!.content);
        } else {
          // Block-level result: operate on whole top-level blocks around the target.
          const $from = state.doc.resolve(Math.min(target.from, state.doc.content.size));
          const $to = state.doc.resolve(Math.min(target.to, state.doc.content.size));
          const start = $from.depth ? $from.before(1) : $from.pos;
          const end = $to.depth ? $to.after(1) : $to.pos;
          if (current.mode === 'below') tr.insert(end, parsed.content);
          else tr.replaceWith(start, end, parsed.content);
        }
        dispatch(tr.scrollIntoView());
        close();
        return true;
      });
      editor.registerCommand('aiDiscard', () => (close(), true));

      return [
        new Plugin<Target | null>({
          key,
          state: {
            init: () => null,
            apply(tr, prev) {
              const meta = tr.getMeta(key);
              if (meta === 'clear') return null;
              if (meta) return meta as Target;
              if (!prev || !tr.docChanged) return prev;
              // Keep the target attached to its text while the user keeps editing during the request.
              return { from: tr.mapping.map(prev.from, -1), to: tr.mapping.map(prev.to, 1) };
            },
          },
          view() {
            panel = document.createElement('div');
            panel.className = 'wy-ai-panel';
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-label', 'AI assistant');
            panel.hidden = true;
            editor.root.append(panel);
            return { destroy: () => (controller?.abort(), panel.remove()) };
          },
        }),
      ];
    },
    toolbar: [
      {
        type: 'select',
        name: 'ai',
        label: 'AI assistant',
        command: 'ai',
        options: [{ label: '✨ AI', value: '' }, ...actions.map((a) => ({ label: a.label, value: a.id }))],
        getValue: () => '',
      },
    ],
  };
}

/** A provider that POSTs `{ action, instruction, text }` to your endpoint and reads the reply as text (streamed if possible). */
export function createFetchProvider(url: string, init: { headers?: Record<string, string>; fetchImpl?: typeof fetch } = {}): AIProvider {
  const doFetch = init.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return async function* ({ action, instruction, text, signal }) {
    const res = await doFetch(url, { method: 'POST', signal, headers: { 'content-type': 'application/json', ...init.headers }, body: JSON.stringify({ action, instruction, text }) });
    if (!res.ok) throw new Error(`AI endpoint returned ${res.status}`);
    if (!res.body) return void (yield await res.text());
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  };
}
