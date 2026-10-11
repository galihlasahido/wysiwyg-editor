import { NodeSelection } from 'prosemirror-state';
import { askDialog } from '../dialog';
import type { ContextMenuEntry, EditorPlugin } from '../types';
import { isSafeSrc } from '../url';

/**
 * A cover page: one picture that fills the whole first page, edge to edge, followed by a page break. Add it from the Layout or Insert
 * tab (Cover Page), by uploading a picture or giving its address. There is at most one, and it is always the first thing in the document.
 */
export const Cover: EditorPlugin = {
  name: 'cover',
  nodes: {
    cover_page: {
      group: 'block',
      atom: true,
      selectable: true,
      draggable: false,
      attrs: { src: {}, alt: { default: '' } },
      parseDOM: [{
        tag: 'div[data-cover-page]',
        getAttrs: (n) => {
          const img = (n as HTMLElement).querySelector('img');
          const src = img?.getAttribute('src');
          return src && isSafeSrc(src) ? { src, alt: img?.getAttribute('alt') ?? '' } : false;
        },
      }],
      // Checked again on output: a node can also arrive from collaboration, which bypasses parseDOM.
      toDOM: (n) => ['div', { class: 'wy-cover', 'data-cover-page': '' }, ['img', { src: isSafeSrc(n.attrs.src) ? n.attrs.src : '', alt: n.attrs.alt || 'Cover' }]],
    },
  },
  setup(editor) {
    const { cover_page } = editor.schema.nodes;
    const existing = () => {
      const first = editor.view.state.doc.firstChild;
      return first && first.type === cover_page ? first : null;
    };
    const place = (src: string, alt = '') => {
      if (!isSafeSrc(src)) return false;
      const { state, dispatch } = editor.view;
      const node = cover_page.create({ src, alt });
      const tr = existing() ? state.tr.replaceWith(0, state.doc.firstChild!.nodeSize, node) : state.tr.insert(0, node);
      dispatch(tr.scrollIntoView());
      return true;
    };
    editor.registerCommand('coverPage', (_e, src?: string, alt?: string) => {
      if (typeof src === 'string') return place(src, alt);
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file || !file.type.startsWith('image/')) return;
        editor.uploadImage(file).then((url) => place(url, file.name.replace(/\.[^.]+$/, '')), (err) => console.error('Cover upload failed', err));
      };
      input.click();
      return true;
    });
    editor.registerCommand('coverPageFromAddress', (e, src?: string) => {
      if (typeof src === 'string') return place(src);
      void askDialog(e.root, { title: 'Cover page', label: 'Image address', placeholder: 'https://example.com/cover.jpg', submitLabel: 'Use as cover', validate: (v) => (isSafeSrc(v) ? null : 'Use an http(s) address, a /path or a base64 image.') }).then((url) => url && place(url));
      return true;
    });
    editor.registerCommand('removeCover', (e) => {
      const first = existing();
      if (!first) return false;
      e.view.dispatch(e.view.state.tr.delete(0, first.nodeSize));
      return true;
    });
  },
  contextMenuOrder: 24,
  contextMenu({ state, readonly }) {
    const sel = state.selection;
    if (readonly || !(sel instanceof NodeSelection) || sel.node.type.name !== 'cover_page') return [];
    const items: ContextMenuEntry[] = [
      { label: 'Change cover picture…', command: 'coverPage' },
      { label: 'Use a picture address…', command: 'coverPageFromAddress' },
      '-',
      { label: 'Remove cover page', command: 'removeCover', danger: true, icon: '🗑' },
    ];
    return items;
  },
  ribbon: [
    { tab: 'layout', after: 'setup', group: { id: 'cover', label: 'Cover Page', controls: [coverMenu()] } },
    { tab: 'insert', before: 'tables', group: { id: 'pages', label: 'Pages', controls: [coverMenu()] } },
  ],
};

function coverMenu() {
  return {
    kind: 'menu' as const, id: 'coverPage', label: 'Cover Page', icon: 'coverPage', need: 'coverPage', size: 'large' as const,
    entries: () => [
      { label: 'Upload a picture…', command: 'coverPage' },
      { label: 'Use a picture address…', command: 'coverPageFromAddress' },
      { label: 'Remove cover page', command: 'removeCover' },
    ],
  };
}
