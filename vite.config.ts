import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        'wysiwyg-editor': resolve(import.meta.dirname, 'src/index.ts'),
        docx: resolve(import.meta.dirname, 'src/docx.ts'),
        collab: resolve(import.meta.dirname, 'src/collab.ts'),
      },
      fileName: (_format, name) => `${name}.js`,
      formats: ['es'],
      cssFileName: 'style',
    },
    rollupOptions: { external: [/^prosemirror-/, /^markdown-it/, /^y-/, /^yjs/, /^lib0/, /^docx$/, /^mammoth/] },
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
