import { createEditor, defaultPlugins, download } from '../src';
import { $, button, codePanel, el, makeImage } from './samples';

const title = el('input', { class: 'out', value: 'Why small editors win', 'aria-label': 'Title' });
const slug = el('input', { class: 'out', 'aria-label': 'Slug' });
const cover = el('img', { alt: 'Cover image', style: 'width:100%;border-radius:8px;display:block' });
const meta = el('div', { class: 'status' });
const width = el('select', { 'aria-label': 'Preview width' }, el('option', { value: '375', textContent: 'Phone (375)' }), el('option', { value: '768', textContent: 'Tablet (768)' }), el('option', { value: '100%', textContent: 'Desktop' }));
const frame = el('iframe', { class: 'preview', title: 'Preview', style: 'margin:0 auto;display:block' });
frame.setAttribute('sandbox', '');
const code = el('pre', { class: 'out', hidden: true });
let hue = 215;
let manualSlug = false;

const toSlug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 60);
slug.addEventListener('input', () => (manualSlug = true));

$('#app').append(
  el('div', { class: 'cols' },
    el('div', { class: 'panel' }, el('h2', {}, 'Post'), el('label', { class: 'status' }, 'Title'), title, el('label', { class: 'status' }, 'Slug'), slug, el('div', { style: 'margin:10px 0' }, cover, el('div', { class: 'actions' }, button('New cover', () => ((hue = (hue + 47) % 360), refresh())))), el('div', { id: 'editor' }), meta),
    el('div', { class: 'panel' }, el('h2', {}, 'Preview ', width), frame, el('div', { class: 'actions', id: 'tabs' }), code),
  ),
);

const editor = createEditor({
  element: $('#editor'),
  plugins: defaultPlugins,
  content: '<p>Big editors do everything, and you pay for all of it. A small core with plugins lets you ship only what you need.</p><h2>What changes</h2><ul><li><p>Smaller bundles</p></li><li><p>Fewer surprises</p></li></ul><p>Drop an image into the editor, or paste one.</p>',
  onChange: refresh,
});

function refresh() {
  cover.src = makeImage(960, 360, title.value.slice(0, 24) || 'Cover', hue);
  if (!manualSlug) slug.value = toSlug(title.value);
  const words = editor.getHTML().replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  meta.textContent = `${words} words · ${Math.max(1, Math.round(words / 200))} min read · /blog/${slug.value || '…'}`;
  const body = editor.getHTML();
  const doc = `<h1>${title.value.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</h1><img src="${cover.src}" alt="" style="max-width:100%">${body}`;
  frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui;margin:16px;color:#111}img{max-width:100%;height:auto}</style>${doc}`;
  frame.style.width = width.value.endsWith('%') ? width.value : `${width.value}px`;
  code.textContent = mode === 'md' ? `# ${title.value}\n\n${editor.getMarkdown()}` : doc;
  code.hidden = !mode;
}
let mode: '' | 'html' | 'md' = '';
title.addEventListener('input', refresh);
width.addEventListener('change', refresh);
$('#tabs').append(
  button('Preview', () => ((mode = ''), refresh()), true),
  button('HTML', () => ((mode = 'html'), refresh())),
  button('Markdown', () => ((mode = 'md'), refresh())),
  button('Download .html', () => download(`<!doctype html><meta charset="utf-8"><title>${title.value.replace(/[<&]/g, '')}</title>${editor.getHTML()}`, `${slug.value || 'post'}.html`, 'text/html')),
);
refresh();
$('#app').append(codePanel(`
const md = editor.getMarkdown();          // body as Markdown
const html = editor.getHTML();            // schema-sanitised HTML, safe to embed
// the preview is a sandboxed iframe, so nothing in the post can run
`));
