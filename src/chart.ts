export type ChartType = 'bar' | 'line' | 'pie';
export interface ChartSpec { type: ChartType; title: string; labels: string[]; series: { name: string; values: number[] }[] }

const TYPES: ChartType[] = ['bar', 'line', 'pie'];
export const CHART_COLORS = ['#2563eb', '#ea580c', '#16a34a', '#9333ea', '#dc2626', '#0891b2', '#ca8a04', '#db2777'];
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : '');

/** A well-formed spec from untrusted input (JSON text or an object), or null when there is nothing to draw. */
export function cleanChart(input: unknown): ChartSpec | null {
  let o: any = input;
  if (typeof input === 'string') { try { o = JSON.parse(input); } catch { return null; } }
  if (!o || typeof o !== 'object') return null;
  const labels = (Array.isArray(o.labels) ? o.labels : []).slice(0, 50).map((l: unknown) => str(l, 40));
  const series = (Array.isArray(o.series) ? o.series : []).slice(0, 8).map((s: any) => ({
    name: str(s?.name, 40),
    values: labels.map((_: string, i: number) => { const n = Number(s?.values?.[i]); return Number.isFinite(n) ? Math.max(-1e12, Math.min(1e12, n)) : 0; }),
  }));
  if (!labels.length || !series.length) return null;
  return { type: TYPES.includes(o.type) ? o.type : 'bar', title: str(o.title, 120), labels, series };
}

/** Parse "1,234.5", "12%", "$40" … ; NaN when it is not a number. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(/[\s$€£¥%]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  return t && /^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(t) ? Number(t) : NaN;
}

/** Chart data from a table: first row = series names, first column = labels, the rest numbers (a first row of numbers means no header). */
export function specFromRows(rows: string[][], type: ChartType = 'bar'): ChartSpec | null {
  if (rows.length < 2 || rows[0].length < 2) return null;
  const header = rows[0];
  const body = rows.slice(1);
  const cols = header.length - 1;
  const series = Array.from({ length: cols }, (_, c) => ({ name: header[c + 1] || `Series ${c + 1}`, values: body.map((r) => { const n = parseNumber(r[c + 1] ?? ''); return Number.isNaN(n) ? 0 : n; }) }));
  if (!series.some((s) => s.values.some((v) => v !== 0))) return null;
  return cleanChart({ type, title: '', labels: body.map((r) => r[0] ?? ''), series });
}

const nice = (max: number) => { if (max <= 0) return 1; const p = 10 ** Math.floor(Math.log10(max)); const f = max / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e4 ? `${+(n / 1e3).toFixed(1)}k` : String(+n.toFixed(2)));

/** Self-contained SVG (text in `currentColor`, fixed series colours) with an accessible title and description. */
export function chartSVG(spec: ChartSpec, width = 560, height = 320): string {
  const W = width, H = height;
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(spec.title || `${spec.type} chart`)}" font-family="system-ui, sans-serif" font-size="12">`;
  const parts: string[] = [`<title>${esc(spec.title || `${spec.type} chart`)}</title>`];
  const top = spec.title ? 34 : 14;
  if (spec.title) parts.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor">${esc(spec.title)}</text>`);
  const legendH = spec.type === 'pie' || spec.series.length > 1 ? 24 : 0;
  const color = (i: number) => CHART_COLORS[i % CHART_COLORS.length];
  const legend = (items: string[]) => {
    let x = 12;
    return items.map((n, i) => { const g = `<rect x="${x}" y="${H - 18}" width="10" height="10" rx="2" fill="${color(i)}"/><text x="${x + 14}" y="${H - 9}" fill="currentColor">${esc(n)}</text>`; x += 26 + n.length * 7; return g; }).join('');
  };
  if (spec.type === 'pie') {
    const vals = spec.series[0].values.map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const cx = W / 2, cy = top + (H - top - legendH - 8) / 2, r = Math.min(W / 2 - 20, (H - top - legendH - 16) / 2);
    let a0 = -Math.PI / 2;
    vals.forEach((v, i) => {
      if (v <= 0) return;
      const a1 = a0 + (v / total) * Math.PI * 2;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
      parts.push(v / total >= 0.9999 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(i)}"/>` : `<path d="M${cx} ${cy} L${p(a0)} A${r} ${r} 0 ${big} 1 ${p(a1)} Z" fill="${color(i)}" stroke="#fff" stroke-width="1.5"/>`);
      if (v / total > 0.06) { const am = (a0 + a1) / 2; parts.push(`<text x="${(cx + r * 0.62 * Math.cos(am)).toFixed(1)}" y="${(cy + r * 0.62 * Math.sin(am) + 4).toFixed(1)}" text-anchor="middle" fill="#fff" font-weight="700">${Math.round((v / total) * 100)}%</text>`); }
      a0 = a1;
    });
    parts.push(legend(spec.labels));
    return `${head}${parts.join('')}</svg>`;
  }
  const left = 46, right = 14, bottom = 28 + legendH;
  const pw = W - left - right, ph = H - top - bottom;
  const all = spec.series.flatMap((s) => s.values);
  const max = nice(Math.max(0, ...all)), min = Math.min(0, ...all) < 0 ? -nice(-Math.min(...all)) : 0;
  const y = (v: number) => top + ph - ((v - min) / (max - min)) * ph;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4, yy = y(v);
    parts.push(`<line x1="${left}" x2="${W - right}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}" stroke="currentColor" stroke-opacity=".15"/><text x="${left - 6}" y="${(yy + 4).toFixed(1)}" text-anchor="end" fill="currentColor" fill-opacity=".7">${fmt(v)}</text>`);
  }
  const n = spec.labels.length, slot = pw / n;
  spec.labels.forEach((l, i) => { if (n <= 12 || i % Math.ceil(n / 12) === 0) parts.push(`<text x="${(left + slot * (i + 0.5)).toFixed(1)}" y="${top + ph + 16}" text-anchor="middle" fill="currentColor" fill-opacity=".8">${esc(l.length > 12 ? `${l.slice(0, 11)}…` : l)}</text>`); });
  if (spec.type === 'bar') {
    const bw = Math.min(40, (slot * 0.76) / spec.series.length);
    spec.series.forEach((s, si) => s.values.forEach((v, i) => {
      const x = left + slot * (i + 0.5) - (bw * spec.series.length) / 2 + bw * si;
      parts.push(`<rect x="${x.toFixed(1)}" y="${Math.min(y(v), y(0)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.abs(y(v) - y(0)).toFixed(1)}" rx="2" fill="${color(si)}"><title>${esc(s.name)} · ${esc(spec.labels[i])}: ${v}</title></rect>`);
    }));
  } else {
    spec.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => `${(left + slot * (i + 0.5)).toFixed(1)},${y(v).toFixed(1)}`);
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${color(si)}" stroke-width="2.5" stroke-linejoin="round"/>`);
      s.values.forEach((v, i) => parts.push(`<circle cx="${(left + slot * (i + 0.5)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.5" fill="${color(si)}"><title>${esc(s.name)} · ${esc(spec.labels[i])}: ${v}</title></circle>`));
    });
  }
  parts.push(`<line x1="${left}" x2="${W - right}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="currentColor" stroke-opacity=".5"/>`);
  if (legendH) parts.push(legend(spec.series.map((s) => s.name)));
  return `${head}${parts.join('')}</svg>`;
}
