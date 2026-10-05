import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Embeds, createEditor, defaultPlugins, resolveEmbed } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content = '<p></p>', opts = {}) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Embeds(opts)] });
};

describe('resolveEmbed', () => {
  it('understands the usual YouTube, Vimeo and OpenStreetMap addresses', () => {
    expect(resolveEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')!.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(resolveEmbed('https://youtu.be/dQw4w9WgXcQ?t=42')!.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42');
    expect(resolveEmbed('https://m.youtube.com/shorts/dQw4w9WgXcQ')!.provider.id).toBe('youtube');
    expect(resolveEmbed('https://vimeo.com/76979871')!.src).toBe('https://player.vimeo.com/video/76979871?dnt=1');
    const map = resolveEmbed('https://www.openstreetmap.org/#map=15/-6.2088/106.8456')!;
    expect(map.src).toMatch(/^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=106\.\d+,-6\.\d+,106\.\d+,-6\.\d+&layer=mapnik&marker=-6\.2088,106\.8456$/);
  });
  it('refuses everything else: other hosts, look-alike hosts, bad ids, javascript: and data: addresses', () => {
    for (const bad of ['https://evil.example/watch?v=dQw4w9WgXcQ', 'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch?v=" onload="x', 'javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://youtu.be/dQw4w9WgXcQ', 'not a url', '', 'https://vimeo.com/abc', 'https://www.openstreetmap.org/#map=99/0/0', 'https://www.openstreetmap.org/#map=5/200/0']) {
      expect(resolveEmbed(bad), bad).toBeNull();
    }
  });
  it('a custom provider can only produce https addresses', () => {
    const evil = { id: 'x', name: 'X', match: () => ({ src: 'javascript:alert(1)' }) };
    const http = { id: 'y', name: 'Y', match: () => ({ src: 'http://plain.example/e' }) };
    const ok = { id: 'z', name: 'Z', match: (u: URL) => (u.hostname === 'media.example' ? { src: `https://media.example/embed${u.pathname}`, aspect: 4 / 3 } : null) };
    expect(resolveEmbed('https://a.test/', [evil, http])).toBeNull();
    expect(resolveEmbed('https://media.example/clip/7', [evil, ok])).toMatchObject({ src: 'https://media.example/embed/clip/7', aspect: 4 / 3 });
  });
});

describe('Embeds plugin', () => {
  it('inserts a sandboxed frame and saves only the address', () => {
    const ed = make();
    expect(ed.execute('insertEmbed', 'https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    const frame = ed.view.dom.querySelector('iframe')!;
    expect(frame.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(frame.getAttribute('sandbox')).toContain('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toContain('allow-top-navigation');
    expect(frame.referrerPolicy).toBe('no-referrer');
    const html = ed.getHTML();
    expect(html).toContain('data-embed-url="https://youtu.be/dQw4w9WgXcQ"');
    expect(html).not.toContain('<iframe');
    ed.destroy();
  });
  it('rebuilds the frame from the address and ignores edited markup', () => {
    const ed = make('<figure data-embed-url="https://youtu.be/dQw4w9WgXcQ"><iframe src="https://evil.example/x"></iframe></figure><figure data-embed-url="https://evil.example/x"></figure><figure data-embed-url="javascript:alert(1)"></figure>');
    const frames = [...ed.view.dom.querySelectorAll('iframe')];
    expect(frames).toHaveLength(1);
    expect(frames[0].src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(ed.getHTML()).not.toMatch(/evil\.example|javascript:/);
    ed.destroy();
  });
  it('refuses an unsupported address', () => {
    const ed = make();
    expect(ed.execute('insertEmbed', 'https://evil.example/video')).toBe(false);
    expect(ed.view.dom.querySelector('iframe')).toBeNull();
    ed.destroy();
  });
  it('the dialog validates the address and previews the service', async () => {
    const ed = make();
    ed.execute('insertEmbed');
    await new Promise((r) => setTimeout(r, 30));
    const input = ed.root.querySelector('form.wy-ask input') as HTMLInputElement;
    input.value = 'https://evil.example/x'; input.dispatchEvent(new Event('input', { bubbles: true }));
    (ed.root.querySelector('form.wy-ask') as HTMLFormElement).requestSubmit();
    expect(ed.root.querySelector('.wy-ask-error')!.textContent).toMatch(/not from a supported service/);
    input.value = 'https://vimeo.com/76979871'; input.dispatchEvent(new Event('input', { bubbles: true }));
    (ed.root.querySelector('form.wy-ask') as HTMLFormElement).requestSubmit();
    await new Promise((r) => setTimeout(r, 30));
    expect(ed.view.dom.querySelector('iframe')!.src).toContain('player.vimeo.com/video/76979871');
    ed.destroy();
  });
  it('pasting only a link on an empty line embeds it; inside text it stays text', () => {
    const ed = make('<p></p><p>some text</p>');
    const paste = (text: string) => !!ed.view.someProp('handlePaste', (f) => f(ed.view, { clipboardData: { getData: (t: string) => (t === 'text/plain' ? text : ''), files: [] }, preventDefault() {} } as unknown as ClipboardEvent, null as never));
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 1)));
    expect(paste('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(ed.view.dom.querySelectorAll('iframe')).toHaveLength(1);
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.atEnd(ed.view.state.doc)));
    expect(paste('https://youtu.be/dQw4w9WgXcQ')).toBe(false); // in the middle of a paragraph
    expect(paste('https://evil.example/x')).toBe(false);
    ed.destroy();
  });
  it('exports to Markdown as a link', () => {
    const ed = make('<figure data-embed-url="https://youtu.be/dQw4w9WgXcQ"></figure>');
    expect(ed.getMarkdown()).toContain('(https://youtu.be/dQw4w9WgXcQ)');
    ed.destroy();
  });
});
