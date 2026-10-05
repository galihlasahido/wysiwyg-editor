import { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { NodeView } from 'prosemirror-view';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

export interface RecordingOptions {
  /** Where a finished recording goes. Return its address (https or same-site). Default: embed it in the document as a data URL. */
  upload?: (blob: Blob, kind: 'audio' | 'video') => Promise<string>;
  /** Longest recording in seconds; it stops by itself. Default 300. */
  maxSeconds?: number;
  /** Largest recording kept when it is embedded as a data URL. Default 6 MB. */
  maxBytes?: number;
  /** Language for dictation (BCP 47), default the page language or en-US. */
  dictationLang?: string;
}

/** Recordings may come from http(s), the same site, or an embedded audio/video data URL. */
const CLIP_SRC = /^(?:https?:|data:(?:audio|video)\/(?:webm|ogg|mp4|mpeg|wav|x-wav);(?:codecs=[\w.,-]+;)?base64,[A-Za-z0-9+/=]+$|\/(?!\/))/i;
export const isSafeClip = (u: unknown): u is string => typeof u === 'string' && CLIP_SRC.test(u);

type Rec = { kind: 'audio' | 'video'; mr: MediaRecorder; stream: MediaStream; chunks: Blob[]; started: number; cancelled: boolean };

const blobToDataURL = (b: Blob) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = () => fail(r.error); r.readAsDataURL(b); });

class ClipView implements NodeView {
  dom: HTMLElement;
  constructor(private node: PMNode) {
    this.dom = document.createElement('figure');
    this.dom.className = 'wy-clip';
    this.dom.contentEditable = 'false';
    this.paint();
  }
  private paint() {
    const { kind, src, name } = this.node.attrs;
    this.dom.replaceChildren();
    if (!isSafeClip(src)) { this.dom.textContent = 'This recording cannot be played.'; return; }
    const m = document.createElement(kind === 'video' ? 'video' : 'audio') as HTMLMediaElement;
    m.controls = true;
    m.preload = 'metadata';
    m.src = src;
    m.setAttribute('aria-label', name || `${kind} recording`);
    this.dom.append(m);
  }
  update(node: PMNode) { if (node.type !== this.node.type) return false; this.node = node; this.paint(); return true; }
  selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
  deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  stopEvent(e: Event) { return (e.target as HTMLElement).tagName === 'AUDIO' || (e.target as HTMLElement).tagName === 'VIDEO'; }
  ignoreMutation() { return true; }
  destroy() { this.dom.querySelectorAll('audio,video').forEach((m) => (m as HTMLMediaElement).pause()); }
}

/**
 * Voice and screen capture in the document: `recordAudio` (microphone), `recordScreen` (screen with sound where the browser offers it), and
 * `toggleDictation` (speech to text where the browser has speech recognition). Recordings become a player in the text; the browser always
 * asks for permission, a bar shows while recording, and Esc or the Cancel button throws the recording away.
 */
export function Recording(options: RecordingOptions = {}): EditorPlugin {
  const maxSeconds = options.maxSeconds ?? 300;
  const maxBytes = options.maxBytes ?? 6 * 1024 * 1024;

  return {
    name: 'recording',
    nodes: {
      clip: {
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { kind: { default: 'audio' }, src: { default: '' }, name: { default: '' } },
        parseDOM: [{ tag: 'figure[data-clip]', getAttrs: (d) => { const el = d as HTMLElement; const src = el.getAttribute('data-src'); const kind = el.getAttribute('data-clip'); return (kind === 'audio' || kind === 'video') && isSafeClip(src) ? { kind, src, name: (el.getAttribute('data-name') ?? '').slice(0, 120) } : false; } }],
        toDOM: (n: PMNode) => ['figure', { class: 'wy-clip', 'data-clip': n.attrs.kind, 'data-src': n.attrs.src, 'data-name': n.attrs.name }, ['a', { href: isSafeClip(n.attrs.src) && !n.attrs.src.startsWith('data:') ? n.attrs.src : '#' }, n.attrs.name || `${n.attrs.kind} recording`]],
      },
    },
    setup(editor: Editor) {
      let gone = false;
      let rec: Rec | null = null;
      let bar: HTMLElement | null = null;
      let timer = 0;
      let dictation: { stop(): void } | null = null;

      const announce = (msg: string) => editor.emit('recording-status', { message: msg });
      const showBar = (label: string) => {
        bar = document.createElement('div');
        bar.className = 'wy-rec-bar';
        bar.setAttribute('role', 'status');
        bar.innerHTML = '<span class="wy-rec-dot" aria-hidden="true"></span><span class="wy-rec-label"></span><span class="wy-rec-time">0:00</span><button type="button" class="wy-btn wy-rec-stop">Stop</button><button type="button" class="wy-btn wy-rec-cancel">Cancel</button>';
        (bar.querySelector('.wy-rec-label') as HTMLElement).textContent = label;
        bar.querySelector('.wy-rec-stop')!.addEventListener('click', () => void finish(false));
        bar.querySelector('.wy-rec-cancel')!.addEventListener('click', () => void finish(true));
        editor.root.append(bar);
        timer = window.setInterval(() => {
          if (!rec || !bar) return;
          const s = Math.floor((Date.now() - rec.started) / 1000);
          (bar.querySelector('.wy-rec-time') as HTMLElement).textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
          if (s >= maxSeconds) void finish(false);
        }, 500);
      };
      const cleanup = () => {
        window.clearInterval(timer);
        bar?.remove();
        bar = null;
        rec?.stream.getTracks().forEach((t) => t.stop());
      };
      async function finish(cancel: boolean) {
        const r = rec;
        if (!r) return false;
        r.cancelled = cancel;
        if (r.mr.state !== 'inactive') r.mr.stop(); // `onstop` does the rest
        return true;
      }

      const start = async (kind: 'audio' | 'video'): Promise<boolean> => {
        if (rec) return false;
        if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices) { announce('Recording is not supported in this browser.'); return false; }
        let stream: MediaStream;
        try {
          stream = kind === 'audio'
            ? await navigator.mediaDevices.getUserMedia({ audio: true })
            : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
        } catch {
          announce('Permission was not given.');
          return false;
        }
        const mr = new MediaRecorder(stream);
        const r: Rec = { kind, mr, stream, chunks: [], started: Date.now(), cancelled: false };
        rec = r;
        mr.ondataavailable = (e) => { if (e.data?.size) r.chunks.push(e.data); };
        stream.getTracks().forEach((t) => t.addEventListener('ended', () => void finish(false))); // the person ended screen sharing from the browser
        mr.onstop = async () => {
          cleanup();
          rec = null;
          if (r.cancelled || !r.chunks.length || gone) return;
          const blob = new Blob(r.chunks, { type: r.chunks[0].type || (kind === 'video' ? 'video/webm' : 'audio/webm') });
          try {
            let src: string;
            if (options.upload) src = await options.upload(blob, kind);
            else if (blob.size > maxBytes) { announce(`The recording is larger than ${Math.round(maxBytes / 1048576)} MB. Set an upload function to keep long recordings.`); return; }
            else src = await blobToDataURL(blob);
            if (!isSafeClip(src)) { announce('The recording address is not allowed.'); return; }
            const { state, dispatch } = editor.view;
            dispatch(state.tr.replaceSelectionWith(state.schema.nodes.clip.create({ kind, src, name: `${kind === 'video' ? 'Screen' : 'Voice'} recording, ${new Date().toLocaleString()}` }), false).scrollIntoView());
            editor.emit('recording-saved', { kind, bytes: blob.size });
          } catch { announce('The recording could not be saved.'); }
        };
        mr.start(1000);
        showBar(kind === 'audio' ? 'Recording audio' : 'Recording screen');
        return true;
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && rec) { e.preventDefault(); void finish(true); } };
      editor.root.addEventListener('keydown', onKey);

      editor.registerCommand('recordAudio', () => { void start('audio'); return true; });
      editor.registerCommand('recordScreen', () => { void start('video'); return true; });
      editor.registerCommand('stopRecording', () => finish(false) as unknown as boolean);
      editor.registerCommand('cancelRecording', () => finish(true) as unknown as boolean);

      editor.registerCommand('toggleDictation', (e) => {
        if (dictation) { dictation.stop(); return true; }
        const Ctor = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
        if (!Ctor) { announce('Dictation is not supported in this browser.'); return false; }
        const sr = new Ctor();
        sr.lang = options.dictationLang ?? (document.documentElement.lang || 'en-US');
        sr.continuous = true;
        sr.interimResults = false;
        let stopped = false;
        sr.onresult = (ev: any) => {
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            if (!ev.results[i].isFinal) continue;
            const text = String(ev.results[i][0].transcript ?? '').replace(/[\u0000-\u001f]/g, ' ').trim();
            if (!text || !e.view.editable) continue;
            const { state, dispatch } = e.view;
            const before = state.selection.from > 1 ? state.doc.textBetween(Math.max(0, state.selection.from - 1), state.selection.from) : '';
            dispatch(state.tr.insertText(`${before && !/\s/.test(before) ? ' ' : ''}${text} `, state.selection.from, state.selection.to).scrollIntoView());
          }
        };
        const end = () => { if (stopped) return; stopped = true; dictation = null; e.emit('dictation', { active: false }); };
        sr.onend = end;
        sr.onerror = (ev: any) => { announce(ev?.error === 'not-allowed' ? 'Permission was not given.' : 'Dictation stopped.'); end(); };
        dictation = { stop: () => { try { sr.stop(); } catch { /* already stopped */ } end(); } };
        try { sr.start(); } catch { end(); return false; }
        e.emit('dictation', { active: true });
        return true;
      });
      return [
        new Plugin({
          props: { nodeViews: { clip: (node: PMNode) => new ClipView(node) } },
          view: () => ({ destroy: () => { gone = true; editor.root.removeEventListener('keydown', onKey); if (rec) { rec.cancelled = true; try { rec.mr.stop(); } catch { /* ignore */ } } cleanup(); dictation?.stop(); } }),
        }),
      ];
    },
    toolbar: [
      { name: 'recordAudio', label: 'Record audio', icon: '🎙', command: 'recordAudio' },
      { name: 'recordScreen', label: 'Record screen', icon: '🖥', command: 'recordScreen' },
      { name: 'toggleDictation', label: 'Dictate (speech to text)', icon: '🗣', command: 'toggleDictation' },
    ],
  };
}
