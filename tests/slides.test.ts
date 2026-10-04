import { describe, expect, it } from 'vitest';
import { splitSlides } from '../src';

describe('splitSlides', () => {
  it('splits on horizontal lines and drops empty slides', () => {
    const s = splitSlides('<h1>One</h1><p>a</p><hr><hr><h2>Two</h2><p>b</p><hr>');
    expect(s.map((x) => x.title)).toEqual(['One', 'Two']);
    expect(s[0].html).toBe('<h1>One</h1><p>a</p>');
  });
  it('pulls speaker notes out of the slide', () => {
    const s = splitSlides('<h1>T</h1><p>Notes: say hello</p><p>body</p><p>notes: and goodbye</p>');
    expect(s).toHaveLength(1);
    expect(s[0].notes).toBe('say hello\nand goodbye');
    expect(s[0].html).not.toContain('Notes');
    expect(s[0].html).toContain('body');
  });
  it('can split by headings', () => {
    const s = splitSlides('<h1>A</h1><p>x</p><h2>B</h2><p>y</p><h2>C</h2>', { by: 'heading' });
    expect(s.map((x) => x.title)).toEqual(['A', 'B', 'C']);
    expect(s[1].html).toBe('<h2>B</h2><p>y</p>');
  });
  it('falls back to a text title', () => {
    expect(splitSlides('<p>Just text here</p>')[0].title).toBe('Just text here');
  });
});
