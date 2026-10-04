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
