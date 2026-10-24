// "wysiwygido/data-table" is the data table without the editor. It must stay that way: nothing reachable from it may import
// ProseMirror (or any other package), or an app that only wants a grid would ship the editor. This walks every file reachable from
// dist/data-table.js and fails on the first import that is not another file of the build.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { specifiers } from './specifiers.mjs';

const dist = resolve(process.argv[2] ?? 'dist');
const ENTRIES = ['data-table', 'spreadsheet', 'presentation'];
let failed = false;
for (const entry of ENTRIES) {
  const file = join(dist, `${entry}.js`);
  if (!existsSync(file)) continue;
  const seen = new Set();
  const problems = [];
  const walk = (f) => {
    if (seen.has(f)) return;
    seen.add(f);
    const src = readFileSync(f, 'utf8');
    for (const spec of specifiers(src)) {
      if (spec.startsWith('.')) walk(join(dirname(f), spec));
      else problems.push(`${f.slice(dist.length + 1)} imports "${spec}"`);
    }
  };
  walk(file);
  // the editor itself must not be pulled in either
  for (const f of seen) if (/\/wysiwygido\.js$/.test(f)) problems.push(`the main editor entry is reachable (${f.slice(dist.length + 1)})`);
  if (problems.length) { console.error(`wysiwygido/${entry} is not stand-alone:\n  ${problems.join('\n  ')}`); failed = true; }
  else console.log(`wysiwygido/${entry} is stand-alone: ${seen.size} files, no package imports.`);
}
if (failed) process.exit(1);
