import { describe, expect, it } from 'vitest';
import { openZip, zipStore } from '../src/data-table';
import { deckToPptx, pptxToDeck } from '../src/presentation-pptx';
import { cleanDeck, htmlToText, type Deck, type SlideEl } from '../src/presentation-model';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const enc = new TextEncoder();
const dec = new TextDecoder();

const text = (id: string, x: number, y: number, html: string, extra: Partial<SlideEl> = {}): SlideEl => ({ id, type: 'text', x, y, w: 400, h: 100, html, ...extra });

function sample(): Deck {
  return cleanDeck({
    title: 'Sample', width: 1280, height: 720, theme: 'office',
    slides: [
      {
        id: 's1', layout: 'blank', notes: 'Say hello\nthen smile', bg: '#112233',
        els: [
          text('a', 100.5, 50, '<div><b>Bold</b> and <i>italic</i> and <a href="https://example.com/x">a link</a></div><div>Second line</div>', { style: { size: 32, color: '#ff0000', align: 'center', valign: 'middle' } }),
          { id: 'b', type: 'shape', shape: 'hexagon', x: 600, y: 300, w: 200, h: 120, rot: 30, fill: '#00ff00', stroke: '#0000ff', strokeW: 4, html: '<div>In a hexagon</div>' },
          { id: 'c', type: 'image', x: 50, y: 400, w: 100, h: 100, src: PNG, fit: 'fill', alt: 'dot' },
        ],
      },
      { id: 's2', layout: 'blank', notes: '', els: [text('d', 10, 10, '<div>One</div><div>Two</div>', { style: { bullets: 'bullet' } }), text('e', 10, 200, '<div>x</div>', { style: { bullets: 'number' } })] },
    ],
  });
}

async function entries(bytes: Uint8Array): Promise<Map<string, string>> {
  const zip = openZip(bytes);
  const out = new Map<string, string>();
  for (const n of zip.names) out.set(n, dec.decode((await zip.readBytes(n))!));
  return out;
}

describe('pptx export', () => {
  it('writes a zip whose content types list every part', async () => {
    const bytes = await deckToPptx(sample());
    expect([...bytes.slice(0, 2)]).toEqual([0x50, 0x4b]);
    const zip = openZip(bytes);
    expect(zip.names[0]).toBe('[Content_Types].xml');
    const ct = (await zip.read('[Content_Types].xml'))!;
    const xml = new DOMParser().parseFromString(ct, 'application/xml');
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    const overrides = new Set([...xml.getElementsByTagName('Override')].map((o) => o.getAttribute('PartName')));
    const defaults = new Set([...xml.getElementsByTagName('Default')].map((o) => o.getAttribute('Extension')));
    for (const n of zip.names) {
      if (n === '[Content_Types].xml') continue;
      const ext = n.split('.').pop()!;
      expect(overrides.has(`/${n}`) || defaults.has(ext), n).toBe(true);
    }
    for (const n of ['ppt/presentation.xml', 'ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/notesSlides/notesSlide1.xml', 'ppt/media/image1.png', 'ppt/theme/theme1.xml']) expect(zip.names).toContain(n);
    expect(zip.names).not.toContain('ppt/notesSlides/notesSlide2.xml');
    // every xml part is well formed
    for (const [n, t] of await entries(bytes)) if (/\.(xml|rels)$/.test(n)) expect(new DOMParser().parseFromString(t, 'application/xml').getElementsByTagName('parsererror'), n).toHaveLength(0);
  });

  it('sets the slide size at 9525 EMU per pixel', async () => {
    const p = (await entries(await deckToPptx(sample()))).get('ppt/presentation.xml')!;
    expect(p).toContain('cx="12192000" cy="6858000"');
  });

  it('strips characters XML forbids and escapes the rest', async () => {
    const d = cleanDeck({ title: 'T\u0001<x>', slides: [{ notes: 'n\u0000ote \u0008& <b>', els: [{ type: 'text', x: 0, y: 0, w: 100, h: 50, html: '<div>a\u0001b\u000bc￾d &amp; "q" &lt;tag&gt;</div>' }] }] });
    const all = await entries(await deckToPptx(d));
    for (const [n, t] of all) if (/\.(xml|rels)$/.test(n)) {
      expect(t, n).not.toMatch(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/);
      expect(new DOMParser().parseFromString(t, 'application/xml').getElementsByTagName('parsererror'), n).toHaveLength(0);
    }
    expect(all.get('ppt/slides/slide1.xml')).toContain('abcd &amp; &quot;q&quot; &lt;tag&gt;');
    expect(all.get('ppt/notesSlides/notesSlide1.xml')).toContain('note &amp; &lt;b&gt;');
  });

  it('writes a labelled placeholder for pictures it cannot embed', async () => {
    const d = cleanDeck({ slides: [{ els: [
      { type: 'image', x: 0, y: 0, w: 100, h: 100, src: 'https://example.com/p.png' },
      { type: 'image', x: 0, y: 0, w: 100, h: 100, src: 'data:image/svg+xml;base64,PHN2Zy8+' },
    ] }] });
    const all = await entries(await deckToPptx(d));
    const s = all.get('ppt/slides/slide1.xml')!;
    expect(s).toContain('Picture not embedded: https://example.com/p.png');
    expect(s).toContain('SVG pictures cannot be exported');
    expect(s).not.toContain('<p:pic>');
    expect([...all.keys()].some((k) => k.startsWith('ppt/media/'))).toBe(false);
  });

  it('only makes hyperlink relationships for safe links', async () => {
    const d = cleanDeck({ slides: [{ els: [{ type: 'text', x: 0, y: 0, w: 100, h: 50, html: '<a href="https://ok.example/a">ok</a><a href="mailto:a@b.c">m</a>' }] }] });
    const all = await entries(await deckToPptx(d));
    const rel = all.get('ppt/slides/_rels/slide1.xml.rels')!;
    expect(rel).toContain('TargetMode="External"');
    expect(rel).toContain('https://ok.example/a');
    expect(rel).toContain('mailto:a@b.c');
  });
});

describe('pptx round trip', () => {
  it('keeps text, formatting, colours, shapes, positions, notes, pictures and links', async () => {
    const src = sample();
    const { deck, skipped } = await pptxToDeck(await deckToPptx(src));
    expect(skipped).toEqual([]);
    expect(deck.width).toBe(1280);
    expect(deck.height).toBe(720);
    expect(deck.slides).toHaveLength(2);
    const s1 = deck.slides[0];
    expect(s1.bg).toBe('#112233');
    expect(s1.notes).toBe('Say hello\nthen smile');
    const t = s1.els.find((e) => e.type === 'text')!;
    expect(htmlToText(t.html!)).toBe('Bold and italic and a link\nSecond line');
    expect(t.html).toMatch(/<b>Bold<\/b>/);
    expect(t.html).toMatch(/<i>italic<\/i>/);
    expect(t.html).toContain('href="https://example.com/x"');
    expect(t.style?.color).toBe('#ff0000');
    expect(t.style?.align).toBe('center');
    expect(t.style?.valign).toBe('middle');
    expect(t.style?.size).toBeCloseTo(32, 0);
    expect(Math.abs(t.x - 100.5)).toBeLessThan(1);
    expect(Math.abs(t.y - 50)).toBeLessThan(1);
    expect(Math.abs(t.w - 400)).toBeLessThan(1);
    const sh = s1.els.find((e) => e.type === 'shape')!;
    expect(sh.shape).toBe('hexagon');
    expect(sh.fill).toBe('#00ff00');
    expect(sh.stroke).toBe('#0000ff');
    expect(Math.abs(sh.strokeW! - 4)).toBeLessThan(0.5);
    expect(Math.abs(sh.rot! - 30)).toBeLessThan(0.1);
    expect(Math.abs(sh.x - 600)).toBeLessThan(1);
    expect(Math.abs(sh.h - 120)).toBeLessThan(1);
    expect(htmlToText(sh.html!)).toBe('In a hexagon');
    const pic = s1.els.find((e) => e.type === 'image')!;
    expect(pic.src).toBe(PNG);
    expect(pic.alt).toBe('dot');
    expect(Math.abs(pic.x - 50)).toBeLessThan(1);
    const s2 = deck.slides[1];
    expect(s2.els[0].style?.bullets).toBe('bullet');
    expect(s2.els[1].style?.bullets).toBe('number');
    expect(htmlToText(s2.els[0].html!)).toBe('One\nTwo');
  });

  it('keeps every shape kind', async () => {
    const kinds = ['rect', 'round', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star', 'arrow', 'chevron', 'callout', 'line'] as const;
    const d = cleanDeck({ slides: [{ els: kinds.map((k, i) => ({ type: 'shape', shape: k, x: 20 + i * 50, y: 40, w: 40, h: 40, fill: '#336699', stroke: '#000000', strokeW: 2 })) }] });
    const back = (await pptxToDeck(await deckToPptx(d))).deck.slides[0].els;
    expect(back.map((e) => e.shape)).toEqual([...kinds]);
  });

  it('keeps a line direction through rotation', async () => {
    const d = cleanDeck({ slides: [{ els: [{ type: 'shape', shape: 'line', x: 100, y: 100, w: 300, h: 4, rot: 45, stroke: '#ff0000', strokeW: 3 }] }] });
    const e = (await pptxToDeck(await deckToPptx(d))).deck.slides[0].els[0];
    expect(e.shape).toBe('line');
    expect(Math.abs(e.rot! - 45)).toBeLessThan(0.1);
    expect(Math.abs(e.w - 300)).toBeLessThan(1);
    expect(Math.abs(e.x + e.w / 2 - 250)).toBeLessThan(1);
  });
});

// ---- hostile files ------------------------------------------------------------------------------------------------------------------

const RELS = (items: [string, string, string][]) => `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

function pptx(slides: { xml: string; rels?: [string, string, string][] }[], extra: { name: string; data: Uint8Array }[] = []): Uint8Array {
  const f = (name: string, t: string) => ({ name, data: enc.encode(t) });
  return zipStore([
    f('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    f('ppt/presentation.xml', `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`),
    f('ppt/_rels/presentation.xml.rels', RELS(slides.map((_, i) => [`rId${i + 1}`, 'slide', `slides/slide${i + 1}.xml`]))),
    ...slides.flatMap((s, i) => [
      f(`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0"?><p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr/><p:grpSpPr/>${s.xml}</p:spTree></p:cSld></p:sld>`),
      f(`ppt/slides/_rels/slide${i + 1}.xml.rels`, RELS(s.rels ?? [])),
    ]),
    ...extra,
  ]);
}

const sp = (body: string, x = 0, y = 0) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="1905000" cy="952500"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr><p:txBody><a:bodyPr/>${body}</p:txBody></p:sp>`;
const para = (t: string, rpr = '') => `<a:p><a:r><a:rPr ${rpr}/><a:t>${t}</a:t></a:r></a:p>`;

describe('pptx import of other files', () => {
  it('reads a hand-made file (4:3 size, groups, scheme colours)', async () => {
    const grp = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="952500" y="952500"/><a:ext cx="1905000" cy="1905000"/><a:chOff x="0" y="0"/><a:chExt cx="1905000" cy="1905000"/></a:xfrm></p:grpSpPr>${sp(para('in group', 'b="1" sz="2400"'), 190500, 190500)}</p:grpSp>`;
    const { deck, skipped } = await pptxToDeck(pptx([{ xml: sp(para('Hello', 'sz="3200"')) + grp }]));
    expect(skipped).toEqual([]);
    expect(deck.width).toBe(960);
    expect(deck.height).toBe(720);
    const [a, b] = deck.slides[0].els;
    expect(htmlToText(a.html!)).toBe('Hello');
    expect(a.style?.size).toBeCloseTo(42.7, 0);     // 32 pt
    expect(a.w).toBeCloseTo(200, 0);
    expect(htmlToText(b.html!)).toBe('in group');
    expect(b.x).toBeCloseTo(120, 0);            // group at 100px + child at 20px
    expect(b.y).toBeCloseTo(120, 0);
  });

  it('leaves out tables and charts and says so', async () => {
    const frame = (uri: string) => `<p:graphicFrame><p:nvGraphicFramePr/><a:graphic><a:graphicData uri="${uri}"/></a:graphic></p:graphicFrame>`;
    const xml = sp(para('keep me')) + frame('http://schemas.openxmlformats.org/drawingml/2006/table') + frame('http://schemas.openxmlformats.org/drawingml/2006/table') + frame('http://schemas.openxmlformats.org/drawingml/2006/chart');
    const { deck, skipped } = await pptxToDeck(pptx([{ xml }]));
    expect(deck.slides[0].els).toHaveLength(1);
    expect(skipped).toEqual(['2 tables', '1 chart']);
  });

  it('refuses things that are not a .pptx', async () => {
    await expect(pptxToDeck(enc.encode('hello, this is not a zip file at all'))).rejects.toThrow('This is not a .pptx file');
    await expect(pptxToDeck(zipStore([{ name: 'a.txt', data: enc.encode('x') }]))).rejects.toThrow('This is not a .pptx file');
  });

  it('refuses an entry name that climbs out', async () => {
    const bytes = pptx([{ xml: sp(para('x')) }], [{ name: '../evil', data: enc.encode('x') }]);
    await expect(pptxToDeck(bytes)).rejects.toThrow(/not safe/);
    await expect(pptxToDeck(pptx([{ xml: sp(para('x')) }], [{ name: '/abs', data: enc.encode('x') }]))).rejects.toThrow(/not safe/);
    await expect(pptxToDeck(pptx([{ xml: sp(para('x')) }], [{ name: 'a\\..\\b', data: enc.encode('x') }]))).rejects.toThrow(/not safe/);
  });

  it('refuses a zip bomb header (huge declared size, tiny file)', async () => {
    const bytes = pptx([{ xml: sp(para('x')) }], [{ name: 'ppt/media/big.bin', data: new Uint8Array(40) }]);
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let patched = 0;
    for (let i = 0; i + 46 < bytes.length; i++) {
      if (v.getUint32(i, true) === 0x02014b50) { const nl = v.getUint16(i + 28, true); if (dec.decode(bytes.subarray(i + 46, i + 46 + nl)) === 'ppt/media/big.bin') { v.setUint32(i + 24, 3_000_000_000, true); patched++; } }
    }
    expect(patched).toBe(1);
    await expect(pptxToDeck(bytes)).rejects.toThrow(/not safe/);
    // a ratio bomb: 2 MB declared from 40 bytes
    const b2 = pptx([{ xml: sp(para('x')) }], [{ name: 'ppt/media/big.bin', data: new Uint8Array(40) }]);
    const v2 = new DataView(b2.buffer, b2.byteOffset, b2.byteLength);
    for (let i = 0; i + 46 < b2.length; i++) if (v2.getUint32(i, true) === 0x02014b50 && v2.getUint16(i + 28, true) === 17) v2.setUint32(i + 24, 2_000_000, true);
    await expect(pptxToDeck(b2)).rejects.toThrow(/not safe/);
  });

  it('refuses a document type declaration with an entity', async () => {
    const evil = `<?xml version="1.0"?><!DOCTYPE p [<!ENTITY x "boom">]><p:sld ${NS}><p:cSld><p:spTree/></p:cSld></p:sld>`;
    const bytes = pptx([{ xml: '' }]);
    const files = openZip(bytes);
    const out: { name: string; data: Uint8Array }[] = [];
    for (const n of files.names) out.push({ name: n, data: n === 'ppt/slides/slide1.xml' ? enc.encode(evil) : (await files.readBytes(n))! });
    await expect(pptxToDeck(zipStore(out))).rejects.toThrow(/not safe/);
  });

  it('turns a javascript: hyperlink into plain text', async () => {
    const run = (id: string, t: string) => `<a:p><a:r><a:rPr><a:hlinkClick r:id="${id}"/></a:rPr><a:t>${t}</a:t></a:r></a:p>`;
    const bytes = pptx([{ xml: sp(run('rId2', 'bad') + run('rId3', 'good')), rels: [] }]);
    const files = openZip(bytes);
    const out: { name: string; data: Uint8Array }[] = [];
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://ok.example/" TargetMode="External"/></Relationships>`;
    for (const n of files.names) out.push({ name: n, data: n === 'ppt/slides/_rels/slide1.xml.rels' ? enc.encode(rels) : (await files.readBytes(n))! });
    const { deck } = await pptxToDeck(zipStore(out));
    const html = deck.slides[0].els[0].html!;
    expect(html).not.toMatch(/javascript/i);
    expect(html).toContain('bad');
    expect(html).toContain('href="https://ok.example/"');
  });

  it('does not bring in a picture that is not a picture', async () => {
    const pic = (rid: string) => `<p:pic><p:nvPicPr><p:cNvPr id="3" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm></p:spPr></p:pic>`;
    const html = enc.encode('<html><script>alert(1)</script></html>');
    const bytes = pptx([{ xml: pic('rId2') + pic('rId3') + pic('rId4'), rels: [['rId2', 'image', '../media/a.png'], ['rId3', 'image', 'data:text/html;base64,PHNjcmlwdD4='], ['rId4', 'image', '../../../etc/passwd']] }], [{ name: 'ppt/media/a.png', data: html }]);
    const { deck, skipped } = await pptxToDeck(bytes);
    expect(deck.slides[0].els).toHaveLength(0);
    expect(skipped.length).toBeGreaterThan(0);
    for (const e of deck.slides[0].els) expect(e.src ?? '').not.toMatch(/text\/html/);
  });

  it('reads an embedded png', async () => {
    const png = Uint8Array.from(atob(PNG.split(',')[1]), (c) => c.charCodeAt(0));
    const pic = `<p:pic><p:nvPicPr><p:cNvPr id="3" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="952500" cy="952500"/></a:xfrm></p:spPr></p:pic>`;
    const { deck } = await pptxToDeck(pptx([{ xml: pic, rels: [['rId2', 'image', '../media/a.png']] }], [{ name: 'ppt/media/a.png', data: png }]));
    expect(deck.slides[0].els[0].src).toBe(PNG);
  });

  it('refuses a file with more than 2000 entries (5000 slides) and caps 600 slides at 500', async () => {
    const many = (n: number) => pptx(Array.from({ length: n }, () => ({ xml: sp(para('s')) })));
    await expect(pptxToDeck(many(5000))).rejects.toThrow(/not safe/);
    const { deck, skipped } = await pptxToDeck(many(600));
    expect(deck.slides).toHaveLength(500);
    expect(skipped).toEqual(['100 slides over the limit of 500']);
  });

  it('caps the elements of a slide at 500', async () => {
    const { deck, skipped } = await pptxToDeck(pptx([{ xml: Array.from({ length: 520 }, () => sp(para('e'))).join('') }]));
    expect(deck.slides[0].els).toHaveLength(500);
    expect(skipped[0]).toContain('20 elements over the limit');
  });

  it('leaves script-like text as inert text', async () => {
    const { deck } = await pptxToDeck(pptx([{ xml: sp(para('&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;x&lt;/script&gt;')) }]));
    const html = deck.slides[0].els[0].html!;
    expect(html).not.toMatch(/<img|<script/i);
  });
});
