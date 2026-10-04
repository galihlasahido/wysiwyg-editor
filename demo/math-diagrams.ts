import 'katex/dist/katex.min.css';
import { Equations, Mermaid, createEditor, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';

const content =
  '<h1>Notes on the quadratic formula</h1>' +
  '<p>For <span data-math="ax^2 + bx + c = 0"></span>, the solutions are:</p>' +
  '<div data-math-block="x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}"></div>' +
  '<p>The sum of a series: <span data-math="\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}"></span>. Try typing <code>$e^{i\\pi}+1=0$</code> yourself.</p>' +
  '<h2>How the solver works</h2>' +
  '<figure data-mermaid="flowchart TD\n  A[Read a, b, c] --> B{a = 0?}\n  B -- Yes --> C[Linear: x = -c / b]\n  B -- No --> D[Discriminant D = b² - 4ac]\n  D --> E{D < 0?}\n  E -- Yes --> F[No real roots]\n  E -- No --> G[Two roots]"></figure>' +
  '<h2>A request</h2>' +
  '<figure data-mermaid="sequenceDiagram\n  participant U as User\n  participant E as Editor\n  participant K as KaTeX\n  U->>E: types $x^2$\n  E->>K: render(x^2)\n  K-->>E: HTML + MathML\n  E-->>U: equation"></figure>' +
  '<p></p>';

const out = el('pre', { class: 'out', hidden: true });
$('#app').append(
  el('div', { class: 'demo-note' }, el('strong', {}, '∑'), ' inserts an inline equation, ', el('strong', {}, '∫'), ' a display equation, ', el('strong', {}, '⬡'), ' a Mermaid diagram. Both dialogs show a live preview and have starters. Invalid input shows the error in place and never breaks the page. The dark toggle redraws diagrams in dark colours.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  out,
);
const editor = createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, Equations(), Mermaid()], ribbon: true, outline: false });
(window as unknown as { editor: typeof editor }).editor = editor;
$('#actions').append(
  button('Dark', () => editor.setTheme(editor.root.dataset.theme === 'dark' ? 'light' : 'dark')),
  button('Show Markdown', () => { out.hidden = false; out.textContent = editor.getMarkdown(); }, true),
  button('Show HTML', () => { out.hidden = false; out.textContent = editor.getHTML(); }),
);
$('#app').append(codePanel(`
import 'katex/dist/katex.min.css';
plugins: [...defaultPlugins, Equations({ macros: { '\\\\RR': '\\\\mathbb{R}' } }), Mermaid()],

editor.execute('insertMath', 'E = mc^2');          // inline
editor.execute('insertMathBlock', '\\\\int_0^1 x\\\\,dx');  // display
editor.execute('insertMermaid', 'flowchart LR\\n  A --> B');
// Markdown: $x^2$, $$ ... $$ blocks and \`\`\`mermaid fences
`));
