// "wysiwygido/data-table" is the data table without the editor. It must stay that way: nothing reachable from it may import
// ProseMirror (or any other package), or an app that only wants a grid would ship the editor. This walks every file reachable from
// dist/data-table.js and fails on the first import that is not another file of the build.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const seen = new Set();
const problems = [];
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = m[1];
    if (spec.startsWith('.')) walk(join(dirname(file), spec));
    else problems.push(`${file.slice(dist.length + 1)} imports "${spec}"`);
  }
};
walk(join(dist, 'data-table.js'));
// the editor itself must not be pulled in either
for (const f of seen) if (/\/wysiwygido\.js$/.test(f)) problems.push(`the main editor entry is reachable (${f.slice(dist.length + 1)})`);
if (problems.length) { console.error(`wysiwygido/data-table is not stand-alone:\n  ${problems.join('\n  ')}`); process.exit(1); }
console.log(`wysiwygido/data-table is stand-alone: ${seen.size} files, no package imports.`);
