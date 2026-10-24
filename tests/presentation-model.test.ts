import { describe, expect, it } from 'vitest';
import {
  DeckStore, addEls, addSlide, alignEls, cleanDeck, cleanHTML, deleteSlides, distributeEls, duplicateSlides, htmlToText, moveSlide, newDeck, newImageEl, newShapeEl, newTextEl,
  reorderEls, setLayout, setSlideSize, setTransition, slideTitle, styleEls, textToHTML, updateEls, updateSlide, SIZE_STANDARD,
} from '../src/presentation-model';
import { deckToHTML, renderSlide } from '../src/presentation-render';

describe('clean text', () => {
  it('keeps simple formatting and drops everything that can run', () => {
    const out = cleanHTML('<b onclick="x()">a</b><script>alert(1)</script><img src=x onerror=alert(1)><iframe src="//e"></iframe><a href="javascript:alert(1)">l</a><a href="https://e.com/x?a=1&b=2">ok</a><span style="color:red;background:url(javascript:1);font-size:20px;position:fixed">s</span>');
    expect(out).toContain('<b>a</b>');
    expect(out).not.toMatch(/script|onclick|onerror|iframe|javascript|<img|url\(|position/i);
    expect(out).toContain('href="https://e.com/x?a=1&amp;b=2"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).toContain('style="color:red;font-size:20px"');
  });
  it('turns unknown tags into their text and strong into b', () => {
    expect(cleanHTML('<section><strong>x</strong> <font color="red">y</font></section>')).toBe('<b>x</b> y');
  });
  it('plain text round-trips through HTML', () => {
    const html = textToHTML('a < b\n\nc & d');
    expect(html).toBe('<div>a &lt; b</div><div><br></div><div>c &amp; d</div>');
    expect(htmlToText(html)).toBe('a < b\n\nc & d');
  });
});

describe('cleaning a deck from outside', () => {
  it('fixes numbers, colours, pictures and ids', () => {
    const d = cleanDeck({
      width: 99999, theme: 'nope',
      slides: [{ id: 'a', layout: 'evil', notes: 5, els: [
        { type: 'text', x: 'NaN', y: 5, w: -4, h: 1e9, html: '<script>x</script>t', style: { color: 'url(x)', size: 5000, align: 'diagonal' } },
        { type: 'image', src: 'javascript:alert(1)', x: 0, y: 0, w: 10, h: 10 },
        { type: 'image', src: 'data:image/svg+xml;base64,AAAA', x: 0, y: 0, w: 10, h: 10 },
        { type: 'shape', shape: 'nonsense', fill: 'red', stroke: 'url(x)', x: 0, y: 0, w: 10, h: 10 },
        { type: 'movie' },
      ] }, { id: 'a', els: [] }],
    });
    expect(d.width).toBe(4000);
    expect(d.theme).toBe('office');
    expect(d.slides).toHaveLength(2);
    expect(d.slides[0].layout).toBe('blank');
    expect(d.slides[0].notes).toBe('');
    expect(new Set(d.slides.map((s) => s.id)).size).toBe(2);
    const [t, img, shape] = d.slides[0].els;
    expect(d.slides[0].els).toHaveLength(3);
    expect(t.x).toBe(0); expect(t.w).toBe(4); expect(t.h).toBe(20000);
    expect(t.html).toBe('t');
    expect(t.style).toBeUndefined();
    expect(img.src).toMatch(/^data:image\/svg/);
    expect(shape.shape).toBe('rect'); expect(shape.fill).toBe('red'); expect(shape.stroke).toBeUndefined();
  });
  it('JSON text, nothing, and garbage all give a usable deck', () => {
    expect(cleanDeck('not json').slides).toHaveLength(1);
    expect(cleanDeck(null).slides[0].layout).toBe('title');
    expect(cleanDeck(JSON.stringify(newDeck('x'))).title).toBe('x');
  });
});

describe('operations', () => {
  it('adds, duplicates, moves and deletes slides', () => {
    let d = newDeck();
    const a = addSlide(d, 1, 'titleContent'); d = a.deck;
    const b = addSlide(d, 2, 'blank'); d = b.deck;
    expect(d.slides.map((s) => s.layout)).toEqual(['title', 'titleContent', 'blank']);
    const dup = duplicateSlides(d, [a.slide.id]); d = dup.deck;
    expect(d.slides).toHaveLength(4);
    expect(d.slides[2].id).toBe(dup.ids[0]);
    expect(d.slides[2].els.map((e) => e.id)).not.toEqual(d.slides[1].els.map((e) => e.id));
    d = moveSlide(d, b.slide.id, 0);
    expect(d.slides[0].id).toBe(b.slide.id);
    d = deleteSlides(d, d.slides.map((s) => s.id));
    expect(d.slides).toHaveLength(1);                  // there is always a slide
  });
  it('a layout puts boxes in place, and a new layout keeps the text', () => {
    let d = newDeck();
    const s = d.slides[0];
    d = updateEls(d, s.id, [s.els[0].id], { html: 'Hello' });
    d = setLayout(d, s.id, 'titleContent');
    const els = d.slides[0].els;
    expect(els.find((e) => e.ph === 'title')!.html).toBe('Hello');
    expect(els.some((e) => e.ph === 'body')).toBe(true);
    expect(els.some((e) => e.ph === 'subtitle')).toBe(false);          // it was empty
    d = setLayout(d, s.id, 'blank');
    expect(d.slides[0].els.map((e) => e.html)).toEqual(['Hello']);      // text is not thrown away
    expect(d.slides[0].els[0].ph).toBeUndefined();
  });
  it('align, distribute, stack and style', () => {
    let d = newDeck();
    const id = d.slides[0].id;
    const a = { ...newTextEl(d, 'a'), x: 0, y: 0, w: 100, h: 50 };
    const b = { ...newTextEl(d, 'b'), x: 300, y: 100, w: 100, h: 50 };
    const c = { ...newTextEl(d, 'c'), x: 1000, y: 200, w: 100, h: 50 };
    d = addEls(d, id, [a, b, c]);
    d = distributeEls(d, id, [a.id, b.id, c.id], 'horizontal');
    expect(d.slides[0].els.find((e) => e.id === b.id)!.x).toBe(500);
    d = alignEls(d, id, [a.id], 'center');
    expect(d.slides[0].els.find((e) => e.id === a.id)!.x).toBe(590);   // one box centres on the slide
    d = alignEls(d, id, [a.id, c.id], 'right');
    expect(d.slides[0].els.find((e) => e.id === a.id)!.x).toBe(1000);
    d = reorderEls(d, id, [a.id], 'front');
    expect(d.slides[0].els.at(-1)!.id).toBe(a.id);
    d = reorderEls(d, id, [a.id], 'back');
    expect(d.slides[0].els[0].id).toBe(a.id);
    d = styleEls(d, id, [a.id], { b: 1, size: 40 });
    d = styleEls(d, id, [a.id], { b: undefined });
    expect(d.slides[0].els.find((e) => e.id === a.id)!.style).toMatchObject({ size: 40 });
    expect(d.slides[0].els.find((e) => e.id === a.id)!.style!.b).toBeUndefined();
  });
  it('a new slide size moves the boxes with it', () => {
    let d = newDeck();
    d = addEls(d, d.slides[0].id, [{ ...newShapeEl(d, 'rect'), x: 640, y: 360, w: 128, h: 72 }]);
    d = setSlideSize(d, SIZE_STANDARD);
    const e = d.slides[0].els.at(-1)!;
    expect(d.width).toBe(960);
    expect(e.x).toBe(480); expect(e.w).toBe(96);
  });
  it('transitions, title and a picture that is not larger than the slide', () => {
    let d = newDeck();
    const { deck, slide } = addSlide(d, 1, 'titleOnly'); d = deck;
    d = updateEls(d, slide.id, [slide.els[0].id], { html: '<div>My title</div>' });
    expect(slideTitle(d.slides[1])).toBe('My title');
    d = setTransition(d, 'all', 'fade');
    expect(d.slides.every((s) => s.transition === 'fade')).toBe(true);
    d = setTransition(d, [slide.id], 'none');
    expect(d.slides[1].transition).toBeUndefined();
    const img = newImageEl(d, 'data:image/png;base64,AA', { w: 4000, h: 2000 });
    expect(img.w).toBeLessThanOrEqual(d.width * 0.7);
    expect(img.w / img.h).toBeCloseTo(2);
    d = updateSlide(d, slide.id, { hidden: 1 });
    expect(d.slides[1].hidden).toBe(1);
  });
});

describe('the store', () => {
  it('undo and redo, and a drag is one step', () => {
    const s = new DeckStore(newDeck());
    const id = s.deck.slides[0].id;
    const first = s.deck;
    s.set(updateSlide(s.deck, id, { notes: 'a' }));
    s.live(updateSlide(s.deck, id, { notes: 'b' }));
    s.live(updateSlide(s.deck, id, { notes: 'c' }));
    s.endLive();
    expect(s.deck.slides[0].notes).toBe('c');
    expect(s.undo()).toBe(true);
    expect(s.deck.slides[0].notes).toBe('a');
    expect(s.undo()).toBe(true);
    expect(s.deck).toBe(first);
    expect(s.undo()).toBe(false);
    expect(s.redo()).toBe(true); expect(s.redo()).toBe(true);
    expect(s.deck.slides[0].notes).toBe('c');
    expect(s.canRedo).toBe(false);
  });
  it('a change after an undo drops the redo list; load starts again', () => {
    const s = new DeckStore(newDeck());
    const id = s.deck.slides[0].id;
    s.set(updateSlide(s.deck, id, { notes: 'a' }));
    s.undo();
    s.set(updateSlide(s.deck, id, { notes: 'z' }));
    expect(s.canRedo).toBe(false);
    s.load(newDeck());
    expect(s.canUndo).toBe(false);
  });
});

describe('drawing', () => {
  it('draws a slide with its boxes, theme colours and no scripts', () => {
    let d = newDeck();
    d = addEls(d, d.slides[0].id, [newShapeEl(d, 'star'), { ...newImageEl(d, 'data:image/png;base64,AA', { w: 10, h: 10 }, 'a "pic"') }]);
    const dom = renderSlide(d, d.slides[0]);
    expect(dom.style.width).toBe('1280px');
    expect(dom.style.getPropertyValue('--pr-accent')).toBe('#2563eb');
    expect(dom.querySelectorAll('.wy-pr-el')).toHaveLength(4);
    expect(dom.querySelector('svg path')).toBeTruthy();
    expect(dom.querySelector('img')!.alt).toBe('a "pic"');
  });
  it('the exported page has every shown slide and a print size', () => {
    let d = newDeck('A <b> & "title"');
    d = addSlide(d, 1, 'blank').deck;
    d = addSlide(d, 2, 'blank').deck;
    d = updateSlide(d, d.slides[1].id, { hidden: 1 });
    const html = deckToHTML(d);
    expect(html.match(/<section class="s"/g)).toHaveLength(2);
    expect(html).toContain('<title>A &lt;b&gt; &amp; &quot;title&quot;</title>');
    expect(html).toContain('@page{size:1280px 720px');
  });
});
