/**
 * PowerPoint (.pptx) export and import for the presentation app, with no library: the package is written with the stored-zip writer
 * of `data-table.ts` and read with its bounded zip reader, the XML is parsed with the browser's `DOMParser`.
 *
 * Export writes text boxes, shapes (nearest preset shape), pictures (png, jpeg, gif), notes, backgrounds, links, bullets and
 * numbering. Import reads the same things back and ignores everything else (tables, charts, SmartArt, video, animations, master
 * shapes), counting what it left out. Everything that comes in goes through `cleanDeck`, so nothing unvalidated survives.
 */

import { openZip, zipStore, type ZipLimits } from './data-table';
import { cleanDeck, cleanHTML, themeOf, type Deck, type DeckTheme, type ShapeKind, type SlideEl } from './presentation-model';

const EMU = 9525;                                    // EMU per slide pixel (96 dpi)
const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NSDECL = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

const ILLEGAL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;
const clean = (s: unknown): string => String(s ?? '').replace(ILLEGAL, '');
const esc = (s: unknown): string => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const emu = (px: number): number => Math.round((Number.isFinite(px) ? px : 0) * EMU);

// ---- colours ---------------------------------------------------------------------------------------------------------------------

const NAMED: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', green: '008000', lime: '00ff00', blue: '0000ff', yellow: 'ffff00', orange: 'ffa500', purple: '800080',
  gray: '808080', grey: '808080', silver: 'c0c0c0', maroon: '800000', navy: '000080', teal: '008080', aqua: '00ffff', cyan: '00ffff', fuchsia: 'ff00ff',
  magenta: 'ff00ff', pink: 'ffc0cb', brown: 'a52a2a', gold: 'ffd700', olive: '808000', indigo: '4b0082', violet: 'ee82ee', crimson: 'dc143c', coral: 'ff7f50',
  tomato: 'ff6347', salmon: 'fa8072', khaki: 'f0e68c', beige: 'f5f5dc', ivory: 'fffff0', lavender: 'e6e6fa', turquoise: '40e0d0', tan: 'd2b48c',
};

/** A CSS colour as six hex digits (no #) and an alpha from 0 to 1, or null when it cannot be worked out. */
function toHex(c: string | null | undefined): { hex: string; alpha: number } | null {
  if (!c) return null;
  const t = c.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    const h = m[1];
    if (h.length === 3 || h.length === 4) return { hex: h.slice(0, 3).split('').map((x) => x + x).join(''), alpha: h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1 };
    if (h.length === 6) return { hex: h, alpha: 1 };
    if (h.length === 8) return { hex: h.slice(0, 6), alpha: parseInt(h.slice(6), 16) / 255 };
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)(?:[\s,/]+([\d.]+)(%?))?\s*\)$/.exec(t);
  if (m) {
    const ch = (v: string, pct: string) => Math.max(0, Math.min(255, Math.round(pct ? (Number(v) * 255) / 100 : Number(v))));
    const hex = [ch(m[1], m[2]), ch(m[3], m[4]), ch(m[5], m[6])].map((n) => n.toString(16).padStart(2, '0')).join('');
    const a = m[7] === undefined ? 1 : Math.max(0, Math.min(1, m[8] ? Number(m[7]) / 100 : Number(m[7])));
    return { hex, alpha: a };
  }
  if (NAMED[t]) return { hex: NAMED[t], alpha: 1 };
  return null;
}

// ---- export ----------------------------------------------------------------------------------------------------------------------

const PRESET: Record<ShapeKind, string> = {
  rect: 'rect', round: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', diamond: 'diamond', pentagon: 'pentagon', hexagon: 'hexagon',
  star: 'star5', arrow: 'rightArrow', chevron: 'chevron', callout: 'wedgeRectCallout', line: 'line',
};

const GENERIC_FONTS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'cursive', 'fantasy', 'inherit', 'initial']);
/** The first real family name of a CSS font list. */
function firstFont(list: string | undefined): string | undefined {
  if (!list) return undefined;
  for (const part of list.split(',')) {
    const f = part.trim().replace(/^["']|["']$/g, '').trim();
    if (f && !GENERIC_FONTS.has(f.toLowerCase())) return f.slice(0, 80);
  }
  return undefined;
}

interface Fmt { b?: 1; i?: 1; u?: 1; s?: 1; sup?: 1; sub?: 1; mark?: 1; color?: string; size?: number; font?: string; href?: string }
type Piece = { text: string; f: Fmt } | 'br';
interface Para { pieces: Piece[]; list?: 'bullet' | 'number'; align?: string; empty?: boolean }

function cssSize(v: string, base: number): number | undefined {
  const m = /^(\d+(?:\.\d+)?)(px|pt|em|rem|%)$/.exec(v.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return m[2] === 'px' ? n : m[2] === 'pt' ? (n * 4) / 3 : m[2] === '%' ? (base * n) / 100 : base * n;
}

/** The paragraphs of the (clean) HTML of a box, each with its runs. */
function paragraphsOf(html: string, baseSize: number): Para[] {
  const out: Para[] = [];
  if (!html) return out;
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  let cur: Para = { pieces: [] };
  const flush = (list?: Para['list'], align?: string) => {
    while (cur.pieces.length && cur.pieces[cur.pieces.length - 1] === 'br') cur.pieces.pop();
    if (cur.pieces.length || cur.empty) out.push(cur);
    cur = { pieces: [], list, align };
  };
  const walk = (n: Node, f: Fmt, list: Para['list'], align: string | undefined) => {
    for (const c of Array.from(n.childNodes)) {
      if (c.nodeType === 3) {
        const text = clean(c.textContent).replace(/[\r\n]+/g, ' ');
        if (text && (cur.pieces.length || text.trim())) cur.pieces.push({ text, f });
        continue;
      }
      if (c.nodeType !== 1) continue;
      const e = c as HTMLElement;
      const tag = e.tagName;
      if (tag === 'BR') { if (cur.pieces.length) cur.pieces.push('br'); else cur.empty = true; continue; }
      const block = tag === 'P' || tag === 'DIV' || tag === 'LI' || tag === 'UL' || tag === 'OL';
      const nf: Fmt = { ...f };
      if (tag === 'B' || tag === 'STRONG') nf.b = 1;
      if (tag === 'I' || tag === 'EM') nf.i = 1;
      if (tag === 'U') nf.u = 1;
      if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') nf.s = 1;
      if (tag === 'SUP') nf.sup = 1;
      if (tag === 'SUB') nf.sub = 1;
      if (tag === 'MARK') nf.mark = 1;
      if (tag === 'A') { const h = e.getAttribute('href') ?? ''; if (/^(https?:|mailto:|tel:)/i.test(h.trim())) nf.href = h.trim(); }
      const st = e.style;
      if (st) {
        const col = st.getPropertyValue('color'); if (col && toHex(col)) nf.color = col;
        const fs = st.getPropertyValue('font-size'); if (fs) { const px = cssSize(fs, f.size ?? baseSize); if (px) nf.size = px; }
        const ff = firstFont(st.getPropertyValue('font-family')); if (ff) nf.font = ff;
        const fw = st.getPropertyValue('font-weight'); if (fw === 'bold' || Number(fw) >= 600) nf.b = 1;
        if (st.getPropertyValue('font-style') === 'italic') nf.i = 1;
        const td = st.getPropertyValue('text-decoration') || st.getPropertyValue('text-decoration-line');
        if (/underline/.test(td)) nf.u = 1;
        if (/line-through/.test(td)) nf.s = 1;
      }
      if (block) {
        flush(list, align);
        const l2: Para['list'] = tag === 'LI' ? (e.parentElement?.tagName === 'OL' ? 'number' : 'bullet') : list;
        const al = st?.getPropertyValue('text-align') || align;
        cur.list = l2; cur.align = al;
        walk(e, nf, l2, al);
        flush(list, align);
      } else walk(e, nf, list, align);
    }
  };
  walk(doc.body, {}, undefined, undefined);
  flush();
  return out;
}

interface SlideCtx {
  deck: Deck;
  theme: DeckTheme;
  rels: { id: string; type: string; target: string; external?: boolean }[];
  link(url: string): string;
  media(src: string): { rid: string; w: number; h: number } | null;
  nextId(): number;
}

const fillXml = (hex: { hex: string; alpha: number } | null, opacity = 1): string => {
  if (!hex) return '';
  const a = Math.round(hex.alpha * opacity * 100000);
  return `<a:solidFill><a:srgbClr val="${hex.hex.toUpperCase()}">${a < 100000 ? `<a:alpha val="${Math.max(0, a)}"/>` : ''}</a:srgbClr></a:solidFill>`;
};

function runXml(text: string, f: Fmt, base: { size: number; color?: string; font?: string; b?: 1; i?: 1; u?: 1; s?: 1 }, ctx: SlideCtx, opacity: number): string {
  const size = Math.max(100, Math.min(400000, Math.round((f.size ?? base.size) * 75)));
  const attrs = [`lang="en-US"`, `sz="${size}"`];
  if (f.b ?? base.b) attrs.push('b="1"');
  if (f.i ?? base.i) attrs.push('i="1"');
  if (f.u ?? base.u) attrs.push('u="sng"');
  if (f.s ?? base.s) attrs.push('strike="sngStrike"');
  if (f.sup) attrs.push('baseline="30000"'); else if (f.sub) attrs.push('baseline="-25000"');
  attrs.push('dirty="0"');
  const color = toHex(f.color ?? base.color) ?? toHex(ctx.theme.fg);
  const font = f.font ?? base.font;
  let inner = fillXml(color, opacity);
  if (f.mark) inner += '<a:highlight><a:srgbClr val="FDE68A"/></a:highlight>';
  if (font) inner += `<a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/>`;
  if (f.href) inner += `<a:hlinkClick r:id="${ctx.link(f.href)}"/>`;
  return `<a:r><a:rPr ${attrs.join(' ')}>${inner}</a:rPr><a:t>${esc(text)}</a:t></a:r>`;
}

function txBody(e: SlideEl, ctx: SlideCtx, kind: 'text' | 'shape'): string {
  const s = e.style ?? {};
  const baseSize = s.size ?? (e.ph === 'title' ? 44 : 28);
  const base = { size: baseSize, color: s.color ?? (e.ph === 'subtitle' ? ctx.theme.muted : undefined), font: s.font ? firstFont(s.font) : e.ph === 'title' ? firstFont(ctx.theme.heading) : undefined, b: s.b, i: s.i, u: s.u, s: s.s };
  const opacity = e.opacity ?? 1;
  const anchor = s.valign === 'middle' ? 'ctr' : s.valign === 'bottom' ? 'b' : 't';
  const ins = kind === 'shape' ? 57150 : 0;
  const body = `<a:bodyPr wrap="square" lIns="${ins}" tIns="${ins}" rIns="${ins}" bIns="${ins}" rtlCol="0" anchor="${anchor}">${s.fit ? '<a:normAutofit/>' : '<a:noAutofit/>'}</a:bodyPr><a:lstStyle/>`;
  const paras = paragraphsOf(e.html ?? '', baseSize);
  const xml = paras.map((p) => {
    const list = p.list ?? (s.bullets === 'bullet' || s.bullets === 'number' ? s.bullets : undefined);
    const algn = p.align ?? s.align ?? 'left';
    const a = algn === 'center' ? 'ctr' : algn === 'right' ? 'r' : algn === 'justify' ? 'just' : 'l';
    const attrs = [`algn="${a}"`];
    let inner = '';
    if (s.line && s.line !== 1.2) inner += `<a:lnSpc><a:spcPct val="${Math.round((s.line / 1.2) * 100000)}"/></a:lnSpc>`;
    if (list) {
      const mar = Math.round(baseSize * 1.2 * EMU);
      attrs.push(`marL="${mar}"`, `indent="${-mar}"`);
      inner += list === 'bullet' ? '<a:buFont typeface="Arial"/><a:buChar char="&#8226;"/>' : '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>';
    } else inner += '<a:buNone/>';
    const runs = p.pieces.map((x) => (x === 'br' ? `<a:br><a:rPr lang="en-US" sz="${Math.round(baseSize * 75)}"/></a:br>` : runXml(x.text, x.f, base, ctx, opacity))).join('');
    return `<a:p><a:pPr ${attrs.join(' ')}>${inner}</a:pPr>${runs}<a:endParaRPr lang="en-US" sz="${Math.round(baseSize * 75)}" dirty="0"/></a:p>`;
  }).join('');
  return `<p:txBody>${body}${xml || '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>'}</p:txBody>`;
}

const xfrmXml = (x: number, y: number, w: number, h: number, rot?: number): string => {
  const r = rot ? Math.round((((rot % 360) + 360) % 360) * 60000) : 0;
  return `<a:xfrm${r ? ` rot="${r}"` : ''}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>`;
};

function textShape(e: SlideEl, ctx: SlideCtx, label: string, extra?: { dashed?: boolean }): string {
  const id = ctx.nextId();
  const isShape = e.type === 'shape';
  const kind: ShapeKind = isShape ? e.shape ?? 'rect' : 'rect';
  const line = kind === 'line';
  const opacity = e.opacity ?? 1;
  const fill = !line && e.type === 'shape' ? toHex(e.fill ?? undefined) : null;
  const stroke = toHex(e.stroke ?? undefined);
  const sw = e.strokeW ?? 0;
  let ln = '<a:ln><a:noFill/></a:ln>';
  if (extra?.dashed) ln = `<a:ln w="12700">${fillXml(toHex(ctx.theme.muted))}<a:prstDash val="dash"/></a:ln>`;
  else if (stroke && sw > 0) ln = `<a:ln w="${emu(sw)}" cap="${line ? 'rnd' : 'flat'}">${fillXml(stroke, opacity)}<a:round/></a:ln>`;
  const shadow = e.shadow ? '<a:effectLst><a:outerShdw blurRad="127000" dist="63500" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst>' : '';
  const geo = line
    ? xfrmXml(e.x, e.y + e.h / 2, e.w, 0, e.rot)
    : xfrmXml(e.x, e.y, e.w, e.h, e.rot);
  const spFill = fill ? fillXml(fill, opacity) : '<a:noFill/>';
  const hasText = e.type === 'text' || !line;
  const descr = e.alt ? ` descr="${esc(e.alt)}"` : '';
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(label)} ${id}"${descr}/><p:cNvSpPr${e.type === 'text' ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>`
    + `<p:spPr>${geo}<a:prstGeom prst="${PRESET[kind]}"><a:avLst/></a:prstGeom>${spFill}${ln}${shadow}</p:spPr>${hasText ? txBody(e, ctx, e.type === 'text' ? 'text' : 'shape') : ''}</p:sp>`;
}

// ---- picture helpers ----

function decodeDataUrl(src: string): { ext: 'png' | 'jpeg' | 'gif'; bytes: Uint8Array } | null {
  const m = /^data:image\/(png|jpe?g|gif);base64,/i.exec(src.slice(0, 40));
  if (!m) return null;
  let bin: string;
  try { bin = atob(src.slice(m[0].length).replace(/\s+/g, '')); } catch { return null; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = sniff(bytes);
  return ext === 'png' || ext === 'jpeg' || ext === 'gif' ? { ext, bytes } : null;
}

/** What kind of picture the bytes really are (by their first bytes, never by a name). */
function sniff(b: Uint8Array): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

function pictureSize(b: Uint8Array, ext: string): { w: number; h: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (ext === 'png') return { w: v.getUint32(16), h: v.getUint32(20) };
    if (ext === 'gif') return { w: v.getUint16(6, true), h: v.getUint16(8, true) };
    if (ext === 'jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1];
        if (mk >= 0xc0 && mk <= 0xcf && mk !== 0xc4 && mk !== 0xc8 && mk !== 0xcc) return { w: v.getUint16(i + 7), h: v.getUint16(i + 5) };
        i += 2 + v.getUint16(i + 2);
      }
    }
  } catch { /* short file */ }
  return null;
}

function pictureXml(e: SlideEl, ctx: SlideCtx): string {
  const m = ctx.media(e.src ?? '');
  if (!m) {
    const raw = e.src ?? '';
    const what = /^https?:/i.test(raw) ? `Picture not embedded: ${raw.slice(0, 200)}` : /^data:image\/svg/i.test(raw) ? 'Picture not embedded: SVG pictures cannot be exported' : 'Picture not embedded';
    return textShape({ ...e, type: 'text', html: `<div>${what.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)}</div>`, style: { size: 14, color: ctx.theme.muted, align: 'center', valign: 'middle', fit: 1 }, opacity: 1 }, ctx, 'Picture placeholder', { dashed: true });
  }
  const id = ctx.nextId();
  let x = e.x, y = e.y, w = e.w, h = e.h;
  let crop = '';
  const fit = e.fit ?? 'contain';
  if (m.w > 0 && m.h > 0 && fit !== 'fill') {
    if (fit === 'contain') {
      const k = Math.min(e.w / m.w, e.h / m.h);
      w = m.w * k; h = m.h * k; x = e.x + (e.w - w) / 2; y = e.y + (e.h - h) / 2;
    } else {
      const k = Math.max(e.w / m.w, e.h / m.h);
      const vw = e.w / (m.w * k), vh = e.h / (m.h * k);
      const lr = Math.round(((1 - vw) / 2) * 100000), tb = Math.round(((1 - vh) / 2) * 100000);
      if (lr > 0 || tb > 0) crop = `<a:srcRect l="${lr}" t="${tb}" r="${lr}" b="${tb}"/>`;
    }
  }
  const alpha = e.opacity !== undefined && e.opacity < 1 ? `<a:alphaModFix amt="${Math.round(e.opacity * 100000)}"/>` : '';
  const shadow = e.shadow ? '<a:effectLst><a:outerShdw blurRad="127000" dist="63500" dir="5400000" algn="t" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst>' : '';
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="Picture ${id}" descr="${esc(e.alt ?? '')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
    + `<p:blipFill><a:blip r:embed="${m.rid}">${alpha}</a:blip>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
    + `<p:spPr>${xfrmXml(x, y, w, h, e.rot)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${shadow}</p:spPr></p:pic>`;
}

// ---- parts ----

const GRP = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

function themeXml(t: DeckTheme, name: string): string {
  const c = (v: string, d: string) => (toHex(v)?.hex ?? d).toUpperCase();
  const major = firstFont(t.heading) ?? 'Calibri', minor = firstFont(t.body) ?? 'Calibri';
  const fills = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>'.repeat(3);
  const lns = [6350, 12700, 19050].map((w) => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`).join('');
  return `${XML_HEAD}<a:theme xmlns:a="${NS_A}" name="${esc(name)}"><a:themeElements><a:clrScheme name="${esc(name)}">`
    + `<a:dk1><a:srgbClr val="${c(t.fg, '1F2937')}"/></a:dk1><a:lt1><a:srgbClr val="${c(t.bg, 'FFFFFF')}"/></a:lt1><a:dk2><a:srgbClr val="${c(t.muted, '6B7280')}"/></a:dk2><a:lt2><a:srgbClr val="${c(t.bg, 'FFFFFF')}"/></a:lt2>`
    + `<a:accent1><a:srgbClr val="${c(t.accent, '2563EB')}"/></a:accent1><a:accent2><a:srgbClr val="${c(t.accent2, 'F59E0B')}"/></a:accent2><a:accent3><a:srgbClr val="10B981"/></a:accent3><a:accent4><a:srgbClr val="EF4444"/></a:accent4><a:accent5><a:srgbClr val="8B5CF6"/></a:accent5><a:accent6><a:srgbClr val="06B6D4"/></a:accent6>`
    + `<a:hlink><a:srgbClr val="${c(t.accent, '2563EB')}"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>`
    + `<a:fontScheme name="${esc(name)}"><a:majorFont><a:latin typeface="${esc(major)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${esc(minor)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
    + `<a:fmtScheme name="${esc(name)}"><a:fillStyleLst>${fills}</a:fillStyleLst><a:lnStyleLst>${lns}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${fills}</a:bgFillStyleLst></a:fmtScheme>`
    + `</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
}

const rels = (items: { id: string; type: string; target: string; external?: boolean }[]): string =>
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${esc(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

const bgXml = (hex: string): string => `<p:bg><p:bgPr>${fillXml({ hex, alpha: 1 })}<a:effectLst/></p:bgPr></p:bg>`;

const lvl = (sz: number) => Array.from({ length: 9 }, (_, i) => `<a:lvl${i + 1}pPr marL="${i * 457200}" algn="l"><a:defRPr sz="${sz}"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl${i + 1}pPr>`).join('');

/** The deck as a PowerPoint file. */
/**
 * PowerPoint cannot show an SVG picture from a data address, so each one is drawn to a canvas and written as a PNG. An SVG used as an
 * image runs no script and loads nothing, so this is safe; where there is no canvas (a test runner) the picture stays a placeholder.
 */
async function rasterizeSvg(src: string): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  try {
    const probe = document.createElement('canvas');
    let drawable: CanvasRenderingContext2D | null = null;
    try { drawable = probe.getContext('2d'); } catch { /* no canvas here */ }
    if (!drawable) return null;
    const img = new Image();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('svg')); timer = setTimeout(() => fail(new Error('slow')), 4000); img.src = src; }).finally(() => clearTimeout(timer));
    const k = Math.min(1, 2400 / Math.max(1, img.naturalWidth || 1280, img.naturalHeight || 720));
    const w = Math.max(1, Math.round((img.naturalWidth || 1280) * k)); const h = Math.max(1, Math.round((img.naturalHeight || 720) * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const url = c.toDataURL('image/png');
    return url.startsWith('data:image/png') ? url : null;
  } catch { return null; }
}

export async function deckToPptx(deck: Deck): Promise<Uint8Array> {
  const raster = new Map<string, string>();
  for (const sl of deck.slides.slice(0, 500)) for (const e of sl.els.slice(0, 500)) {
    if (e.src && /^data:image\/svg/i.test(e.src) && !raster.has(e.src)) { const png = await rasterizeSvg(e.src); if (png) raster.set(e.src, png); }
  }
  const enc = new TextEncoder();
  const theme = themeOf(deck);
  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, text: string) => files.push({ name, data: enc.encode(text) });
  const media = new Map<string, { name: string; ext: string; bytes: Uint8Array; w: number; h: number }>();
  const overrides: { part: string; type: string }[] = [];
  const CT = 'application/vnd.openxmlformats-officedocument';
  const slides = deck.slides.slice(0, 500);
  const noted = slides.map((s) => !!(s.notes && clean(s.notes).trim()));

  const bgHex = toHex(theme.bg)?.hex ?? 'ffffff';
  slides.forEach((s, i) => {
    const rl: { id: string; type: string; target: string; external?: boolean }[] = [{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }];
    const links = new Map<string, string>();
    let idc = 1;
    let rc = 1;
    const ctx: SlideCtx = {
      deck, theme, rels: rl,
      nextId: () => ++idc,
      link(url) {
        let id = links.get(url);
        if (!id) { id = `rId${++rc}`; links.set(url, id); rl.push({ id, type: 'hyperlink', target: clean(url), external: true }); }
        return id;
      },
      media(src) {
        const d = decodeDataUrl(raster.get(src) ?? src);
        if (!d) return null;
        let m = media.get(src);
        if (!m) {
          const dim = pictureSize(d.bytes, d.ext);
          m = { name: `image${media.size + 1}.${d.ext}`, ext: d.ext, bytes: d.bytes, w: dim?.w ?? 0, h: dim?.h ?? 0 };
          media.set(src, m);
        }
        const key = `media:${m.name}`;
        let id = links.get(key);
        if (!id) { id = `rId${++rc}`; links.set(key, id); rl.push({ id, type: 'image', target: `../media/${m.name}` }); }
        return { rid: id, w: m.w, h: m.h };
      },
    };
    const body = s.els.slice(0, 500).map((e) => {
      if (e.type === 'image') return pictureXml(e, ctx);
      return textShape(e, ctx, e.type === 'text' ? 'TextBox' : 'Shape');
    }).join('');
    if (noted[i]) rl.push({ id: `rId${++rc}`, type: 'notesSlide', target: `../notesSlides/notesSlide${i + 1}.xml` });
    const bg = s.bg ? toHex(s.bg) : null;
    add(`ppt/slides/slide${i + 1}.xml`, `${XML_HEAD}<p:sld ${NSDECL}${s.hidden ? ' show="0"' : ''}><p:cSld>${bg ? bgXml(bg.hex) : ''}<p:spTree>${GRP}${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    add(`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels(rl));
    overrides.push({ part: `/ppt/slides/slide${i + 1}.xml`, type: `${CT}.presentationml.slide+xml` });
    if (noted[i]) {
      const lines = clean(s.notes).slice(0, 20000).split(/\r?\n/);
      const paras = lines.map((l) => (l ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>')).join('');
      add(`ppt/notesSlides/notesSlide${i + 1}.xml`, `${XML_HEAD}<p:notes ${NSDECL}><p:cSld><p:spTree>${GRP}`
        + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>`
        + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp>`
        + `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`);
      add(`ppt/notesSlides/_rels/notesSlide${i + 1}.xml.rels`, rels([{ id: 'rId1', type: 'notesMaster', target: '../notesMasters/notesMaster1.xml' }, { id: 'rId2', type: 'slide', target: `../slides/slide${i + 1}.xml` }]));
      overrides.push({ part: `/ppt/notesSlides/notesSlide${i + 1}.xml`, type: `${CT}.presentationml.notesSlide+xml` });
    }
  });

  const anyNotes = noted.some(Boolean);
  const clrMap = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
  add('ppt/slideMasters/slideMaster1.xml', `${XML_HEAD}<p:sldMaster ${NSDECL}><p:cSld>${bgXml(bgHex)}<p:spTree>${GRP}</p:spTree></p:cSld><p:clrMap ${clrMap}/>`
    + `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>`
    + `<p:txStyles><p:titleStyle>${lvl(4400).replace(/<a:lvl([2-9])pPr.*$/, '')}</p:titleStyle><p:bodyStyle>${lvl(2800)}</p:bodyStyle><p:otherStyle>${lvl(1800)}</p:otherStyle></p:txStyles></p:sldMaster>`);
  add('ppt/slideMasters/_rels/slideMaster1.xml.rels', rels([{ id: 'rId1', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' }, { id: 'rId2', type: 'theme', target: '../theme/theme1.xml' }]));
  add('ppt/slideLayouts/slideLayout1.xml', `${XML_HEAD}<p:sldLayout ${NSDECL} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${GRP}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
  add('ppt/slideLayouts/_rels/slideLayout1.xml.rels', rels([{ id: 'rId1', type: 'slideMaster', target: '../slideMasters/slideMaster1.xml' }]));
  add('ppt/theme/theme1.xml', themeXml(theme, theme.label));
  overrides.push(
    { part: '/ppt/presentation.xml', type: `${CT}.presentationml.presentation.main+xml` },
    { part: '/ppt/slideMasters/slideMaster1.xml', type: `${CT}.presentationml.slideMaster+xml` },
    { part: '/ppt/slideLayouts/slideLayout1.xml', type: `${CT}.presentationml.slideLayout+xml` },
    { part: '/ppt/theme/theme1.xml', type: `${CT}.theme+xml` },
  );
  if (anyNotes) {
    add('ppt/notesMasters/notesMaster1.xml', `${XML_HEAD}<p:notesMaster ${NSDECL}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${GRP}`
      + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>`
      + `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>`
      + `</p:spTree></p:cSld><p:clrMap ${clrMap}/><p:notesStyle>${lvl(1200).replace(/<a:lvl([2-9])pPr.*$/, '')}</p:notesStyle></p:notesMaster>`);
    add('ppt/notesMasters/_rels/notesMaster1.xml.rels', rels([{ id: 'rId1', type: 'theme', target: '../theme/theme2.xml' }]));
    add('ppt/theme/theme2.xml', themeXml(theme, theme.label));
    overrides.push({ part: '/ppt/notesMasters/notesMaster1.xml', type: `${CT}.presentationml.notesMaster+xml` }, { part: '/ppt/theme/theme2.xml', type: `${CT}.theme+xml` });
  }

  const pres = [{ id: 'rId1', type: 'slideMaster', target: 'slideMasters/slideMaster1.xml' }, { id: 'rId2', type: 'theme', target: 'theme/theme1.xml' }];
  if (anyNotes) pres.push({ id: 'rId3', type: 'notesMaster', target: 'notesMasters/notesMaster1.xml' });
  slides.forEach((_, i) => pres.push({ id: `rId${10 + i}`, type: 'slide', target: `slides/slide${i + 1}.xml` }));
  const w = Math.max(1, Math.round(deck.width)), h = Math.max(1, Math.round(deck.height));
  add('ppt/presentation.xml', `${XML_HEAD}<p:presentation ${NSDECL} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>`
    + (anyNotes ? '<p:notesMasterIdLst><p:notesMasterId r:id="rId3"/></p:notesMasterIdLst>' : '')
    + `<p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('')}</p:sldIdLst>`
    + `<p:sldSz cx="${emu(w)}" cy="${emu(h)}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`);
  add('ppt/_rels/presentation.xml.rels', rels(pres));

  add('docProps/core.xml', `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(deck.title ?? '')}</dc:title></cp:coreProperties>`);
  add('docProps/app.xml', `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office PowerPoint</Application><Slides>${slides.length}</Slides></Properties>`);
  overrides.push({ part: '/docProps/core.xml', type: 'application/vnd.openxmlformats-package.core-properties+xml' }, { part: '/docProps/app.xml', type: `${CT}.extended-properties+xml` });
  add('_rels/.rels', rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }, { id: 'rId2', type: 'extended-properties', target: 'docProps/app.xml' }])
    .replace('</Relationships>', `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`));

  const exts = new Set<string>();
  for (const m of media.values()) { files.push({ name: `ppt/media/${m.name}`, data: m.bytes }); exts.add(m.ext); }
  const ctXml = `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + [...exts].map((x) => `<Default Extension="${x}" ContentType="image/${x}"/>`).join('')
    + overrides.map((o) => `<Override PartName="${o.part}" ContentType="${o.type}"/>`).join('') + '</Types>';
  return zipStore([{ name: '[Content_Types].xml', data: enc.encode(ctXml) }, ...files]);
}

// ---- import ----------------------------------------------------------------------------------------------------------------------

const LIMITS: ZipLimits = { maxTotal: 150 * 1024 * 1024, maxEntries: 2000, maxRatio: 1000, message: 'This .pptx file is too large or not safe to open' };
const MAX_SLIDES = 500, MAX_EL = 500, MAX_PICTURE = 15 * 1024 * 1024, MAX_PICTURES_TOTAL = 100 * 1024 * 1024, MAX_XML = 20 * 1024 * 1024;
const NOT_PPTX = 'This is not a .pptx file';

const ln = (e: Element) => e.localName;
const kid = (e: Element | null | undefined, name: string): Element | null => { if (!e) return null; for (const c of Array.from(e.children)) if (ln(c) === name) return c; return null; };
const kids = (e: Element | null | undefined, name: string): Element[] => (e ? Array.from(e.children).filter((c) => ln(c) === name) : []);
const at = (e: Element | null | undefined, ...names: string[]): Element | null => { let c: Element | null | undefined = e; for (const n of names) c = kid(c, n); return c ?? null; };
const attrNum = (e: Element | null | undefined, name: string): number | undefined => { const v = e?.getAttribute(name); if (v === null || v === undefined || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const relId = (e: Element | null | undefined, name = 'id'): string | null => e?.getAttributeNS(NS_R, name) ?? e?.getAttribute(`r:${name}`) ?? null;

interface Rel { type: string; target: string; external: boolean }
interface Xf { a: number; b: number; c: number; d: number }   // x' = a*x + b ; y' = c*y + d

function resolvePath(base: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return null;
  const parts = target.startsWith('/') ? [] : base.split('/').slice(0, -1);
  for (const seg of target.replace(/^\/+/, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { if (!parts.length) return null; parts.pop(); } else parts.push(seg);
  }
  return parts.join('/');
}

const LABELS = {
  table: ['table', 'tables'], chart: ['chart', 'charts'], smartart: ['SmartArt graphic', 'SmartArt graphics'], object: ['embedded object', 'embedded objects'],
  video: ['video', 'videos'], audio: ['audio clip', 'audio clips'], freeform: ['freeform shape (kept only for its text)', 'freeform shapes (kept only for their text)'],
  animation: ['slide with animations (animations dropped)', 'slides with animations (animations dropped)'],
  picNotEmbedded: ['picture that is not embedded', 'pictures that are not embedded'], picTooBig: ['picture that is too large or missing', 'pictures that are too large or missing'],
  picFormat: ['picture in an unsupported format', 'pictures in an unsupported format'], elOver: ['element over the limit of 500 per slide', 'elements over the limit of 500 per slide'],
  slideOver: ['slide over the limit of 500', 'slides over the limit of 500'], slideBad: ['slide that could not be read', 'slides that could not be read'],
  nested: ['deeply nested group', 'deeply nested groups'], dropped: ['element that could not be kept', 'elements that could not be kept'],
} as const;
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const SCHEME: Record<string, string> = { tx1: 'dk1', bg1: 'lt1', tx2: 'dk2', bg2: 'lt2' };
const SYS: Record<string, string> = { windowText: '000000', window: 'ffffff' };
const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

function hslOf(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function rgbOf(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

interface Resolved { color: string; alpha: number }

class Importer {
  skipped = new Map<string, number>();
  pictureBytes = 0;
  themeColors = new Map<string, string>();
  themeFonts = { major: '', minor: '' };
  clrMap: Record<string, string> = {};
  docs = new Map<string, Document | null>();
  relCache = new Map<string, Map<string, Rel>>();
  names: Set<string>;

  constructor(private zip: ReturnType<typeof openZip>) { this.names = new Set(zip.names); }

  size(name: string): number | null { return this.zip.size(name); }
  bytes(name: string): Promise<Uint8Array | null> { return this.zip.readBytes(name); }
  skip(what: keyof typeof LABELS, n = 1) { this.skipped.set(what, (this.skipped.get(what) ?? 0) + n); }

  async doc(path: string | null): Promise<Document | null> {
    if (!path || !this.names.has(path)) return null;
    if (this.docs.has(path)) return this.docs.get(path)!;
    let d: Document | null = null;
    if ((this.zip.size(path) ?? 0) <= MAX_XML) {
      const text = await this.zip.read(path);
      if (text !== null) {
        if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('This .pptx file is not safe to open');
        try {
          const parsed = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml');
          d = parsed.getElementsByTagName('parsererror').length ? null : parsed;
        } catch { d = null; }
      }
    }
    this.docs.set(path, d);
    return d;
  }

  async relsOf(part: string | null): Promise<Map<string, Rel>> {
    const out = new Map<string, Rel>();
    if (!part) return out;
    const hit = this.relCache.get(part);
    if (hit) return hit;
    const i = part.lastIndexOf('/');
    const d = await this.doc(`${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`);
    for (const r of Array.from(d?.documentElement?.children ?? [])) {
      const id = r.getAttribute('Id'), type = r.getAttribute('Type') ?? '', target = r.getAttribute('Target') ?? '';
      if (!id) continue;
      const external = r.getAttribute('TargetMode') === 'External';
      out.set(id, { type: type.slice(type.lastIndexOf('/') + 1), target: external ? target : resolvePath(part, target) ?? '', external });
    }
    this.relCache.set(part, out);
    return out;
  }

  async loadTheme(path: string | null, masterDoc: Document | null) {
    const t = await this.doc(path);
    const scheme = t ? Array.from(t.getElementsByTagName('*')).find((e) => ln(e) === 'clrScheme') : undefined;
    for (const c of Array.from(scheme?.children ?? [])) {
      const v = kid(c, 'srgbClr')?.getAttribute('val') ?? kid(c, 'sysClr')?.getAttribute('lastClr');
      if (v && /^[0-9a-f]{6}$/i.test(v)) this.themeColors.set(ln(c), v.toLowerCase());
    }
    const fonts = t ? Array.from(t.getElementsByTagName('*')) : [];
    this.themeFonts.major = at(fonts.find((e) => ln(e) === 'majorFont') ?? null, 'latin')?.getAttribute('typeface') ?? '';
    this.themeFonts.minor = at(fonts.find((e) => ln(e) === 'minorFont') ?? null, 'latin')?.getAttribute('typeface') ?? '';
    const cm = masterDoc?.documentElement ? kid(masterDoc.documentElement, 'clrMap') : null;
    for (const a of Array.from(cm?.attributes ?? [])) this.clrMap[a.name] = a.value;
  }

  /** The colour inside a fill element (srgbClr, schemeClr, sysClr, prstClr), with its alpha. */
  color(holder: Element | null | undefined): Resolved | null {
    const c = holder ? Array.from(holder.children).find((x) => ['srgbClr', 'schemeClr', 'sysClr', 'prstClr'].includes(ln(x))) : null;
    if (!c) return null;
    const v = c.getAttribute('val') ?? '';
    let hex: string | undefined;
    if (ln(c) === 'srgbClr') hex = /^[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined;
    else if (ln(c) === 'sysClr') hex = (c.getAttribute('lastClr') ?? SYS[v] ?? '').toLowerCase();
    else if (ln(c) === 'prstClr') hex = NAMED[v.toLowerCase()];
    else {
      hex = this.themeColors.get(this.clrMap[v] ?? SCHEME[v] ?? v);
    }
    if (!hex || !/^[0-9a-f]{6}$/.test(hex)) return null;
    let alpha = 1;
    let [r, g, b] = [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
    for (const m of Array.from(c.children)) {
      const n = attrNum(m, 'val');
      if (n === undefined) continue;
      const k = ln(m);
      if (k === 'alpha') alpha = Math.max(0, Math.min(1, n / 100000));
      else if (k === 'lumMod' || k === 'lumOff') {
        const [h, s, l] = hslOf(r, g, b);
        [r, g, b] = rgbOf(h, s, Math.max(0, Math.min(1, k === 'lumMod' ? l * (n / 100000) : l + n / 100000)));
      } else if (k === 'tint') { const t = n / 100000; r = 255 - (255 - r) * t; g = 255 - (255 - g) * t; b = 255 - (255 - b) * t; }
      else if (k === 'shade') { const t = n / 100000; r *= t; g *= t; b *= t; }
    }
    return { color: `#${hex2(r)}${hex2(g)}${hex2(b)}`, alpha };
  }

  fontName(face: string | null | undefined): string | undefined {
    if (!face) return undefined;
    const f = face === '+mj-lt' ? this.themeFonts.major : face === '+mn-lt' ? this.themeFonts.minor : face;
    return f && /^[\w \-,]{1,120}$/.test(f) ? f : undefined;
  }
}

interface RawEl extends Partial<SlideEl> { type: SlideEl['type'] }

interface SlideState {
  imp: Importer;
  rels: Map<string, Rel>;
  layout: Document | null;
  master: Document | null;
  els: RawEl[];
}

function xfrmOf(sp: Element | null): { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean } | null {
  const x = sp ? (kid(sp, 'xfrm') ?? null) : null;
  if (!x) return null;
  const off = kid(x, 'off'), ext = kid(x, 'ext');
  if (!off || !ext) return null;
  return { x: attrNum(off, 'x') ?? 0, y: attrNum(off, 'y') ?? 0, w: attrNum(ext, 'cx') ?? 0, h: attrNum(ext, 'cy') ?? 0, rot: (attrNum(x, 'rot') ?? 0) / 60000, flipH: x.getAttribute('flipH') === '1', flipV: x.getAttribute('flipV') === '1' };
}

/** The geometry a placeholder inherits from its layout, then its master. */
function inheritedXfrm(st: SlideState, ph: Element): ReturnType<typeof xfrmOf> {
  const type = ph.getAttribute('type') ?? 'body', idx = ph.getAttribute('idx');
  const alias = (t: string) => (t === 'ctrTitle' ? 'title' : t);
  for (const d of [st.layout, st.master]) {
    const tree = d?.documentElement ? at(kid(d.documentElement, 'cSld'), 'spTree') : null;
    if (!tree) continue;
    const cands = kids(tree, 'sp').filter((s) => at(s, 'nvSpPr', 'nvPr', 'ph'));
    const hit = cands.find((s) => { const p = at(s, 'nvSpPr', 'nvPr', 'ph')!; return idx !== null && p.getAttribute('idx') === idx && (d === st.layout || alias(p.getAttribute('type') ?? 'body') === alias(type)); })
      ?? cands.find((s) => alias(at(s, 'nvSpPr', 'nvPr', 'ph')!.getAttribute('type') ?? 'body') === alias(type));
    const x = hit ? xfrmOf(kid(hit, 'spPr')) : null;
    if (x) return x;
  }
  return null;
}

interface RunData { text: string; f: { sz?: number; b?: boolean; i?: boolean; u?: boolean; s?: boolean; sup?: boolean; sub?: boolean; color?: string; font?: string; href?: string } }
interface ParaData { runs: (RunData | 'br')[]; algn?: string; bullet?: 'bullet' | 'number' | 'none'; line?: number; size?: number }

function readParas(imp: Importer, st: SlideState, body: Element | null): { paras: ParaData[]; anchor?: string; fit: boolean } {
  const paras: ParaData[] = [];
  const bp = kid(body, 'bodyPr');
  const def = at(body, 'lstStyle', 'lvl1pPr', 'defRPr');
  const readRPr = (rp: Element | null): RunData['f'] => {
    const f: RunData['f'] = {};
    const sz = attrNum(rp, 'sz') ?? attrNum(def, 'sz');
    if (sz) f.sz = sz;
    const flag = (name: string, d?: boolean) => { const v = rp?.getAttribute(name); return v === null || v === undefined ? d : v === '1' || v === 'true'; };
    f.b = flag('b', def?.getAttribute('b') === '1' || undefined); f.i = flag('i', def?.getAttribute('i') === '1' || undefined);
    const u = rp?.getAttribute('u'); f.u = u ? u !== 'none' : undefined;
    const sk = rp?.getAttribute('strike'); f.s = sk ? sk !== 'noStrike' : undefined;
    const bl = attrNum(rp, 'baseline'); if (bl) { if (bl > 0) f.sup = true; else f.sub = true; }
    const col = imp.color(at(rp, 'solidFill')) ?? imp.color(at(def, 'solidFill')); if (col) f.color = col.color;
    f.font = imp.fontName(at(rp, 'latin')?.getAttribute('typeface'));
    const h = at(rp, 'hlinkClick');
    const id = relId(h);
    if (id) { const r = st.rels.get(id); if (r?.external && /^(https?:|mailto:|tel:)/i.test(r.target.trim())) f.href = r.target.trim(); }
    return f;
  };
  for (const p of kids(body, 'p')) {
    if (paras.length >= 500) break;
    const pp = kid(p, 'pPr');
    const pd: ParaData = { runs: [] };
    const al = pp?.getAttribute('algn'); if (al) pd.algn = al;
    if (kid(pp, 'buNone')) pd.bullet = 'none'; else if (kid(pp, 'buAutoNum')) pd.bullet = 'number'; else if (kid(pp, 'buChar')) pd.bullet = 'bullet';
    const sp = attrNum(at(pp, 'lnSpc', 'spcPct'), 'val'); if (sp) pd.line = (sp / 100000) * 1.2;
    for (const c of Array.from(p.children)) {
      const k = ln(c);
      if (k === 'br') pd.runs.push('br');
      else if (k === 'r' || k === 'fld') {
        const text = clean(kid(c, 't')?.textContent ?? '');
        if (text) pd.runs.push({ text, f: readRPr(kid(c, 'rPr')) });
      }
    }
    const end = attrNum(kid(p, 'endParaRPr'), 'sz'); if (end) pd.size = end;
    paras.push(pd);
  }
  return { paras, anchor: bp?.getAttribute('anchor') ?? undefined, fit: !!kid(bp, 'normAutofit') };
}

const px = (emuV: number, xf: Xf | null, axis: 'x' | 'y', k: number): number => {
  const v = xf ? (axis === 'x' ? xf.a * emuV + xf.b : xf.c * emuV + xf.d) : emuV;
  return (v / EMU) * k;
};

function buildHtml(paras: ParaData[], first: { sz?: number; color?: string; font?: string }, k: number): string {
  const box = document.createElement('div');
  paras.forEach((p) => {
    const d = document.createElement('div');
    if (p.algn === 'just' || p.algn === 'dist') d.style.textAlign = 'justify';
    const hasRuns = p.runs.length > 0;
    if (!hasRuns) d.append(document.createElement('br'));
    for (const r of p.runs) {
      if (r === 'br') { d.append(document.createElement('br')); continue; }
      let node: Node = document.createTextNode(r.text);
      const wrap = (tag: string) => { const e = document.createElement(tag); e.append(node); node = e; };
      if (r.f.sup) wrap('sup'); else if (r.f.sub) wrap('sub');
      if (r.f.s) wrap('s');
      if (r.f.u) wrap('u');
      if (r.f.i) wrap('i');
      if (r.f.b) wrap('b');
      const css: string[] = [];
      if (r.f.sz && first.sz !== undefined && Math.abs(r.f.sz - first.sz) > 1) css.push(`font-size:${Math.round((r.f.sz / 75) * k * 10) / 10}px`);
      if (r.f.color && r.f.color !== first.color) css.push(`color:${r.f.color}`);
      if (r.f.font && r.f.font !== first.font) css.push(`font-family:${r.f.font}`);
      if (css.length) { const s = document.createElement('span'); s.setAttribute('style', css.join(';')); s.append(node); node = s; }
      if (r.f.href) { const a = document.createElement('a'); a.setAttribute('href', r.f.href); a.append(node); node = a; }
      d.append(node);
    }
    box.append(d);
  });
  return box.innerHTML;
}

function addText(st: SlideState, base: RawEl, body: Element | null, isPh: string | null, k: number, tx1: string | undefined): boolean {
  const imp = st.imp;
  const { paras, anchor, fit } = readParas(imp, st, body);
  const hasText = paras.some((p) => p.runs.some((r) => r === 'br' || r.text.trim() !== ''));
  const runs = paras.flatMap((p) => p.runs.filter((r): r is RunData => r !== 'br'));
  const firstRun = runs[0];
  const sz = firstRun?.f.sz ?? paras.find((p) => p.size)?.size;
  const first = { sz, color: runs.find((r) => r.f.color)?.f.color, font: runs.find((r) => r.f.font)?.f.font };
  const style: NonNullable<SlideEl['style']> = {};
  if (sz) style.size = Math.round((sz / 75) * k * 10) / 10;
  style.color = first.color ?? tx1;
  if (!style.color) delete style.color;
  if (first.font) style.font = first.font;
  const al = paras.find((p) => p.algn)?.algn;
  if (al === 'ctr') style.align = 'center'; else if (al === 'r') style.align = 'right'; else if (al === 'just' || al === 'dist') style.align = 'justify';
  if (anchor === 'ctr') style.valign = 'middle'; else if (anchor === 'b') style.valign = 'bottom';
  const line = paras.find((p) => p.line)?.line; if (line) style.line = Math.max(0.8, Math.min(4, Math.round(line * 100) / 100));
  const bullets = paras.filter((p) => p.bullet === 'bullet' || p.bullet === 'number');
  const explicitNone = paras.length > 0 && paras.every((p) => p.bullet === 'none');
  if (bullets.length * 2 >= paras.length && bullets.length) style.bullets = bullets[0].bullet as 'bullet' | 'number';
  else if (isPh && /^(body|obj)?$/.test(isPh) && !explicitNone && !paras.some((p) => p.bullet === 'none')) style.bullets = 'bullet';
  if (fit) style.fit = 1;
  base.html = buildHtml(paras, first, k);
  base.style = style;
  return hasText;
}

const SHAPE_OF: Record<string, ShapeKind> = {
  rect: 'rect', roundRect: 'round', round1Rect: 'round', round2SameRect: 'round', snipRoundRect: 'round', ellipse: 'ellipse', triangle: 'triangle', rtTriangle: 'triangle', diamond: 'diamond',
  pentagon: 'pentagon', homePlate: 'pentagon', hexagon: 'hexagon', star4: 'star', star5: 'star', star6: 'star', star7: 'star', star8: 'star', star10: 'star', star12: 'star', star16: 'star', star24: 'star', star32: 'star',
  rightArrow: 'arrow', leftArrow: 'arrow', upArrow: 'arrow', downArrow: 'arrow', chevron: 'chevron',
  wedgeRectCallout: 'callout', wedgeRoundRectCallout: 'callout', wedgeEllipseCallout: 'callout', cloudCallout: 'callout',
  line: 'line', straightConnector1: 'line', flowChartProcess: 'rect', flowChartTerminator: 'round', flowChartDecision: 'diamond',
};

function addSp(st: SlideState, sp: Element, T: Xf | null, k: number, tx1: string | undefined, connector: boolean) {
  const imp = st.imp;
  const nv = connector ? kid(sp, 'nvCxnSpPr') : kid(sp, 'nvSpPr');
  const phEl = at(nv, 'nvPr', 'ph');
  const phType = phEl ? phEl.getAttribute('type') ?? 'body' : null;
  if (phType && ['dt', 'ftr', 'sldNum', 'hdr'].includes(phType)) return;
  const spPr = kid(sp, 'spPr');
  let xf = xfrmOf(spPr);
  if (!xf && phEl) xf = inheritedXfrm(st, phEl);
  if (!xf) return;
  const prst = at(spPr, 'prstGeom')?.getAttribute('prst') ?? (kid(spPr, 'custGeom') ? 'custom' : 'rect');
  const body = kid(sp, 'txBody');

  // fill and outline: the shape itself, else its style references
  const style = kid(sp, 'style');
  let fill: Resolved | null = null; let noFill = false;
  const sf = kid(spPr, 'solidFill'), gf = kid(spPr, 'gradFill');
  if (sf) fill = imp.color(sf);
  else if (gf) fill = imp.color(at(gf, 'gsLst', 'gs'));
  else if (kid(spPr, 'noFill')) noFill = true;
  else if (style && (attrNum(kid(style, 'fillRef'), 'idx') ?? 0) > 0) fill = imp.color(kid(style, 'fillRef'));
  const lnEl = kid(spPr, 'ln');
  let stroke: Resolved | null = null; let strokeW = 0;
  if (lnEl && kid(lnEl, 'noFill')) stroke = null;
  else if (lnEl && kid(lnEl, 'solidFill')) { stroke = imp.color(kid(lnEl, 'solidFill')); strokeW = (attrNum(lnEl, 'w') ?? 12700) / EMU; }
  else if (style && (attrNum(kid(style, 'lnRef'), 'idx') ?? 0) > 0) { stroke = imp.color(kid(style, 'lnRef')); strokeW = (attrNum(lnEl, 'w') ?? 12700) / EMU; }
  void noFill;

  const isLine = prst === 'line' || prst === 'straightConnector1' || connector;
  const { paras } = body ? readParas(imp, st, body) : { paras: [] as ParaData[] };
  const hasText = paras.some((p) => p.runs.some((r) => r === 'br' || r.text.trim() !== ''));
  if (prst === 'custom') { imp.skip('freeform'); if (!hasText) return; }

  const base: RawEl = { type: 'shape', x: 0, y: 0, w: 0, h: 0 };
  let rot = xf.rot;
  if (isLine) {
    const cx = px(xf.w, null, 'x', k), cy = px(xf.h, null, 'y', k);
    const len = Math.hypot(cx, cy);
    const ang = (Math.atan2(xf.flipH !== xf.flipV ? -cy : cy, cx) * 180) / Math.PI;
    const mx = px(xf.x + xf.w / 2, T, 'x', k), my = px(xf.y + xf.h / 2, T, 'y', k);
    const sxs = T ? T.a : 1, sys = T ? T.c : 1;
    const l = Math.hypot(cx * sxs, cy * sys) || len;
    base.w = Math.max(4, l); base.h = 4; base.x = mx - base.w / 2; base.y = my - 2;
    rot = rot + ang;
  } else {
    base.x = px(xf.x, T, 'x', k); base.y = px(xf.y, T, 'y', k);
    base.w = px(xf.w, null, 'x', k) * (T ? T.a : 1); base.h = px(xf.h, null, 'y', k) * (T ? T.c : 1);
  }
  rot = ((rot + 540) % 360) - 180;
  if (Math.abs(rot) > 0.01) base.rot = Math.round(rot * 100) / 100;

  const textBox = !isLine && (sp.getAttribute('txBox') === '1' || !!phEl || (!fill && !stroke && (prst === 'rect' || prst === 'custom') && hasText));
  const nameOf = at(nv, 'cNvPr');
  if (nameOf?.getAttribute('descr')) base.alt = nameOf.getAttribute('descr')!.slice(0, 500);
  if (textBox) {
    base.type = 'text';
    if (!hasText && !fill && !stroke) return;                 // an empty placeholder
    addText(st, base, body, phType, k, tx1);
    if (phType === 'title' || phType === 'ctrTitle') base.ph = 'title';
    else if (phType === 'subTitle') base.ph = 'subtitle';
    else if (phType === 'body' || phType === 'obj') base.ph = 'body';
    if (fill) { base.type = 'shape'; base.shape = 'rect'; base.fill = fill.color; if (fill.alpha < 1) base.opacity = fill.alpha; }
  } else {
    if (!fill && !stroke && !hasText) return;
    base.shape = SHAPE_OF[prst] ?? 'rect';
    if (prst === 'custom') base.shape = 'rect';
    base.fill = isLine ? null : fill?.color ?? null;
    base.stroke = stroke?.color ?? null;
    base.strokeW = stroke ? Math.max(0.5, Math.round(strokeW * k * 10) / 10) : 0;
    if (!isLine && fill && fill.alpha < 1) base.opacity = fill.alpha;
    if (hasText && !isLine) addText(st, base, body, null, k, tx1);
  }
  if (st.els.length >= MAX_EL) { imp.skip('elOver'); return; }
  if (kid(spPr, 'effectLst') && at(spPr, 'effectLst', 'outerShdw')) base.shadow = 1;
  st.els.push(base);
}

async function addPic(st: SlideState, pic: Element, T: Xf | null, k: number) {
  const imp = st.imp;
  if (at(pic, 'nvPicPr', 'nvPr', 'videoFile') || at(pic, 'nvPicPr', 'nvPr', 'audioFile')) { imp.skip(at(pic, 'nvPicPr', 'nvPr', 'audioFile') ? 'audio' : 'video'); return; }
  const xf = xfrmOf(kid(pic, 'spPr'));
  const id = relId(at(pic, 'blipFill', 'blip'), 'embed');
  const rel = id ? st.rels.get(id) : undefined;
  if (!xf || !rel || rel.external || !rel.target) { imp.skip('picNotEmbedded'); return; }
  if (st.els.length >= MAX_EL) { imp.skip('elOver'); return; }
  const size = imp.names.has(rel.target) ? imp.size(rel.target) : null;
  if (size === null || size > MAX_PICTURE || imp.pictureBytes + size > MAX_PICTURES_TOTAL) { imp.skip('picTooBig'); return; }
  let bytes: Uint8Array | null = null;
  try { bytes = await imp.bytes(rel.target); } catch { bytes = null; }
  const kind = bytes ? sniff(bytes) : null;
  if (!bytes || !kind) { imp.skip('picFormat'); return; }
  imp.pictureBytes += bytes.length;
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  const alpha = attrNum(at(pic, 'blipFill', 'blip', 'alphaModFix'), 'amt');
  const el: RawEl = {
    type: 'image', x: px(xf.x, T, 'x', k), y: px(xf.y, T, 'y', k), w: px(xf.w, null, 'x', k) * (T ? T.a : 1), h: px(xf.h, null, 'y', k) * (T ? T.c : 1),
    src: `data:image/${kind};base64,${btoa(bin)}`, fit: 'fill', alt: (at(pic, 'nvPicPr', 'cNvPr')?.getAttribute('descr') ?? '').slice(0, 500),
  };
  if (xf.rot) el.rot = ((xf.rot + 540) % 360) - 180;
  if (alpha !== undefined && alpha < 100000) el.opacity = alpha / 100000;
  st.els.push(el);
}

async function walkTree(st: SlideState, tree: Element, T: Xf | null, k: number, tx1: string | undefined, depth = 0): Promise<void> {
  if (depth > 20) { st.imp.skip('nested'); return; }
  for (const c of Array.from(tree.children)) {
    switch (ln(c)) {
      case 'sp': addSp(st, c, T, k, tx1, false); break;
      case 'cxnSp': addSp(st, c, T, k, tx1, true); break;
      case 'pic': await addPic(st, c, T, k); break;
      case 'grpSp': {
        const gx = at(c, 'grpSpPr', 'xfrm');
        const off = kid(gx, 'off'), ext = kid(gx, 'ext'), co = kid(gx, 'chOff'), ce = kid(gx, 'chExt');
        let nt = T;
        if (off && ext && co && ce) {
          const cw = attrNum(ce, 'cx') || 1, chh = attrNum(ce, 'cy') || 1;
          const sx = (attrNum(ext, 'cx') ?? cw) / cw, sy = (attrNum(ext, 'cy') ?? chh) / chh;
          // child point p lands at off + (p - chOff) * s in the parent space; then the parent's own transform applies
          const a0 = sx, b0 = (attrNum(off, 'x') ?? 0) - (attrNum(co, 'x') ?? 0) * sx, c0 = sy, d0 = (attrNum(off, 'y') ?? 0) - (attrNum(co, 'y') ?? 0) * sy;
          nt = T ? { a: T.a * a0, b: T.a * b0 + T.b, c: T.c * c0, d: T.c * d0 + T.d } : { a: a0, b: b0, c: c0, d: d0 };
        }
        await walkTree(st, c, nt, k, tx1, depth + 1);
        break;
      }
      case 'graphicFrame': {
        const uri = at(c, 'graphic', 'graphicData')?.getAttribute('uri') ?? '';
        st.imp.skip(/table/.test(uri) ? 'table' : /chart/.test(uri) ? 'chart' : /diagram/.test(uri) ? 'smartart' : 'object');
        break;
      }
      case 'AlternateContent': {
        const fb = kid(c, 'Fallback');
        if (fb) await walkTree(st, fb, T, k, tx1, depth + 1); else st.imp.skip('object');
        break;
      }
      case 'contentPart': st.imp.skip('object'); break;
      default: break;
    }
  }
}

function bgOf(imp: Importer, d: Document | null): string | undefined {
  const bg = d?.documentElement ? at(kid(d.documentElement, 'cSld'), 'bg') : null;
  if (!bg) return undefined;
  const c = imp.color(at(bg, 'bgPr', 'solidFill')) ?? imp.color(kid(bg, 'bgRef'));
  return c?.color;
}

const notesOf = async (imp: Importer, rels: Map<string, Rel>): Promise<string> => {
  const r = [...rels.values()].find((x) => x.type === 'notesSlide');
  const d = await imp.doc(r?.target ?? null);
  const tree = d?.documentElement ? at(kid(d.documentElement, 'cSld'), 'spTree') : null;
  const out: string[] = [];
  for (const sp of kids(tree, 'sp')) {
    if (at(sp, 'nvSpPr', 'nvPr', 'ph')?.getAttribute('type') !== 'body') continue;
    for (const p of kids(kid(sp, 'txBody'), 'p')) {
      out.push(Array.from(p.children).map((c) => (ln(c) === 'br' ? '\n' : ln(c) === 'r' || ln(c) === 'fld' ? clean(kid(c, 't')?.textContent) : '')).join(''));
    }
  }
  return out.join('\n').replace(/\s+$/, '').slice(0, 20000);
};

/** A PowerPoint file as a deck, and what could not be brought over (`['2 tables', '1 chart']`). */
export async function pptxToDeck(bytes: Uint8Array | ArrayBuffer): Promise<{ deck: Deck; skipped: string[] }> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error(NOT_PPTX);
  let zip: ReturnType<typeof openZip>;
  try { zip = openZip(data, LIMITS); } catch (e) { throw new Error((e as Error).message === LIMITS.message ? LIMITS.message : NOT_PPTX); }
  const imp = new Importer(zip);
  if (!imp.names.has('[Content_Types].xml') || !imp.names.has('ppt/presentation.xml')) throw new Error(NOT_PPTX);

  let pres: Document | null;
  try { pres = await imp.doc('ppt/presentation.xml'); } catch (e) { throw e instanceof Error && /not safe/.test(e.message) ? e : new Error(NOT_PPTX); }
  const root = pres?.documentElement;
  if (!root || ln(root) !== 'presentation') throw new Error(NOT_PPTX);
  const prels = await imp.relsOf('ppt/presentation.xml');

  const sz = kid(root, 'sldSz');
  const wEmu = attrNum(sz, 'cx') ?? 12192000, hEmu = attrNum(sz, 'cy') ?? 6858000;
  let k = 1;
  const wpx = wEmu / EMU, hpx = hEmu / EMU;
  if (wpx > 4000 || hpx > 4000) k = Math.min(4000 / wpx, 4000 / hpx);
  if (wpx * k < 320 || hpx * k < 240) k = Math.max(320 / wpx, 240 / hpx);

  // theme and colour map from the first master
  const masterRel = [...prels.values()].find((r) => r.type === 'slideMaster');
  const masterDocFirst = await imp.doc(masterRel?.target ?? null);
  const masterRels = await imp.relsOf(masterRel?.target ?? null);
  const themeRel = [...masterRels.values()].find((r) => r.type === 'theme') ?? [...prels.values()].find((r) => r.type === 'theme');
  await imp.loadTheme(themeRel?.target ?? null, masterDocFirst);
  const defaultText = (() => { const key = imp.clrMap.tx1 ?? 'dk1'; return imp.themeColors.get(key) ? `#${imp.themeColors.get(key)}` : undefined; })();

  const ids = kids(kid(root, 'sldIdLst'), 'sldId');
  if (ids.length > MAX_SLIDES) imp.skip('slideOver', ids.length - MAX_SLIDES);
  const rawSlides: Record<string, unknown>[] = [];
  for (const sid of ids.slice(0, MAX_SLIDES)) {
    const rel = prels.get(relId(sid) ?? '');
    if (!rel || rel.type !== 'slide' || !rel.target) { imp.skip('slideBad'); continue; }
    const sdoc = await imp.doc(rel.target);
    if (!sdoc?.documentElement || ln(sdoc.documentElement) !== 'sld') { imp.skip('slideBad'); continue; }
    const rels = await imp.relsOf(rel.target);
    const layoutRel = [...rels.values()].find((r) => r.type === 'slideLayout');
    const layout = await imp.doc(layoutRel?.target ?? null);
    const lrels = await imp.relsOf(layoutRel?.target ?? null);
    const mrel = [...lrels.values()].find((r) => r.type === 'slideMaster');
    const master = await imp.doc(mrel?.target ?? null);
    const st: SlideState = { imp, rels, layout, master, els: [] };
    const tree = at(kid(sdoc.documentElement, 'cSld'), 'spTree');
    if (tree) await walkTree(st, tree, null, k, defaultText);
    if (kid(sdoc.documentElement, 'timing')) imp.skip('animation');
    const slide: Record<string, unknown> = { layout: 'blank', els: st.els, notes: await notesOf(imp, rels) };
    const bg = bgOf(imp, sdoc) ?? bgOf(imp, layout) ?? bgOf(imp, master);
    if (bg) slide.bg = bg;
    if (sdoc.documentElement.getAttribute('show') === '0') slide.hidden = 1;
    const tr = kid(sdoc.documentElement, 'transition');
    if (tr) { const t = ln(Array.from(tr.children)[0] ?? tr); slide.transition = t === 'fade' ? 'fade' : t === 'push' || t === 'wipe' || t === 'cover' ? 'slide' : t === 'zoom' ? 'zoom' : undefined; }
    rawSlides.push(slide);
  }

  const before = rawSlides.reduce((n, s) => n + (s.els as unknown[]).length, 0);
  const deck = cleanDeck({ width: Math.round(wpx * k), height: Math.round(hpx * k), theme: 'office', slides: rawSlides });
  // cleanDeck makes sure of every value; whatever it refused (a picture over the size limit, an unsafe source) is counted
  const after = rawSlides.length ? deck.slides.reduce((n, s) => n + s.els.length, 0) : 0;
  if (rawSlides.length && before > after) imp.skip('dropped', before - after);
  for (const s of deck.slides) for (const e of s.els) if (e.html !== undefined) e.html = cleanHTML(e.html);

  const skipped = [...imp.skipped].map(([what, n]) => plural(n, LABELS[what as keyof typeof LABELS][0], LABELS[what as keyof typeof LABELS][1]));
  if (!ids.length) throw new Error(NOT_PPTX);
  return { deck, skipped };
}
