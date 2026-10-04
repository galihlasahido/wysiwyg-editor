import { Plugin } from 'prosemirror-state';
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
    const insertFiles = (files: File[]) => {
      for (const file of files) {
        editor.uploadImage(file).then(
          (url) => editor.execute('image', url),
          (err) => console.error('Image upload failed', err),
        );
      }
    };
    const imageFiles = (list?: FileList | null) => Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
    editor.registerCommand('uploadImage', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = () => insertFiles(imageFiles(input.files));
      input.click();
      return true;
    });
    editor.registerCommand('image', (e, src?: string) => {
      const url = src ?? window.prompt('Image URL');
      if (!url || !SAFE_SRC.test(url)) return false;
      const { state, dispatch } = e.view;
      dispatch(state.tr.replaceSelectionWith(e.schema.nodes.image.create({ src: url })).scrollIntoView());
      return true;
    });
    return [
      new Plugin({
        props: {
          handlePaste: (_v, e) => {
            const files = imageFiles(e.clipboardData?.files);
            if (!files.length) return false;
            insertFiles(files);
            return true;
          },
          handleDrop: (_v, e) => {
            const files = imageFiles((e as DragEvent).dataTransfer?.files);
            if (!files.length) return false;
            e.preventDefault();
            insertFiles(files);
            return true;
          },
        },
      }),
    ];
  },
  toolbar: [
    { name: 'image', label: 'Insert image from URL', icon: '🖼', command: 'image' },
    { name: 'uploadImage', label: 'Upload image', icon: '⬆🖼', command: 'uploadImage' },
  ],
};
