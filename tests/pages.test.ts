import { describe, expect, it } from 'vitest';
import { createEditor, getOutline, paginate } from '../src';

describe('paginate', () => {
  it('keeps everything on one page when it fits', () => {
    expect(paginate([{ height: 100 }, { height: 100 }], 300)).toEqual({ breaks: [], lastFiller: 100, pages: 1 });
  });

  it('breaks before the block that overflows and reports filler', () => {
    const r = paginate([{ height: 100 }, { height: 150 }, { height: 100 }], 300);
    expect(r.breaks).toEqual([{ index: 2, filler: 50 }]);
    expect(r.pages).toBe(2);
    expect(r.lastFiller).toBe(200);
  });

  it('honours forced page breaks and never emits a trailing break', () => {
    const r = paginate([{ height: 10 }, { height: 0, breakAfter: true }, { height: 10 }], 300);
    expect(r.breaks).toEqual([{ index: 2, filler: 290 }]);
    expect(paginate([{ height: 10 }, { height: 0, breakAfter: true }], 300).pages).toBe(1);
  });

  it('puts an oversized block on its own page without a negative filler', () => {
    const r = paginate([{ height: 50 }, { height: 500 }, { height: 50 }], 300);
    expect(r.breaks).toEqual([
      { index: 1, filler: 250 },
      { index: 2, filler: 0 },
    ]);
  });

  it('handles an empty document', () => {
    expect(paginate([], 300)).toEqual({ breaks: [], lastFiller: 300, pages: 1 });
  });
});

describe('paged editor', () => {
  const make = (html: string) => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    document.body.append(el);
    return createEditor({ element: el, content: html, pages: true, outline: true });
  };

  it('enables paged mode and inserts a page break node', () => {
    const e = make('<p>a</p>');
    expect(e.root.classList.contains('wy-paged')).toBe(true);
    e.execute('pageBreak');
    expect(e.getHTML()).toContain('data-page-break');
  });

  it('validates and clamps margins and page size', () => {
    const e = make('<p>a</p>');
    expect(e.execute('pageSize', 'nope')).toBe(false);
    expect(e.execute('pageSize', 'letter')).toBe(true);
    e.execute('pageMargins', { left: 9999 });
    expect(e.root.style.getPropertyValue('--wy-ml')).toBe('358px'); // 816 / 2 - 50
  });

  it('builds an outline from headings', () => {
    const e = make('<h1>One</h1><p>x</p><h2>Two</h2>');
    expect(getOutline(e.view.state.doc).map((i) => [i.level, i.text])).toEqual([[1, 'One'], [2, 'Two']]);
    expect(e.root.querySelectorAll('.wy-outline-item').length).toBe(2);
  });

  it('exports Markdown without choking on page breaks', () => {
    const e = make('<p>a</p>');
    e.execute('pageBreak');
    expect(() => e.getMarkdown()).not.toThrow();
  });
});

describe('paginate: splitting paragraphs across pages', () => {
  const para = (n: number, lh = 20, margin = 12) => ({ height: n * lh + margin, lines: Array(n).fill(lh) as number[] });

  it('splits a paragraph between lines and carries the rest to the next page', () => {
    // page = 200px; heading takes 50, paragraph has 10 lines of 20px (+12 margin)
    const r = paginate([{ height: 50 }, para(10)], 200);
    // 150px left on page 1 -> 7 lines fit (140px); 3 lines go to page 2
    expect(r.breaks).toEqual([{ index: 1, line: 7, filler: 10 }]);
    expect(r.pages).toBe(2);
    expect(r.lastFiller).toBe(200 - (3 * 20 + 12));
  });

  it('keeps at least two lines on each side (widow/orphan control)', () => {
    // 9 of 10 lines would fit, which would leave a single widow line: pull one back
    const r = paginate([para(10)], 180);
    expect(r.breaks[0].line).toBe(8);
    // exactly two lines fit (40px left): splitting is allowed
    expect(paginate([{ height: 160 }, para(10)], 200).breaks[0]).toEqual({ index: 1, line: 2, filler: 0 });
    // only one line fits (30px left): move the whole paragraph instead of leaving an orphan
    expect(paginate([{ height: 170 }, para(10)], 200).breaks[0]).toEqual({ index: 1, filler: 30 });
  });

  it('splits a paragraph taller than several pages and always makes progress', () => {
    const r = paginate([para(50)], 200); // 1012px over 200px pages
    expect(r.pages).toBeGreaterThanOrEqual(5);
    const lines = r.breaks.map((b) => b.line!);
    expect(lines).toEqual([...lines].sort((a, b) => a - b));
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('does not terminate early when a single line is taller than the page', () => {
    const r = paginate([{ height: 1000, lines: [250, 250, 250, 250] }], 200);
    expect(r.pages).toBeGreaterThan(1);
  });

  it('treats short paragraphs as atomic', () => {
    const r = paginate([{ height: 150 }, para(3)], 200);
    expect(r.breaks).toEqual([{ index: 1, filler: 50 }]);
  });
});

describe('page settings', () => {
  it('switches orientation by swapping page dimensions', () => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    document.body.append(el);
    const e = createEditor({ element: el, content: '<p>a</p>', pages: true });
    expect(e.root.style.getPropertyValue('--wy-page-w')).toBe('794px');
    expect(e.execute('pageOrientation', 'landscape')).toBe(true);
    expect(e.root.style.getPropertyValue('--wy-page-w')).toBe('1123px');
    expect(e.execute('pageOrientation', 'sideways')).toBe(false);
  });
});

describe('table of contents', () => {
  it('lists headings, stays in sync with edits, and survives a round trip', () => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    document.body.append(el);
    const e = createEditor({ element: el, content: '<h1>One</h1><div data-toc></div><h2>Two</h2>' });
    const items = () => [...e.root.querySelectorAll('.wy-toc-item')].map((a) => a.textContent);
    expect(items()).toEqual(['One', 'Two']);
    e.setHTML('<h1>One</h1><div data-toc></div><h2>Two</h2><h3>Three</h3>');
    expect(items()).toEqual(['One', 'Two', 'Three']);
    expect(e.getHTML()).toContain('data-toc');
    expect(e.getMarkdown()).toContain('[TOC]');
  });

  it('shows a hint when there are no headings', () => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    document.body.append(el);
    const e = createEditor({ element: el, content: '<p>x</p>' });
    e.execute('insertToc');
    expect(e.root.querySelector('.wy-toc-empty')).not.toBeNull();
  });
});
