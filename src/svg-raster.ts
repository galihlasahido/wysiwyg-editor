/** Draw SVG markup to PNG bytes in the browser (no network, no external references). Null where there is no canvas or the SVG has no size. */
export async function rasterizeSVG(svg: string, scale = 2, maxSide = 4000): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    // real browsers have createImageBitmap; environments without a canvas (tests, servers) skip drawing
    if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null;
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = parsed.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) return null;
    const vb = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const attr = (n: string) => { const v = parseFloat(root.getAttribute(n) ?? ''); return Number.isFinite(v) && !(root.getAttribute(n) ?? '').includes('%') ? v : NaN; };
    let w = vb && vb.length === 4 ? vb[2] : attr('width');
    let h = vb && vb.length === 4 ? vb[3] : attr('height');
    if (!(w > 0) || !(h > 0)) return null;
    const k = Math.min(scale, maxSide / w, maxSide / h);
    root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    root.setAttribute('width', String(w));
    root.setAttribute('height', String(h));
    root.removeAttribute('style');
    const xml = new XMLSerializer().serializeToString(root);
    const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
    try {
      const img = new Image();
      await new Promise<void>((ok, fail) => { const t = setTimeout(() => fail(new Error('svg timeout')), 10000); img.onload = () => (clearTimeout(t), ok()); img.onerror = () => (clearTimeout(t), fail(new Error('svg'))); img.src = url; });
      const pw = Math.max(1, Math.round(w * k));
      const ph = Math.max(1, Math.round(h * k));
      const canvas = Object.assign(document.createElement('canvas'), { width: pw, height: ph });
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.fillStyle = '#fff'; // Word pages are white: a transparent background would show dark text on dark in some viewers
      ctx.fillRect(0, 0, pw, ph);
      ctx.drawImage(img, 0, 0, pw, ph);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      w = pw; h = ph;
      return blob ? { data: new Uint8Array(await blob.arrayBuffer()), width: w, height: h } : null;
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch {
    return null;
  }
}
