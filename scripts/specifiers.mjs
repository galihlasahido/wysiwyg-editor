// The module specifiers a source file imports, read with a small tokenizer so words inside strings and comments do not count.
/** The module specifiers a file imports: `from "x"`, `import "x"` and `import("x")` in real code, not inside strings or comments. */
export function specifiers(src) {
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

