/**
 * .docx import/export. Lives in its own entry point (`wysiwyg-editor/docx`) so the `docx` and `mammoth`
 * libraries are only loaded by apps that need them.
 */
import * as D from 'docx';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { cropBytes, cropToString, type Crop } from './crop';
import type { Editor } from './editor';
import type { PageSettings } from './plugins/pages';
import type { CommentsPlugin, CommentThread } from './plugins/comments';

export interface ExportOptions {
  /** Include comments (defaults to the editor's Comments plugin store, if installed). */
  comments?: CommentThread[];
  /** Title in the document properties. */
  title?: string;
  /** Fetch remote images to embed them. Default true; failures fall back to the alt text. */
  fetchImages?: boolean;
}

interface ImageData { data: Uint8Array; type: 'png' | 'jpg' | 'gif'; width: number; height: number }

const PX_TO_TWIP = 15;
const px = (n: number) => Math.round(n * PX_TO_TWIP);
const hex = (c: string) => c.replace('#', '').toUpperCase();

/** Read width/height and format from PNG, JPEG or GIF bytes. */
export function imageInfo(b: Uint8Array): { type: 'png' | 'jpg' | 'gif'; width: number; height: number } | null {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { type: 'png', width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) {
    return { type: 'gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpg', height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
  }
  return null;
}

async function loadImage(src: string, fetchRemote: boolean): Promise<ImageData | null> {
  try {
    let bytes: Uint8Array;
    if (src.startsWith('data:')) {
      const comma = src.indexOf(',');
      if (comma < 0 || !/;base64$/i.test(src.slice(0, comma))) return null;
      const bin = atob(src.slice(comma + 1));
      bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } else if (fetchRemote && /^https?:/i.test(src)) {
      const res = await fetch(src);
      if (!res.ok) return null;
      bytes = new Uint8Array(await res.arrayBuffer());
    } else return null;
    const info = imageInfo(bytes);
    return info ? { data: bytes, ...info } : null;
  } catch {
    return null;
  }
}

const imageKey = (attrs: { src: string; crop?: Crop | null }) => (attrs.crop ? `${attrs.src}|${cropToString(attrs.crop)}` : attrs.src);

function collectImages(doc: PMNode): { key: string; src: string; crop: Crop | null }[] {
  const out = new Map<string, { key: string; src: string; crop: Crop | null }>();
  doc.descendants((n) => {
    if (n.type.name !== 'image') return;
    const key = imageKey(n.attrs as { src: string; crop?: Crop | null });
    out.set(key, { key, src: n.attrs.src, crop: n.attrs.crop ?? null });
  });
  return [...out.values()];
}

interface Ctx {
  images: Map<string, ImageData | null>;
  footnotes: Record<number, { children: D.Paragraph[] }>;
  numbering: D.ILevelsOptions[][];
  numberingRefs: string[];
  revision: number;
  author: string;
  commentIds: Map<string, number>;
  referenced: Set<string>;
  quote: number;
}

const ALIGN: Record<string, (typeof D.AlignmentType)[keyof typeof D.AlignmentType]> = {
  left: D.AlignmentType.LEFT,
  center: D.AlignmentType.CENTER,
  right: D.AlignmentType.RIGHT,
  justify: D.AlignmentType.JUSTIFIED,
};

function levels(format: 'decimal' | 'bullet', text?: string): D.ILevelsOptions[] {
  return Array.from({ length: 9 }, (_, level) => ({
    level,
    format: format === 'decimal' ? D.LevelFormat.DECIMAL : D.LevelFormat.BULLET,
    text: format === 'decimal' ? `%${level + 1}.` : text ?? (level % 2 ? '◦' : '•'),
    alignment: D.AlignmentType.START,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
}

function newNumbering(ctx: Ctx, format: 'decimal' | 'bullet', text?: string): string {
  const ref = `list-${ctx.numberingRefs.length}`;
  ctx.numberingRefs.push(ref);
  ctx.numbering.push(levels(format, text));
  return ref;
}

function runOptions(marks: readonly Mark[]) {
  const o: Record<string, unknown> = {};
  let link: string | null = null;
  let revision: 'insertion' | 'deletion' | null = null;
  for (const m of marks) {
    switch (m.type.name) {
      case 'bold': o.bold = true; break;
      case 'italic': o.italics = true; break;
      case 'underline': o.underline = {}; break;
      case 'strike': o.strike = true; break;
      case 'code': o.font = 'Courier New'; o.shading = { type: D.ShadingType.CLEAR, fill: 'F0F0F0', color: 'auto' }; break;
      case 'text_color': o.color = hex(m.attrs.color); break;
      case 'highlight': o.shading = { type: D.ShadingType.CLEAR, fill: hex(m.attrs.color), color: 'auto' }; break;
      case 'font_family': o.font = m.attrs.value; break;
      case 'font_size': o.size = Math.round(Number(m.attrs.value) * 1.5); break; // px -> half-points
      case 'link': link = m.attrs.href; o.color ??= '1D4ED8'; o.underline ??= {}; break;
      case 'insertion': revision = 'insertion'; break;
      case 'deletion': revision = 'deletion'; break;
    }
  }
  return { o, link, revision };
}

function footnoteText(ctx: Ctx, text: string): number {
  const id = Object.keys(ctx.footnotes).length + 1;
  ctx.footnotes[id] = { children: [new D.Paragraph({ children: [new D.TextRun(text)] })] };
  return id;
}

function inlineChildren(node: PMNode, ctx: Ctx): D.ParagraphChild[] {
  const out: D.ParagraphChild[] = [];
  // Comment ranges: open before the first run carrying a comment, close after the last one in this paragraph.
  const lastIndexOf = new Map<string, number>();
  node.forEach((child, _o, i) => child.marks.forEach((m) => m.type.name === 'comment' && lastIndexOf.set(m.attrs.id, i)));
  const open = new Set<string>();

  node.forEach((child, _offset, index) => {
    const ids = child.marks.filter((m) => m.type.name === 'comment').map((m) => m.attrs.id as string);
    for (const id of ids) {
      if (!open.has(id) && ctx.commentIds.has(id)) {
        open.add(id);
        out.push(new D.CommentRangeStart(ctx.commentIds.get(id)!));
      }
    }

    const { o, link, revision } = runOptions(child.marks);
    let run: D.ParagraphChild | null = null;
    if (child.isText) {
      const text = child.text!;
      if (revision === 'insertion') run = new D.InsertedTextRun({ id: ctx.revision++, author: ctx.author, date: new Date().toISOString(), text, ...o });
      else if (revision === 'deletion') run = new D.DeletedTextRun({ id: ctx.revision++, author: ctx.author, date: new Date().toISOString(), text, ...o });
      else run = new D.TextRun({ text, ...o });
    } else if (child.type.name === 'mention') {
      run = new D.TextRun({ text: `@${child.attrs.label}`, color: '1D4ED8', ...o });
    } else if (child.type.name === 'hard_break') {
      run = new D.TextRun({ break: 1 });
    } else if (child.type.name === 'footnote') {
      run = new D.FootnoteReferenceRun(footnoteText(ctx, child.attrs.text));
    } else if (child.type.name === 'image') {
      const img = ctx.images.get(imageKey(child.attrs as { src: string; crop?: Crop | null }));
      if (img) {
        const w = child.attrs.width ?? Math.min(img.width, 600);
        run = new D.ImageRun({
          type: img.type,
          data: img.data,
          transformation: { width: w, height: Math.max(1, Math.round((w * img.height) / img.width)) },
          altText: { name: 'image', title: child.attrs.alt ?? 'image', description: child.attrs.alt ?? '' },
        });
      } else run = new D.TextRun({ text: child.attrs.alt ? `[${child.attrs.alt}]` : '[image]', italics: true });
    }
    if (run) out.push(link ? new D.ExternalHyperlink({ link, children: [run as D.TextRun] }) : run);

    for (const id of ids) {
      if (open.has(id) && lastIndexOf.get(id) === index) {
        open.delete(id);
        const n = ctx.commentIds.get(id)!;
        out.push(new D.CommentRangeEnd(n));
        if (!ctx.referenced.has(id)) {
          ctx.referenced.add(id);
          out.push(new D.TextRun({ children: [new D.CommentReference(n)] }));
        }
      }
    }
  });
  return out;
}

function paragraphOptions(node: PMNode, ctx: Ctx) {
  const o: Record<string, unknown> = {};
  if (node.attrs.align && ALIGN[node.attrs.align]) o.alignment = ALIGN[node.attrs.align];
  if (node.attrs.lineHeight) o.spacing = { line: Math.round(Number(node.attrs.lineHeight) * 240), lineRule: D.LineRuleType.AUTO };
  if (ctx.quote) {
    o.indent = { left: 720 * ctx.quote };
    o.border = { left: { style: D.BorderStyle.SINGLE, size: 12, color: 'D4D4D4', space: 8 } };
  }
  return o;
}

type Block = D.Paragraph | D.Table | D.TableOfContents;

function listBlocks(list: PMNode, ctx: Ctx, depth: number): Block[] {
  const out: Block[] = [];
  const name = list.type.name;
  const ref = name === 'ordered_list' ? newNumbering(ctx, 'decimal') : name === 'bullet_list' ? newNumbering(ctx, 'bullet') : null;
  list.forEach((item) => {
    let first = true;
    const taskRef = name === 'task_list' ? newNumbering(ctx, 'bullet', item.attrs.checked ? '☑' : '☐') : null;
    item.forEach((child) => {
      if (child.type.name === 'paragraph' && first) {
        out.push(new D.Paragraph({ children: inlineChildren(child, ctx), numbering: { reference: (ref ?? taskRef)!, level: depth }, ...paragraphOptions(child, ctx) }));
      } else if (/_list$/.test(child.type.name)) {
        out.push(...listBlocks(child, ctx, depth + 1));
      } else {
        out.push(...blocks(child, ctx).map((b) => b));
      }
      first = false;
    });
  });
  return out;
}

function tableBlock(table: PMNode, ctx: Ctx): D.Table {
  const rows: D.TableRow[] = [];
  table.forEach((row) => {
    const cells: D.TableCell[] = [];
    let header = true;
    row.forEach((cell) => {
      if (cell.type.name !== 'table_header') header = false;
      const children: Block[] = [];
      cell.forEach((c) => children.push(...blocks(c, ctx)));
      if (!children.length) children.push(new D.Paragraph(''));
      const bg = cell.attrs.background as string | null;
      cells.push(
        new D.TableCell({
          children: children as D.Paragraph[],
          columnSpan: cell.attrs.colspan > 1 ? cell.attrs.colspan : undefined,
          rowSpan: cell.attrs.rowspan > 1 ? cell.attrs.rowspan : undefined,
          shading: bg ? { type: D.ShadingType.CLEAR, fill: hex(bg), color: 'auto' } : undefined,
        }),
      );
    });
    rows.push(new D.TableRow({ children: cells, tableHeader: header }));
  });
  return new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } });
}

function blocks(node: PMNode, ctx: Ctx): Block[] {
  switch (node.type.name) {
    case 'paragraph':
      return [new D.Paragraph({ children: inlineChildren(node, ctx), ...paragraphOptions(node, ctx) })];
    case 'heading':
      return [new D.Paragraph({ heading: D.HeadingLevel[`HEADING_${Math.min(6, node.attrs.level)}` as 'HEADING_1'], children: inlineChildren(node, ctx), ...paragraphOptions(node, ctx) })];
    case 'bullet_list':
    case 'ordered_list':
    case 'task_list':
      return listBlocks(node, ctx, 0);
    case 'locked_section':
    case 'editable_region': {
      // Locking is an editing concern; in Word the content is simply part of the document.
      const out: Block[] = [];
      node.forEach((c) => out.push(...blocks(c, ctx)));
      return out;
    }
    case 'blockquote': {
      ctx.quote++;
      const out: Block[] = [];
      node.forEach((c) => out.push(...blocks(c, ctx)));
      ctx.quote--;
      return out;
    }
    case 'code_block':
      return node.textContent.split('\n').map((line) => new D.Paragraph({ children: [new D.TextRun({ text: line, font: 'Courier New', size: 20 })], shading: { type: D.ShadingType.CLEAR, fill: 'F0F0F0', color: 'auto' } }));
    case 'horizontal_rule':
      return [new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } } })];
    case 'page_break':
      return [new D.Paragraph({ children: [new D.PageBreak()] })];
    case 'toc':
      return [new D.TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-4' })];
    case 'table':
      return [tableBlock(node, ctx), new D.Paragraph('')]; // Word needs a paragraph after a table
    default:
      return node.isTextblock ? [new D.Paragraph({ children: inlineChildren(node, ctx) })] : [];
  }
}

function headerFooterParagraph(template: string): D.Paragraph {
  const parts = template.split(/(\{page\}|\{pages\})/);
  const run: (string | (typeof D.PageNumber)[keyof typeof D.PageNumber])[] = parts
    .filter(Boolean)
    .map((p) => (p === '{page}' ? D.PageNumber.CURRENT : p === '{pages}' ? D.PageNumber.TOTAL_PAGES : p));
  return new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ children: run, color: '9CA3AF', size: 18 })] });
}

/** Build a docx `Document` from the editor's content, page setup, footnotes, comments and tracked changes. */
export async function buildDocx(editor: Editor, options: ExportOptions = {}): Promise<D.Document> {
  const doc = editor.view.state.doc;
  const page = (editor.extensions.pageSettings as (() => PageSettings) | undefined)?.();
  const store = (editor.config.plugins.find((p) => p.name === 'comments') as CommentsPlugin | undefined)?.store;
  const threads = options.comments ?? store?.list() ?? [];
  const used = new Set<string>();
  doc.descendants((n) => void n.marks.forEach((m) => m.type.name === 'comment' && used.add(m.attrs.id)));
  const exported = threads.filter((t) => used.has(t.id));

  const images = new Map<string, ImageData | null>();
  await Promise.all(
    collectImages(doc).map(async ({ key, src, crop }) => {
      let img = await loadImage(src, options.fetchImages !== false);
      if (img && crop) {
        // Word needs the cropped pixels; render them with canvas. Without canvas the full image is exported.
        const cropped = await cropBytes(img.data, crop);
        if (cropped) img = { data: cropped.data, type: 'png', width: cropped.width, height: cropped.height };
      }
      images.set(key, img);
    }),
  );

  const ctx: Ctx = {
    images,
    footnotes: {},
    numbering: [],
    numberingRefs: [],
    revision: 1,
    author: 'Author',
    commentIds: new Map(exported.map((t, i) => [t.id, i])),
    referenced: new Set(),
    quote: 0,
  };
  const children: Block[] = [];
  doc.forEach((n) => children.push(...blocks(n, ctx)));
  if (!children.length) children.push(new D.Paragraph(''));

  const w = page?.width ?? 794;
  const h = page?.height ?? 1123;
  const landscape = page?.orientation === 'landscape';
  const m = page?.margins ?? { top: 96, right: 96, bottom: 96, left: 96 };
  const headerTpl = page?.header ?? '';
  const footerTpl = page ? page.footer : '';

  return new D.Document({
    creator: 'wysiwyg-editor',
    title: options.title,
    features: { updateFields: doc.content.content.some((n) => n.type.name === 'toc') },
    numbering: { config: ctx.numbering.map((lv, i) => ({ reference: ctx.numberingRefs[i], levels: lv })) },
    footnotes: ctx.footnotes,
    comments: {
      children: exported.map((t, i) => ({
        id: i,
        author: t.author,
        date: new Date(t.createdAt),
        children: [t.text, ...t.replies.map((r) => `${r.author}: ${r.text}`)].map((text) => new D.Paragraph(text)),
      })),
    },
    sections: [
      {
        properties: {
          titlePage: page?.differentFirstPage,
          page: {
            size: { width: px(Math.min(w, h)), height: px(Math.max(w, h)), orientation: landscape ? D.PageOrientation.LANDSCAPE : D.PageOrientation.PORTRAIT },
            margin: { top: px(m.top), right: px(m.right), bottom: px(m.bottom), left: px(m.left) },
          },
        },
        headers: {
          default: new D.Header({ children: [headerFooterParagraph(headerTpl)] }),
          ...(page?.differentFirstPage ? { first: new D.Header({ children: [headerFooterParagraph(page.firstHeader)] }) } : {}),
        },
        footers: {
          default: new D.Footer({ children: [headerFooterParagraph(footerTpl)] }),
          ...(page?.differentFirstPage ? { first: new D.Footer({ children: [headerFooterParagraph(page.firstFooter)] }) } : {}),
        },
        children: children as D.Paragraph[],
      },
    ],
  });
}

/** Export the document as a .docx `Blob`. */
export async function exportDocx(editor: Editor, options: ExportOptions = {}): Promise<Blob> {
  return D.Packer.toBlob(await buildDocx(editor, options));
}

function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

/** Replace the editor content with a .docx file's content (undoable). Returns mammoth's conversion warnings. */
export async function importDocx(editor: Editor, source: Blob | ArrayBuffer): Promise<string[]> {
  const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
  const arrayBuffer = source instanceof ArrayBuffer ? source : await blobToArrayBuffer(source);
  // mammoth's browser build reads `arrayBuffer`, its Node build reads `buffer`; pass what the runtime has.
  const input = { arrayBuffer, ...(typeof Buffer !== 'undefined' ? { buffer: Buffer.from(arrayBuffer) } : {}) };
  const result = await mammoth.convertToHtml(
    input as { arrayBuffer: ArrayBuffer },
    { styleMap: ['u => u', 'strike => s', "p[style-name='Quote'] => blockquote:fresh"] },
  );
  editor.replaceHTML(result.value);
  return result.messages.map((m: { message: string }) => m.message);
}
