export interface Slide {
  /** Sanitised-by-the-editor HTML of the slide, without the speaker notes. */
  html: string;
  /** Speaker notes: paragraphs starting with "Notes:". */
  notes: string;
  /** Text of the first heading, for thumbnails and navigation. */
  title: string;
}

export interface SlideOptions {
  /** `hr` (default): a horizontal line starts a new slide. `heading`: every H1 or H2 does. */
  by?: 'hr' | 'heading';
}

/** Split editor HTML into slides. Pure function of the HTML string; run it on `editor.getHTML()`. */
export function splitSlides(html: string, options: SlideOptions = {}): Slide[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const groups: Element[][] = [[]];
  for (const el of [...doc.body.children]) {
    const isBreak = options.by === 'heading' ? /^H[12]$/.test(el.tagName) : el.tagName === 'HR';
    if (isBreak && options.by !== 'heading') { groups.push([]); continue; }
    if (isBreak && groups[groups.length - 1].length) groups.push([]);
    groups[groups.length - 1].push(el);
  }
  const slides: Slide[] = [];
  for (const g of groups) {
    const notes: string[] = [];
    const body = g.filter((el) => {
      const m = el.tagName === 'P' && /^\s*notes:\s*/i.exec(el.textContent ?? '');
      if (m) notes.push((el.textContent ?? '').slice(m[0].length).trim());
      return !m;
    });
    if (!body.length && !notes.length) continue;
    const heading = body.find((e) => /^H[1-6]$/.test(e.tagName));
    slides.push({ html: body.map((e) => e.outerHTML).join(''), notes: notes.filter(Boolean).join('\n'), title: heading?.textContent?.trim() || (body[0]?.textContent ?? '').trim().slice(0, 40) || 'Untitled' });
  }
  return slides;
}
