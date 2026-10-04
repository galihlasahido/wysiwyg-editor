import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSelection, TextSelection } from 'prosemirror-state';
import { AIAssistant, Comments, Editor, TrackChanges, Versions, createEditor, defaultPlugins, getChanges } from '../src';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function make(html = '<h1>Title</h1><p>Hello world</p><p>Second paragraph</p>', extra: any[] = [], config: object = {}) {
  document.body.innerHTML = '<main></main>';
  const e = createEditor({
    element: document.querySelector('main')!,
    content: html,
    plugins: [...defaultPlugins, Comments({ author: 'Ana' }), TrackChanges({ author: 'Ana' }), Versions(), ...extra],
    pages: true,
    outline: true,
    ribbon: true,
    ...config,
  } as any);
  editors.push(e);
  return e;
}
const select = (e: Editor, from: number, to = from) => e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, from, to)));
const tab = (e: Editor, id: string) => e.root.querySelector<HTMLButtonElement>(`#wy-tab-${id}`)!;
const control = (e: Editor, label: string) => [...e.root.querySelectorAll<HTMLElement>('.wy-panel .wy-rbtn, .wy-panel select, .wy-panel input')].find((b) => b.getAttribute('aria-label') === label)!;
const click = (e: Editor, label: string) => (control(e, label) as HTMLElement).click();
const menu = (e: Editor) => e.root.querySelector<HTMLElement>('.wy-menu');
const menuItem = (e: Editor, text: string) => [...e.root.querySelectorAll<HTMLElement>('.wy-menu-item')].find((b) => b.textContent!.trim() === text)!;
const pageSettings = (e: Editor) => (e.extensions.pageSettings as () => any)();

describe('Ribbon structure', () => {
  it('builds tabs and groups, shows Home first, and hides the contextual Table tab', () => {
    const e = make();
    const tabs = [...e.root.querySelectorAll<HTMLElement>('.wy-tab')];
    expect(tabs.map((t) => t.textContent)).toEqual(['File', 'Home', 'Insert', 'Layout', 'References', 'Review', 'View', 'Help', 'Table']);
    expect(tab(e, 'home').getAttribute('aria-selected')).toBe('true');
    expect(tab(e, 'table').hidden).toBe(true);
    expect([...e.root.querySelectorAll('#wy-panel-home .wy-group-label')].map((l) => l.textContent)).toEqual(['Undo', 'Clipboard', 'Font', 'Paragraph', 'Styles', 'Editing']);
    expect(e.root.querySelector('#wy-panel-home')!.hasAttribute('hidden')).toBe(false);
    expect(e.root.querySelector('#wy-panel-insert')!.hasAttribute('hidden')).toBe(true);
  });

  it('hides controls whose plugin is not installed instead of showing dead buttons', () => {
    const e = make('<p>x</p>', [], { pages: false, outline: false, plugins: [...defaultPlugins] });
    expect(control(e, 'Margins')).toBeUndefined(); // needs the Pages plugin
    expect(control(e, 'New Comment')).toBeUndefined(); // needs Comments
    expect(control(e, 'Bold')).toBeDefined();
    expect(tab(e, 'review').textContent).toBe('Review'); // still has Spelling and Word Count
  });

  it('switches tabs by click and with the keyboard (WAI-ARIA tabs)', () => {
    const e = make();
    tab(e, 'insert').click();
    expect(tab(e, 'insert').getAttribute('aria-selected')).toBe('true');
    expect(e.root.querySelector('#wy-panel-insert')!.hasAttribute('hidden')).toBe(false);
    expect(e.root.querySelector('#wy-panel-home')!.hasAttribute('hidden')).toBe(true);
    tab(e, 'insert').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tab(e, 'layout').getAttribute('aria-selected')).toBe('true');
    tab(e, 'layout').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(tab(e, 'file').getAttribute('aria-selected')).toBe('true');
    expect(tab(e, 'file').tabIndex).toBe(0);
    expect(tab(e, 'home').tabIndex).toBe(-1);
  });

  it('collapses and expands on double click', () => {
    const e = make();
    tab(e, 'home').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(e.root.querySelector('#wy-panel-home')!.hasAttribute('hidden')).toBe(true);
    tab(e, 'home').click(); // selecting a tab re-opens it
    expect(e.root.querySelector('#wy-panel-home')!.hasAttribute('hidden')).toBe(false);
  });

  it('has one tab stop per panel with arrow-key movement', () => {
    const e = make();
    const panel = e.root.querySelector<HTMLElement>('#wy-panel-home')!;
    const controls = [...panel.querySelectorAll<HTMLElement>('button, select, input')];
    expect(controls.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    controls[0].focus();
    controls[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(controls[1]);
    expect(controls[1].tabIndex).toBe(0);
  });

  it('every control has an accessible name and the whole editor passes axe', async () => {
    const e = make('<h1>T</h1><p>x</p>', [AIAssistant({ provider: async () => 'x' })]);
    for (const c of e.root.querySelectorAll<HTMLElement>('.wy-panel button, .wy-panel select, .wy-panel input')) {
      expect(c.getAttribute('aria-label') || c.textContent?.trim(), c.outerHTML).toBeTruthy();
    }
    const results = await axe.run(e.root, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.help} :: ${v.nodes.map((n) => n.html.slice(0, 110)).join(' | ')}`)).toEqual([]);
  });
});

describe('Ribbon controls', () => {
  it('toggle buttons apply formatting and reflect the state', () => {
    const e = make();
    select(e, 8, 13);
    const bold = control(e, 'Bold');
    expect(bold.getAttribute('aria-pressed')).toBe('false');
    bold.click();
    expect(e.getHTML()).toContain('<strong>');
    expect(bold.getAttribute('aria-pressed')).toBe('true');
    expect(bold.classList.contains('is-active')).toBe(true);
    select(e, 1, 3);
    expect(bold.getAttribute('aria-pressed')).toBe('false'); // follows the selection
  });

  it('opens a menu, runs an entry, closes on Escape and on outside click', () => {
    const e = make();
    tab(e, 'insert').click();
    click(e, 'Table');
    expect(menu(e)).not.toBeNull();
    expect(control(e, 'Table').getAttribute('aria-expanded')).toBe('true');
    e.root.querySelector('.wy-menu')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(menu(e)).toBeNull();
    click(e, 'Table');
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu(e)).toBeNull();
    click(e, 'Table');
    menuItem(e, '3 × 3 table').click();
    expect(menu(e)).toBeNull();
    expect(e.getHTML()).toContain('<table>');
  });

  it('clicking the same menu button twice closes it', () => {
    const e = make();
    tab(e, 'layout').click();
    click(e, 'Margins');
    click(e, 'Margins');
    expect(menu(e)).toBeNull();
  });

  it('color palettes apply and clear a text color', () => {
    const e = make();
    select(e, 8, 13);
    click(e, 'Font color');
    (e.root.querySelector('.wy-swatch[title="#e03131"]') as HTMLElement).click();
    expect(e.getHTML()).toMatch(/color: (#e03131|rgb\(224, 49, 49\))/);
    click(e, 'Font color');
    menuItem(e, 'Automatic').click();
    expect(e.getHTML()).not.toMatch(/color:/);
  });

  it('the contextual Table tab follows the cursor', () => {
    const e = make();
    tab(e, 'insert').click();
    click(e, 'Table');
    menuItem(e, '2 × 2 table').click();
    expect(tab(e, 'table').hidden).toBe(false); // the cursor is in the first cell
    tab(e, 'table').click();
    click(e, 'Insert Row');
    expect(e.root.querySelectorAll('tr')).toHaveLength(3);
    let last = 0;
    e.view.state.doc.descendants((n, p) => void (n.type.name === 'paragraph' && n.textContent === 'Second paragraph' && (last = p + 2)));
    select(e, last); // out of the table, into a paragraph
    expect(tab(e, 'table').hidden).toBe(true);
    expect(tab(e, 'home').getAttribute('aria-selected')).toBe('true'); // hands over to Home
  });

  it('indent and spacing spinners show the cursor paragraph and apply on change', () => {
    const e = make();
    select(e, 9);
    tab(e, 'layout').click();
    const left = control(e, 'Left (cm)') as HTMLInputElement;
    expect(left.value).toBe('0');
    left.value = '2';
    left.dispatchEvent(new Event('change', { bubbles: true }));
    expect(e.view.state.selection.$from.parent.attrs.indentLeft).toBe(76);
    expect(left.value).toBe('2');
    (control(e, 'After (pt)') as HTMLInputElement).value = '12';
    control(e, 'After (pt)').dispatchEvent(new Event('change', { bubbles: true }));
    expect(e.view.state.selection.$from.parent.attrs.spaceAfter).toBe(12);
    // out-of-range values are clamped, junk is ignored
    left.value = '999';
    left.dispatchEvent(new Event('change', { bubbles: true }));
    expect(e.view.state.selection.$from.parent.attrs.indentLeft).toBe(Math.round(20 * (96 / 2.54)));
    left.value = '';
    left.dispatchEvent(new Event('change', { bubbles: true }));
    expect(e.view.state.selection.$from.parent.attrs.indentLeft).toBe(Math.round(20 * (96 / 2.54)));
    select(e, 1); // the heading has no indent
    expect(left.value).toBe('0');
  });

  it('view toggles reflect state: dark mode, ruler, reading view, zoom', () => {
    const e = make();
    tab(e, 'view').click();
    const dark = control(e, 'Dark Mode');
    expect(dark.classList.contains('is-active')).toBe(false);
    dark.click();
    expect(e.root.dataset.theme).toBe('dark');
    expect(e.root.dataset.page).toBe('dark');
    expect(dark.classList.contains('is-active')).toBe(true);
    click(e, 'Switch Background');
    expect(e.root.dataset.page).toBe('light'); // chrome stays dark, paper switches
    expect(e.root.dataset.theme).toBe('dark');
    const ruler = control(e, 'Ruler');
    expect(ruler.classList.contains('is-active')).toBe(true);
    ruler.click();
    expect(e.root.classList.contains('wy-hide-ruler')).toBe(true);
    expect(ruler.classList.contains('is-active')).toBe(false);
    const zoom = control(e, 'Zoom') as HTMLSelectElement;
    zoom.value = '150';
    zoom.dispatchEvent(new Event('change', { bubbles: true }));
    expect(e.root.style.getPropertyValue('--wy-zoom')).toBe('1.5');
    click(e, '100%');
    expect(e.root.style.getPropertyValue('--wy-zoom')).toBe('1');
    click(e, 'Reading View');
    expect(e.isReadOnly).toBe(true);
    expect(e.root.classList.contains('wy-reading')).toBe(true);
    e.execute('toggleReadingView');
    expect(e.isReadOnly).toBe(false);
  });

  it('Separate Pages toggles the paged layout off and on', async () => {
    const e = make();
    await sleep(60);
    tab(e, 'view').click();
    const pages = control(e, 'Separate Pages');
    expect(pages.classList.contains('is-active')).toBe(true);
    pages.click();
    expect(e.root.classList.contains('wy-paged')).toBe(false);
    await sleep(80);
    expect(e.root.querySelector('.wy-page-header')).toBeNull(); // page widgets removed
    pages.click();
    expect(e.root.classList.contains('wy-paged')).toBe(true);
  });

  it('shows File tab .docx actions only when the app provides them', () => {
    expect(control(make(), 'Open .docx')).toBeUndefined();
    let opened = 0;
    const e = make('<p>x</p>', [], { ribbon: { onOpenDocx: () => opened++, onExportDocx: () => undefined } });
    tab(e, 'file').click();
    click(e, 'Open .docx');
    expect(opened).toBe(1);
    expect(control(e, 'Export .docx')).toBeDefined();
  });

  it('translates tab, group and control labels', () => {
    const e = make('<p>x</p>', [], { locale: 'id' });
    expect([...e.root.querySelectorAll('.wy-tab')].map((t) => t.textContent)).toContain('Beranda');
    expect([...e.root.querySelectorAll('.wy-group-label')].map((t) => t.textContent)).toContain('Papan klip');
    expect(control(e, 'Tempel')).toBeDefined();
    expect(e.root.dir).toBe('ltr');
  });

  it('renders labels as text, never as markup', () => {
    const e = make('<p>x</p>', [], { ribbon: true });
    for (const s of e.root.querySelectorAll('.wy-rbtn span')) expect(s.querySelector('*')).toBeNull();
  });
});

describe('Office commands', () => {
  it('subscript and superscript are mutually exclusive and round-trip', () => {
    const e = make('<p>H2O</p>');
    select(e, 2, 3);
    e.execute('subscript');
    expect(e.getHTML()).toBe('<p>H<sub>2</sub>O</p>');
    e.execute('superscript');
    expect(e.getHTML()).toBe('<p>H<sup>2</sup>O</p>'); // replaced, not stacked
    e.setHTML(e.getHTML());
    expect(e.getHTML()).toBe('<p>H<sup>2</sup>O</p>');
  });

  it('clearFormatting removes marks and paragraph formatting but keeps links', () => {
    const e = make('<h1 style="text-align: center">Big <strong>bold</strong> <a href="https://x.test">link</a></h1><p style="margin-left: 40px"><em>it</em></p>');
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, e.view.state.doc.content.size - 1)));
    expect(e.execute('clearFormatting')).toBe(true);
    expect(e.getHTML()).toBe('<p>Big bold <a href="https://x.test" rel="noopener noreferrer">link</a></p><p>it</p>');
    expect(e.execute('clearFormatting')).toBe(false); // nothing left to clear
  });

  it('fontSizeStep walks the size scale and stops at the ends', () => {
    const e = make('<p>abc</p>');
    select(e, 1, 4);
    e.execute('fontSizeStep', 1); // from the default 16 to 18
    expect(e.getHTML()).toContain('font-size: 18px');
    e.execute('fontSizeStep', 1);
    expect(e.getHTML()).toContain('font-size: 24px');
    e.execute('fontSizeStep', -1);
    expect(e.getHTML()).toContain('font-size: 18px');
    for (let i = 0; i < 12; i++) e.execute('fontSizeStep', 1);
    expect(e.getHTML()).toContain('font-size: 48px');
    expect(e.execute('fontSizeStep', 1)).toBe(false);
  });

  it('indentMore / indentLess indent paragraphs outside lists and nest list items inside them', () => {
    const e = make('<p>abc</p><ul><li><p>one</p></li><li><p>two</p></li></ul>');
    select(e, 2);
    e.execute('indentMore');
    e.execute('indentMore');
    expect(e.view.state.doc.firstChild!.attrs.indentLeft).toBe(96);
    e.execute('indentLess');
    expect(e.view.state.doc.firstChild!.attrs.indentLeft).toBe(48);
    e.execute('indentLess');
    e.execute('indentLess');
    expect(e.view.state.doc.firstChild!.attrs.indentLeft).toBeNull(); // never negative
    let two = 0;
    e.view.state.doc.descendants((n, p) => void (n.textContent === 'two' && n.type.name === 'paragraph' && (two = p + 2)));
    select(e, two);
    e.execute('indentMore');
    expect(e.getHTML()).toContain('<ul><li><p>one</p><ul><li><p>two</p></li></ul></li></ul>'); // nested, paragraph untouched
  });

  it('selectAll selects the whole document, also in read-only mode', () => {
    const e = make();
    e.setReadOnly(true);
    expect(e.execute('selectAll')).toBe(true);
    expect(e.view.state.selection.from).toBe(0);
    expect(e.view.state.selection.to).toBe(e.view.state.doc.content.size);
  });

  it('paste reads the clipboard, and explains when the browser blocks it', async () => {
    const e = make('<p>abc</p>');
    select(e, 4);
    const real = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => [{ types: ['text/plain'], getType: async () => ({ text: async () => 'XYZ' }) }] } });
    expect(e.execute('paste')).toBe(true);
    await sleep(20);
    expect(e.getHTML()).toBe('<p>abcXYZ</p>');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { read: async () => { throw new Error('denied'); } } });
    e.execute('paste');
    await sleep(20);
    expect(e.root.querySelector('.wy-dialog')!.textContent).toContain('blocked clipboard access');
    if (real) Object.defineProperty(navigator, 'clipboard', real);
    else delete (navigator as any).clipboard;
  });

  it('theme and zoom commands validate their input', () => {
    const e = make();
    expect(e.execute('setTheme', 'neon' as any)).toBe(false);
    expect(e.execute('setTheme', 'dark')).toBe(true);
    e.execute('toggleTheme');
    expect(e.theme).toBe('light');
    expect(e.execute('setZoom', NaN)).toBe(false);
    e.execute('setZoom', 9999);
    expect(e.root.style.getPropertyValue('--wy-zoom')).toBe('5'); // clamped to 500%
    e.execute('setZoom', 1);
    expect(e.root.style.getPropertyValue('--wy-zoom')).toBe('0.25'); // and to 25%
  });

  it('word count and shortcut dialogs open and close', () => {
    const e = make('<p>one two three</p>');
    e.execute('showWordCount');
    const dlg = e.root.querySelector('.wy-dialog')!;
    expect(dlg.textContent).toContain('Words');
    expect(dlg.textContent).toContain('3');
    dlg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(e.root.querySelector('.wy-dialog')).toBeNull();
    e.execute('showShortcuts');
    expect(e.root.querySelector('.wy-dialog')!.textContent).toContain('Ctrl/Cmd + B');
    (e.root.querySelector('.wy-dialog button') as HTMLElement).click();
    expect(e.root.querySelector('.wy-dialog')).toBeNull();
  });
});

describe('Page commands', () => {
  it('applies margin presets and validates names', () => {
    const e = make();
    expect(e.execute('pageMarginPreset', 'nope')).toBe(false);
    e.execute('pageMarginPreset', 'wide');
    expect(pageSettings(e).margins).toEqual({ top: 96, bottom: 96, left: 192, right: 192 });
    e.execute('pageMarginPreset', 'narrow');
    expect(pageSettings(e).margins.left).toBe(48);
  });

  it('only accepts plain hex page colors (nothing else reaches the stylesheet)', () => {
    const e = make();
    expect(e.execute('pageColor', 'red')).toBe(false);
    expect(e.execute('pageColor', 'url(javascript:alert(1))')).toBe(false);
    expect(e.execute('pageColor', '#fff9db')).toBe(true);
    expect(e.root.style.getPropertyValue('--wy-page-bg')).toBe('#fff9db');
    e.execute('pageColor', '');
    expect(e.root.style.getPropertyValue('--wy-page-bg')).toBe('');
  });

  it('page number presets replace any earlier numbering', () => {
    const e = make();
    expect(pageSettings(e).footer).toBe('Page {page} of {pages}');
    e.execute('pageNumberPreset', 'bottom');
    expect(pageSettings(e).footer).toBe('Page {page}');
    e.execute('pageNumberPreset', 'top');
    expect(pageSettings(e).header).toBe('Page {page}');
    expect(pageSettings(e).footer).toBe(''); // like Word, the number lives in one place: choosing Top moves it
    e.execute('pageNumberPreset', 'none');
    expect(pageSettings(e).header).toBe('');
    expect(pageSettings(e).footer).toBe('');
    expect(e.execute('pageNumberPreset', 'sideways' as any)).toBe(false);
  });

  it('the Header & Footer dialog edits both texts, and Cancel changes nothing', () => {
    const e = make();
    e.execute('headerFooterDialog');
    const [h, f] = [...e.root.querySelectorAll<HTMLInputElement>('.wy-dialog input')];
    h.value = 'My header';
    f.value = 'Footer {page}';
    [...e.root.querySelectorAll<HTMLElement>('.wy-dialog button')].find((b) => b.textContent === 'OK')!.click();
    expect(pageSettings(e).header).toBe('My header');
    expect(pageSettings(e).footer).toBe('Footer {page}');
    e.execute('headerFooterDialog');
    e.root.querySelector<HTMLInputElement>('.wy-dialog input')!.value = 'changed';
    [...e.root.querySelectorAll<HTMLElement>('.wy-dialog button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(pageSettings(e).header).toBe('My header');
  });

  it('caps header/footer length and rejects non-strings', () => {
    const e = make();
    e.execute('setHeaderFooter', { header: 'x'.repeat(500), footer: 42 as any });
    expect(pageSettings(e).header).toHaveLength(200);
    expect(pageSettings(e).footer).toBe('Page {page} of {pages}');
  });
});

describe('Review navigation', () => {
  it('moves between comments, wraps around, and deletes the one at the cursor', () => {
    const e = make('<p>aaa bbb ccc</p>');
    select(e, 1, 4);
    e.execute('addComment', 'one');
    select(e, 9, 12);
    e.execute('addComment', 'three');
    select(e, 5);
    e.execute('nextComment');
    expect(e.view.state.selection.from).toBe(9);
    e.execute('nextComment'); // wraps to the first
    expect(e.view.state.selection.from).toBe(1);
    e.execute('prevComment'); // wraps backwards to the last
    expect(e.view.state.selection.from).toBe(9);
    e.execute('deleteCurrentComment');
    expect(e.root.querySelectorAll('.wy-comment-card')).toHaveLength(1);
    expect(e.execute('deleteCurrentComment')).toBe(false); // cursor is no longer in a comment
    e.execute('toggleComments');
    expect(e.root.querySelector<HTMLElement>('.wy-comments')!.hidden).toBe(true);
    e.execute('toggleComments');
    expect(e.root.querySelector<HTMLElement>('.wy-comments')!.hidden).toBe(false);
  });

  it('moves between tracked changes', () => {
    const e = make('<p>abcdef</p>', [], { plugins: [...defaultPlugins, TrackChanges({ author: 'Ana', enabled: true })] });
    e.view.dispatch(e.view.state.tr.insertText('X', 2));
    e.view.dispatch(e.view.state.tr.insertText('Y', 6));
    expect(getChanges(e.view.state.doc)).toHaveLength(2);
    select(e, 1);
    e.execute('nextChange');
    expect(e.view.state.selection.from).toBe(2);
    e.execute('nextChange');
    expect(e.view.state.selection.from).toBe(6);
    e.execute('nextChange'); // wraps
    expect(e.view.state.selection.from).toBe(2);
    e.execute('prevChange');
    expect(e.view.state.selection.from).toBe(6);
  });

  it('removes and refreshes a table of contents', () => {
    const e = make('<h1>One</h1><div data-toc></div><p>x</p>');
    expect(e.execute('updateToc')).toBe(true);
    expect(e.execute('removeToc')).toBe(true);
    expect(e.getHTML()).not.toContain('data-toc');
    expect(e.execute('removeToc')).toBe(false);
  });

  it('the AI menu lists the configured actions', () => {
    const e = make('<p>x</p>', [AIAssistant({ provider: async () => 'ok', actions: [{ id: 'poem', label: 'Write a poem', instruction: 'poem' }] })]);
    tab(e, 'review').click();
    click(e, 'AI Assistant');
    expect([...e.root.querySelectorAll('.wy-menu-item')].map((b) => b.textContent)).toEqual(['Write a poem']);
  });

  it('inserting a table puts the cursor in the first cell', () => {
    const e = make('<p>abc</p>');
    select(e, 2);
    e.execute('insertTable', 2, 2);
    expect(e.view.state.selection.$from.node(-1)?.type.name).toBe('table_cell');
  });

  it('image commands still work with the ribbon active', () => {
    const e = make('<p><img src="https://x.test/a.png"></p>');
    let pos = -1;
    e.view.state.doc.descendants((n, p) => void (n.type.name === 'image' && (pos = p)));
    e.view.dispatch(e.view.state.tr.setSelection(NodeSelection.create(e.view.state.doc, pos)));
    expect(e.execute('imageWidth', 200)).toBe(true);
  });
});
