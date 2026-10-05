import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        wysiwygido: resolve(import.meta.dirname, 'src/index.ts'),
        docx: resolve(import.meta.dirname, 'src/docx.ts'),
        pdf: resolve(import.meta.dirname, 'src/pdf.ts'),
        epub: resolve(import.meta.dirname, 'src/epub.ts'),
        collab: resolve(import.meta.dirname, 'src/collab.ts'),
        react: resolve(import.meta.dirname, 'src/react.ts'),
        adapter: resolve(import.meta.dirname, 'src/adapter.ts'),
        svelte: resolve(import.meta.dirname, 'src/svelte.ts'),
        vue: resolve(import.meta.dirname, 'src/vue.ts'),
      },
      fileName: (_format, name) => `${name}.js`,
      formats: ['es'],
      cssFileName: 'style',
    },
    // a library ships readable code with source maps: the app's bundler minifies once, and stack traces stay useful
    minify: false,
    sourcemap: true,
    rollupOptions: { external: [/^prosemirror-/, /^markdown-it/, /^y-/, /^yjs/, /^lib0/, /^docx$/, /^mammoth/, /^pdfjs-dist/, /^jszip/, /^katex/, /^mermaid/, /^react/, /^vue/] },
  },
  // Pre-bundle the lazily imported optional packages so the dev server does not reload the page when it first meets them.
  optimizeDeps: { include: ['katex', 'mermaid', 'docx', 'mammoth', 'jszip', 'pdfjs-dist', 'yjs', 'y-prosemirror', 'y-protocols/awareness', 'y-protocols/sync', 'lib0/encoding', 'lib0/decoding'] },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
