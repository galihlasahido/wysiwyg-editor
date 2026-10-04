import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { Autosave, BalloonToolbar, Comments, createEndpointSaver, Editor, askDialog, TrackChanges, MergeFields, SlashCommands, SourceEditing, createEditor, defaultPlugins, formatHtml, getMergeFields, renderMergeFields, toEmailHTML, toEmailText } from '../src';
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
    expect(html).toMatch(/<a href="https:\/\/x.test" rel="noopener noreferrer" style="color:#1d4ed8;text-decoration:underline;" target="_blank">c<\/a>/);
    expect(html).toContain('<th style="border:1px solid #cccccc');
    expect(html).toContain('alt="i"');
    expect(html).not.toMatch(/class=|data-/);
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

describe('untrusted HTML is inert and sanitised', () => {
  it('toEmailHTML drops active elements, handlers, script URLs, tracking images and CSS escapes', () => {
    const out = toEmailHTML('<script>alert(1)</script><iframe src=x></iframe><p onclick="x()" style="color:red;background-color:u\\72l(http://e/x)">hi<img src="javascript:alert(1)"><img src="//t.example/p.gif"></p><svg onload=alert(1)></svg><a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/<script|<iframe|<svg|onclick|onload|javascript:|t\.example|u\\72l/i);
    expect(out).toContain('hi');
  });
  it('toEmailHTML keeps option values from breaking out of the style attribute', () => {
    const out = toEmailHTML('<p>x</p>', { fontFamily: 'x" onmouseover="alert(1)', color: 'red;}</style>', width: 99999 });
    expect(out).not.toMatch(/onmouseover|<\/style>/);
    expect(out).toContain('max-width:1200px');
  });
  it('setHTML does not run event handlers of the markup it parses', () => {
    (globalThis as any).__pwn = 0;
    const host = document.body.appendChild(document.createElement('div'));
    const ed = createEditor({ element: host, content: '<p>ok</p>' });
    ed.setHTML('<img src="x" onerror="globalThis.__pwn++"><p>t</p>');
    expect(ed.getHTML()).not.toContain('onerror');
    expect((globalThis as any).__pwn).toBe(0);
    ed.destroy();
  });
});

describe('URL and table hardening', () => {
  const make = (content: string) => createEditor({ element: document.body.appendChild(document.createElement('div')), content });
  it('rejects protocol-relative and script URLs for links and images', () => {
    const ed = make('<p><a href="//evil.example">a</a><a href="javascript:alert(1)">b</a><a href="/ok">c</a><img src="//t.example/p.gif"><img src="data:image/svg+xml;base64,AAAA"><img src="data:image/png;base64,AAAA"></p>');
    const html = ed.getHTML();
    expect(html).not.toMatch(/evil\.example|javascript:|t\.example|svg\+xml/);
    expect(html).toContain('href="/ok"');
    expect(html).toContain('data:image/png;base64');
    ed.destroy();
  });
  it('re-checks URLs on output for nodes that skipped parsing (collaboration)', () => {
    const ed = make('<p>x</p>');
    const { state, dispatch } = ed.view;
    const link = state.schema.marks.link.create({ href: 'javascript:alert(1)' });
    dispatch(state.tr.replaceWith(1, 2, state.schema.text('y', [link])));
    expect(ed.getHTML()).not.toContain('javascript:');
    ed.destroy();
  });
  it('clamps absurd colspan and rowspan', () => {
    const ed = make('<table><tr><td colspan="1000000000" rowspan="999999">x</td></tr></table>');
    expect(ed.getHTML()).toMatch(/colspan="100"/);
    ed.destroy();
  });
  it('escapes Markdown destinations', () => {
    const ed = make('<p><a href="https://a.test/x)%20[click](https://b.test">z</a></p>');
    expect(ed.getMarkdown()).not.toContain('[click](https://b.test');
    ed.destroy();
  });
});

describe('track changes leaves undo and remote transactions alone', () => {
  it('undo applies as an undo (not as a new suggestion) after tracking is switched on', () => {
    const ed = createEditor({ element: document.body.appendChild(document.createElement('div')), content: '<p>abc</p>', plugins: [...defaultPlugins, TrackChanges()] });
    ed.view.dispatch(ed.view.state.tr.insertText('X', 4)); // tracking is off: a plain edit
    expect(ed.getHTML()).toContain('abcX');
    ed.execute('setTracking', true);
    ed.execute('undo');
    expect(ed.getHTML()).not.toContain('abcX');
    expect(ed.getHTML()).not.toMatch(/data-change|<del|deletion/i);
    ed.destroy();
  });
  it('transactions from collaboration are not rewritten into suggestions', () => {
    const ed = createEditor({ element: document.body.appendChild(document.createElement('div')), content: '<p>abc</p>', plugins: [...defaultPlugins, TrackChanges({ enabled: true })] });
    ed.view.dispatch(ed.view.state.tr.insertText('Z', 4).setMeta('y-sync$', { isChangeOrigin: true }));
    expect(ed.getHTML()).toContain('abcZ');
    expect(ed.getHTML()).not.toMatch(/insertion|data-change/i);
    ed.destroy();
  });
});

describe('askDialog (modal instead of window.prompt)', () => {
  const host = () => document.body.appendChild(document.createElement('div'));
  const type = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };

  it('resolves with the trimmed text when submitted and focuses the field', async () => {
    const root = host();
    const p = askDialog(root, { title: 'T', multiline: true });
    const input = root.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(input);
    expect((root.querySelector('button[type=submit]') as HTMLButtonElement).disabled).toBe(true); // required and empty
    type(input, '  hello  ');
    (root.querySelector('form') as HTMLFormElement).requestSubmit();
    await expect(p).resolves.toBe('hello');
    expect(root.querySelector('.wy-ask-backdrop')).toBeNull();
  });
  it('resolves null on Escape or Cancel and keeps a draft when the backdrop is clicked', async () => {
    const root = host();
    const p = askDialog(root, { title: 'T' });
    (root.querySelector('input') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(p).resolves.toBeNull();
    const q = askDialog(root, { title: 'T', value: 'draft' });
    root.querySelector('.wy-ask-backdrop')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(root.querySelector('.wy-ask-backdrop')).not.toBeNull(); // not lost by a stray click
    (root.querySelector('button[type=button]') as HTMLButtonElement).click();
    await expect(q).resolves.toBeNull();
  });
  it('shows validation errors instead of closing, and shows text as text', async () => {
    const root = host();
    const p = askDialog(root, { title: 'T', quote: '<img src=x onerror=alert(1)>', validate: (v) => (v === 'bad' ? 'Not allowed' : null) });
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.wy-ask-quote')!.textContent).toContain('<img');
    const input = root.querySelector('input') as HTMLInputElement;
    type(input, 'bad');
    (root.querySelector('form') as HTMLFormElement).requestSubmit();
    expect(root.querySelector('.wy-ask-error')!.textContent).toBe('Not allowed');
    type(input, 'good');
    (root.querySelector('form') as HTMLFormElement).requestSubmit();
    await expect(p).resolves.toBe('good');
  });
  it('addComment without text opens the modal, quotes the selection and attaches the comment on submit', async () => {
    const comments = Comments({ author: 'Ana' });
    const ed = createEditor({ element: host(), content: '<p>hello world</p>', plugins: [...defaultPlugins, comments] });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 1, 6)));
    expect(ed.execute('addComment')).toBe(true);
    expect(ed.root.querySelector('.wy-ask-quote')!.textContent).toBe('hello');
    type(ed.root.querySelector('textarea')!, 'Please rephrase');
    (ed.root.querySelector('form') as HTMLFormElement).requestSubmit();
    await new Promise((r) => setTimeout(r));
    expect(comments.store.list()[0]).toMatchObject({ author: 'Ana', text: 'Please rephrase' });
    expect(ed.getHTML()).toContain('data-comment-id');
    ed.destroy();
  });
  it('the comment still lands on the same words when the text moved while the dialog was open', async () => {
    const comments = Comments({ author: 'Ana' });
    const ed = createEditor({ element: host(), content: '<p>hello world</p>', plugins: [...defaultPlugins, comments] });
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 7, 12))); // "world"
    ed.execute('addComment');
    ed.view.dispatch(ed.view.state.tr.insertText('XXXX ', 1)); // a collaborator types in front
    type(ed.root.querySelector('textarea')!, 'ok');
    (ed.root.querySelector('form') as HTMLFormElement).requestSubmit();
    await new Promise((r) => setTimeout(r));
    const html = ed.getHTML();
    expect(html).toMatch(/data-comment-id="[^"]+"[^>]*>world</);
    ed.destroy();
  });
});

describe('saving comments to an endpoint', () => {
  const host = () => document.body.appendChild(document.createElement('div'));
  const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

  it('Autosave hands the comment threads to save, and a reply (no document change) triggers a save', async () => {
    const saves: { html: string; comments: any[] }[] = [];
    const comments = Comments({ author: 'Ana' });
    const ed = createEditor({ element: host(), content: '<p>hello world</p>', plugins: [...defaultPlugins, comments, Autosave({ save: async (html, ctx) => void saves.push({ html, comments: ctx.comments }), delayMs: 5 })] });
    await flush();
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 1, 6)));
    ed.execute('addComment', 'first');
    await flush(60);
    expect(saves.at(-1)!.comments).toHaveLength(1);
    expect(saves.at(-1)!.html).toContain('data-comment-id');
    const n = saves.length;
    const id = comments.store.list()[0].id;
    ed.execute('replyComment', id, 'a reply'); // only the store changes, not the document
    await flush(60);
    expect(saves.length).toBeGreaterThan(n);
    expect(saves.at(-1)!.comments[0].replies).toHaveLength(1);
    ed.execute('resolveComment', id, true);
    await flush(60);
    expect(saves.at(-1)!.comments[0].resolved).toBe(true);
    ed.destroy();
  });

  it('createEndpointSaver posts { title, html, comments } with your headers, and stops on a 409', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let status = 200;
    const fakeFetch = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response(status === 200 ? '{"version":2}' : 'stale', { status }))) as unknown as typeof fetch;
    let seen: unknown;
    const save = createEndpointSaver({ url: 'https://api.test/posts/7', method: 'PUT', headers: async () => ({ Authorization: 'Bearer t0k' }), title: () => 'My post', fetch: fakeFetch, onSaved: (r) => (seen = r) });
    await save('<p>x</p>', { comments: [{ id: 'c1' }] });
    expect(calls[0].url).toBe('https://api.test/posts/7');
    expect(calls[0].init.method).toBe('PUT');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ title: 'My post', html: '<p>x</p>', comments: [{ id: 'c1' }] });
    expect(seen).toEqual({ version: 2 });
    status = 409;
    await expect(save('<p>y</p>')).rejects.toMatchObject({ status: 409 });
    const custom = createEndpointSaver({ url: 'https://api.test/x', fetch: fakeFetch, body: (p) => ({ content: p.html, threads: p.comments }) });
    status = 200;
    await custom('<p>z</p>', { comments: [] });
    expect(JSON.parse(calls.at(-1)!.init.body as string)).toEqual({ content: '<p>z</p>', threads: [] });
  });
});
