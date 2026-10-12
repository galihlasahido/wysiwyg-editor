import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as main from '../src';
import * as table from '../src/data-table-app';

/**
 * The public API, as names. Removing or renaming anything listed here breaks apps, so it needs a major version; adding a name is
 * fine but must be deliberate. After an intended change run `UPDATE_API=1 pnpm test api-surface` and commit `tests/api-surface.json`.
 */
const FILE = join(dirname(fileURLToPath(import.meta.url)), 'api-surface.json');
const current = { 'wysiwygido': Object.keys(main).sort(), 'wysiwygido/data-table': Object.keys(table).sort() };

describe('public API', () => {
  if (process.env.UPDATE_API) {
    it('writes the snapshot', () => { writeFileSync(FILE, `${JSON.stringify(current, null, 2)}\n`); });
    return;
  }
  const saved = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, string[]>;
  for (const entry of Object.keys(current) as (keyof typeof current)[]) {
    it(`${entry}: nothing that was exported has gone`, () => {
      expect(saved[entry].filter((n) => !current[entry].includes(n)), 'removed or renamed exports are breaking changes').toEqual([]);
    });
    it(`${entry}: new exports are recorded in tests/api-surface.json`, () => {
      expect(current[entry].filter((n) => !saved[entry].includes(n)), 'run UPDATE_API=1 pnpm test api-surface').toEqual([]);
    });
  }
});
