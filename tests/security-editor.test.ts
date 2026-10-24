import { describe, expect, it } from 'vitest';
import { cleanFileName, cleanPastedHTML, createEditor, defaultPlugins, rejectReason } from '../src';
import { isRiskyRegex, SourceEditing } from '../src/plugins';
import { cleanRendered } from '../src/inert';
import { diffDocuments } from '../src/diff';
import { isSafeHref, isSafeSrc } from '../src/url';
import { checkZipBomb } from '../src/docx';
import { docToMarkdown, markdownToDoc } from '../src/markdown';
import { marginContent } from '../src/print';

const MXSS = '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;/mglyph&gt;&lt;img src=1 onerror=alert(1)&gt;">';
const live = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('mutation XSS', () => {
  it('cleanRendered and the version diff give HTML that is still harmless when parsed again', () => {
    for (const html of [MXSS, '<svg><style><img src=x onerror=alert(1)></style></svg>', '<noscript><p title="</noscript><img src=x onerror=alert(1)>">', '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>']) {
      for (const out of [cleanRendered(html), diffDocuments('<p>a</p>', html).html]) {
        const box = live(out);
        expect(box.querySelectorAll('[onerror],[onload],[onclick]').length, html).toBe(0);
        expect(out).not.toMatch(/\son\w+\s*=|javascript:/i);
        expect(box.querySelectorAll('script,iframe,style,noscript,template,foreignObject').length).toBe(0);
      }
    }
  });
  it('keeps a formula or diagram', () => {
    expect(cleanRendered('<svg viewBox="0 0 10 10"><path d="M0 0L10 10"/></svg>')).toContain('<path');
  });
});

describe('patterns and pastes that used to freeze the tab', () => {
  it('refuses repeats hidden inside groups', () => {
    for (const re of ['(a+)+$', '(a|a)+$', '((a+))+$', '(a*)*b', '(x+x+)+y', '(a|aa)*c', '(\\w+\\s?)+$']) expect(isRiskyRegex(re), re).toBe(true);
    for (const re of ['colou?r', '\\d{3}-\\d{4}', '(foo|bar)baz', '[a-z]+@[a-z]+\\.com', '^(?:ab){2,3}$']) expect(isRiskyRegex(re), re).toBe(false);
  });
  it('cleans a Word paste with thousands of conditional comments quickly', () => {
    const t = Date.now();
    const html = '<p class=MsoNormal>x</p>' + '<!--[if gte mso 9]>'.repeat(40000);
    cleanPastedHTML(html);
    expect(Date.now() - t).toBeLessThan(1000);
  });
  it('still removes the conditional comments of a real Word paste', () => {
    const out = cleanPastedHTML('<p class=MsoNormal>Hi<!--[if gte mso 9]><xml>junk</xml><![endif]--> there</p>');
    expect(out).not.toContain('junk');
    expect(out).toContain('Hi');
  });
});

describe('links and pictures', () => {
  it('does not let a backslash or tab make a path into another site', () => {
    for (const u of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', 'javascript:alert(1)']) { expect(isSafeHref(u), JSON.stringify(u)).toBe(false); expect(isSafeSrc(u)).toBe(false); }
    expect(isSafeHref('/docs/a')).toBe(true);
    expect(isSafeHref('https://example.com')).toBe(true);
  });
  it('Markdown cannot bring in an address the editor would not accept', () => {
    const ed = createEditor({ element: document.body.appendChild(document.createElement('div')), plugins: [...defaultPlugins] });
    const doc = markdownToDoc(ed.view.state.schema, '![x](//evil.example/p.png) [a](smb://evil/share) [b](https://ok.example)');
    const attrs: Record<string, unknown>[] = [];
    doc.descendants((n) => { if (n.type.name === 'image') attrs.push(n.attrs); n.marks.forEach((m) => { if (m.type.name === 'link') attrs.push(m.attrs); }); });
    expect(attrs.map((a) => a.src ?? a.href)).toEqual(['', '#', 'https://ok.example']);
    ed.destroy();
  });
  it('Markdown export keeps code from closing its own fence', () => {
    const ed = createEditor({ element: document.body.appendChild(document.createElement('div')), plugins: [...defaultPlugins], content: '<pre><code>a\n```\n# not a heading</code></pre>' });
    const md = docToMarkdown(ed.view.state.doc);
    const back = markdownToDoc(ed.view.state.schema, md);
    expect(back.childCount).toBe(1);
    expect(back.firstChild!.type.name).toBe('code_block');
    ed.destroy();
  });
});

describe('print headers', () => {
  it('cannot close the style element', () => {
    expect(marginContent('</style><img src=x onerror=alert(1)>')).not.toMatch(/[<>]/);
  });
});

describe('files', () => {
  it('sees through trailing dots, double extensions and direction overrides', () => {
    const r = (name: string) => rejectReason({ name, size: 1, type: '' }, {});
    for (const n of ['evil.exe.', 'evil.exe ', 'a.exe.txt', 'x.php.jpg', 'invoice‮txt.exe', 'page.xhtml', 'run.hta', 'm.docm']) expect(r(n), n).not.toBeNull();
    expect(r('photo.png')).toBeNull();
    expect(r('report.final.pdf')).toBeNull();
    expect(cleanFileName('a‮b​.txt.')).toBe('ab.txt');
  });
});

describe('docx import', () => {
  const zip = (usize: number, csize: number) => {
    const name = new TextEncoder().encode('word/document.xml');
    const cd = new Uint8Array(46 + name.length); const v = new DataView(cd.buffer);
    v.setUint32(0, 0x02014b50, true); v.setUint32(20, csize, true); v.setUint32(24, usize, true); v.setUint16(28, name.length, true); cd.set(name, 46);
    const end = new Uint8Array(22); const e = new DataView(end.buffer);
    e.setUint32(0, 0x06054b50, true); e.setUint16(10, 1, true); e.setUint32(12, cd.length, true); e.setUint32(16, 0, true);
    const out = new Uint8Array(cd.length + 22); out.set(cd); out.set(end, cd.length);
    return out;
  };
  it('refuses a file that unpacks to far more than it weighs', () => {
    expect(() => checkZipBomb(zip(2_000_000_000, 1000))).toThrow(/too much/);
    expect(() => checkZipBomb(zip(50_000_000, 20_000))).toThrow(/too much/);
    expect(() => checkZipBomb(zip(40_000, 12_000))).not.toThrow();
    expect(() => checkZipBomb(new Uint8Array(5))).toThrow();
  });
});

describe('read-only source view', () => {
  it('can be read but not used to change the document', () => {
    const ed = createEditor({ element: document.body.appendChild(document.createElement('div')), plugins: [...defaultPlugins, SourceEditing], content: '<p>keep</p>' });
    ed.setReadOnly(true);
    ed.execute('toggleSource');
    const area = ed.root.querySelector('textarea.wy-source') as HTMLTextAreaElement;
    expect(area.readOnly).toBe(true);
    area.value = '<p>changed</p>';
    ed.execute('toggleSource');
    expect(ed.getHTML()).toContain('keep');
    expect(ed.getHTML()).not.toContain('changed');
    ed.destroy();
  });
});

describe('pasted review marks and stored drafts', () => {
  it('a paste cannot carry a tracked change author, a mention id or a comment id', async () => {
    const { stripReviewAttributes } = await import('../src/paste');
    const out = stripReviewAttributes('<p><ins data-author="CEO" data-date="1">a</ins><span data-mention-id="u9">@x</span><span data-comment-id="t1">c</span> plain</p>');
    expect(out).not.toMatch(/data-(author|date|mention-id|comment-id)/);
    expect(out).toContain('plain');
    expect(stripReviewAttributes('<p>no marks</p>')).toBe('<p>no marks</p>');
  });
  it('drafts can be encrypted and are unreadable with another key', async () => {
    const { MemoryDraftStore, encryptedDraftStore, deriveDraftKey } = await import('../src/plugins/offline');
    const inner = new MemoryDraftStore();
    const salt = new Uint8Array(16).fill(7);
    const key = await deriveDraftKey('correct horse', salt);
    const store = encryptedDraftStore(inner, key);
    await store.put('d', { html: '<p>secret text ' + 'x'.repeat(200000) + '</p>', comments: [], savedAt: 5 });
    const raw = await inner.get('d');
    expect(raw!.html.startsWith('enc:')).toBe(true);
    expect(raw!.html).not.toContain('secret');
    expect((await store.get('d'))!.html).toContain('secret text');
    expect(await encryptedDraftStore(inner, await deriveDraftKey('wrong', salt)).get('d')).toBeNull();
  });
});

describe('find and replace', () => {
  it('expands $1 and keeps lookbehind and anchors working', async () => {
    const { findMatches } = await import('../src/plugins/find-replace');
    const ed = createEditor({ element: document.body.appendChild(document.createElement('div')), plugins: [...defaultPlugins], content: '<p>price: 10 and 20</p>' });
    const m = findMatches(ed.view.state.doc, '(?<=price: )(\\d+)', false, { regex: true });
    expect(m).toHaveLength(1);
    expect(m[0].expand!('[$1|$&]')).toBe('[10|10]');
    ed.destroy();
  });
});
