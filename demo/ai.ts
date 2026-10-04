import { AIAssistant, createEditor, defaultPlugins, type AIProvider } from '../src';
import { $, el } from './samples';

const app = $('#app');
app.append(
  el('div', { class: 'demo-note' }, el('strong', {}, 'This demo uses a mock provider'), ' that rewrites text with simple rules so it works offline. ', 'In your app, point ', el('code', {}, 'AIAssistant({ provider })'), ' at your own endpoint (never put API keys in the browser): ', el('code', {}, "createFetchProvider('/api/ai')"), '.'),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  el('ul', { class: 'tips' }, el('li', {}, 'Select a sentence, then choose an action from the ✨ AI dropdown.'), el('li', {}, 'The result streams into a preview. Nothing changes until you press Accept; Cancel aborts the request.'), el('li', {}, 'With nothing selected, an action works on the whole document.')),
);

const FIXES: [RegExp, string][] = [[/\bteh\b/gi, 'the'], [/\brecieve(d?)\b/gi, 'receive$1'], [/\bdont\b/gi, "don't"], [/\bcant\b/gi, "can't"], [/\bwich\b/gi, 'which'], [/\balot\b/gi, 'a lot'], [/\bi\b/g, 'I'], [/ {2,}/g, ' ']];
const fix = (t: string) => FIXES.reduce((s, [re, to]) => s.replace(re, to), t).replace(/(^|[.!?]\s+)([a-z])/g, (_m, a, b) => a + b.toUpperCase());
const sentences = (t: string) => t.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [t];

/** Offline stand-in for a language model: deterministic text rules, streamed word by word. */
const mock: AIProvider = async function* ({ action, instruction, text, signal }) {
  let out: string;
  switch (action) {
    case 'grammar': out = fix(text); break;
    case 'improve': out = fix(text).replace(/\bvery good\b/gi, 'excellent').replace(/\ba lot of\b/gi, 'many').replace(/\breally /gi, ''); break;
    case 'shorten': { const s = sentences(fix(text)); out = s.slice(0, Math.max(1, Math.ceil(s.length / 2))).join(' '); break; }
    case 'expand': out = `${fix(text)} In other words, the details matter, and small improvements add up over time.`; break;
    case 'summarize': out = `Summary: ${sentences(fix(text))[0]}`; break;
    case 'translate': out = `[mock translation to ${/to (.+?)\./.exec(instruction)?.[1] ?? 'the target language'}] ${text}`; break;
    default: out = `[mock] ${instruction}\n\n${fix(text)}`;
  }
  for (const word of out.split(/(\s+)/)) {
    if (signal.aborted) return;
    await new Promise((r) => setTimeout(r, 25));
    yield word;
  }
};

createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, AIAssistant({ provider: mock })],
  content: `<h1>Quarterly update</h1><p>i recieve teh report yesterday and dont know wich numbers to trust. there is alot of data, and it is very good in some places but really unclear in others.</p><p>The team shipped three features this quarter. Two of them were requested by customers. The third was an internal tool that saves about an hour a week for every engineer. Next quarter we plan to focus on reliability.</p>`,
});
