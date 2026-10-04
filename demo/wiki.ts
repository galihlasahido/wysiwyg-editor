import { Versions, createEditor, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';

const KEY = 'wysiwyg-wiki-v1';
type Pages = Record<string, string>;
const link = (t: string) => `<a href="#wiki:${encodeURIComponent(t)}">${t}</a>`;
const seed: Pages = {
  Home: `<h1>Home</h1><p>Welcome to the team wiki. Start with ${link('Onboarding')} or read the ${link('Style guide')}.</p><div data-toc></div>`,
  Onboarding: `<h1>Onboarding</h1><h2>Week one</h2><ul><li><p>Get access</p></li><li><p>Read the ${link('Style guide')}</p></li></ul><h2>Week two</h2><p>Pick a first task. Back to ${link('Home')}.</p>`,
  'Style guide': `<h1>Style guide</h1><p>Short sentences. Active voice. Link pages with the link button: use <code>#wiki:Page name</code> as the address.</p><p>See ${link('Onboarding')}.</p>`,
};
const load = (): Pages => { try { return { ...seed, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...seed }; } };
const pages = load();
let current = 'Home';
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pages)); } catch { /* storage blocked */ } };

const search = el('input', { class: 'out', placeholder: 'Search pages…', 'aria-label': 'Search' });
const nav = el('ul', { class: 'tips', style: 'list-style:none;padding:0;margin:8px 0' });
const back = el('ul', { class: 'tips' });
$('#app').append(el('div', { class: 'cols', style: 'grid-template-columns:240px 1fr' },
  el('div', { class: 'panel' }, el('h2', {}, 'Pages'), search, nav, el('div', { class: 'actions' }, button('New page', () => { const n = prompt('Page name'); if (n?.trim()) { pages[n.trim()] ||= `<h1>${n.trim().replace(/[<&]/g, '')}</h1><p></p>`; open(n.trim()); } })), el('h2', {}, 'Linked from'), back),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
));

const editor = createEditor({ element: $('#editor'), plugins: [...defaultPlugins, Versions({ author: 'You' })], content: pages[current], onChange: () => { pages[current] = editor.getHTML(); save(); backlinks(); } });

function open(name: string) {
  current = name;
  editor.setHTML(pages[name] ?? '<p></p>');
  renderNav();
  backlinks();
}
function renderNav() {
  const q = search.value.toLowerCase();
  nav.replaceChildren(...Object.keys(pages).filter((n) => !q || n.toLowerCase().includes(q) || pages[n].toLowerCase().includes(q)).sort().map((n) => el('li', {}, button(n, () => open(n), n === current))));
}
function backlinks() {
  const needle = `#wiki:${encodeURIComponent(current)}`;
  const from = Object.keys(pages).filter((n) => n !== current && pages[n].includes(needle));
  back.replaceChildren(...(from.length ? from.map((n) => el('li', {}, button(n, () => open(n)))) : [el('li', {}, 'No page links here yet')]));
}
search.addEventListener('input', renderNav);
// links inside the editor open the page instead of navigating
editor.view.dom.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a[href^="#wiki:"]');
  if (!a) return;
  e.preventDefault();
  open(decodeURIComponent(a.getAttribute('href')!.slice(6)));
});
renderNav();
backlinks();
$('#app').append(codePanel(`
// pages live in localStorage; links use href="#wiki:Page"
editor.view.dom.addEventListener('click', (e) => { /* open the page named by the link */ });
// Versions() gives named snapshots per page session
`));
