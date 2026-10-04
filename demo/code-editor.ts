import { createCodeEditor, languageForFilename, type CursorInfo } from '../src';
import { $, Kernel, codePanel, el } from './samples';

interface File { id: string; name: string; value: string }

const STORAGE = 'wysiwyg-code-editor-files-v1';
const SAMPLES: File[] = [
  {
    id: 'f1',
    name: 'main.js',
    value: `// Press Run (Ctrl+Enter). Try: Ctrl+/ to comment, Alt+Up/Down to move a line,
// Shift+Alt+Down to duplicate, Ctrl+G to jump to a line, Ctrl+F to search.
function isPrime(n) {
  if (n < 2) return false;
  for (let i = 2; i * i <= n; i++) {
    if (n % i === 0) return false;
  }
  return true;
}

const primes = [];
for (let n = 1; primes.length < 12; n++) {
  if (isPrime(n)) primes.push(n);
}

console.log('first primes:', primes);
console.log({ sum: primes.reduce((a, b) => a + b, 0), count: primes.length });
`,
  },
  {
    id: 'f2',
    name: 'utils.ts',
    value: `export interface Point { x: number; y: number }

/** Euclidean distance between two points. */
export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function groupBy<T, K extends string | number>(items: T[], key: (item: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const item of items) {
    (out[key(item)] ??= []).push(item);
  }
  return out;
}
`,
  },
  {
    id: 'f3',
    name: 'index.html',
    value: `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Counter</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <button id="inc">Clicked 0 times</button>
  <!-- Run to see a live preview: styles.css and script.js are inlined for you -->
  <script src="script.js"></script>
</body>
</html>
`,
  },
  {
    id: 'f4',
    name: 'styles.css',
    value: `body {
  font-family: system-ui, sans-serif;
  display: grid;
  place-items: center;
  height: 100vh;
  margin: 0;
  background: #0f172a;
}

button {
  padding: 14px 24px;
  font-size: 18px;
  border: 0;
  border-radius: 10px;
  background: #38bdf8;
  color: #0f172a;
  cursor: pointer;
}
button:hover { background: #7dd3fc; }
`,
  },
  {
    id: 'f5',
    name: 'script.js',
    value: `let count = 0;
const button = document.getElementById('inc');

button.addEventListener('click', () => {
  count++;
  button.textContent = 'Clicked ' + count + ' time' + (count === 1 ? '' : 's');
  console.log('count =', count);
});
`,
  },
  {
    id: 'f6',
    name: 'app.py',
    value: `from dataclasses import dataclass


@dataclass
class Account:
    owner: str
    balance: float = 0.0

    def deposit(self, amount: float) -> None:
        if amount <= 0:
            raise ValueError("amount must be positive")
        self.balance += amount


acct = Account("Ana")
acct.deposit(25.5)
print(f"{acct.owner}: {acct.balance:.2f}")  # Ana: 25.50
`,
  },
];

function load(): File[] {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null');
    if (Array.isArray(saved) && saved.length && saved.every((f) => typeof f?.id === 'string' && typeof f.name === 'string' && typeof f.value === 'string')) return saved;
  } catch {
    /* private mode or corrupted data: start from the samples */
  }
  return SAMPLES.map((f) => ({ ...f }));
}

let files = load();
let activeId = files[0].id;
const persist = () => {
  try {
    files = files.map((f) => ({ ...f, value: f.id === activeId ? ce.getValue() : ce.getFileValue(f.id) ?? f.value }));
    localStorage.setItem(STORAGE, JSON.stringify(files));
  } catch {
    /* storage unavailable */
  }
};

// ---- layout -----------------------------------------------------------------------------------------------------

const tabs = el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Open files' });
const side = el('div', { class: 'side' });
const codeHost = el('div', { id: 'code' });
const consoleOut = el('pre', { textContent: 'Press Run to execute JavaScript, or open index.html and Run for a live preview.' });
const previewFrame = el('iframe', { title: 'Preview' });
previewFrame.setAttribute('sandbox', 'allow-scripts');
const consoleBody = el('div', { class: 'panel-body' }, consoleOut);
const previewBody = el('div', { class: 'panel-body hidden' }, previewFrame);
const posStatus = el('span', { textContent: 'Ln 1, Col 1' });
const selStatus = el('span');
const caretStatus = el('span', { hidden: true });
const langSelect = el('select', { 'aria-label': 'Language' });
const tabSizeBtn = el('button', { type: 'button', title: 'Change tab size' });
const themeBtn = el('button', { class: 'tb', type: 'button', title: 'Toggle theme' });
const runBtn = el('button', { class: 'tb run', type: 'button', title: 'Run (Ctrl+Enter)', textContent: '▶ Run' });
const wrapBtn = el('button', { class: 'tb', type: 'button', title: 'Toggle word wrap' });
const palette = el('div', { class: 'palette', hidden: true });

const LANGS = ['', 'javascript', 'typescript', 'json', 'python', 'html', 'css', 'bash', 'sql', 'go', 'rust', 'java', 'markdown', 'yaml'];
for (const l of LANGS) langSelect.add(new Option(l === '' ? 'Plain text' : l, l));

const ide = el(
  'div',
  { class: 'ide' },
  el('div', { class: 'toolbar' }, runBtn, wrapBtn, themeBtn, el('button', { class: 'tb', type: 'button', textContent: 'A−', title: 'Smaller font', onclick: () => (ce.setFontSize(ce.fontSize - 1), refreshStatus()) }), el('button', { class: 'tb', type: 'button', textContent: 'A+', title: 'Larger font', onclick: () => (ce.setFontSize(ce.fontSize + 1), refreshStatus()) }), el('button', { class: 'tb', type: 'button', textContent: 'Find', title: 'Find (Ctrl+F)', onclick: () => ce.editor.execute('toggleFind') }), el('button', { class: 'tb', type: 'button', textContent: 'Go to line', title: 'Ctrl+G', onclick: () => ce.editor.execute('goToLine') }), el('button', { class: 'tb', type: 'button', textContent: 'Fold all', title: 'Fold every top-level block', onclick: () => ce.foldAll() }), el('button', { class: 'tb', type: 'button', textContent: 'Unfold all', onclick: () => ce.unfoldAll() }), el('button', { class: 'tb', type: 'button', textContent: 'Minimap', title: 'Show or hide the minimap', onclick: () => ce.setMinimap(!ce.hasMinimap) }), el('span', { class: 'sp' }), el('button', { class: 'tb', type: 'button', textContent: 'Commands ⌘⇧P', onclick: () => openPalette() })),
  tabs,
  el('div', { class: 'main' }, side, codeHost),
  el('div', { class: 'panel-bar' }, el('button', { class: 'ptab active', type: 'button', id: 'ptab-console', textContent: 'Output', onclick: () => showPanel('console') }), el('button', { class: 'ptab', type: 'button', id: 'ptab-preview', textContent: 'Preview', onclick: () => showPanel('preview') }), el('span', { style: 'flex:1' }), el('button', { class: 'ptab', type: 'button', textContent: 'Clear', onclick: () => (consoleOut.textContent = '') })),
  el('div', {}, consoleBody, previewBody),
);
// the status bar sits below the panels
const status = el('div', { class: 'status' }, posStatus, selStatus, caretStatus, el('span', { class: 'sp' }), langSelect, tabSizeBtn, el('span', { textContent: 'Spaces' }), el('span', { textContent: 'UTF-8' }), el('span', { textContent: 'LF' }));
ide.append(status);
ide.style.gridTemplateRows = 'auto auto minmax(0, 1fr) auto auto auto';

$('#app').append(
  el('div', { class: 'demo-note' }, el('strong', {}, 'Keys: '), el('kbd', {}, 'Tab'), ' / ', el('kbd', {}, 'Shift+Tab'), ' indent · ', el('kbd', {}, 'Ctrl/Cmd+/'), ' comment · ', el('kbd', {}, 'Alt+↑/↓'), ' move line · ', el('kbd', {}, 'Shift+Alt+↓'), ' duplicate · ', el('kbd', {}, 'Ctrl/Cmd+Shift+K'), ' delete line · ', el('kbd', {}, 'Ctrl/Cmd+L'), ' select line · ', el('kbd', {}, 'Ctrl/Cmd+G'), ' go to line · ', el('kbd', {}, 'Ctrl/Cmd+F'), ' find · ', el('kbd', {}, 'Ctrl/Cmd+Enter'), ' run · ', el('kbd', {}, 'Ctrl/Cmd+S'), ' save to this browser · ', el('kbd', {}, 'Ctrl/Cmd+Shift+P'), ' commands · ', el('kbd', {}, 'Alt+click'), ' or ', el('kbd', {}, 'Ctrl/Cmd+Alt+↑/↓'), ' add cursors (Esc clears) · gutter arrows or ', el('kbd', {}, 'Ctrl/Cmd+Alt+['), ' fold.'),
  ide,
  palette,
);

// ---- the editor ---------------------------------------------------------------------------------------------------

function onCursor(c: CursorInfo) {
  posStatus.textContent = `Ln ${c.line}, Col ${c.col}`;
  selStatus.textContent = c.selected ? `(${c.selected} selected)` : '';
  selStatus.hidden = !c.selected;
  langSelect.value = LANGS.includes(c.language ?? '') ? c.language ?? '' : '';
}

const first = files[0];
const ce = createCodeEditor({
  element: codeHost,
  value: first.value,
  language: languageForFilename(first.name),
  theme: 'dark',
  tabSize: 2,
  minimap: true,
  onChange: () => scheduleSave(),
  onCursor,
});
const showCarets = () => { caretStatus.hidden = ce.cursorCount < 2; caretStatus.textContent = `${ce.cursorCount} cursors`; };
for (const t of ['keyup', 'mouseup', 'click']) codeHost.addEventListener(t, () => requestAnimationFrame(showCarets));
(window as unknown as { ce: typeof ce }).ce = ce; // handy for experimenting in the console
let saveTimer: ReturnType<typeof setTimeout>;
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 600);
  renderTabs();
};

function refreshStatus() {
  tabSizeBtn.textContent = `Tab Size: ${ce.tabSize}`;
  wrapBtn.textContent = ce.wordWrap ? 'Wrap: on' : 'Wrap: off';
  themeBtn.textContent = ce.editor.theme === 'dark' ? '☾ Dark' : '☀ Light';
}

// ---- files and tabs -----------------------------------------------------------------------------------------------

const dirty = new Set<string>();
const original = new Map(files.map((f) => [f.id, f.value]));

function renderTabs() {
  dirty.clear();
  for (const f of files) if (original.get(f.id) !== (f.id === activeId ? ce.getValue() : ce.getFileValue(f.id) ?? f.value)) dirty.add(f.id);
  tabs.replaceChildren(
    ...files.map((f) => {
      const tab = el('div', { class: `tab${f.id === activeId ? ' active' : ''}`, role: 'tab', 'aria-selected': String(f.id === activeId), tabIndex: 0, onclick: () => open(f.id) }, f.name);
      if (dirty.has(f.id)) tab.append(el('span', { class: 'dot', title: 'Modified' }));
      tab.append(el('button', { class: 'x', type: 'button', title: 'Close', 'aria-label': `Close ${f.name}`, textContent: '×', onclick: (e: Event) => (e.stopPropagation(), close(f.id)) }));
      tab.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(f.id)));
      return tab;
    }),
    el('button', { class: 'new', type: 'button', title: 'New file', 'aria-label': 'New file', textContent: '+', onclick: newFile }),
  );
  side.replaceChildren(
    el('h3', {}, 'Files'),
    ...files.map((f) => el('div', { class: `file${f.id === activeId ? ' active' : ''}`, onclick: () => open(f.id) }, f.name, el('span', { class: 'lang', textContent: languageForFilename(f.name) ?? '' }))),
  );
}

function open(id: string) {
  const f = files.find((x) => x.id === id);
  if (!f) return;
  persist();
  activeId = id;
  ce.openFile({ id, value: f.value, language: languageForFilename(f.name) });
  renderTabs();
  ce.focus();
}

function close(id: string) {
  if (files.length === 1) return;
  const idx = files.findIndex((f) => f.id === id);
  if (id === activeId) open(files[idx === 0 ? 1 : idx - 1].id);
  ce.closeFile(id);
  files = files.filter((f) => f.id !== id);
  persist();
  renderTabs();
}

function newFile() {
  const name = window.prompt('File name (the extension picks the language)', `untitled-${files.length + 1}.js`)?.trim();
  if (!name || name.length > 80 || /[\\/]/.test(name) || files.some((f) => f.name === name)) return;
  const id = `f${Date.now().toString(36)}`;
  files.push({ id, name, value: '' });
  original.set(id, '');
  open(id);
}

// ---- run ----------------------------------------------------------------------------------------------------------

const kernel = new Kernel();
function showPanel(which: 'console' | 'preview') {
  consoleBody.classList.toggle('hidden', which !== 'console');
  previewBody.classList.toggle('hidden', which !== 'preview');
  $('#ptab-console').classList.toggle('active', which === 'console');
  $('#ptab-preview').classList.toggle('active', which === 'preview');
}

const fileText = (name: string) => (name === files.find((f) => f.id === activeId)?.name ? ce.getValue() : ce.getFileValue(files.find((f) => f.name === name)?.id ?? '') ?? files.find((f) => f.name === name)?.value ?? null);

async function run() {
  const f = files.find((x) => x.id === activeId)!;
  const lang = languageForFilename(f.name);
  if (lang === 'html') {
    // Inline the referenced stylesheet and script so the preview needs no server.
    let html = ce.getValue();
    html = html.replace(/<link[^>]+href=["']([^"']+\.css)["'][^>]*>/gi, (m, href) => {
      const css = fileText(href);
      return css === null ? m : `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`;
    });
    html = html.replace(/<script[^>]+src=["']([^"']+\.js)["'][^>]*>\s*<\/script>/gi, (m, src) => {
      const js = fileText(src);
      return js === null ? m : `<script>${js.replace(/<\/script/gi, '<\\/script')}<\/script>`;
    });
    const bridge = `<script>for (const k of ['log','warn','error']) { const o = console[k]; console[k] = (...a) => { parent.postMessage({ ide: true, k, text: a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') }, '*'); o.apply(console, a); }; } addEventListener('error', (e) => parent.postMessage({ ide: true, k: 'error', text: e.message }, '*'));<\/script>`;
    consoleOut.textContent = '';
    previewFrame.srcdoc = bridge + html;
    showPanel('preview');
    return;
  }
  if (lang === 'javascript') {
    showPanel('console');
    consoleOut.textContent = 'Running…';
    const r = await kernel.run(ce.getValue());
    consoleOut.textContent = [...r.lines, r.error ? `✖ ${r.error}` : ''].filter(Boolean).join('\n') || '(no output)';
    return;
  }
  showPanel('console');
  consoleOut.textContent = `Running ${lang ?? 'this file type'} is not available in the browser. JavaScript and HTML can be run.`;
}
window.addEventListener('message', (e) => {
  if (e.source !== previewFrame.contentWindow || !e.data?.ide) return;
  consoleOut.textContent += `${e.data.k === 'log' ? '' : e.data.k + ': '}${e.data.text}\n`;
});
runBtn.addEventListener('click', run);

// ---- toolbar and status controls ------------------------------------------------------------------------------------

themeBtn.addEventListener('click', () => {
  const next = ce.editor.theme === 'dark' ? 'light' : 'dark';
  ce.setTheme(next);
  ide.classList.toggle('light', next === 'light');
  refreshStatus();
});
wrapBtn.addEventListener('click', () => (ce.setWordWrap(!ce.wordWrap), refreshStatus()));
tabSizeBtn.addEventListener('click', () => (ce.setTabSize(ce.tabSize === 2 ? 4 : ce.tabSize === 4 ? 8 : 2), refreshStatus()));
langSelect.addEventListener('change', () => (ce.setLanguage(langSelect.value || null), ce.focus()));

// ---- shortcuts -------------------------------------------------------------------------------------------------------

codeHost.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'Enter') (e.preventDefault(), void run());
  else if (mod && e.key.toLowerCase() === 's') (e.preventDefault(), persist());
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') (e.preventDefault(), openPalette());
});

// ---- command palette ---------------------------------------------------------------------------------------------------

interface Cmd { label: string; keys?: string; run: () => void }
const commands = (): Cmd[] => [
  { label: 'Run file', keys: 'Ctrl+Enter', run: () => void run() },
  { label: 'Toggle theme', run: () => themeBtn.click() },
  { label: 'Toggle word wrap', run: () => wrapBtn.click() },
  { label: 'Increase font size', run: () => (ce.setFontSize(ce.fontSize + 1), refreshStatus()) },
  { label: 'Decrease font size', run: () => (ce.setFontSize(ce.fontSize - 1), refreshStatus()) },
  { label: 'Cycle tab size (2 / 4 / 8)', run: () => tabSizeBtn.click() },
  { label: 'Go to line…', keys: 'Ctrl+G', run: () => ce.editor.execute('goToLine') },
  { label: 'Find and replace', keys: 'Ctrl+F', run: () => ce.editor.execute('toggleFind') },
  { label: 'Toggle line comment', keys: 'Ctrl+/', run: () => ce.editor.execute('toggleComment') },
  { label: 'Duplicate line', keys: 'Shift+Alt+↓', run: () => ce.editor.execute('duplicateLine') },
  { label: 'Delete line', keys: 'Ctrl+Shift+K', run: () => ce.editor.execute('deleteLine') },
  { label: 'Select line', keys: 'Ctrl+L', run: () => ce.editor.execute('selectLine') },
  { label: 'Fold at cursor', keys: 'Ctrl+Alt+[', run: () => ce.editor.execute('toggleFold') },
  { label: 'Fold all', run: () => ce.foldAll() },
  { label: 'Unfold all', run: () => ce.unfoldAll() },
  { label: 'Add cursor below', keys: 'Ctrl+Alt+↓', run: () => (ce.editor.execute('addCaretBelow'), showCarets()) },
  { label: 'Add cursor above', keys: 'Ctrl+Alt+↑', run: () => (ce.editor.execute('addCaretAbove'), showCarets()) },
  { label: 'Toggle minimap', run: () => ce.setMinimap(!ce.hasMinimap) },
  { label: 'New file…', run: newFile },
  { label: 'Save to this browser', keys: 'Ctrl+S', run: persist },
  { label: 'Reset all files to the samples', run: () => (localStorage.removeItem(STORAGE), location.reload()) },
];

function openPalette() {
  const input = el('input', { placeholder: 'Type a command…', 'aria-label': 'Command' });
  const list = el('ul');
  let sel = 0;
  let shown: Cmd[] = [];
  const draw = () => {
    const q = input.value.toLowerCase();
    shown = commands().filter((c) => c.label.toLowerCase().includes(q));
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((c, i) => el('li', { class: i === sel ? 'sel' : '', onclick: () => choose(c) }, c.label, el('kbd', { textContent: c.keys ?? '' }))));
  };
  const closePalette = () => {
    palette.hidden = true;
    palette.replaceChildren();
    ce.focus();
  };
  const choose = (c: Cmd) => {
    closePalette();
    c.run();
  };
  input.addEventListener('input', () => ((sel = 0), draw()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), (sel = Math.min(shown.length - 1, sel + 1)), draw());
    else if (e.key === 'ArrowUp') (e.preventDefault(), (sel = Math.max(0, sel - 1)), draw());
    else if (e.key === 'Enter') (e.preventDefault(), shown[sel] && choose(shown[sel]));
    else if (e.key === 'Escape') (e.preventDefault(), closePalette());
  });
  palette.addEventListener('mousedown', (e) => e.target === palette && closePalette(), { once: true });
  palette.replaceChildren(el('div', { class: 'box' }, input, list));
  palette.hidden = false;
  draw();
  input.focus();
}

// ---- go -------------------------------------------------------------------------------------------------------------

ce.openFile({ id: first.id, value: first.value, language: languageForFilename(first.name) });
refreshStatus();
renderTabs();

$('#app').append(
  codePanel(`
import { createCodeEditor, languageForFilename } from 'wysiwyg-editor';

const ide = createCodeEditor({
  element, theme: 'dark', tabSize: 2, wordWrap: true,
  onChange: (value) => save(value),
  onCursor: ({ line, col, selected, lines }) => updateStatusBar(line, col),
});

ide.openFile({ id: 'main.ts', value: source, language: languageForFilename('main.ts') });  // each file keeps its own undo history
ide.getValue();        ide.setLanguage('python');       ide.goToLine(42);
ide.setWordWrap(false); ide.setFontSize(16);             ide.editor.execute('toggleComment');`),
);
