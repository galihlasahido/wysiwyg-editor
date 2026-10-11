import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8');

describe('table cells and list items stay as tight as Word', () => {
  it('resets the paragraph margins inside cells and list items', () => {
    expect(css).toMatch(/\.wy-content td > p, \.wy-content th > p, \.wy-content li > p \{ margin-top: 0; margin-bottom: 0; \}/);
  });
  it('uses compact, adjustable cell padding and line height', () => {
    expect(css).toMatch(/padding: var\(--wy-cell-pad-y, 2px\) var\(--wy-cell-pad-x, 7px\)/);
    expect(css).toMatch(/line-height: var\(--wy-cell-line-height, 1\.3\)/);
  });
});
