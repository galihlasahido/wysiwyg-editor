import { afterEach, describe, expect, it, vi } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { SpellCheck, TrackChanges, cleanIssues, createEditor, createLanguageToolProvider, defaultPlugins, type ProofProvider } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const make = (content: string, provider: ProofProvider, extra: any[] = []) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins.filter((p) => p.name !== 'spellcheck'), ...extra, SpellCheck({ provider, delayMs: 10, lang: 'en-US' })] });
};
const dict: ProofProvider = vi.fn(async ({ text }) => {
  const out: any[] = [];
  for (const [bad, good] of [['teh', 'the'], ['recieve', 'receive']]) { let i = text.indexOf(bad); while (i !== -1) { out.push({ offset: i, length: bad.length, message: `Did you mean "${good}"?`, replacements: [good], rule: `typo-${bad}`, kind: 'spelling' }); i = text.indexOf(bad, i + 1); } }
  return out;
}) as ProofProvider;

describe('cleanIssues', () => {
  it('keeps valid issues and drops out-of-range, non-integer and malformed ones', () => {
    const r = cleanIssues([{ offset: 0, length: 3, message: 'm', replacements: ['a', 5, 'x'.repeat(300), 'b\nc'] }, { offset: 9, length: 5 }, { offset: -1, length: 1 }, { offset: 0.5, length: 1 }, { offset: 0, length: 0 }, null, 'x'], 'abcdef');
    expect(r).toHaveLength(1);
    expect(r[0].replacements).toEqual(['a']);
    expect(cleanIssues('nope', 'abc')).toEqual([]);
  });
});

describe('proofreading with a provider', () => {
  it('underlines issues, offers the suggestion and applies it; the browser squiggles are off', async () => {
    const ed = make('<p>I recieve teh report</p>', dict);
    await tick(80);
    const marks = [...ed.view.dom.querySelectorAll('.wy-proof')];
    expect(marks.map((m) => m.textContent)).toEqual(['recieve', 'teh']);
    expect(ed.view.dom.getAttribute('spellcheck')).toBe('false');
    // click opens the menu
    const pos = ed.view.state.doc.textContent.indexOf('teh') + 1;
    ed.view.someProp('handleClick', (f) => f(ed.view, pos + 1, new MouseEvent('click')));
    const menu = ed.root.querySelector('.wy-proof-menu')!;
    expect(menu.querySelector('.wy-proof-msg')!.textContent).toBe('Did you mean "the"?');
    (menu.querySelector('.wy-proof-suggest') as HTMLElement).click();
    expect(ed.view.state.doc.textContent).toBe('I recieve the report');
    await tick(60);
    expect([...ed.view.dom.querySelectorAll('.wy-proof')].map((m) => m.textContent)).toEqual(['recieve']);
    ed.destroy();
  });
  it('checks only changed paragraphs (cache), follows edits, and ignore hides a word or a rule', async () => {
    const provider = vi.fn(dict as any) as unknown as ProofProvider & ReturnType<typeof vi.fn>;
    const ed = make('<p>teh first</p><p>second recieve</p>', provider);
    await tick(80);
    expect(provider).toHaveBeenCalledTimes(2);
    provider.mockClear();
    ed.view.dispatch(ed.view.state.tr.insertText('!', ed.view.state.doc.content.size - 1));
    await tick(80);
    expect(provider).toHaveBeenCalledTimes(1); // only the edited paragraph is sent again
    const issues = (ed.extensions.proofread as any).issues();
    expect(issues.map((i: any) => i.rule)).toEqual(['typo-teh', 'typo-recieve']);
    ed.view.someProp('handleClick', (f) => f(ed.view, issues[0].from + 1, new MouseEvent('click')));
    ([...ed.root.querySelectorAll('.wy-proof-menu button')].find((b) => /Ignore this rule/.test(b.textContent!)) as HTMLElement).click();
    expect((ed.extensions.proofread as any).issues().map((i: any) => i.rule)).toEqual(['typo-recieve']);
    ed.destroy();
  });
  it('nextIssue selects the next problem and opens the menu; corrections are tracked when suggesting', async () => {
    const ed = make('<p>teh cat recieve</p>', dict, [TrackChanges({ author: 'Me', enabled: true })]);
    await tick(80);
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 1)));
    expect(ed.execute('nextIssue')).toBe(true);
    expect(ed.view.state.selection.from).toBeGreaterThan(1);
    (ed.root.querySelector('.wy-proof-suggest') as HTMLElement).click();
    expect(ed.view.dom.querySelector('ins')).not.toBeNull(); // the fix is a tracked change
    expect(ed.view.dom.querySelector('del')).not.toBeNull();
    ed.destroy();
  });
  it('a failing service reports once and leaves the text alone; markup in messages stays text', async () => {
    const ed = make('<p>some text here</p>', async () => { throw new Error('service down'); });
    const msgs: string[] = [];
    ed.on('proofread-status', (e: any) => msgs.push(e.message));
    ed.execute('checkDocument');
    await tick(80);
    expect(msgs).toEqual(['service down']);
    ed.destroy();
    const evil = make('<p>abc def</p>', async () => [{ offset: 0, length: 3, message: '<img src=x onerror=alert(1)>', replacements: ['<b>x</b>'] }]);
    await tick(80);
    evil.view.someProp('handleClick', (f) => f(evil.view, 2, new MouseEvent('click')));
    expect(evil.root.querySelector('.wy-proof-menu img, .wy-proof-menu b')).toBeNull();
    expect(evil.root.querySelector('.wy-proof-msg')!.textContent).toContain('<img');
    evil.destroy();
  });
  it('toggle off removes the underlines', async () => {
    const ed = make('<p>teh</p>', dict);
    await tick(80);
    expect(ed.view.dom.querySelector('.wy-proof')).not.toBeNull();
    ed.execute('toggleSpellcheck');
    expect(ed.view.dom.querySelector('.wy-proof')).toBeNull();
    ed.destroy();
  });
});

describe('LanguageTool provider', () => {
  it('posts the text and maps the matches', async () => {
    const fetchImpl = vi.fn(async (_u: any, init: any) => new Response(JSON.stringify({ matches: [{ offset: 2, length: 3, message: 'Typo', replacements: [{ value: 'cat' }, { value: 'cut' }], rule: { id: 'MORFOLOGIK', issueType: 'misspelling' } }, { offset: 0, length: 1, message: 'Style', replacements: [], rule: { id: 'S', issueType: 'style' } }] }), { status: 200 }));
    const p = createLanguageToolProvider('https://lt.example/v2/check', { fetchImpl: fetchImpl as any });
    const out = await p({ text: 'a cta', lang: 'en-US', signal: new AbortController().signal });
    expect(fetchImpl.mock.calls[0][1].body).toBe('text=a+cta&language=en-US');
    expect(out[0]).toMatchObject({ offset: 2, length: 3, replacements: ['cat', 'cut'], rule: 'MORFOLOGIK', kind: 'spelling' });
    expect(out[1].kind).toBe('style');
    await expect(createLanguageToolProvider('x', { fetchImpl: (async () => new Response('', { status: 500 })) as any })({ text: 'a', lang: 'en', signal: new AbortController().signal })).rejects.toThrow(/500/);
  });
});
