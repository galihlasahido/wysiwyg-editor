// Make the generated declaration files resolve under Node's ESM rules ("moduleResolution": "node16"): relative imports need a file
// extension (and a directory import needs /index.js). Also drops side-effect imports of stylesheets, which have no declaration.
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist');
const walk = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.d.ts') ? [p] : []; });
let changed = 0, unresolved = [];
for (const file of walk(root)) {
  const src = readFileSync(file, 'utf8');
  const out = src
    .replace(/^import\s+['"][^'"]+\.css['"];?\r?\n/gm, '')
    .replace(/(\bfrom\s+|\bimport\s*\(\s*|^import\s+)(['"])(\.{1,2}\/[^'"]*)\2/gm, (m, pre, q, spec) => {
      if (/\.(?:js|mjs|css|json)$/.test(spec)) return m;
      const base = resolve(dirname(file), spec);
      if (existsSync(`${base}.d.ts`)) return `${pre}${q}${spec}.js${q}`;
      if (existsSync(join(base, 'index.d.ts'))) return `${pre}${q}${spec.replace(/\/$/, '')}/index.js${q}`;
      unresolved.push(`${file}: ${spec}`);
      return m;
    });
  if (out !== src) { writeFileSync(file, out); changed++; }
}
console.log(`fix-dts: ${changed} declaration files updated`);
if (unresolved.length) { console.error(`fix-dts: could not resolve\n${unresolved.join('\n')}`); process.exit(1); }
