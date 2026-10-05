import { SpellCheck, createEditor, defaultPlugins, type ProofIssue, type ProofProvider } from '../src';
import { $, button, codePanel, el } from './samples';

/** Offline stand-in for a LanguageTool server: a tiny dictionary of typos, a/an, repeated words and a lowercase "i". */
const TYPOS: Record<string, string> = { teh: 'the', recieve: 'receive', definately: 'definitely', seperate: 'separate', alot: 'a lot', wich: 'which', occured: 'occurred' };
const mock: ProofProvider = async ({ text, signal }) => {
  await new Promise((r) => setTimeout(r, 150));
  if (signal.aborted) return [];
  const out: ProofIssue[] = [];
  for (const m of text.matchAll(/[A-Za-z']+/g)) {
    const w = m[0], i = m.index!;
    const fix = TYPOS[w.toLowerCase()];
    if (fix) out.push({ offset: i, length: w.length, message: `Possible spelling mistake: “${w}”.`, replacements: [w[0] === w[0].toUpperCase() ? fix[0].toUpperCase() + fix.slice(1) : fix], rule: 'MOCK_SPELL', kind: 'spelling' });
    else if (w === 'i') out.push({ offset: i, length: 1, message: 'The pronoun “I” is capitalised.', replacements: ['I'], rule: 'MOCK_I', kind: 'grammar' });
  }
  for (const m of text.matchAll(/\b(a)\s+([aeiou]\w*)/gi)) out.push({ offset: m.index!, length: m[1].length, message: 'Use “an” before a vowel sound.', replacements: ['an'], rule: 'MOCK_AN', kind: 'grammar' });
  for (const m of text.matchAll(/\b(\w+)\s+\1\b/gi)) out.push({ offset: m.index! + m[1].length + 1, length: m[1].length, message: 'Repeated word.', replacements: [''], rule: 'MOCK_REPEAT', kind: 'style' });
  return out;
};

$('#app').append(
  el('div', { class: 'demo-note' }, el('strong', {}, 'This demo uses a mock service'), ' so it works offline. Red wavy = spelling, blue wavy = grammar, purple dotted = style. Click an underline (or press ', el('strong', {}, '⚑'), ') for suggestions, “Ignore” or “Ignore this rule”. Only paragraphs that changed are sent again.'),
  el('div', { class: 'actions' }, button('Check again', () => editor.execute('checkDocument'), true), button('Next issue', () => editor.execute('nextIssue'))),
  el('div', { class: 'status', id: 'status', 'aria-live': 'polite' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins.filter((p) => p.name !== 'spellcheck'), SpellCheck({ provider: mock, lang: 'en-US', delayMs: 500 })],
  content: '<h1>Meeting notes</h1><p>i definately recieve teh agenda a hour before, wich is is alot better than last time.</p><p>The team occured to agree on a seperate review for each item.</p>',
});
(window as unknown as { editor: typeof editor }).editor = editor;
editor.on('proofread-status', (e) => { $('#status').textContent = (e as { message: string }).message; });
$('#app').append(codePanel(`
import { SpellCheck, createLanguageToolProvider } from 'wysiwyg-editor';

plugins: [...defaultPlugins.filter((p) => p.name !== 'spellcheck'), SpellCheck({
  provider: createLanguageToolProvider('https://your-languagetool/v2/check'),  // the paragraph text is sent to this server
  lang: 'en-US',
})],
// or your own: provider: async ({ text, lang, signal }) => [{ offset, length, message, replacements, rule, kind }]
editor.execute('checkDocument'); editor.execute('nextIssue');
`));
