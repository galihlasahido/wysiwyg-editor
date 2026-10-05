import { describe, expect, it } from 'vitest';
import { diffDocuments } from '../src/diff';

describe('diffDocuments', () => {
  it('reports no changes for identical documents', () => {
    const r = diffDocuments('<h1>T</h1><p>same</p>', '<h1>T</h1><p>same</p>');
    expect(r.stats).toEqual({ added: 0, removed: 0, changedBlocks: 0 });
    expect(r.html).not.toMatch(/wy-diff/);
  });
  it('shows an edited paragraph word by word', () => {
    const r = diffDocuments('<p>The quick brown fox jumps</p>', '<p>The quick red fox leaps high</p>');
    expect(r.html).toContain('<del class="wy-diff-del">brown</del>');
    expect(r.html).toContain('<ins class="wy-diff-ins">red</ins>');
    expect(r.html).toContain('leaps');
    expect(r.stats.changedBlocks).toBe(1);
    expect(r.stats.added).toBe(3); // red, leaps, high
    expect(r.stats.removed).toBe(2); // brown, jumps
  });
  it('marks whole added and removed blocks and keeps unchanged ones plain', () => {
    const r = diffDocuments('<h1>A</h1><p>keep</p><p>gone</p>', '<h1>A</h1><p>keep</p><h2>New section</h2><p>more</p>');
    expect(r.html).toContain('<p>keep</p>');
    expect(r.html).toMatch(/wy-diff-del-block[^>]*>gone/);
    expect(r.html).toMatch(/wy-diff-ins-block[^>]*>more/);
  });
  it('diffs list items inside a list', () => {
    const r = diffDocuments('<ul><li><p>one</p></li><li><p>two</p></li></ul>', '<ul><li><p>one</p></li><li><p>two and three</p></li><li><p>four</p></li></ul>');
    expect(r.html).toContain('<ins class="wy-diff-ins"> and three</ins>');
    expect(r.html).toMatch(/wy-diff-ins-block[^>]*>[\s\S]*four/);
  });
  it('is safe: scripts and handlers in a stored version are removed', () => {
    const r = diffDocuments('<p>a</p>', '<p>a</p><p onclick="x()">b<script>alert(1)</script><img src="x" onerror="alert(2)"></p>');
    expect(r.html).not.toMatch(/<script|onclick|onerror/i);
  });
  it('does not freeze on large documents', () => {
    const big = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `<p>${tag} paragraph number ${i}</p>`).join('');
    const t = Date.now();
    const r = diffDocuments(big(3000, 'old'), big(3000, 'new'));
    expect(Date.now() - t).toBeLessThan(5000);
    expect(r.stats.changedBlocks).toBeGreaterThan(0);
  });
  it('handles empty documents', () => {
    expect(diffDocuments('', '<p>x</p>').stats.added).toBe(1);
    expect(diffDocuments('<p>x</p>', '').stats.removed).toBe(1);
    expect(diffDocuments('', '').html).toBe('');
  });
});
