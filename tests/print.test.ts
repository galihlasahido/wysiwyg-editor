import { afterEach, describe, expect, it } from 'vitest';
import { Pages, buildPrintHTML, createEditor, defaultPlugins, marginContent } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (opts: Record<string, unknown> = {}, content = '<h1>Title</h1><p>Hello <strong>world</strong></p>') => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, Pages({ header: 'Annual report', footer: 'Page {page} of {pages}', ...opts })], theme: 'dark' });
};

describe('marginContent', () => {
  it('turns a template into a CSS content value with page counters', () => {
    expect(marginContent('Page {page} of {pages}')).toBe('"Page " counter(page) " of " counter(pages)');
    expect(marginContent('Plain')).toBe('"Plain"');
    expect(marginContent('')).toBe('""');
  });
  it('escapes quotes, backslashes and newlines so text cannot break out of the string', () => {
    const v = marginContent('a"b\\c\nd; } body{display:none');
    expect(v).toBe('"a\\"b\\\\c\\A d; } body{display:none"');
    expect(v.replace(/\\./g, '')).not.toMatch(/"[^"]*"[^"]/); // still one properly closed string
  });
});

describe('print document', () => {
  it('contains only the document: no toolbar, no page widgets, no editing attributes', () => {
    const ed = make();
    const html = buildPrintHTML(ed);
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>world</strong>');
    expect(html).not.toMatch(/contenteditable|wy-toolbar|wy-page-header|wy-page-footer|wy-ribbon/);
    ed.destroy();
  });
  it('uses the real paper size and margins and puts the header and footer in the page margins', () => {
    const ed = make({ size: 'letter', margins: { top: 100, bottom: 110, left: 70, right: 80 } });
    const html = buildPrintHTML(ed);
    expect(html).toMatch(/@page\{size:816px 1056px;margin:100px 80px 110px 70px;/);
    expect(html).toContain('@top-center{content:"Annual report"');
    expect(html).toContain('@bottom-center{content:"Page " counter(page) " of " counter(pages)');
    ed.destroy();
  });
  it('can use a different first page, and always prints light even when the editor is dark', () => {
    const ed = make({ differentFirstPage: true, firstHeader: 'Cover', firstFooter: '' });
    const html = buildPrintHTML(ed);
    expect(html).toMatch(/@page :first\{@top-center\{content:"Cover"/);
    expect(html).toContain('data-theme="light"');
    expect(html).not.toContain('data-theme="dark"');
    ed.destroy();
  });
  it('works without the Pages plugin (A4, one inch margins) and honours explicit options', () => {
    const el = document.body.appendChild(document.createElement('div'));
    roots.push(el);
    const ed = createEditor({ element: el, content: '<p>x</p>', plugins: defaultPlugins });
    expect(buildPrintHTML(ed)).toContain('@page{size:794px 1123px;margin:96px 96px 96px 96px;');
    expect(buildPrintHTML(ed, { width: 500, height: 700, margins: { top: 1, right: 2, bottom: 3, left: 4 }, footer: '{page}' })).toContain('@page{size:500px 700px;margin:1px 2px 3px 4px;@bottom-center{content:counter(page)');
    expect(ed.hasCommand('print')).toBe(true); // the command exists for every editor
    ed.destroy();
  });
  it('escapes the title', () => {
    const ed = make();
    expect(buildPrintHTML(ed, { title: '<script>alert(1)</script>' })).not.toContain('<script>alert(1)');
    ed.destroy();
  });
});
