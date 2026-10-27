import { describe, expect, it } from 'vitest';
import { examples } from '../demo/full';
import { cdnModule, pageFiles } from '../demo/full-code';
import { existsSync, readdirSync } from 'node:fs';

// the package entries the examples may import from, and the source module behind each
const ENTRIES: Record<string, () => Promise<Record<string, unknown>>> = {
  wysiwygido: () => import('../src'),
  'wysiwygido/data-table': () => import('../src/data-table-app'),
  'wysiwygido/spreadsheet': () => import('../src/spreadsheet-app'),
  'wysiwygido/presentation': () => import('../src/presentation-app'),
  'wysiwygido/collab': () => import('../src/collab'),
  'wysiwygido/docx': () => import('../src/docx'),
  'wysiwygido/pdf': () => import('../src/pdf'),
  'wysiwygido/epub': () => import('../src/epub'),
};

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (code: string) => unknown;
const IMPORT = /^import\s+(?:([^'"]*?)\s+from\s+)?['"]([^'"]+)['"];?[ \t]*$/gm;

/** Parses the module as plain JavaScript (a type annotation or a `!` is a syntax error) and lists what it imports. */
function check(code: string) {
  const errors: string[] = [];
  const imports: { from: string; names: string[] }[] = [];
  const body = code.replace(IMPORT, (_m, clause: string | undefined, from: string) => {
    const names = [...(clause?.match(/\{([^}]*)\}/)?.[1].split(',') ?? [])].map((n) => n.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    imports.push({ from, names });
    return '';
  });
  try { new AsyncFunction(body); } catch (e) { errors.push(String(e)); }
  return { errors, imports };
}

describe('full examples on the demo pages', () => {
  const pages = readdirSync('demo').filter((f) => f.endsWith('.html')).map((f) => f.replace('.html', ''));

  it('only describe pages that exist', () => {
    for (const name of Object.keys(examples)) expect(pages, name).toContain(name);
    for (const name of Object.keys(examples)) expect(existsSync(`demo/${name}.html`), name).toBe(true);
  });

  for (const [name, ex] of Object.entries(examples)) {
    it(`${name}: valid JavaScript, imports names the package really exports`, async () => {
      const { errors, imports } = check(ex.code);
      expect(errors, name).toEqual([]);
      for (const imp of imports) {
        if (imp.from === 'wysiwygido/style.css') continue;
        if (imp.from in ENTRIES) {
          const mod = await ENTRIES[imp.from]();
          for (const n of imp.names) expect(n in mod, `${name}: ${n} is not exported by ${imp.from}`).toBe(true);
        } else expect(ex.install ?? [], `${name}: ${imp.from} must be listed in install`).toContain(imp.from.split('/').slice(0, imp.from.startsWith('@') ? 2 : 1).join('/'));
      }
    });

    it(`${name}: the CDN page has no bare imports and no leftover stylesheet import`, () => {
      if (ex.noCdn) return;
      const cdn = cdnModule(ex.code);
      expect(cdn).not.toMatch(/from\s+['"](?!https:)/);
      expect(cdn).not.toMatch(/style\.css['"];/);
      expect(pageFiles(ex)).toHaveLength(2);
    });
  }
});
