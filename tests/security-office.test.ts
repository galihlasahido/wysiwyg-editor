import { describe, expect, it } from 'vitest';
import { createEvaluator } from '../src/grid-formulas';
import { Workbook } from '../src/spreadsheet-model';
import { cleanDeck, cleanHTML } from '../src/presentation-model';

const run = (cells: Record<string, string>, ask: string, size: [number, number] = [8, 200]) => {
  const ev = createEvaluator((c, r) => (c >= size[0] || r >= size[1] ? undefined : cells[`${c},${r}`] ?? ''), size);
  const [c, r] = ask.split(',').map(Number);
  return ev.value(c, r);
};

describe('formulas cannot freeze the page', () => {
  it('wildcards do not backtrack badly', () => {
    const t = Date.now();
    const cells: Record<string, string> = { '0,0': `${'a'.repeat(5000)}b`, '1,0': '=COUNTIF(A1,"*a*a*a*a*a*a*a*a*a*a*c")', '2,0': '=SEARCH("*a*a*a*a*a*a*a*c",A1)' };
    expect(run(cells, '1,0')).toBe(0);
    expect(['#VALUE!', '#CALC!']).toContain(run(cells, '2,0'));
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('has no regular-expression functions (their patterns come from the sheet)', () => {
    expect(run({ '0,0': '=REGEXTEST("aaaaaaaaaaaaaaaaaaaaaaaa!","(a+)+$")' }, '0,0')).toBe('#NAME?');
  });
  it('stops a formula that does far too much work', () => {
    const t = Date.now();
    const cells = { '0,0': '=SUMPRODUCT(SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000)*SEQUENCE(1000000))' };
    expect(run(cells, '0,0')).toBe('#CALC!');
    expect(Date.now() - t).toBeLessThan(5000);
  });
  it('rejects a formula longer than Excel allows and absurd nesting', () => {
    expect(run({ '0,0': `=${'1+'.repeat(5000)}1` }, '0,0')).toBe('#ERR!');
    expect(run({ '0,0': `=${'('.repeat(3000)}1${')'.repeat(3000)}` }, '0,0')).toMatch(/^#|1/);
  });
  it('cannot loop through INDIRECT', () => {
    expect(run({ '0,0': '=INDIRECT("A1")' }, '0,0')).toBe('#CYCLE!');
  });
  it('limits a text it builds', () => {
    expect(run({ '0,0': '=REPT("abcdefghij",5000)' }, '0,0')).toBe('#VALUE!');
  });
});

describe('spreadsheet files', () => {
  it('keeps CSV from running as a formula in Excel', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.input(s, 0, 0, '=1+1');
    wb.input(s, 0, 1, '=HYPERLINK("http://x","click")');
    wb.input(s, 1, 0, '="=cmd|\x27 /C calc\x27!A0"');
    wb.input(s, 1, 1, '-5');
    wb.input(s, 2, 0, '@SUM(1)');
    wb.input(s, 2, 1, '+62 811');
    const csv = wb.toCSV(s);
    expect(csv.split('\n')[0].startsWith('2,')).toBe(true);   // a formula that gives a number
    expect(csv).toContain("'=cmd");
    expect(csv).toContain("'@SUM(1)");
    expect(csv).toContain("'+62 811");
    expect(csv).toContain(',-5');                                // a number stays a number
  });
  it('imports a very long CSV without blowing the stack', () => {
    const wb = new Workbook();
    const text = Array.from({ length: 150000 }, (_, i) => `${i},x`).join('\n');
    expect(() => wb.importCSV(text, 'Big')).not.toThrow();
  });
});

describe('presentation text and files', () => {
  const bad = [
    '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<a href="javascript:alert(1)">x</a>', '<a href=" jav&#x09;ascript:alert(1)">x</a>', '<p style="background:url(javascript:alert(1))">x</p>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>', '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">',
    '<form><input onfocus=alert(1) autofocus>', '<span style="color:red;position:fixed;inset:0">x</span>', '<b onclick=alert(1)>x</b>', '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
  ];
  it('lets nothing active through', () => {
    for (const html of bad) {
      const out = cleanHTML(html);
      expect(out, html).not.toMatch(/on\w+\s*=|javascript:|<script|<img|<iframe|<svg|<form|<input|url\(|position/i);
      const box = document.createElement('div'); box.innerHTML = out;   // and it stays harmless when parsed again
      expect(box.querySelectorAll('img,script,iframe,svg,form,input,object,embed,style').length, html).toBe(0);
      for (const a of box.querySelectorAll('a')) expect(/^(https?:|mailto:|tel:|#)/i.test(a.getAttribute('href') ?? '#')).toBe(true);
    }
  });
  it('accepts only picture sources it understands and caps what a deck may hold', () => {
    const img = (src: string) => ({ type: 'image', x: 0, y: 0, w: 10, h: 10, src });
    const d = cleanDeck({ slides: [{ els: [img('javascript:alert(1)'), img('data:text/html;base64,AAAA'), img('data:image/png;base64,AAAA'), img('https://example.com/a.png'), img('//evil.example/a.png'), img('file:///etc/passwd')] }] });
    expect(d.slides[0].els.map((e) => e.src)).toEqual(['data:image/png;base64,AAAA', 'https://example.com/a.png']);
    const big = 'data:image/png;base64,' + 'A'.repeat(11_000_000);
    const many = cleanDeck({ slides: Array.from({ length: 20 }, () => ({ els: [img(big)] })) });
    expect(many.slides.reduce((n, s) => n + s.els.length, 0)).toBeLessThan(20);
  });
  it('survives hostile JSON', () => {
    const d = cleanDeck('{"__proto__":{"x":1},"slides":[{"__proto__":{"y":1},"els":[{"type":"shape","x":"NaN","w":-5,"fill":"url(javascript:1)","html":"<script>1</script>"}]}],"theme":{"a":1}}');
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(d.slides[0].els[0].fill).toBeUndefined();
    expect(d.slides[0].els[0].html ?? '').not.toContain('script');
    expect(() => cleanDeck('not json')).not.toThrow();
  });
});
