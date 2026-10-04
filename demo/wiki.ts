import { Versions, askDialog, createEditor, defaultPlugins } from '../src';
import { $, button, codePanel, el } from './samples';

const KEY = 'wysiwyg-wiki-v1';
type Pages = Record<string, string>;
const link = (t: string) => `<a href="#wiki:${encodeURIComponent(t)}">${t}</a>`;
const seed: Pages = {
  Home: `<h1>Home</h1><p>Welcome to the team wiki. Start with ${link('Onboarding')} or read the ${link('Style guide')}.</p><div data-toc></div>`,
  Onboarding: `<h1>Onboarding</h1><h2>Week one</h2><ul><li><p>Get access</p></li><li><p>Read the ${link('Style guide')}</p></li></ul><h2>Week two</h2><p>Pick a first task. Back to ${link('Home')}.</p>`,
  'Style guide': `<h1>Style guide</h1><p>Short sentences. Active voice. Link pages with the link button: use <code>#wiki:Page name</code> as the address.</p><p>See ${link('Onboarding')}.</p>`,
};
// Storage is shared by every page on this origin, so it is data to validate: only string values, and no inherited keys
// (a page called "constructor" or "toString" must not hit Object.prototype).
const load = (): Pages => {
  const out: Pages = Object.create(null);
  Object.assign(out, seed);
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) for (const [k, v] of Object.entries(saved)) if (typeof v === 'string' && k !== '__proto__' && k.length <= 200) out[k] = v;
  } catch { /* corrupt storage: start from the samples */ }
  return out;
};
const pages = load();
let current = 'Home';
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pages)); } catch { /* storage blocked */ } };

const search = el('input', { class: 'out', placeholder: 'Search pages…', 'aria-label': 'Search' });
const nav = el('ul', { class: 'tips', style: 'list-style:none;padding:0;margin:8px 0' });
const back = el('ul', { class: 'tips' });
$('#app').append(el('div', { class: 'cols', style: 'grid-template-columns:240px 1fr' },
  el('div', { class: 'panel' }, el('h2', {}, 'Pages'), search, nav, el('div', { class: 'actions' }, button('New page', () => void askDialog(editor.root, { title: 'New page', label: 'Page name', placeholder: 'e.g. Release checklist', submitLabel: 'Create', maxLength: 100, validate: (v) => (Object.hasOwn(pages, v) ? 'A page with this name already exists.' : null) }).then((n) => { if (!n) return; pages[n] = `<h1>${n.replace(/[<&>]/g, '')}</h1><p></p>`; open(n); }))), el('h2', {}, 'Linked from'), back),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
));

const editor = createEditor({ element: $('#editor'), plugins: [...defaultPlugins, Versions({ author: 'You' })], content: pages[current], onChange: () => { pages[current] = editor.getHTML(); save(); backlinks(); } });

function open(name: string) {
  current = name;
  editor.setHTML(Object.hasOwn(pages, name) ? pages[name] : '<p></p>');
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
  try { open(decodeURIComponent(a.getAttribute('href')!.slice(6))); } catch { /* malformed %-escape in the link */ }
});
renderNav();
backlinks();
$('#app').append(codePanel(`
// pages live in localStorage; links use href="#wiki:Page"
editor.view.dom.addEventListener('click', (e) => { /* open the page named by the link */ });
// Versions() gives named snapshots per page session
`));
