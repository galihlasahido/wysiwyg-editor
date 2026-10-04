import { MergeFields, createEditor, defaultPlugins, getMergeFields, renderMergeFields, toEmailHTML } from '../src';
import { $, button, codePanel, el } from './samples';

const FIELDS = [{ name: 'first_name', label: 'First name' }, { name: 'company', label: 'Company' }, { name: 'plan', label: 'Plan' }];
const PEOPLE = [
  { email: 'ana@kopi.id', first_name: 'Ana', company: 'Kopi Nusantara', plan: 'Team' },
  { email: 'budi@santoso.id', first_name: 'Budi', company: 'Santoso & Sons <b>', plan: 'Business' },
  { email: 'citra@example.com', first_name: 'Citra' },
] as Record<string, string>[];
const f = (n: string) => `<span data-merge-field="${n}"></span>`;

const subject = el('input', { class: 'out', value: 'Your ' + '{{plan}}' + ' plan, {{first_name}}', 'aria-label': 'Subject' });
const list = el('ul', { class: 'tips', style: 'list-style:none;padding:0' });
const frame = el('iframe', { class: 'preview', title: 'Email preview', style: 'height:360px' });
frame.setAttribute('sandbox', '');
const result = el('div', { class: 'status', 'aria-live': 'polite' });
let selected = 0;

$('#app').append(el('div', { class: 'cols' },
  el('div', { class: 'panel' }, el('h2', {}, 'Compose'), el('label', { class: 'status' }, 'Subject'), subject, el('div', { id: 'editor', style: 'margin-top:8px' })),
  el('div', { class: 'panel' }, el('h2', {}, 'Recipients'), list, el('div', { class: 'actions' }, button('Send test (simulated)', () => send(), true)), result, el('h2', {}, 'Preview'), frame),
));

const editor = createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, MergeFields(FIELDS)],
  content: `<h2>Hello ${f('first_name')}</h2><p>Your ${f('plan')} plan for <strong>${f('company')}</strong> is ready.</p><p><a href="https://example.com/start">Open your dashboard</a></p>`,
  onChange: render,
});
const fill = (s: string, p: Record<string, string>) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => p[k] ?? m);
const missing = (p: Record<string, string>) => [...new Set([...getMergeFields(editor.view.state.doc), ...(subject.value.match(/\{\{(\w+)\}\}/g) ?? []).map((m) => m.slice(2, -2))])].filter((k) => !p[k]);

function render() {
  list.replaceChildren(...PEOPLE.map((p, i) => {
    const m = missing(p);
    return el('li', { style: 'padding:3px 0' }, button(p.email, () => ((selected = i), render()), i === selected), m.length ? ` ⚠ missing: ${m.join(', ')}` : ' ✓');
  }));
  const p = PEOPLE[selected];
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><title>${fill(subject.value, p).replace(/[<&]/g, '')}</title><p style="font:12px system-ui;color:#666;margin:8px">Subject: ${fill(subject.value, p).replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</p>${toEmailHTML(renderMergeFields(editor.getHTML(), p))}`;
}
function send() {
  const bad = PEOPLE.filter((p) => missing(p).length);
  result.textContent = bad.length ? `Blocked: ${bad.length} recipient(s) are missing data. Fix them or remove them first.` : `Would send ${PEOPLE.length} emails. Nothing is sent from this demo.`;
}
subject.addEventListener('input', render);
render();
$('#app').append(codePanel(`
const html = toEmailHTML(renderMergeFields(editor.getHTML(), recipient));   // values are text, never markup
getMergeFields(editor.view.state.doc);                                     // validate before sending
`));
