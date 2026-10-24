// The editor must never import its optional packages (docx, mammoth, jszip, pdfjs-dist, katex, mermaid, yjs…) from the files an app gets
// by importing "wysiwygido": bundlers such as Angular's esbuild or webpack fail when a package they cannot find is imported, even lazily.
// Only the separate entry points (wysiwygido/docx, /pdf, /epub, /collab, /react, /vue) may mention them. This walks everything reachable
// from the main entry (static and dynamic imports) and fails if one of those files names an optional package.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { specifiers } from './specifiers.mjs';

const dist = resolve(process.argv[2] ?? 'dist');
const OPTIONAL = ['docx', 'mammoth', 'jszip', 'pdfjs-dist', 'katex', 'mermaid', 'yjs', 'y-prosemirror', 'y-protocols', 'lib0', 'react', 'vue'];

const seen = new Set();
const bad = [];
const walk = (file) => {
  if (seen.has(file)) return;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const s of specifiers(src)) {
    if (s.startsWith('.')) { walk(resolve(dirname(file), s)); continue; }
    const pkg = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
    if (OPTIONAL.includes(pkg)) bad.push(`${file.replace(dist + '/', '')} imports "${s}"`);
  }
};
walk(join(dist, 'wysiwygido.js'));
if (bad.length) { console.error(`Optional packages reachable from the main entry:\n${bad.join('\n')}`); process.exit(1); }
console.log(`check-optional-peers: ${seen.size} files reachable from the main entry, none import an optional package`);
