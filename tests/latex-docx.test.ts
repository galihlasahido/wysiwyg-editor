import JSZip from 'jszip';
import * as D from 'docx';
import { describe, expect, it } from 'vitest';
import { latexToDocx } from '../src/latex-docx';

async function xmlOf(nodes: NonNullable<ReturnType<typeof latexToDocx>>) {
  const doc = new D.Document({ sections: [{ children: [new D.Paragraph({ children: [new D.Math({ children: nodes })] })] }] });
  const zip = await JSZip.loadAsync(await D.Packer.toBuffer(doc));
  return zip.file('word/document.xml')!.async('string');
}

describe('latexToDocx', () => {
  it('builds native Word equations for common LaTeX', async () => {
    const cases: [string, RegExp[]][] = [
      ['\\frac{a}{b}', [/<m:f>/]],
      ['x^2 + y_i', [/<m:sSup>/, /<m:sSub>/]],
      ['x_i^2', [/<m:sSubSup>/]],
      ['\\sqrt{x}', [/<m:rad>/]],
      ['\\sqrt[3]{x}', [/<m:rad>/, /<m:deg>/]],
      ['\\sum_{i=1}^{n} x_i', [/<m:nary>/, /<m:chr m:val="∑"/]],
      ['\\int_0^1 f(x)\\,dx', [/<m:nary>/]],
      ['\\lim_{x \\to 0} f(x)', [/<m:limLow>/]],
      ['\\left( \\frac{a}{b} \\right)', [/<m:d>/, /<m:f>/]],
      ['\\alpha + \\beta \\le \\pi', [/α/, /β/, /≤/, /π/]],
      ['x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', [/<m:f>/, /<m:rad>/, /±/, /<m:sSup>/]],
      ['\\mathbb{R}^n', [/ℝ/, /<m:sSup>/]],
    ];
    for (const [tex, patterns] of cases) {
      const nodes = latexToDocx(tex);
      expect(nodes, tex).not.toBeNull();
      const xml = await xmlOf(nodes!);
      for (const p of patterns) expect(xml, `${tex} ~ ${p}`).toMatch(p);
    }
  });
  it('returns null for what it cannot do, so the caller can keep the LaTeX text', () => {
    expect(latexToDocx('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}')).toBeNull();
    expect(latexToDocx('\\frac{a}{')).toBeNull();
    expect(latexToDocx('\\unknownmacro{x}')).toBeNull();
    expect(latexToDocx('x^')).toBeNull();
    expect(latexToDocx('   ')).toBeNull();
    expect(latexToDocx('}')).toBeNull();
  });
  it('never throws on hostile or huge input', () => {
    expect(() => latexToDocx('{'.repeat(10000))).not.toThrow();
    expect(() => latexToDocx('\\frac'.repeat(5000))).not.toThrow();
    expect(() => latexToDocx('x^'.repeat(5000))).not.toThrow();
  });
});
