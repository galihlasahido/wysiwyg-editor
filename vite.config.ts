import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'wysiwyg-editor': resolve(import.meta.dirname, 'src/index.ts'),
        docx: resolve(import.meta.dirname, 'src/docx.ts'),
        collab: resolve(import.meta.dirname, 'src/collab.ts'),
        react: resolve(import.meta.dirname, 'src/react.ts'),
        vue: resolve(import.meta.dirname, 'src/vue.ts'),
      },
      fileName: (_format, name) => `${name}.js`,
      formats: ['es'],
      cssFileName: 'style',
    },
    rollupOptions: { external: [/^prosemirror-/, /^markdown-it/, /^y-/, /^yjs/, /^lib0/, /^docx$/, /^mammoth/, /^react/, /^vue/] },
  },
  // Pre-bundle the lazily imported optional packages so the dev server does not reload the page when it first meets them.
  optimizeDeps: { include: ['docx', 'mammoth', 'yjs', 'y-prosemirror', 'y-protocols/awareness', 'y-protocols/sync', 'lib0/encoding', 'lib0/decoding'] },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
