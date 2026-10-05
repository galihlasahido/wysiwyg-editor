import { afterEach, describe, expect, it } from 'vitest';
import { FileManager, MemoryFileStore, addFiles, createEditor, defaultPlugins, matchesAccept, openFileManager, rejectReason } from '../src';

const host = () => document.body.appendChild(document.createElement('div'));
const file = (name: string, content = 'hello', type = 'text/plain') => new File([content], name, { type });
const flush = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const mount = () => { const r = host(); roots.push(r); return r; };

describe('upload rules', () => {
  it('matches accept lists like the HTML attribute', () => {
    expect(matchesAccept('image/*,.pdf', 'a.png', 'image/png')).toBe(true);
    expect(matchesAccept('image/*,.pdf', 'a.PDF', 'application/pdf')).toBe(true);
    expect(matchesAccept('image/*,.pdf', 'a.zip', 'application/zip')).toBe(false);
    expect(matchesAccept('', 'a.zip', 'application/zip')).toBe(true);
  });
  it('refuses programs, empty files, wrong types and oversized files with a reason', () => {
    expect(rejectReason({ name: 'setup.exe', size: 10, type: '' }, {})).toMatch(/cannot be uploaded/);
    expect(rejectReason({ name: 'page.html', size: 10, type: 'text/html' }, {})).toMatch(/cannot be uploaded/); // scripts could ride along
    expect(rejectReason({ name: 'a.txt', size: 0, type: 'text/plain' }, {})).toMatch(/empty/);
    expect(rejectReason({ name: 'a.txt', size: 2000, type: 'text/plain' }, { maxFileSize: 1000 })).toMatch(/limit/);
    expect(rejectReason({ name: 'a.txt', size: 5, type: 'text/plain' }, { accept: 'image/*' })).toMatch(/accepted/);
    expect(rejectReason({ name: 'a.txt', size: 5, type: 'text/plain' }, {})).toBeNull();
    expect(rejectReason({ name: 'a.exe', size: 5, type: '' }, { blockedExtensions: [] })).toBeNull();
  });
  it('addFiles stores good files with unique names and reports the rest', async () => {
    const store = new MemoryFileStore();
    const r1 = await addFiles(store, [file('a.txt'), file('a.txt'), file('run.exe', 'x', 'application/x-msdownload')], {});
    expect(r1.added.map((f) => f.name)).toEqual(['a.txt', 'a (2).txt']);
    expect(r1.errors).toHaveLength(1);
    expect((await store.list()).length).toBe(2);
  });
});

describe('file manager dialog', () => {
  it('lists files, filters, searches, renames, deletes (with confirmation) and inserts the selection', async () => {
    const store = new MemoryFileStore();
    await store.put(new Blob(['one'], { type: 'text/plain' }), { name: 'notes.txt' });
    await store.put(new Blob(['pdf!'], { type: 'application/pdf' }), { name: 'report.pdf' });
    const root = mount();
    const inserted: string[][] = [];
    const close = openFileManager(root, { store, onInsert: (fs) => void inserted.push(fs.map((f) => f.name)) });
    await flush();
    const names = () => [...root.querySelectorAll('.wy-fm-item .wy-fm-name')].map((n) => n.textContent);
    expect(names().sort()).toEqual(['notes.txt', 'report.pdf']);
    expect((root.querySelector('.wy-fm-foot .wy-btn-primary') as HTMLButtonElement).disabled).toBe(true); // nothing selected

    // search + type filter
    const search = root.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'rep'; search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(names()).toEqual(['report.pdf']);
    search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true }));
    const filter = root.querySelector('select[aria-label=Type]') as HTMLSelectElement;
    filter.value = 'pdf'; filter.dispatchEvent(new Event('change'));
    expect(names()).toEqual(['report.pdf']);
    filter.value = 'all'; filter.dispatchEvent(new Event('change'));

    // select, rename
    (root.querySelector('.wy-fm-item[data-id]') as HTMLElement).click();
    await flush();
    const rename = root.querySelector('.wy-fm-field input') as HTMLInputElement;
    const old = rename.value;
    rename.value = '../sneaky/new-name.txt';
    rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(names()).toContain('new-name.txt');
    expect(names()).not.toContain(old);

    // delete needs a confirmation
    (root.querySelector('.wy-fm-item[data-id]') as HTMLElement).click();
    await flush();
    const del = [...root.querySelectorAll('.wy-fm-actions button')].find((b) => b.textContent === 'Delete') as HTMLButtonElement;
    del.click();
    expect(root.querySelector('.wy-dialog')).not.toBeNull();
    expect((await store.list()).length).toBe(2); // not yet
    ([...root.querySelectorAll('.wy-dialog button')].find((b) => b.textContent === 'Delete') as HTMLButtonElement).click();
    await flush();
    expect((await store.list()).length).toBe(1);

    // insert the remaining one
    (root.querySelector('.wy-fm-item[data-id]') as HTMLElement).click();
    (root.querySelector('.wy-fm-foot .wy-btn-primary') as HTMLButtonElement).click();
    await flush();
    expect(inserted).toHaveLength(1);
    expect(root.querySelector('.wy-fm-backdrop')).toBeNull(); // closed after inserting
    close();
  });

  it('shows file names as text, never as markup, and closes with Escape', async () => {
    const store = new MemoryFileStore();
    await store.put(new Blob(['x'], { type: 'text/plain' }), { name: '<img src=x onerror=alert(1)>.txt' });
    const root = mount();
    openFileManager(root, { store });
    await flush();
    expect(root.querySelector('.wy-fm img')).toBeNull();
    expect(root.querySelector('.wy-fm-name')!.textContent).toContain('img src=x');
    root.querySelector('.wy-fm-backdrop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(root.querySelector('.wy-fm-backdrop')).toBeNull();
  });
});

describe('FileManager plugin', () => {
  const make = (extra = {}) => {
    const fm = FileManager({ store: new MemoryFileStore(), ...extra });
    const ed = createEditor({ element: mount(), content: '<p>doc</p>', plugins: [...defaultPlugins, fm] });
    return { ed, fm };
  };

  it('inserts a non-image file as an attachment and round-trips it through HTML', async () => {
    const { ed, fm } = make();
    const rec = await fm.store.put(new Blob(['abc'], { type: 'application/pdf' }), { name: 'plan.pdf' });
    ed.execute('insertFile', rec.id);
    await flush();
    const html = ed.getHTML();
    expect(html).toContain('data-file-id');
    expect(html).toContain('plan.pdf');
    expect(html).not.toContain('href='); // no address without resolveUrl: it opens from this browser's library
    const again = createEditor({ element: mount(), content: html, plugins: [...defaultPlugins, FileManager({ store: new MemoryFileStore() })] });
    expect(again.view.dom.querySelector('.wy-attachment .wy-att-name')!.textContent).toBe('plan.pdf');
  });

  it('uses resolveUrl for the address, and refuses unsafe ones', async () => {
    const { ed, fm } = make({ resolveUrl: async (f: { name: string }) => (f.name === 'bad.pdf' ? 'javascript:alert(1)' : `https://cdn.test/${f.name}`) });
    const good = await fm.store.put(new Blob(['a'], { type: 'application/pdf' }), { name: 'good.pdf' });
    const bad = await fm.store.put(new Blob(['a'], { type: 'application/pdf' }), { name: 'bad.pdf' });
    ed.execute('insertFile', good.id);
    ed.execute('insertFile', bad.id);
    await flush(40);
    const html = ed.getHTML();
    expect(html).toContain('href="https://cdn.test/good.pdf"');
    expect(html).not.toContain('javascript:');
  });

  it('sanitises hostile attachment markup', () => {
    const { ed } = make();
    ed.setHTML('<p><a data-file-id="ok" data-name="../../x<b>.pdf" data-size="-5" data-type="text/html;<script>" href="javascript:alert(1)">z</a><a data-file-id="bad id!">q</a></p>');
    const html = ed.getHTML();
    expect(html).not.toMatch(/javascript:|<script|<b>/);
    expect(ed.view.dom.querySelectorAll('.wy-attachment').length).toBe(1);
  });

  it('openFiles opens the dialog inside the editor', async () => {
    const { ed } = make();
    expect(ed.execute('openFiles')).toBe(true);
    await flush();
    expect(ed.root.querySelector('.wy-fm')).not.toBeNull();
  });

  it('keeps uploaded pictures in the library', async () => {
    const { ed, fm } = make();
    const url = await ed.uploadImage(new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], 'p.png', { type: 'image/png' }));
    expect(url).toMatch(/^data:/);
    expect((await fm.store.list()).map((f) => f.name)).toEqual(['p.png']);
  });
});

describe('image editor loading', () => {
  it('explains a CORS refusal in plain words, and honours a custom fetchSource', async () => {
    const { openImageEditor } = await import('../src');
    const original = globalThis.fetch;
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await expect(openImageEditor(document.body, { source: 'https://other.example/a.png' })).rejects.toThrow(/CORS/);
    globalThis.fetch = original;
    let asked = '';
    await expect(openImageEditor(document.body, { source: 'https://other.example/b.png', fetchSource: async (u) => { asked = u; return new Blob(['x'], { type: 'text/plain' }); } })).rejects.toThrow(/cannot be edited as a picture/);
    expect(asked).toBe('https://other.example/b.png'); // the proxy was used instead of fetch
  });
  it('refuses SVG and non-image data', async () => {
    const { openImageEditor } = await import('../src');
    await expect(openImageEditor(document.body, { source: new Blob(['<svg/>'], { type: 'image/svg+xml' }) })).rejects.toThrow(/cannot be edited/);
  });
});
