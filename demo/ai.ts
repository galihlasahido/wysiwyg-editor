import { AIAssistant, TrackChanges, createEditor, createFetchProvider, defaultPlugins, type AIProvider } from '../src';
import { $, el, codePanel } from './samples';

const app = $('#app');
// ?endpoint=http://127.0.0.1:8788/api/ai uses a real server (`pnpm server:examples`) instead of the offline mock; only http(s) addresses are accepted
const endpoint = new URLSearchParams(location.search).get('endpoint');
const endpointUrl = endpoint && /^https?:\/\//i.test(endpoint) ? endpoint : null;
app.append(
  el('div', { class: 'demo-note' }, el('strong', {}, endpointUrl ? `Using your endpoint ${endpointUrl}. ` : 'This demo uses a mock provider'), endpointUrl ? '' : ' that rewrites text with simple rules so it works offline (or start `pnpm server:examples` and add ?endpoint=http://127.0.0.1:8788/api/ai to the address). ', 'In your app, point ', el('code', {}, 'AIAssistant({ provider })'), ' at your own endpoint (never put API keys in the browser): ', el('code', {}, "createFetchProvider('/api/ai')"), '.'),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  el('ul', { class: 'tips' }, el('li', {}, 'Select a sentence, then choose an action from the ✨ AI dropdown.'), el('li', {}, 'The result streams into a preview. Nothing changes until you press Accept; Cancel aborts the request.'), el('li', {}, 'With nothing selected, an action works on the whole document.'), el('li', {}, el('strong', {}, 'Suggestions while typing: '), 'finish a sentence at the end of a paragraph and pause. Grey text appears; Tab accepts it, Esc or typing dismisses it. The ✨ button turns it on or off.'), el('li', {}, el('strong', {}, 'Review (✍): '), 'the whole document is checked paragraph by paragraph and the fixes arrive as tracked changes you accept or reject. Undo takes the whole review back.'), el('li', {}, el('strong', {}, 'Chat (💬): '), 'ask about the document; a reply can be inserted below the cursor.')),
);

const FIXES: [RegExp, string][] = [[/\bteh\b/gi, 'the'], [/\brecieve(d?)\b/gi, 'receive$1'], [/\bdont\b/gi, "don't"], [/\bcant\b/gi, "can't"], [/\bwich\b/gi, 'which'], [/\balot\b/gi, 'a lot'], [/\bi\b/g, 'I'], [/ {2,}/g, ' ']];
const fix = (t: string) => FIXES.reduce((s, [re, to]) => s.replace(re, to), t).replace(/(^|[.!?]\s+)([a-z])/g, (_m, a, b) => a + b.toUpperCase());
const sentences = (t: string) => t.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [t];

/** Offline stand-in for a language model: deterministic text rules, streamed word by word. */
const mock: AIProvider = async function* ({ action, instruction, text, signal }) {
  let out: string;
  switch (action) {
    case 'complete': out = /quarter|report|data/i.test(text.slice(-80)) ? ' We will share the details in the next update.' : ' This is only a mock suggestion.'; break;
    case 'review': out = fix(text); break;
    case 'chat': out = /summar|about/i.test(instruction.split('User:').pop() ?? '') ? `The document is a short update (${text.split(/\s+/).length} words). Its first paragraph mentions a late report; the second lists what the team shipped.` : `**Mock answer.** In your app the real model answers here, using the document (${text.length} characters) as context.`; break;
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

const editor = createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, TrackChanges({ author: 'You' }), AIAssistant({ provider: endpointUrl ? createFetchProvider(endpointUrl) : mock, inline: { delayMs: 700, minChars: 15 }, chat: true, review: { author: 'AI' } })],
  content: `<h1>Quarterly update</h1><p>i recieve teh report yesterday and dont know wich numbers to trust. there is alot of data, and it is very good in some places but really unclear in others.</p><p>The team shipped three features this quarter. Two of them were requested by customers. The third was an internal tool that saves about an hour a week for every engineer. Next quarter we plan to focus on reliability.</p>`,
});

$('#app').append(codePanel(`
import { AIAssistant, createFetchProvider } from 'wysiwygido';

createEditor({
  element,
  plugins: [...defaultPlugins, AIAssistant({
    provider: createFetchProvider('/api/ai'),   // your server calls the model; no keys in the browser
    inline: true,                               // grey continuation while you type (Tab accepts)
    chat: true,                                 // ‘aiChat’ panel about the document
  }), TrackChanges()],                          // editor.execute('aiReview') proposes fixes as tracked changes
});
`));
(window as unknown as { editor: typeof editor }).editor = editor;
