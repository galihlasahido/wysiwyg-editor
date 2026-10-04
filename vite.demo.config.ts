import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Multi-page build: the gallery plus every page in demo/.
const pages = Object.fromEntries([
  ['index', resolve(import.meta.dirname, 'index.html')],
  ...readdirSync(resolve(import.meta.dirname, 'demo'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`demo/${f.replace('.html', '')}`, resolve(import.meta.dirname, 'demo', f)]),
]);

// Pages whose demo runs the user's own code in a sandboxed iframe through srcdoc. A srcdoc frame inherits the parent's
// Content-Security-Policy, so a policy that forbids inline scripts would stop the very thing they demonstrate.
const RUNS_CODE = new Set(['code-editor', 'coding-docs', 'coding-notebook', 'coding-playground']);
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // ProseMirror positions things with inline styles
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' blob: data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** Adds a Content-Security-Policy to the built pages (not in dev, where Vite injects inline scripts for hot reload). */
const csp: Plugin = {
  name: 'demo-csp',
  apply: 'build',
  transformIndexHtml(html, ctx) {
    const name = ctx.path.replace(/^\/(?:demo\/)?/, '').replace(/\.html$/, '');
    if (RUNS_CODE.has(name)) return html;
    return html.replace('<head>', `<head>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
  },
};

export default defineConfig({ base: './', plugins: [csp], build: { outDir: 'demo-dist', rollupOptions: { input: pages } } });
