import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Recording, createEditor, defaultPlugins, isSafeClip } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => { roots.splice(0).forEach((r) => r.remove()); vi.unstubAllGlobals(); });
const make = (opts = {}, content = '<p>hi</p>') => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Recording(opts)] });
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

let tracks: { stop: ReturnType<typeof vi.fn> }[];
beforeEach(() => {
  HTMLMediaElement.prototype.pause = () => {};
  tracks = [{ stop: vi.fn() }];
  class FakeRecorder {
    state = 'inactive'; ondataavailable: any; onstop: any;
    constructor(public stream: unknown) { void stream; }
    start() { this.state = 'recording'; this.ondataavailable?.({ data: new Blob(['abc'], { type: 'audio/webm' }) }); }
    stop() { this.state = 'inactive'; setTimeout(() => this.onstop?.(), 0); }
  }
  vi.stubGlobal('MediaRecorder', FakeRecorder);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => ({ getTracks: () => tracks.map((t) => Object.assign(t, { addEventListener() {} })) })), getDisplayMedia: vi.fn(async () => ({ getTracks: () => tracks.map((t) => Object.assign(t, { addEventListener() {} })) })) } });
});

describe('safe clip addresses', () => {
  it('allows audio/video data URLs, https and same-site; refuses scripts, html and svg', () => {
    for (const ok of ['data:audio/webm;base64,AAAA', 'data:video/webm;codecs=vp8;base64,AAAA', 'https://x.test/a.mp3', '/media/a.ogg']) expect(isSafeClip(ok), ok).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA', '//evil.test/a.mp3', 'data:audio/webm;base64,AA"onerror=1', 'ftp://x/a']) expect(isSafeClip(bad), bad).toBe(false);
  });
});

describe('Recording', () => {
  it('records audio, shows a bar, stops and inserts a player; tracks are released', async () => {
    const ed = make();
    const saved: unknown[] = [];
    ed.on('recording-saved', (e) => saved.push(e));
    ed.execute('recordAudio');
    await tick();
    expect(ed.root.querySelector('.wy-rec-bar')).not.toBeNull();
    (ed.root.querySelector('.wy-rec-stop') as HTMLElement).click();
    await tick(60);
    expect(ed.root.querySelector('.wy-rec-bar')).toBeNull();
    expect(tracks[0].stop).toHaveBeenCalled();
    const audio = ed.view.dom.querySelector('audio') as HTMLAudioElement;
    expect(audio.src).toMatch(/^data:audio\/webm;base64,/);
    expect(saved).toHaveLength(1);
    expect(ed.getHTML()).toContain('data-clip="audio"');
    ed.destroy();
  });
  it('cancel (button or Escape) keeps nothing', async () => {
    const ed = make();
    ed.execute('recordAudio'); await tick();
    ed.root.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(60);
    expect(ed.view.dom.querySelector('audio')).toBeNull();
    expect(ed.root.querySelector('.wy-rec-bar')).toBeNull();
    ed.execute('recordScreen'); await tick();
    (ed.root.querySelector('.wy-rec-cancel') as HTMLElement).click(); await tick(60);
    expect(ed.view.dom.querySelector('video')).toBeNull();
    ed.destroy();
  });
  it('uses the upload function when given, and refuses an unsafe address or an oversized embed', async () => {
    const ed = make({ upload: async () => 'https://cdn.test/r1.webm' });
    ed.execute('recordScreen'); await tick();
    ed.execute('stopRecording'); await tick(60);
    expect(ed.view.dom.querySelector('video')!.src).toBe('https://cdn.test/r1.webm');
    ed.destroy();
    const bad = make({ upload: async () => 'javascript:alert(1)' });
    bad.execute('recordAudio'); await tick(); bad.execute('stopRecording'); await tick(60);
    expect(bad.view.dom.querySelector('audio')).toBeNull();
    bad.destroy();
    const big = make({ maxBytes: 1 });
    big.execute('recordAudio'); await tick(); big.execute('stopRecording'); await tick(60);
    expect(big.view.dom.querySelector('audio')).toBeNull();
    big.destroy();
  });
  it('says so when the browser cannot record or permission is denied', async () => {
    const ed = make();
    const msgs: string[] = [];
    ed.on('recording-status', (e: any) => msgs.push(e.message));
    (navigator.mediaDevices.getUserMedia as any).mockRejectedValueOnce(new Error('denied'));
    ed.execute('recordAudio'); await tick();
    expect(msgs).toEqual(['Permission was not given.']);
    expect(ed.root.querySelector('.wy-rec-bar')).toBeNull();
    ed.destroy();
  });
  it('drops hostile clip markup on load', () => {
    const ed = make({}, '<figure data-clip="audio" data-src="javascript:alert(1)"></figure><figure data-clip="exe" data-src="https://x.test/a"></figure><figure data-clip="video" data-src="https://x.test/v.webm" data-name="Demo"></figure>');
    expect(ed.view.dom.querySelectorAll('.wy-clip')).toHaveLength(1);
    expect(ed.view.dom.querySelector('video')!.getAttribute('aria-label')).toBe('Demo');
    ed.destroy();
  });
  it('dictation types recognised text at the cursor, and reports when unsupported', async () => {
    const ed = make({}, '<p>Hello</p>');
    const msgs: string[] = [];
    ed.on('recording-status', (e: any) => msgs.push(e.message));
    expect(ed.execute('toggleDictation')).toBe(false);
    expect(msgs[0]).toMatch(/not supported/);
    let sr: any;
    vi.stubGlobal('SpeechRecognition', class { start = vi.fn(); stop = vi.fn(() => this.onend?.()); onresult: any; onend: any; onerror: any; constructor() { sr = this; } });
    ed.view.focus();
    ed.view.dispatch(ed.view.state.tr.setSelection((await import('prosemirror-state')).TextSelection.atEnd(ed.view.state.doc)));
    expect(ed.execute('toggleDictation')).toBe(true);
    sr.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'world <b>x</b>' }], { isFinal: true })] });
    expect(ed.view.state.doc.textContent).toBe('Hello world <b>x</b> '); // text, never markup
    ed.execute('toggleDictation');
    expect(sr.stop).toHaveBeenCalled();
    ed.destroy();
  });
});
