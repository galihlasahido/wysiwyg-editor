import { NodeSelection, Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import type { EditorPlugin } from '../types';

const SAFE_SRC = /^(https?:|data:image\/|\/)/i;

export const Image: EditorPlugin = {
  name: 'image',
  nodes: {
    image: {
      inline: true,
      group: 'inline',
      draggable: true,
      attrs: { src: {}, alt: { default: null }, width: { default: null }, caption: { default: null } },
      parseDOM: [
        {
          tag: 'img[src]',
          getAttrs: (n) => {
            const el = n as HTMLElement;
            const src = el.getAttribute('src') ?? '';
            const w = parseInt(el.getAttribute('width') ?? '', 10);
            return SAFE_SRC.test(src)
              ? { src, alt: el.getAttribute('alt'), width: w > 0 ? w : null, caption: el.getAttribute('data-caption') }
              : false;
          },
        },
      ],
      toDOM: (n) => [
        'img',
        { src: n.attrs.src, alt: n.attrs.alt, ...(n.attrs.width ? { width: String(n.attrs.width) } : {}), ...(n.attrs.caption ? { 'data-caption': n.attrs.caption } : {}) },
      ],
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
    // setNodeMarkup drops the node selection; restore it so further edits keep working.
    const updateImage = (e: typeof editor, pos: number, attrs: Record<string, unknown>) => {
      const tr = e.view.state.tr.setNodeMarkup(pos, undefined, attrs);
      e.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    };
    const selectedImage = (e: typeof editor) => {
      const sel = e.view.state.selection;
      return sel instanceof NodeSelection && sel.node.type.name === 'image' ? sel : null;
    };
    editor.registerCommand('imageWidth', (e, width: number | null) => {
      const sel = selectedImage(e);
      if (!sel) return false;
      const w = width === null ? null : Math.max(24, Math.min(2000, Math.round(width)));
      updateImage(e, sel.from, { ...sel.node.attrs, width: w });
      return true;
    });
    editor.registerCommand('imageCaption', (e, caption?: string | null) => {
      const sel = selectedImage(e);
      if (!sel) return false;
      const text = caption === undefined ? window.prompt('Caption', sel.node.attrs.caption ?? '') : caption;
      if (text === null) return false;
      updateImage(e, sel.from, { ...sel.node.attrs, caption: text || null });
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
          nodeViews: { image: (node, view, getPos) => new ImageView(node, view, getPos) },
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
    { name: 'imageCaption', label: 'Image caption (select an image)', icon: 'Cap', command: 'imageCaption' },
  ],
};

/** Image with a drag handle for resizing (visible when the image is selected) and an optional caption. */
class ImageView implements NodeView {
  dom = document.createElement('span');
  private img = document.createElement('img');
  private handle = document.createElement('span');

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom.className = 'wy-image';
    this.handle.className = 'wy-image-handle';
    this.handle.setAttribute('contenteditable', 'false');
    this.dom.append(this.img, this.handle);
    this.handle.addEventListener('pointerdown', (e) => this.startResize(e));
    this.render();
  }

  private render() {
    const { src, alt, width, caption } = this.node.attrs;
    this.img.src = src;
    this.img.alt = alt ?? '';
    this.img.style.width = width ? `${width}px` : '';
    if (caption) this.dom.dataset.caption = caption;
    else delete this.dom.dataset.caption;
  }

  private startResize(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = this.img.getBoundingClientRect().width;
    this.handle.setPointerCapture(e.pointerId);
    const width = (ev: PointerEvent) => Math.max(24, Math.min(2000, Math.round(startW + ev.clientX - startX)));
    const move = (ev: PointerEvent) => (this.img.style.width = `${width(ev)}px`);
    const up = (ev: PointerEvent) => {
      this.handle.removeEventListener('pointermove', move);
      this.handle.removeEventListener('pointerup', up);
      const pos = this.getPos();
      if (pos === undefined) return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, width: width(ev) });
      this.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)));
    };
    this.handle.addEventListener('pointermove', move);
    this.handle.addEventListener('pointerup', up);
  }

  update(node: PMNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('is-selected'); }
  deselectNode() { this.dom.classList.remove('is-selected'); }
  stopEvent(e: Event) { return e.target === this.handle; }
  ignoreMutation() { return true; }
}
