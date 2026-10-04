import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Multi-page build: the gallery plus every page in demo/.
const pages = Object.fromEntries([
  ['index', resolve(import.meta.dirname, 'index.html')],
  ...readdirSync(resolve(import.meta.dirname, 'demo'))
    .filter((f) => f.endsWith('.html'))
    .map((f) => [`demo/${f.replace('.html', '')}`, resolve(import.meta.dirname, 'demo', f)]),
]);

export default defineConfig({ base: './', build: { outDir: 'demo-dist', rollupOptions: { input: pages } } });
