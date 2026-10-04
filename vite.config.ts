import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.ts'),
      name: 'WysiwygEditor',
      fileName: 'wysiwyg-editor',
      formats: ['es'],
      cssFileName: 'style',
    },
    rollupOptions: { external: [/^prosemirror-/, /^markdown-it/, /^y-/, /^yjs/, /^lib0/] },
  },
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], setupFiles: ['tests/setup.ts'] },
});
