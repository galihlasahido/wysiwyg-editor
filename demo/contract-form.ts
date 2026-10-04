import { RestrictedEditing, createEditor, defaultPlugins, download } from '../src';
import { $, button, codePanel, el } from './samples';

const ph = (t: string) => `<p><i>${t}</i></p>`;
const content =
  '<section data-locked data-variant="title" data-label="Header"><h1>Services contract</h1><p>Between the parties named below. Complete every highlighted field.</p></section>' +
  '<h2>1. Parties</h2><div data-editable-region data-label="Client">' + ph('Client full name and address') + '</div><div data-editable-region data-label="Provider">' + ph('Provider full name and address') + '</div>' +
  '<h2>2. Services</h2><div data-editable-region data-label="Scope">' + ph('Describe the services') + '</div>' +
  '<h2>3. Fees</h2><div data-editable-region data-label="Amount">' + ph('Fee and payment schedule') + '</div>' +
  '<section data-locked data-variant="legal" data-label="Standard terms"><h2>4. Standard terms</h2><ol><li><p>Payment is due within 30 days of the invoice date.</p></li><li><p>Either party may end this contract with 14 days written notice.</p></li><li><p>Confidential information stays confidential for five years.</p></li></ol></section>' +
  '<h2>5. Checklist</h2><div data-editable-region data-label="Checklist"><ul data-task-list><li data-task data-checked="false"><p>ID of both parties checked</p></li><li data-task data-checked="false"><p>Scope agreed in writing</p></li></ul></div>' +
  '<h2>6. Signatures</h2><div data-editable-region data-label="Signature">' + ph('Type your full name to sign') + '</div><div data-editable-region data-label="Date">' + ph('Date (dd/mm/yyyy)') + '</div>';

const status = el('div', { class: 'status', 'aria-live': 'polite' });
const list = el('ul', { class: 'tips' });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Gray blocks are locked. Dashed ', el('strong', {}, 'fill-in'), ' areas hold placeholder text in italics; replace it. The list shows which fields are still empty.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'cols' }, el('div', { class: 'panel' }, el('div', { id: 'editor' })), el('div', { class: 'panel' }, el('h2', {}, 'Progress'), status, list)),
);

const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, RestrictedEditing()] });
const regions = () => [...editor.view.dom.querySelectorAll<HTMLElement>('.wy-region')].filter((r) => !r.querySelector('[data-task]'));
const initial = regions().map((r) => r.textContent!.trim());

function update() {
  const rs = regions();
  const pending = rs.map((r, i) => ({ label: r.dataset.label ?? `Field ${i + 1}`, empty: r.textContent!.trim() === initial[i] || !r.textContent!.trim() })).filter((x) => x.empty);
  status.textContent = pending.length ? `${rs.length - pending.length} of ${rs.length} fields filled` : 'All fields filled. Ready to export.';
  list.replaceChildren(...pending.map((p) => el('li', {}, p.label)));
}
editor.view.dom.addEventListener('input', update);
const obs = new MutationObserver(update);
obs.observe(editor.view.dom, { subtree: true, childList: true, characterData: true });
update();

$('#actions').append(
  button('Download .docx', async () => download(await (await import('../src/docx')).exportDocx(editor), 'contract.docx'), true),
  button('Print / Save as PDF', () => editor.execute('print')),
  button('Reset', () => { editor.setHTML(content); update(); }),
);
$('#app').append(codePanel(`
plugins: [...defaultPlugins, RestrictedEditing()],
// <section data-locked> = fixed text, <div data-editable-region> = fill in
// progress: regions whose text still equals the placeholder are "pending"
`));
