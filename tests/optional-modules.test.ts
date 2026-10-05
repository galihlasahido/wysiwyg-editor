import { afterEach, describe, expect, it } from 'vitest';
import { Equations, Mermaid, PdfEpub, createEditor, defaultPlugins } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const host = () => { const e = document.body.appendChild(document.createElement('div')); roots.push(e); return e; };

describe('optional packages are passed in, never imported by the editor itself', () => {
  it('exportDocx and importDocx explain what to pass and install when docx is not set up', async () => {
    const ed = createEditor({ element: host() });
    await expect(ed.exportDocx()).rejects.toThrow(/docx: \(\) => import\('wysiwygido\/docx'\)/);
    await expect(ed.importDocx(new Blob(['x']))).rejects.toThrow(/docx module/);
    ed.destroy();
  });
  it('a loader that fails gives the install hint', async () => {
    const ed = createEditor({ element: host(), docx: () => Promise.reject(new Error('Cannot find package')) });
    await expect(ed.exportDocx()).rejects.toThrow(/pnpm add docx mammoth/);
    ed.destroy();
  });
  it('Equations and Mermaid without their package say how to pass it, and accept a module or a loader', async () => {
    const eq = createEditor({ element: host(), content: '<p>x <span data-math="x^2"></span></p>', plugins: [...defaultPlugins, Equations()] });
    await new Promise((r) => setTimeout(r, 40));
    expect(eq.view.dom.textContent).toMatch(/KaTeX is not set up|x\^2/);
    eq.destroy();
    const m = Mermaid();
    expect(m.name).toBe('mermaid');
  });
  it('PdfEpub explains when PDF or EPUB support is not passed', async () => {
    const ed = createEditor({ element: host(), plugins: [...defaultPlugins, PdfEpub()] });
    const msgs: string[] = [];
    ed.on('error', (e: any) => msgs.push(e.message));
    ed.execute('importPdf', new Blob(['x']));
    ed.execute('exportEpub', '');
    await new Promise((r) => setTimeout(r, 40));
    expect(msgs.some((m) => /loadPdf/.test(m))).toBe(true);
    expect(msgs.some((m) => /loadEpub/.test(m))).toBe(true);
    ed.destroy();
  });
});
