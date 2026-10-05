// The editor must never import its optional packages (docx, mammoth, jszip, pdfjs-dist, katex, mermaid, yjs…) from the files an app gets
// by importing "wysiwygido": bundlers such as Angular's esbuild or webpack fail when a package they cannot find is imported, even lazily.
// Only the separate entry points (wysiwygido/docx, /pdf, /epub, /collab, /react, /vue) may mention them. This walks everything reachable
// from the main entry (static and dynamic imports) and fails if one of those files names an optional package.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const dist = resolve(process.argv[2] ?? 'dist');
const OPTIONAL = ['docx', 'mammoth', 'jszip', 'pdfjs-dist', 'katex', 'mermaid', 'yjs', 'y-prosemirror', 'y-protocols', 'lib0', 'react', 'vue'];

/** The module specifiers a file imports: `from "x"`, `import "x"` and `import("x")` in real code, not inside strings or comments. */
function specifiers(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const skipWs = () => { while (i < n && /\s/.test(src[i])) i++; };
  const readString = () => {
    const q = src[i++];
    let v = '';
    while (i < n && src[i] !== q) { if (src[i] === '\\') { v += src[i + 1]; i += 2; } else v += src[i++]; }
    i++;
    return v;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2); i = i < 0 ? n : i + 2; continue; }
    if (c === '"' || c === "'") { readString(); continue; }
    if (c === '`') { i++; let depth = 0; while (i < n && !(src[i] === '`' && depth === 0)) { if (src[i] === '\\') i += 2; else if (src[i] === '$' && src[i + 1] === '{') { depth++; i += 2; } else if (src[i] === '}' && depth > 0) { depth--; i++; } else i++; } i++; continue; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i; while (j < n && /[\w$]/.test(src[j])) j++;
      const word = src.slice(i, j);
      const prev = src[i - 1];
      i = j;
      if ((word === 'from' || word === 'import') && prev !== '.') {
        const save = i; skipWs();
        if (word === 'import' && src[i] === '(') { i++; skipWs(); }
        if (src[i] === '"' || src[i] === "'") out.push(readString()); else i = save;
      }
      continue;
    }
    i++;
  }
  return out;
}

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
