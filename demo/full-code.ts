/**
 * Complete, copy-ready examples for the demo pages. Each page has one entry written once as a plain ES module (valid JavaScript,
 * importing from 'wysiwygido'); the npm/Vite files and the single-file CDN page are both generated from it.
 */
import { examples } from './full';

export interface FullExample {
  /** The whole module: imports first, then the code. Plain JavaScript (no type annotations); mount into `document.getElementById('editor')`. */
  code: string;
  /** Markup placed in the page body. Default: `<div id="editor"></div>`. */
  html?: string;
  /** Extra CSS for the page, if the example needs layout of its own. */
  css?: string;
  /** Packages to install besides wysiwygido (peer packages such as yjs, katex). */
  install?: string[];
  /** Set when the example cannot run from a CDN page: the reason is shown instead of the CDN tab. */
  noCdn?: string;
}

export const CDN_VERSION = '1.4.0';
const ESM = 'https://esm.sh/';

/** The module for a CDN page: bare imports become esm.sh URLs (pinned for wysiwygido), the stylesheet import is dropped (a <link> loads it). */
export function cdnModule(code: string): string {
  return code
    .replace(/^import\s+['"]wysiwygido\/style\.css['"];?\s*\n/m, '')
    .replace(/(from\s+|import\s+)(['"])(wysiwygido)((?:\/[\w-]+)?)\2/g, (_m, pre, q, _p, sub) => `${pre}${q}${ESM}wysiwygido@${CDN_VERSION}${sub}${q}`)
    .replace(/(from\s+|import\s+)(['"])((?:@[\w-]+\/)?[a-z][\w.-]*(?:\/[\w./-]+)?)\2/g, (m, pre, q, spec) => (spec.startsWith('wysiwygido') || spec.startsWith('http') ? m : `${pre}${q}${ESM}${spec}${q}`))
    .trim();
}

const indent = (text: string, by: string) => text.split('\n').map((l) => (l ? by + l : l)).join('\n');

export function pageFiles(ex: FullExample): { name: string; files: { file: string; code: string }[] }[] {
  const body = ex.html ?? '<div id="editor"></div>';
  const style = (pad: string) => (ex.css ? `${pad}<style>\n${indent(ex.css.trim(), pad + '  ')}\n${pad}</style>\n` : '');
  const mount = (m: string) => (m.includes('style.css') ? m : `import 'wysiwygido/style.css';\n${m}`);
  const npm = {
    name: 'npm / Vite',
    files: [
      { file: 'terminal', code: `npm create vite@latest my-app -- --template vanilla\ncd my-app\nnpm install wysiwygido${ex.install?.length ? ' ' + ex.install.join(' ') : ''}\nnpm run dev` },
      { file: 'index.html', code: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>My app</title>\n${style('    ')}  </head>\n  <body>\n${indent(body, '    ')}\n    <script type="module" src="/src/main.js"></script>\n  </body>\n</html>` },
      { file: 'src/main.js', code: mount(ex.code.trim()) },
    ],
  };
  if (ex.noCdn) return [npm, { name: 'CDN (one HTML file)', files: [{ file: 'notes', code: ex.noCdn }] }];
  const cdn = {
    name: 'CDN (one HTML file)',
    files: [
      { file: 'index.html  (save it and open it in a browser: no install, no build)', code: `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>My app</title>\n    <link rel="stylesheet" href="https://unpkg.com/wysiwygido@${CDN_VERSION}/dist/style.css" />\n${style('    ')}  </head>\n  <body>\n${indent(body, '    ')}\n\n    <script type="module">\n${indent(cdnModule(ex.code), '      ')}\n    </script>\n  </body>\n</html>` },
      { file: 'notes', code: `// The version is pinned (@${CDN_VERSION}) so a new release never changes your page. Use the same number in the stylesheet and the script.` },
    ],
  };
  return [npm, cdn];
}

/** The complete example for the page being viewed, or null when there is none. */
export function exampleForPage(name = location.pathname.split('/').pop()!.replace(/\.html$/, '')): FullExample | null {
  return examples[name] ?? null;
}
