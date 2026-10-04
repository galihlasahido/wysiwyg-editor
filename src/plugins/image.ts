import { NodeSelection, Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { cropFromString, cropLayout, cropToString, dragCrop, normalizeCrop, visibleSize, type Crop, type Handle } from '../crop';
import type { EditorPlugin } from '../types';
import { isSafeSrc } from '../url';

const SAFE_SRC = { test: isSafeSrc };

export const Image: EditorPlugin = {
  name: 'image',
  nodes: {
    image: {
      inline: true,
      group: 'inline',
      draggable: true,
      // `crop` is the fraction of the natural image removed per side; `nw`/`nh` its natural size (known once cropped).
      attrs: { src: {}, alt: { default: null }, width: { default: null }, caption: { default: null }, crop: { default: null }, nw: { default: null }, nh: { default: null } },
      parseDOM: [
        {
          // A cropped image is a clipping box around the full image (works in every browser, unlike object-view-box).
          tag: 'span[data-crop]',
          priority: 60,
          getAttrs: (n) => {
            const box = n as HTMLElement;
            const img = box.querySelector('img[src]');
            const src = img?.getAttribute('src') ?? '';
            const crop = cropFromString(box.getAttribute('data-crop'));
            const nw = Number(box.getAttribute('data-nw'));
            const nh = Number(box.getAttribute('data-nh'));
            if (!img || !SAFE_SRC.test(src) || !crop || !(nw > 0) || !(nh > 0)) return false;
            const w = parseFloat(box.style.width);
            return { src, alt: img.getAttribute('alt'), width: w > 0 ? Math.round(w) : null, caption: box.getAttribute('data-caption'), crop, nw, nh };
          },
        },
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
      toDOM: (n) => {
        const { alt, width, caption, crop, nw, nh } = n.attrs;
        const src = isSafeSrc(n.attrs.src) ? n.attrs.src : ''; // re-checked on output: collaboration can deliver nodes that skipped parseDOM
        if (crop && nw && nh) {
          const L = cropLayout(crop, { w: nw, h: nh }, width ?? visibleSize(crop, { w: nw, h: nh }).w);
          const px = (v: number) => `${Math.round(v * 100) / 100}px`;
          return [
            'span',
            {
              class: 'wy-crop',
              'data-crop': cropToString(crop),
              'data-nw': String(nw),
              'data-nh': String(nh),
              ...(caption ? { 'data-caption': caption } : {}),
              style: `display: inline-block; position: relative; overflow: hidden; vertical-align: bottom; width: ${px(L.width)}; height: ${px(L.height)}`,
            },
            ['img', { src, alt, style: `position: absolute; max-width: none; width: ${px(L.imgWidth)}; height: ${px(L.imgHeight)}; left: ${px(L.offsetX)}; top: ${px(L.offsetY)}` }],
          ];
        }
        return ['img', { src, alt, ...(width ? { width: String(width) } : {}), ...(caption ? { 'data-caption': caption } : {}) }];
      },
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
    editor.registerCommand('imageAlt', (e, text?: string | null) => {
      const sel = selectedImage(e);
      if (!sel) return false;
      const alt = text === undefined ? window.prompt('Alternative text (describe the image for screen readers)', sel.node.attrs.alt ?? '') : text;
      if (alt === null) return false;
      updateImage(e, sel.from, { ...sel.node.attrs, alt: alt.trim() || null });
      return true;
    });
    /** Natural size of the selected image: known from a previous crop, passed in, or read from the loaded <img>. */
    const naturalOf = (e: typeof editor, pos: number, attrs: Record<string, any>, given?: { w: number; h: number }) => {
      const dom = e.view.nodeDOM(pos) as HTMLElement | null;
      const img = dom?.querySelector('img');
      const w = given?.w ?? attrs.nw ?? img?.naturalWidth;
      const h = given?.h ?? attrs.nh ?? img?.naturalHeight;
      return w > 0 && h > 0 ? { w: Number(w), h: Number(h) } : null;
    };
    /** Current on-screen px per natural px, so a new crop keeps the picture at the same scale. */
    const scaleOf = (attrs: Record<string, any>, nat: { w: number; h: number }) =>
      attrs.width ? attrs.width / visibleSize(attrs.crop, nat).w : 1;
    editor.registerCommand('imageCrop', (e, value: Partial<Crop> | null, natural?: { w: number; h: number }) => {
      const sel = selectedImage(e);
      if (!sel) return false;
      const attrs = sel.node.attrs;
      const nat = naturalOf(e, sel.from, attrs, natural);
      if (!nat) return false; // not loaded yet: cannot crop what we cannot measure
      const crop = normalizeCrop(value);
      const scale = scaleOf(attrs, nat);
      const width = crop || attrs.crop ? Math.max(24, Math.round(scale * visibleSize(crop, nat).w)) : attrs.width;
      updateImage(e, sel.from, { ...attrs, crop, nw: crop ? nat.w : null, nh: crop ? nat.h : null, width: attrs.width || crop ? width : null });
      return true;
    });
    editor.registerCommand('resetCrop', (e) => (selectedImage(e)?.node.attrs.crop ? e.execute('imageCrop', null) : false));
    editor.registerCommand('cropImage', (e) => {
      const sel = selectedImage(e);
      const dom = sel && (e.view.nodeDOM(sel.from) as HTMLElement | null);
      const view = dom && imageViews.get(dom);
      return view ? view.startCrop((crop, nat) => e.execute('imageCrop', crop, nat)) : false;
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
    { name: 'cropImage', label: 'Crop image (select an image)', icon: 'crop', command: 'cropImage' },
    { name: 'imageAlt', label: 'Alternative text (select an image)', icon: 'alt', command: 'imageAlt' },
  ],
};

const imageViews = new WeakMap<HTMLElement, ImageView>();
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/**
 * Image with a drag handle for resizing (visible when selected), an optional caption, and a crop mode: the full
 * image is shown with a draggable rectangle; Apply stores it as a crop (see crop.ts).
 */
class ImageView implements NodeView {
  dom = document.createElement('span');
  private box = document.createElement('span'); // clipping box when cropped
  private img = document.createElement('img');
  private handle = document.createElement('span');
  private cropUi: HTMLElement | null = null;
  private endCrop: (() => void) | null = null;

  constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined) {
    this.dom.className = 'wy-image';
    this.box.className = 'wy-crop-box';
    this.handle.className = 'wy-image-handle';
    this.handle.setAttribute('contenteditable', 'false');
    this.dom.append(this.box, this.handle);
    this.box.append(this.img);
    this.handle.addEventListener('pointerdown', (e) => this.startResize(e));
    imageViews.set(this.dom, this);
    this.render();
  }

  private render() {
    const { src, alt, width, caption, crop, nw, nh } = this.node.attrs;
    this.img.src = src;
    this.img.alt = alt ?? '';
    if (crop && nw && nh) {
      const L = cropLayout(crop, { w: nw, h: nh }, width ?? visibleSize(crop, { w: nw, h: nh }).w);
      Object.assign(this.box.style, { display: 'inline-block', position: 'relative', overflow: 'hidden', width: `${L.width}px`, height: `${L.height}px` });
      Object.assign(this.img.style, { position: 'absolute', maxWidth: 'none', width: `${L.imgWidth}px`, height: `${L.imgHeight}px`, left: `${L.offsetX}px`, top: `${L.offsetY}px` });
    } else {
      this.box.removeAttribute('style');
      this.img.removeAttribute('style');
      this.img.style.width = width ? `${width}px` : '';
    }
    if (caption) this.dom.dataset.caption = caption;
    else delete this.dom.dataset.caption;
  }

  /** Enter crop mode. `apply` receives the chosen crop and the image's natural size. */
  startCrop(apply: (crop: Crop | null, nat: { w: number; h: number }) => unknown): boolean {
    const nat = { w: this.node.attrs.nw || this.img.naturalWidth, h: this.node.attrs.nh || this.img.naturalHeight };
    if (this.cropUi || !(nat.w > 0 && nat.h > 0)) return false;
    const attrs = this.node.attrs;
    // Show the whole image at the scale it is currently displayed at.
    const scale = attrs.width ? attrs.width / visibleSize(attrs.crop, nat).w : 1;
    const full = { w: nat.w * scale, h: nat.h * scale };
    this.box.removeAttribute('style');
    Object.assign(this.img.style, { position: '', maxWidth: 'none', left: '', top: '', width: `${full.w}px`, height: `${full.h}px` });

    let draft: Crop = attrs.crop ?? { left: 0, top: 0, right: 0, bottom: 0 };
    const ui = document.createElement('span');
    ui.className = 'wy-crop-ui';
    ui.setAttribute('contenteditable', 'false');
    ui.style.width = `${full.w}px`;
    ui.style.height = `${full.h}px`;
    // The dimmed area outside the crop rectangle is a huge box-shadow; a clipping layer keeps it on the image.
    const clip = document.createElement('span');
    clip.className = 'wy-crop-clip';
    const shade = document.createElement('span');
    shade.className = 'wy-crop-shade';
    clip.append(shade);
    const rect = document.createElement('span');
    rect.className = 'wy-crop-rect';
    rect.tabIndex = 0;
    rect.setAttribute('role', 'group');
    rect.setAttribute('aria-label', 'Crop area. Arrow keys move it, Enter applies, Escape cancels.');
    const draw = () => {
      const pos = { left: `${draft.left * 100}%`, top: `${draft.top * 100}%`, right: `${draft.right * 100}%`, bottom: `${draft.bottom * 100}%` };
      Object.assign(rect.style, pos);
      Object.assign(shade.style, pos);
    };
    for (const h of HANDLES) {
      const el = document.createElement('span');
      el.className = `wy-crop-handle wy-crop-${h}`;
      el.dataset.handle = h;
      rect.append(el);
    }
    const bar = document.createElement('span');
    bar.className = 'wy-crop-bar';
    const mk = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wy-btn';
      b.textContent = label;
      b.title = title;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', fn);
      bar.append(b);
    };
    const close = () => {
      ui.remove();
      this.cropUi = null;
      this.endCrop = null;
      this.render();
    };
    const finish = (commit: boolean) => {
      close();
      if (commit) apply(normalizeCrop(draft), nat);
    };
    mk('✓', 'Apply crop', () => finish(true));
    mk('↺', 'Reset', () => ((draft = { left: 0, top: 0, right: 0, bottom: 0 }), draw()));
    mk('✕', 'Cancel', () => finish(false));
    ui.append(clip, rect, bar);
    this.dom.append(ui);
    this.cropUi = ui;
    this.endCrop = () => finish(false);
    draw();
    rect.focus();

    // Drag: handles resize edges, the body moves the rectangle.
    rect.addEventListener('pointerdown', (ev) => {
      if ((ev.target as HTMLElement).closest('.wy-crop-bar')) return;
      ev.preventDefault();
      rect.setPointerCapture?.(ev.pointerId);
      const handle = ((ev.target as HTMLElement).dataset.handle as Handle | undefined) ?? 'move';
      const startCrop = draft;
      const ox = ev.clientX;
      const oy = ev.clientY;
      const move = (e2: PointerEvent) => {
        draft = dragCrop(startCrop, handle, (e2.clientX - ox) / full.w, (e2.clientY - oy) / full.h);
        draw();
      };
      const up = () => {
        rect.removeEventListener('pointermove', move);
        rect.removeEventListener('pointerup', up);
      };
      rect.addEventListener('pointermove', move);
      rect.addEventListener('pointerup', up);
    });
    rect.addEventListener('keydown', (e) => {
      const step = (e.shiftKey ? 0.05 : 0.01);
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) (e.preventDefault(), (draft = dragCrop(draft, 'move', d[0], d[1])), draw());
      else if (e.key === 'Enter') (e.preventDefault(), finish(true));
      else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), finish(false));
    });
    return true;
  }

  private startResize(e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = (this.node.attrs.crop ? this.box : this.img).getBoundingClientRect().width;
    this.handle.setPointerCapture?.(e.pointerId);
    const width = (ev: PointerEvent) => Math.max(24, Math.min(2000, Math.round(startW + ev.clientX - startX)));
    const move = (ev: PointerEvent) => {
      const attrs = { ...this.node.attrs, width: width(ev) };
      this.node = this.node.type.create(attrs);
      this.render(); // live preview, also for cropped images
    };
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
    if (!this.cropUi) this.render();
    return true;
  }
  selectNode() { this.dom.classList.add('is-selected'); }
  deselectNode() {
    this.dom.classList.remove('is-selected');
    this.endCrop?.(); // leaving the image cancels an unfinished crop
  }
  stopEvent(e: Event) { return e.target === this.handle || !!this.cropUi?.contains(e.target as Node); }
  ignoreMutation() { return true; }
  destroy() { imageViews.delete(this.dom); }
}
