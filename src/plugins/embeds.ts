import { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { askDialog } from '../dialog';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

/** A service whose pages may be embedded. Only these hosts ever become an iframe. */
export interface EmbedProvider {
  id: string;
  name: string;
  /** Turn a pasted address into the iframe address, or null when it is not this service. Must return an https URL on the service's own host. */
  match(url: URL): { src: string; /** width / height */ aspect?: number; title?: string } | null;
  /** `sandbox` flags the frame needs. Default: scripts and same-origin (the service's own origin, isolated from your page). */
  sandbox?: string;
}

const YT_ID = /^[\w-]{11}$/;
const youtube: EmbedProvider = {
  id: 'youtube',
  name: 'YouTube',
  match(u) {
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') id = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:embed|shorts|live)\/([\w-]{11})/.exec(u.pathname)?.[1] ?? null;
    if (!id || !YT_ID.test(id)) return null;
    const t = parseInt(u.searchParams.get('t') ?? u.searchParams.get('start') ?? '', 10);
    return { src: `https://www.youtube-nocookie.com/embed/${id}${t > 0 ? `?start=${t}` : ''}`, aspect: 16 / 9, title: 'YouTube video' };
  },
};
const vimeo: EmbedProvider = {
  id: 'vimeo',
  name: 'Vimeo',
  match(u) {
    const host = u.hostname.replace(/^www\./, '');
    const id = host === 'vimeo.com' ? /^\/(\d{5,12})(?:\/|$)/.exec(u.pathname)?.[1] : host === 'player.vimeo.com' ? /^\/video\/(\d{5,12})/.exec(u.pathname)?.[1] : null;
    return id ? { src: `https://player.vimeo.com/video/${id}?dnt=1`, aspect: 16 / 9, title: 'Vimeo video' } : null;
  },
};
const openstreetmap: EmbedProvider = {
  id: 'openstreetmap',
  name: 'OpenStreetMap',
  match(u) {
    if (u.hostname.replace(/^www\./, '') !== 'openstreetmap.org') return null;
    const m = /map=(\d{1,2})\/(-?\d{1,2}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/.exec(u.hash);
    if (!m) return null;
    const [zoom, lat, lon] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (zoom > 19 || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
    const span = 360 / 2 ** zoom / 2.5; // a window that roughly matches the zoom level
    const bbox = [lon - span, lat - span / 2, lon + span, lat + span / 2].map((n) => n.toFixed(5)).join(',');
    return { src: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`, aspect: 16 / 10, title: 'Map' };
  },
};

export const DEFAULT_EMBED_PROVIDERS: EmbedProvider[] = [youtube, vimeo, openstreetmap];

export interface EmbedsOptions {
  /** Services that may be embedded. Default: YouTube (privacy-enhanced), Vimeo and OpenStreetMap. */
  providers?: EmbedProvider[];
  /** Turn a pasted address that is only a link to a known service into an embed. Default true. */
  pasteLinks?: boolean;
}

/** Resolve an address against the providers. Only http(s) addresses are considered, and the result is always an https URL. */
export function resolveEmbed(input: string, providers: EmbedProvider[] = DEFAULT_EMBED_PROVIDERS): { provider: EmbedProvider; src: string; aspect: number; title: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  for (const p of providers) {
    const r = p.match(url);
    if (!r) continue;
    let src: URL;
    try { src = new URL(r.src); } catch { continue; }
    if (src.protocol !== 'https:') continue; // never http, javascript:, data: …
    return { provider: p, src: src.href, aspect: r.aspect && r.aspect > 0 ? r.aspect : 16 / 9, title: r.title ?? p.name };
  }
  return null;
}

/**
 * Embedded media: paste a YouTube, Vimeo or OpenStreetMap link (or use Insert → Media) and it becomes a player or map. Only the listed
 * services ever become an iframe, the frame is sandboxed, and the saved HTML keeps just the original address: the iframe is rebuilt from it
 * on load, so edited markup cannot point a frame somewhere else.
 */
export function Embeds(options: EmbedsOptions = {}): EditorPlugin {
  const providers = options.providers ?? DEFAULT_EMBED_PROVIDERS;

  class EmbedView implements NodeView {
    dom: HTMLElement;
    constructor(private node: PMNode) {
      this.dom = document.createElement('figure');
      this.dom.className = 'wy-embed';
      this.dom.contentEditable = 'false';
      this.paint();
    }
    private paint() {
      const r = resolveEmbed(this.node.attrs.url, providers);
      this.dom.replaceChildren();
      if (!r) { const bad = document.createElement('div'); bad.className = 'wy-embed-bad'; bad.textContent = 'This media cannot be shown.'; this.dom.append(bad); return; }
      this.dom.style.setProperty('--wy-embed-aspect', String(r.aspect));
      const frame = document.createElement('iframe');
      frame.src = r.src;
      frame.title = r.title;
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer';
      frame.setAttribute('sandbox', r.provider.sandbox ?? 'allow-scripts allow-same-origin allow-popups');
      frame.setAttribute('allow', 'fullscreen; picture-in-picture');
      frame.allowFullscreen = true;
      const link = document.createElement('a');
      link.className = 'wy-embed-link';
      link.href = this.node.attrs.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${r.provider.name}: ${this.node.attrs.url}`;
      this.dom.append(frame, link);
    }
    update(node: PMNode) {
      if (node.type !== this.node.type) return false;
      const changed = node.attrs.url !== this.node.attrs.url;
      this.node = node;
      if (changed) this.paint();
      return true;
    }
    selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
    deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
    stopEvent(e: Event) { return (e.target as HTMLElement).tagName === 'IFRAME'; }
    ignoreMutation() { return true; }
  }

  return {
    name: 'embeds',
    nodes: {
      embed: {
        group: 'block',
        atom: true,
        selectable: true,
        draggable: true,
        attrs: { url: { default: '' } },
        leafText: (n: PMNode) => n.attrs.url,
        parseDOM: [{
          tag: 'figure[data-embed-url]',
          getAttrs: (n) => {
            const url = (n as HTMLElement).getAttribute('data-embed-url') ?? '';
            return resolveEmbed(url, providers) ? { url: url.slice(0, 2000) } : false; // an address no provider accepts is dropped
          },
        }],
        // The saved HTML is a figure with a link, no iframe: readers without scripts see a link, and the iframe is rebuilt from the address on load.
        toDOM: (n: PMNode) => ['figure', { class: 'wy-embed', 'data-embed-url': n.attrs.url }, ['a', { href: resolveEmbed(n.attrs.url, providers) ? n.attrs.url : '#', rel: 'noopener noreferrer' }, n.attrs.url]],
      },
    },
    setup(editor: Editor) {
      editor.registerCommand('insertEmbed', (e, url?: string) => {
        const { state, dispatch } = e.view;
        if (url === undefined) {
          void askDialog(e.root, {
            title: 'Insert media', label: 'Address', description: `Paste a link from ${providers.map((p) => p.name).join(', ')}.`, placeholder: 'https://www.youtube.com/watch?v=…', submitLabel: 'Insert',
            validate: (v) => (resolveEmbed(v, providers) ? null : `That address is not from a supported service (${providers.map((p) => p.name).join(', ')}).`),
            preview: (value, host) => { host.replaceChildren(); const r = resolveEmbed(value, providers); if (r) host.textContent = `${r.provider.name}: ${r.title}`; },
          }).then((v) => v && e.execute('insertEmbed', v));
          return true;
        }
        if (!resolveEmbed(url, providers)) return false;
        dispatch(state.tr.replaceSelectionWith(state.schema.nodes.embed.create({ url: url.trim() }), false).scrollIntoView());
        return true;
      });
      return [
        new Plugin({
          props: {
            nodeViews: { embed: (node: PMNode, _v: EditorView) => new EmbedView(node) },
            // pasting nothing but a link to a supported service makes an embed
            handlePaste: (view, event) => {
              if (options.pasteLinks === false) return false;
              const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
              if (!text || /\s/.test(text) || !resolveEmbed(text, providers)) return false;
              const { $from } = view.state.selection;
              if ($from.parent.content.size > 0) return false; // only on an empty line: pasting inside text stays a link
              event.preventDefault();
              return editor.execute('insertEmbed', text);
            },
          },
        }),
      ];
    },
    toolbar: [{ name: 'embed', label: 'Insert media (YouTube, Vimeo, map)', icon: '▶', command: 'insertEmbed' }],
  };
}
