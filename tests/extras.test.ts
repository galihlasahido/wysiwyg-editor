import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { BalloonToolbar, Editor, MergeFields, SlashCommands, SourceEditing, defaultPlugins, formatHtml, getMergeFields, renderMergeFields, toEmailHTML, toEmailText } from '../src';
import { linkAwareness } from '../src/collab';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function make(html: string, plugins: any[] = [], config: object = {}) {
  document.body.innerHTML = '';
  const el = document.createElement('div');
  document.body.append(el);
  const e = new Editor({ element: el, content: html, plugins: [...defaultPlugins, ...plugins], ...config });
  editors.push(e);
  return e;
}
const select = (e: Editor, from: number, to = from) => e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, from, to)));
const type = (e: Editor, text: string) => e.view.dispatch(e.view.state.tr.insertText(text, e.view.state.selection.from));
const key = (e: Editor, k: string) => e.view.someProp('handleKeyDown', (f) => f(e.view, new KeyboardEvent('keydown', { key: k })));

describe('toolbar: false', () => {
  it('builds the editor without attaching a toolbar', () => {
    const e = make('<p>x</p>', [], { toolbar: false });
    expect(e.root.querySelector('.wy-toolbar')).toBeNull();
    expect(e.getHTML()).toBe('<p>x</p>');
  });
});

describe('BalloonToolbar', () => {
  it('appears for a non-empty selection while focused, hides when it collapses or in read-only mode', () => {
    const e = make('<p>hello world</p>', [BalloonToolbar()], { toolbar: false });
    const bar = e.root.querySelector<HTMLElement>('.wy-balloon')!;
    expect(bar.hidden).toBe(true);
    e.view.hasFocus = () => true; // jsdom has no real focus for contenteditable
    select(e, 1, 6);
    expect(bar.hidden).toBe(false);
    select(e, 3);
    expect(bar.hidden).toBe(true);
    select(e, 1, 6);
    e.setReadOnly(true);
    select(e, 1, 5);
    expect(bar.hidden).toBe(true);
  });

  it('formats the selection, reflects the active state, and offers a heading dropdown', () => {
    const e = make('<p>hello world</p>', [BalloonToolbar({ items: ['bold', '|', 'heading', 'nope'] })], { toolbar: false });
    e.view.hasFocus = () => true;
    select(e, 1, 6);
    const bold = e.root.querySelector<HTMLElement>('.wy-balloon [aria-label="Bold"]')!;
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    bold.click();
    expect(e.getHTML()).toContain('<strong>hello</strong>');
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    const sel = e.root.querySelector<HTMLSelectElement>('.wy-balloon select')!;
    sel.value = '2';
    sel.dispatchEvent(new Event('change'));
    expect(e.getHTML()).toContain('<h2>');
    expect(e.root.querySelectorAll('.wy-balloon button')).toHaveLength(1); // unknown item names are skipped
  });
});

describe('SlashCommands', () => {
  const items = (e: Editor) => [...e.root.querySelectorAll('.wy-slash-item')].map((n) => n.textContent);

  it('opens on "/" in a block, filters as you type, and runs the chosen command on a clean block', () => {
    const e = make('<p></p>', [SlashCommands()]);
    select(e, 1);
    type(e, '/');
    expect(items(e).length).toBeGreaterThan(5);
    type(e, 'head');
    expect(items(e)).toEqual(['Heading 1', 'Heading 2', 'Heading 3']);
    key(e, 'ArrowDown');
    expect(key(e, 'Enter')).toBe(true);
    expect(e.getHTML()).toBe('<h2></h2>'); // "/head" is gone and the block became a heading
    expect(e.root.querySelector<HTMLElement>('.wy-slash-menu')!.hidden).toBe(true);
  });

  it('matches keywords, inserts blocks like tables, and closes with Escape', () => {
    const e = make('<p></p>', [SlashCommands()]);
    select(e, 1);
    type(e, '/grid');
    expect(items(e)).toEqual(['Table']);
    key(e, 'Enter');
    expect(e.getHTML()).toContain('<table>');
    const f = make('<p></p>', [SlashCommands()]);
    select(f, 1);
    type(f, '/q');
    expect(items(f)).toEqual(['Quote']);
    expect(key(f, 'Escape')).toBe(true);
    expect(f.root.querySelector<HTMLElement>('.wy-slash-menu')!.hidden).toBe(true);
  });

  it('does not trigger mid-text, in code blocks, or for paths and URLs', () => {
    const e = make('<p>see a/b and http://x</p><pre><code></code></pre>', [SlashCommands()]);
    select(e, 5);
    type(e, '/');
    expect(e.root.querySelector<HTMLElement>('.wy-slash-menu')!.hidden).toBe(true);
    let pre = 0;
    e.view.state.doc.descendants((n, p) => void (n.type.name === 'code_block' && (pre = p + 1)));
    select(e, pre);
    type(e, '/');
    expect(e.root.querySelector<HTMLElement>('.wy-slash-menu')!.hidden).toBe(true);
  });

  it('leaves out commands whose plugin is not installed and shows nothing for no match', () => {
    document.body.innerHTML = '';
    const el = document.createElement('div');
    document.body.append(el);
    const e = new Editor({ element: el, content: '<p></p>', plugins: [defaultPlugins[0], defaultPlugins.find((p) => p.name === 'heading')!, SlashCommands()] });
    editors.push(e);
    select(e, 1);
    type(e, '/');
    expect(items(e).every((l) => /Heading|Paragraph/.test(l!))).toBe(true);
    type(e, 'zzzz');
    expect(items(e)).toEqual([]);
    expect(key(e, 'Enter')).toBe(true); // Enter with no menu is the editor's own Enter (handled by another plugin)
  });
});

describe('MergeFields', () => {
  const fields = [{ name: 'first_name', label: 'First name' }, { name: 'company.name' }];
  const mk = (html = '<p>Dear </p>') => make(html, [MergeFields(fields)]);

  it('inserts fields from the command, validating names against the allow-list', () => {
    const e = mk('<p>Dear</p>');
    select(e, 5); // end of the paragraph text
    expect(e.execute('insertMergeField', 'first_name')).toBe(true);
    expect(e.execute('insertMergeField', 'secret')).toBe(false); // not in the list
    expect(e.execute('insertMergeField', '<img onerror=1>' as any)).toBe(false);
    expect(e.getHTML()).toContain('data-merge-field="first_name">{{first_name}}</span>');
    expect(e.getMarkdown()).toBe('Dear{{first_name}}');
  });

  it('lists used fields, and survives an HTML round trip', () => {
    const e = mk('<p>A <span data-merge-field="first_name"></span> B <span data-merge-field="first_name"></span> <span data-merge-field="company.name"></span></p>');
    expect(getMergeFields(e.view.state.doc)).toEqual(['first_name', 'company.name']);
    e.setHTML(e.getHTML());
    expect(getMergeFields(e.view.state.doc)).toHaveLength(2);
    expect(mk('<p><span data-merge-field="bad name!"></span></p>').getHTML()).not.toContain('merge-field'); // invalid names are dropped
  });

  it('fills values as text (never markup), keeps or removes missing ones', () => {
    const html = '<p>Hi <span data-merge-field="first_name">{{first_name}}</span> at <span data-merge-field="company.name">{{company.name}}</span></p>';
    expect(renderMergeFields(html, { first_name: 'Ana', 'company.name': 'Acme' })).toBe('<p>Hi Ana at Acme</p>');
    expect(renderMergeFields(html, { first_name: '<img src=x onerror=alert(1)>' })).toBe('<p>Hi &lt;img src=x onerror=alert(1)&gt; at {{company.name}}</p>');
    expect(renderMergeFields(html, {}, { missing: 'empty' })).toBe('<p>Hi  at </p>');
    expect(renderMergeFields(html, { first_name: 0, 'company.name': null })).toBe('<p>Hi 0 at {{company.name}}</p>'); // 0 is a value, null is missing
    expect(renderMergeFields(html, Object.create({ first_name: 'inherited' }))).toContain('{{first_name}}'); // prototype keys do not count
  });

  it('shows a dropdown with the configured fields', () => {
    const e = mk('<p>Dear</p>');
    const sel = e.toolbar.el.querySelector<HTMLSelectElement>('select[aria-label="Insert merge field"]')!;
    expect([...sel.options].map((o) => o.text)).toEqual(['{{ }} Merge field', 'First name', 'company.name']);
    select(e, 5);
    sel.value = 'first_name';
    sel.dispatchEvent(new Event('change'));
    expect(getMergeFields(e.view.state.doc)).toEqual(['first_name']);
  });
});

describe('SourceEditing', () => {
  const area = (e: Editor) => e.root.querySelector<HTMLTextAreaElement>('.wy-source');

  it('formats HTML one block per line, keeping <pre> content exact', () => {
    expect(formatHtml('<ul><li><p>a</p></li><li><p>b</p></li></ul><pre><code>x\n  y</code></pre><p>t <strong>b</strong></p>')).toBe(
      ['<ul>', '  <li>', '    <p>a</p>', '  </li>', '  <li>', '    <p>b</p>', '  </li>', '</ul>', '<pre><code>x\n  y</code></pre>', '<p>t <strong>b</strong></p>'].join('\n'),
    );
  });

  it('shows the HTML, locks the editor while open, and applies edits (undoably) on exit', () => {
    const e = make('<p>hello</p>', [SourceEditing]);
    e.execute('toggleSource');
    expect(area(e)!.value).toBe('<p>hello</p>');
    expect(e.isReadOnly).toBe(true);
    expect(e.root.classList.contains('wy-source-mode')).toBe(true);
    area(e)!.value = '<h1>Changed</h1><p>second</p>';
    e.execute('toggleSource');
    expect(area(e)).toBeNull();
    expect(e.isReadOnly).toBe(false);
    expect(e.getHTML()).toBe('<h1>Changed</h1><p>second</p>');
    e.execute('undo');
    expect(e.getHTML()).toBe('<p>hello</p>');
  });

  it('sanitizes through the schema: scripts, event handlers and unsafe URLs never survive', () => {
    const e = make('<p>x</p>', [SourceEditing]);
    e.execute('toggleSource');
    area(e)!.value = '<p onclick="x()">a</p><script>alert(1)</script><a href="javascript:alert(1)">l</a><img src="javascript:alert(2)"><iframe src="//evil"></iframe><p style="position:fixed">b</p>';
    e.execute('toggleSource');
    const html = e.getHTML();
    expect(html).not.toMatch(/script|onclick|javascript:|iframe|position/);
    expect(html).toContain('a');
    expect(html).toContain('b');
  });

  it('cancel discards the text, and read-only editors stay read-only afterwards', () => {
    const e = make('<p>keep</p>', [SourceEditing]);
    e.setReadOnly(true);
    e.execute('toggleSource');
    area(e)!.value = '<p>discard</p>';
    expect(e.execute('cancelSource')).toBe(true);
    expect(e.getHTML()).toBe('<p>keep</p>');
    expect(e.isReadOnly).toBe(true);
    expect(e.execute('cancelSource')).toBe(false); // not open
  });
});

describe('toEmailHTML', () => {
  it('wraps content in layout tables and inlines styles, dropping classes and data attributes', () => {
    const html = toEmailHTML('<h1 class="x" data-y="1">Hi</h1><p style="text-align: center">a <strong>b</strong> <a href="https://x.test" rel="noopener">c</a></p><table><tr><th>H</th><td>1</td></tr></table><img src="https://x.test/i.png" alt="i" width="50">', { width: 480 });
    expect(html).toContain('width="480"');
    expect(html).toContain('max-width:480px');
    expect(html).toContain('<h1 style="margin:0 0 16px 0;font-size:28px;line-height:1.25;">Hi</h1>');
    expect(html).toContain('text-align: center');
    expect(html).toContain('<strong style="font-weight:bold;">b</strong>');
    expect(html).toMatch(/<a href="https:\/\/x.test" style="color:#1d4ed8;text-decoration:underline;" target="_blank">c<\/a>/);
    expect(html).toContain('<th style="border:1px solid #cccccc');
    expect(html).toContain('alt="i"');
    expect(html).not.toMatch(/class=|data-|rel=/);
  });

  it('removes unsafe links, event handlers and style tricks', () => {
    const html = toEmailHTML('<p onclick="x()" style="color: red; background: url(javascript:alert(1)); position: fixed">a <a href="javascript:alert(1)">l</a></p>');
    expect(html).not.toMatch(/onclick|javascript:|url\(|position/);
    expect(html).toContain('color: red');
    expect(html).toContain('>l</a>'); // the text stays, the dangerous href goes
  });

  it('produces a plain-text alternative', () => {
    expect(toEmailText('<h1>Title</h1><p>Hello <a href="https://x.test">link</a></p><ul><li>one</li><li>two</li></ul><script>bad()</script>')).toBe('Title\n\nHello link (https://x.test)\n\n- one\n- two');
  });
});

describe('linkAwareness', () => {
  it('shares cursor state between two Awareness instances in both directions, and stops when unlinked', () => {
    const a = new Awareness(new Y.Doc());
    const b = new Awareness(new Y.Doc());
    a.setLocalStateField('user', { name: 'Ana' });
    const unlink = linkAwareness(a, b);
    expect(b.getStates().get(a.clientID)).toMatchObject({ user: { name: 'Ana' } }); // introduced on link
    b.setLocalStateField('user', { name: 'Bob' });
    expect(a.getStates().get(b.clientID)).toMatchObject({ user: { name: 'Bob' } });
    a.setLocalStateField('user', { name: 'Ana 2' });
    expect(b.getStates().get(a.clientID)).toMatchObject({ user: { name: 'Ana 2' } });
    unlink();
    a.setLocalStateField('user', { name: 'Ana 3' });
    expect(b.getStates().get(a.clientID)).toMatchObject({ user: { name: 'Ana 2' } });
    void sleep;
  });
});


describe('Markdown export with unknown nodes', () => {
  it('falls back to text instead of throwing for node types it does not know', () => {
    const Custom = {
      name: 'custom',
      nodes: {
        badge: { inline: true, group: 'inline', atom: true, parseDOM: [{ tag: 'span[data-badge]' }], toDOM: () => ['span', { 'data-badge': '' }, 'NEW'] },
        callout: { group: 'block', content: 'block+', parseDOM: [{ tag: 'div[data-callout]' }], toDOM: () => ['div', { 'data-callout': '' }, 0] },
        sep: { group: 'block', atom: true, parseDOM: [{ tag: 'div[data-sep]' }], toDOM: () => ['div', { 'data-sep': '' }] },
      },
    };
    const e = make('<p>a <span data-badge></span> b</p><div data-callout><p>inside</p></div><div data-sep></div><p>end</p>', [Custom]);
    expect(() => e.getMarkdown()).not.toThrow();
    const md = e.getMarkdown();
    expect(md).toContain('inside'); // block content is kept
    expect(md).toContain('end');
  });
});
