/**
 * A small dependency-free syntax highlighter: it finds comments, strings, numbers, keywords and a few
 * language-specific pieces. It is not a parser (no nested template literals, regex literals or heredocs), which
 * is a fine trade for an editor. Plug in a different one with `CodeBlocks({ highlight })`.
 */
export type TokenType = 'comment' | 'string' | 'number' | 'keyword' | 'function' | 'literal' | 'tag' | 'attr' | 'variable' | 'property' | 'punct';
export interface Token { from: number; to: number; type: TokenType }
export type Highlighter = (code: string, language: string | null) => Token[];

const words = (s: string) => new Set(s.split(/\s+/));
const JS = words('as async await break case catch class const continue debugger default delete do else enum export extends finally for from function if implements import in instanceof interface let new of package private protected public readonly return static super switch this throw try type typeof var void while with yield abstract declare namespace keyof satisfies');
const PY = words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case');
const SH = words('if then else elif fi for while until do done case esac in function select time echo cd export source alias unset local return exit set read test');
const SQL = words('select from where and or not insert into values update set delete create table drop alter add index join left right inner outer on group by order having limit offset as distinct union all null is in like between exists primary key foreign references default unique check');
const CSS_AT = /^@[\w-]+/;
const LITERALS = words('true false null undefined NaN Infinity None True False');

type Lang = 'js' | 'py' | 'json' | 'css' | 'html' | 'sh' | 'sql' | 'plain';
const ALIASES: Record<string, Lang> = {
  js: 'js', javascript: 'js', jsx: 'js', ts: 'js', typescript: 'js', tsx: 'js', mjs: 'js', java: 'js', c: 'js', cpp: 'js', 'c++': 'js', cs: 'js', 'c#': 'js', go: 'js', rust: 'js', rs: 'js', php: 'js', kotlin: 'js', swift: 'js',
  py: 'py', python: 'py', rb: 'py', ruby: 'py',
  json: 'json', jsonc: 'json', css: 'css', scss: 'css', less: 'css',
  html: 'html', xml: 'html', svg: 'html', vue: 'html',
  sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh',
  sql: 'sql',
};

export function resolveLanguage(language: string | null): Lang {
  return (language && ALIASES[language.toLowerCase()]) || 'plain';
}

/** Scan `code` and return non-overlapping tokens in order. */
export const simpleHighlight: Highlighter = (code, language) => {
  const lang = resolveLanguage(language);
  if (lang === 'plain') return [];
  const out: Token[] = [];
  const n = code.length;
  const add = (from: number, to: number, type: TokenType) => to > from && out.push({ from, to, type });
  const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
  const isId = (c: string) => /[\w$]/.test(c);
  let i = 0;

  while (i < n) {
    const c = code[i];
    const rest2 = code.slice(i, i + 2);

    // ---- comments
    if ((lang === 'js' || lang === 'css') && rest2 === '/*') {
      const e = code.indexOf('*/', i + 2);
      const to = e < 0 ? n : e + 2;
      add(i, to, 'comment');
      i = to;
      continue;
    }
    if ((lang === 'js' || lang === 'json') && rest2 === '//') {
      const e = code.indexOf('\n', i);
      add(i, e < 0 ? n : e, 'comment');
      i = e < 0 ? n : e;
      continue;
    }
    if ((lang === 'py' || lang === 'sh') && c === '#') {
      const e = code.indexOf('\n', i);
      add(i, e < 0 ? n : e, 'comment');
      i = e < 0 ? n : e;
      continue;
    }
    if (lang === 'sql' && rest2 === '--') {
      const e = code.indexOf('\n', i);
      add(i, e < 0 ? n : e, 'comment');
      i = e < 0 ? n : e;
      continue;
    }
    if (lang === 'html' && code.startsWith('<!--', i)) {
      const e = code.indexOf('-->', i + 4);
      const to = e < 0 ? n : e + 3;
      add(i, to, 'comment');
      i = to;
      continue;
    }

    // ---- html tags
    if (lang === 'html' && c === '<' && /[A-Za-z/!]/.test(code[i + 1] ?? '')) {
      const m = /^<\/?[\w:-]*/.exec(code.slice(i))!;
      add(i, i + m[0].length, 'tag');
      i += m[0].length;
      // attributes until '>'
      while (i < n && code[i] !== '>') {
        if (/\s/.test(code[i])) { i++; continue; }
        if (code[i] === '"' || code[i] === "'") {
          const q = code[i];
          const e = code.indexOf(q, i + 1);
          const to = e < 0 ? n : e + 1;
          add(i, to, 'string');
          i = to;
          continue;
        }
        const am = /^[\w:@.-]+/.exec(code.slice(i));
        if (am) { add(i, i + am[0].length, 'attr'); i += am[0].length; continue; }
        i++;
      }
      if (i < n) { add(i, i + 1, 'tag'); i++; }
      continue;
    }

    // ---- strings
    if (c === '"' || c === "'" || (c === '`' && lang !== 'sql' && lang !== 'json' && lang !== 'html')) {
      const triple = lang === 'py' && code.startsWith(c.repeat(3), i);
      const q = triple ? c.repeat(3) : c;
      let j = i + q.length;
      while (j < n) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code.startsWith(q, j)) { j += q.length; break; }
        if (!triple && code[j] === '\n' && c !== '`') break; // unterminated: stop at the line end
        j++;
      }
      j = Math.min(j, n);
      // JSON: a string followed by ':' is a key
      const isKey = lang === 'json' && /^\s*:/.test(code.slice(j));
      add(i, j, isKey ? 'property' : 'string');
      i = j;
      continue;
    }

    // ---- css hex colors
    if (lang === 'css' && c === '#') {
      const m = /^#[\da-fA-F]{3,8}\b/.exec(code.slice(i));
      if (m) { add(i, i + m[0].length, 'number'); i += m[0].length; continue; }
    }

    // ---- numbers
    if (/\d/.test(c) || (c === '.' && /\d/.test(code[i + 1] ?? ''))) {
      const m = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?|\.\d+)(?:%|[a-zA-Z]{1,4})?/.exec(code.slice(i))!;
      const prev = code[i - 1];
      if (!prev || !isId(prev)) { add(i, i + m[0].length, 'number'); i += m[0].length; continue; }
    }

    // ---- variables ($VAR in shell, @at-rules and --custom-props in css)
    if (lang === 'sh' && c === '$') {
      const m = /^\$(?:\{[^}]*\}|[\w@*#?$!-]+)/.exec(code.slice(i));
      if (m) { add(i, i + m[0].length, 'variable'); i += m[0].length; continue; }
    }
    if (lang === 'css') {
      const at = CSS_AT.exec(code.slice(i));
      if (c === '@' && at) { add(i, i + at[0].length, 'keyword'); i += at[0].length; continue; }
      const prop = /^-?-?[a-zA-Z][\w-]*(?=\s*:(?!:))/.exec(code.slice(i));
      if (prop && /[;{\s]/.test(code[i - 1] ?? '{')) { add(i, i + prop[0].length, 'property'); i += prop[0].length; continue; }
    }

    // ---- identifiers: keywords, literals, calls
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isId(code[j])) j++;
      const word = code.slice(i, j);
      const lower = lang === 'sql' ? word.toLowerCase() : word;
      const kw = lang === 'js' ? JS : lang === 'py' ? PY : lang === 'sh' ? SH : lang === 'sql' ? SQL : null;
      if (LITERALS.has(word)) add(i, j, 'literal');
      else if (kw?.has(lower)) add(i, j, 'keyword');
      else if (lang !== 'json' && lang !== 'css' && code[j] === '(') add(i, j, 'function');
      i = j;
      continue;
    }
    i++;
  }
  return out;
};
