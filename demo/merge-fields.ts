import { MergeFields, createEditor, defaultPlugins, getMergeFields, renderMergeFields } from '../src';
import { $, el } from './samples';

const FIELDS = [{ name: 'first_name', label: 'First name' }, { name: 'last_name', label: 'Last name' }, { name: 'company', label: 'Company' }, { name: 'plan', label: 'Plan' }, { name: 'renewal_date', label: 'Renewal date' }];
const PEOPLE: Record<string, Record<string, string>> = {
  'Ana Lestari': { first_name: 'Ana', last_name: 'Lestari', company: 'Kopi Nusantara', plan: 'Team', renewal_date: '1 March 2027' },
  'Budi Santoso': { first_name: 'Budi', last_name: 'Santoso', company: 'Santoso & Sons <b>', plan: 'Business', renewal_date: '14 June 2027' }, // a hostile-looking value: shown as plain text
  'No data yet': { first_name: 'Citra' },
};

const select = el('select', { 'aria-label': 'Recipient' }, ...Object.keys(PEOPLE).map((n) => el('option', { value: n, textContent: n })));
const preview = el('div', { class: 'out', style: 'padding:14px;background:var(--card);border:1px solid var(--line);border-radius:8px;min-height:200px' });
const used = el('div', { class: 'status' });

$('#app').append(
  el('div', { class: 'demo-note' }, 'Use the ', el('strong', {}, '{{ }} Merge field'), ' dropdown to insert placeholders. The preview calls ', el('code', {}, 'renderMergeFields(html, data)'), '; values are inserted as text, so a value containing HTML stays harmless. Fields without data are kept visible.'),
  el('div', { class: 'cols' },
    el('div', { class: 'panel' }, el('h2', {}, 'Template'), el('div', { id: 'editor' }), used),
    el('div', { class: 'panel' }, el('h2', {}, 'Preview for ', select), preview),
  ),
);

const f = (n: string) => `<span data-merge-field="${n}"></span>`;
const editor = createEditor({
  element: $('#editor'),
  plugins: [...defaultPlugins, MergeFields(FIELDS)],
  content: `<h2>Your ${f('plan')} plan renews soon</h2><p>Dear ${f('first_name')} ${f('last_name')},</p><p>This is a reminder that the subscription for <strong>${f('company')}</strong> renews on ${f('renewal_date')}. Reply to this message if anything has changed.</p><p>Thank you,<br>The team</p>`,
  onChange: render,
});

function render() {
  const data = PEOPLE[select.value];
  preview.innerHTML = renderMergeFields(editor.getHTML(), data); // editor output is schema-sanitised; values are text nodes
  used.textContent = `Fields used: ${getMergeFields(editor.view.state.doc).join(', ') || 'none'}`;
}
select.addEventListener('change', render);
render();
