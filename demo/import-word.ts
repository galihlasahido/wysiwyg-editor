import { createEditor } from '../src';
import { $, ARTICLE, button, el, makeImage, codePanel } from './samples';

const log = el('pre', { class: 'out', textContent: 'No file imported yet.' });
const drop = el('div', { class: 'panel', style: 'border-style:dashed;text-align:center;padding:22px', textContent: 'Drop a .docx file here, or use the buttons below.' });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Conversion runs in your browser through the optional ', el('code', {}, 'mammoth'), ' package. The result is parsed with the editor schema, so unsupported or unsafe markup is dropped.'),
  drop,
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'cols' }, el('div', { class: 'panel' }, el('h2', {}, 'Editor'), el('div', { id: 'editor' })), el('div', { class: 'panel' }, el('h2', {}, 'Conversion messages'), log)),
);

const editor = createEditor({ element: $('#editor'), content: '<p>Import a document to see it here.</p>', ribbon: false });

async function load(file: Blob, name: string) {
  try {
    const { importDocx } = await import('../src/docx');
    const warnings = await importDocx(editor, file);
    log.textContent = `Imported ${name} (${Math.round(file.size / 1024)} KB).\n${warnings.length ? warnings.join('\n') : 'No warnings.'}\n\nIt is one undo step: press Ctrl/Cmd+Z to go back.`;
  } catch (err) {
    log.textContent = `Could not import ${name}: ${err instanceof Error ? err.message : err}`; // e.g. not a .docx file
  }
}

const input = el('input', { type: 'file', accept: '.docx', hidden: true });
input.addEventListener('change', () => input.files?.[0] && load(input.files[0], input.files[0].name));
drop.addEventListener('dragover', (e) => e.preventDefault());
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files[0];
  if (f) load(f, f.name);
});

$('#actions').append(
  input,
  button('Choose .docx…', () => input.click(), true),
  button('Generate a sample .docx and import it', async () => {
    // Build a real .docx from a throwaway editor, then import it, so the demo works without any file.
    const host = el('div');
    const tmp = createEditor({ element: host, toolbar: false, content: `${ARTICLE}<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><p><img src="${makeImage(320, 160, 'Sample')}" alt="sample" width="240"></p>` });
    const { exportDocx } = await import('../src/docx');
    await load(await exportDocx(tmp), 'sample.docx');
    tmp.destroy();
  }),
);

$('#app').append(codePanel(`
import { importDocx } from 'wysiwygido/docx';

const warnings = await importDocx(editor, file);   // one undoable step; returns conversion warnings
`));
