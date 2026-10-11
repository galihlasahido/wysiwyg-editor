import { createEditor, defaultPlugins, defaultThemes, Themes } from '../src';
import { $, button, codePanel, el } from './samples';

const content = `<h1>Pick a look</h1><p>Every theme restyles the toolbar, the ribbon, the panels and the paper. Try the buttons above, or open <b>View → Themes</b> in the ribbon.</p><blockquote>Switching is instant and never touches the page outside the editor.</blockquote><ul><li>Light and dark, plus eight more</li><li>A <a href="https://example.com">link</a>, <code>inline code</code> and a table</li></ul><table><tr><th>Theme</th><th>Mode</th></tr><tr><td>Sepia</td><td>light</td></tr><tr><td>Midnight</td><td>dark</td></tr></table>`;

const brand = { name: 'brand', label: 'Brand', palette: { mode: 'light' as const, bg: '#fff8f0', surface: '#ffeede', fg: '#2a1a10', muted: '#7a5a44', border: '#f0d6bf', accent: '#e8590c', workspace: '#f0d2b8', pageBg: '#ffffff', pageFg: '#2a1a10' } };

$('#app').append(
  el('div', { class: 'actions' },
    ...[...defaultThemes, brand].map((t) => button(t.label, () => editor.execute('colorTheme', t.name))),
    button('Next', () => editor.execute('cycleColorTheme')),
    button('Reset', () => editor.execute('clearColorTheme')),
  ),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({ element: $('#editor'), content, ribbon: true, pages: true, plugins: [...defaultPlugins.filter((p) => p.name !== 'themes'), Themes({ extra: [brand] })] });
(window as unknown as { editor: typeof editor }).editor = editor;
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Themes({ initial: 'sepia' })],
editor.execute('colorTheme', 'midnight');
editor.execute('cycleColorTheme');
// your own: a few colours, the rest is derived
Themes({ extra: [{ name: 'brand', label: 'Brand', palette: { mode: 'light', bg: '#fff8f0', surface: '#ffeede',
  fg: '#2a1a10', muted: '#7a5a44', border: '#f0d6bf', accent: '#e8590c', workspace: '#f0d2b8', pageBg: '#fff', pageFg: '#2a1a10' } }] })
// <wysiwyg-editor theme="sepia">
`));
