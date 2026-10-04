import { createCodeEditor, createEditor } from '../src';
import { $, codePanel, el } from './samples';

const SAMPLE = `# Release notes

Welcome to **version 2**. The editor now has:

- line numbers in the code view
- a live preview, kept in sync
- \`inline code\` and [links](https://example.com)

> Quotes work too.

## Steps

1. Write on the left
2. Read on the right
3. Ship it

\`\`\`js
const answer = 42;
\`\`\`
`;
const preview = el('div', { class: 'panel', style: 'min-height:420px;overflow:auto' });
const hidden = el('div', { style: 'display:none' });
$('#app').append(
  el('div', { class: 'cols', style: 'grid-template-columns:1fr 1fr' },
    el('div', { class: 'panel' }, el('h2', {}, 'Markdown'), el('div', { id: 'code', style: 'height:480px' })),
    el('div', {}, el('h2', { style: 'font-size:15px;margin:0 0 8px' }, 'Preview'), preview),
  ),
  hidden,
);
// the renderer is a hidden editor: Markdown goes in, schema-sanitised HTML comes out
const renderer = createEditor({ element: hidden, content: '' });
const render = (md: string) => { renderer.setMarkdown(md); preview.innerHTML = renderer.getHTML(); };
const ce = createCodeEditor({ element: $('#code'), value: SAMPLE, language: 'markdown', height: '480px', onChange: render });
render(SAMPLE);
(window as any).ce = ce;
$('#app').append(codePanel(`
const renderer = createEditor({ element: hiddenDiv });          // Markdown -> sanitised HTML
const ce = createCodeEditor({ element, language: 'markdown', onChange: (md) => { renderer.setMarkdown(md); preview.innerHTML = renderer.getHTML(); } });
`));
