import type { EditorPlugin } from '../types';

const SAFE_SRC = /^(https?:|data:image\/|\/)/i;

export const Image: EditorPlugin = {
  name: 'image',
  nodes: {
    image: {
      inline: true,
      group: 'inline',
      draggable: true,
      attrs: { src: {}, alt: { default: null } },
      parseDOM: [
        {
          tag: 'img[src]',
          getAttrs: (n) => {
            const el = n as HTMLElement;
            const src = el.getAttribute('src') ?? '';
            return SAFE_SRC.test(src) ? { src, alt: el.getAttribute('alt') } : false;
          },
        },
      ],
      toDOM: (n) => ['img', { src: n.attrs.src, alt: n.attrs.alt }],
    },
  },
  setup(editor) {
    editor.registerCommand('image', (e, src?: string) => {
      const url = src ?? window.prompt('Image URL');
      if (!url || !SAFE_SRC.test(url)) return false;
      const { state, dispatch } = e.view;
      dispatch(state.tr.replaceSelectionWith(e.schema.nodes.image.create({ src: url })).scrollIntoView());
      return true;
    });
  },
  toolbar: [{ name: 'image', label: 'Insert image', icon: '🖼', command: 'image' }],
};
