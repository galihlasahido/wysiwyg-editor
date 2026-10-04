import { openDialog } from './dialog';
import { cleanFileName, fileKind, isRasterImage, uniqueName, type FileKind, type FileStore, type StoredFile } from './files';
import { formatBytes } from './image-ops';
import { openImageEditor } from './image-editor';

export interface FileManagerOptions {
  store: FileStore;
  /** Largest file accepted, in bytes. Default 10 MB. */
  maxFileSize?: number;
  /** `accept` list like the HTML attribute: "image/*,.pdf". Default: anything not blocked. */
  accept?: string;
  /** File extensions refused outright (programs and scripts). Pass [] to allow everything. */
  blockedExtensions?: string[];
  /** Offer "Edit image". Default true. */
  imageEditor?: boolean;
  /** Called with the chosen files when the user presses Insert (or double-clicks one). */
  onInsert?: (files: StoredFile[]) => void | Promise<void>;
  /** Label of the main button. Default "Insert". */
  insertLabel?: string;
  title?: string;
}

export const DEFAULT_BLOCKED = ['exe', 'bat', 'cmd', 'com', 'scr', 'msi', 'dll', 'js', 'mjs', 'vbs', 'ps1', 'sh', 'jar', 'app', 'apk', 'html', 'htm', 'svg'];
const KIND_ICON: Record<FileKind, string> = { image: '🖼', pdf: '📕', text: '📄', audio: '🎵', video: '🎞', archive: '🗜', document: '📝', sheet: '📊', other: '📎' };

/** Does a file match an `accept` string (`image/*`, `.pdf`, `application/zip`)? Empty accepts everything. */
export function matchesAccept(accept: string | undefined, name: string, type: string): boolean {
  const list = (accept ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  const ext = `.${name.toLowerCase().split('.').pop() ?? ''}`;
  return list.some((a) => (a.startsWith('.') ? a === ext : a.endsWith('/*') ? type.toLowerCase().startsWith(a.slice(0, -1)) : a === type.toLowerCase()));
}

/** Why a file cannot be added, or null. */
export function rejectReason(file: { name: string; size: number; type: string }, o: Pick<FileManagerOptions, 'maxFileSize' | 'accept' | 'blockedExtensions'>): string | null {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  if ((o.blockedExtensions ?? DEFAULT_BLOCKED).includes(ext)) return `“${file.name}” is a type that cannot be uploaded (.${ext}).`;
  if (!matchesAccept(o.accept, file.name, file.type)) return `“${file.name}” is not one of the accepted types.`;
  const max = o.maxFileSize ?? 10 * 1024 * 1024;
  if (file.size > max) return `“${file.name}” is ${formatBytes(file.size)}; the limit is ${formatBytes(max)}.`;
  if (file.size === 0) return `“${file.name}” is empty.`;
  return null;
}

/** Pixel size of a raster image blob, or null (not an image, or no decoder, as in tests). */
export async function readImageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (!isRasterImage(blob.type) || typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(blob);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close?.();
    return size;
  } catch {
    return null;
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Add files to the store with checks, unique names and image sizes. Returns what was added and why others were refused. */
export async function addFiles(store: FileStore, files: File[], o: Pick<FileManagerOptions, 'maxFileSize' | 'accept' | 'blockedExtensions'>): Promise<{ added: StoredFile[]; errors: string[] }> {
  const added: StoredFile[] = [];
  const errors: string[] = [];
  const names = (await store.list()).map((f) => f.name);
  for (const file of files) {
    const why = rejectReason(file, o);
    if (why) { errors.push(why); continue; }
    const name = uniqueName(cleanFileName(file.name), names);
    const size = await readImageSize(file);
    try {
      const rec = await store.put(file, { name, ...size });
      names.push(rec.name);
      added.push(rec);
    } catch (e) {
      errors.push(`“${file.name}” could not be stored${e instanceof Error ? `: ${e.message}` : '.'}`);
    }
  }
  return { added, errors };
}

/**
 * The file library: upload by button or drag and drop, search, filter by type, sort, grid or list, preview, rename,
 * download, delete and (for pictures) edit. Resolves when closed. Picking files calls `onInsert`.
 */
export function openFileManager(root: HTMLElement, options: FileManagerOptions): () => void {
  const store = options.store;
  const urls = new Map<string, string>(); // thumbnail object URLs, by file id + version
  let files: StoredFile[] = [];
  const selected = new Set<string>();
  let lastClicked: string | null = null;
  let query = '';
  let filter: 'all' | FileKind = 'all';
  let sort: 'new' | 'name' | 'size' = 'new';
  let view: 'grid' | 'list' = 'grid';
  let closed = false;
  let busy = false;

  const backdrop = el('div', 'wy-ask-backdrop wy-fm-backdrop');
  const dlg = el('div', 'wy-fm');
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  dlg.setAttribute('aria-label', options.title ?? 'Files');

  const head = el('div', 'wy-fm-head');
  const title = el('strong', 'wy-fm-title', options.title ?? 'Files');
  const closeBtn = el('button', 'wy-btn', '✕');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', () => close());
  head.append(title, el('span', 'wy-ie-sp'), closeBtn);

  const bar = el('div', 'wy-fm-bar');
  const input = el('input');
  input.type = 'file';
  input.multiple = true;
  if (options.accept) input.accept = options.accept;
  input.hidden = true;
  input.addEventListener('change', () => { void upload([...(input.files ?? [])]); input.value = ''; });
  const uploadBtn = el('button', 'wy-btn wy-btn-primary', '⬆ Upload');
  uploadBtn.type = 'button';
  uploadBtn.addEventListener('click', () => input.click());
  const search = el('input', 'wy-fm-search');
  search.type = 'search';
  search.placeholder = 'Search files…';
  search.setAttribute('aria-label', 'Search files');
  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });
  const filterSel = el('select');
  filterSel.setAttribute('aria-label', 'Type');
  for (const [v, l] of [['all', 'All files'], ['image', 'Images'], ['document', 'Documents'], ['pdf', 'PDF'], ['sheet', 'Spreadsheets'], ['text', 'Text'], ['audio', 'Audio'], ['video', 'Video'], ['archive', 'Archives'], ['other', 'Other']] as const) filterSel.add(new Option(l, v));
  filterSel.addEventListener('change', () => { filter = filterSel.value as typeof filter; render(); });
  const sortSel = el('select');
  sortSel.setAttribute('aria-label', 'Sort');
  for (const [v, l] of [['new', 'Newest'], ['name', 'Name'], ['size', 'Size']] as const) sortSel.add(new Option(l, v));
  sortSel.addEventListener('change', () => { sort = sortSel.value as typeof sort; render(); });
  const viewBtn = el('button', 'wy-btn', '☰ List');
  viewBtn.type = 'button';
  viewBtn.addEventListener('click', () => { view = view === 'grid' ? 'list' : 'grid'; viewBtn.textContent = view === 'grid' ? '☰ List' : '▦ Grid'; render(); });
  bar.append(uploadBtn, input, search, filterSel, sortSel, viewBtn);

  const main = el('div', 'wy-fm-main');
  const list = el('div', 'wy-fm-list');
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-multiselectable', 'true');
  list.setAttribute('aria-label', 'Files');
  const side = el('aside', 'wy-fm-side');
  main.append(list, side);

  const foot = el('div', 'wy-fm-foot');
  const status = el('span', 'wy-fm-status');
  status.setAttribute('role', 'status');
  const usage = el('span', 'wy-fm-usage');
  const insertBtn = el('button', 'wy-btn wy-btn-primary', options.insertLabel ?? 'Insert');
  insertBtn.type = 'button';
  insertBtn.addEventListener('click', () => void insert());
  foot.append(status, el('span', 'wy-ie-sp'), usage, insertBtn);
  const drop = el('div', 'wy-fm-drop', 'Drop files to upload');
  dlg.append(head, bar, main, foot, drop);
  backdrop.append(dlg);

  const say = (msg: string, error = false) => { status.textContent = msg; status.classList.toggle('is-error', error); };
  const urlOf = (f: StoredFile, blob: Blob) => {
    const key = `${f.id}:${f.updatedAt}`;
    let u = urls.get(key);
    if (!u) { u = URL.createObjectURL(blob); urls.set(key, u); }
    return u;
  };

  async function refresh() {
    files = await store.list();
    for (const id of [...selected]) if (!files.some((f) => f.id === id)) selected.delete(id);
    render();
    void store.usage?.().then((u) => { usage.textContent = u.quota ? `${formatBytes(u.used)} of ${formatBytes(u.quota)} used` : `${formatBytes(u.used)} used`; }, () => {});
  }

  function visible(): StoredFile[] {
    const out = files.filter((f) => (filter === 'all' || fileKind(f.type, f.name) === filter) && (!query || f.name.toLowerCase().includes(query)));
    out.sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) : sort === 'size' ? (a, b) => b.size - a.size : (a, b) => b.createdAt - a.createdAt);
    return out;
  }

  function render() {
    if (closed) return;
    list.className = `wy-fm-list is-${view}`;
    const items = visible();
    list.replaceChildren();
    if (!items.length) {
      const empty = el('div', 'wy-fm-empty');
      empty.append(el('div', 'wy-fm-empty-ico', '📁'), el('div', '', files.length ? 'No files match.' : 'No files yet.'), el('div', 'wy-fm-hint', files.length ? 'Try another search or filter.' : 'Upload files, or drag them here.'));
      list.append(empty);
    }
    for (const f of items) list.append(card(f));
    insertBtn.disabled = !selected.size || busy;
    insertBtn.textContent = selected.size > 1 ? `${options.insertLabel ?? 'Insert'} ${selected.size} files` : options.insertLabel ?? 'Insert';
    renderSide();
  }

  function card(f: StoredFile): HTMLElement {
    const kind = fileKind(f.type, f.name);
    const b = el('button', `wy-fm-item${selected.has(f.id) ? ' is-selected' : ''}`);
    b.type = 'button';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(selected.has(f.id)));
    b.dataset.id = f.id;
    const thumb = el('span', 'wy-fm-thumb');
    if (kind === 'image' && isRasterImage(f.type)) {
      const img = el('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      thumb.append(img);
      void store.get(f.id).then((r) => { if (r && !closed) img.src = urlOf(r.meta, r.blob); });
    } else thumb.append(el('span', 'wy-fm-kind', KIND_ICON[kind]));
    const name = el('span', 'wy-fm-name', f.name);
    name.title = f.name;
    const meta = el('span', 'wy-fm-meta', `${formatBytes(f.size)}${f.width && f.height ? ` · ${f.width}×${f.height}` : ''}`);
    b.append(thumb, name, meta);
    b.addEventListener('click', (e) => choose(f.id, e));
    b.addEventListener('dblclick', () => { selected.clear(); selected.add(f.id); void insert(); });
    return b;
  }

  function choose(id: string, e: MouseEvent | KeyboardEvent) {
    if ((e as MouseEvent).shiftKey && lastClicked) {
      const ids = visible().map((f) => f.id);
      const a = ids.indexOf(lastClicked);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) for (const x of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) selected.add(x);
    } else if ((e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey) {
      if (selected.has(id)) selected.delete(id); else selected.add(id);
    } else { selected.clear(); selected.add(id); }
    lastClicked = id;
    render();
  }

  function renderSide() {
    side.replaceChildren();
    const picked = files.filter((f) => selected.has(f.id));
    if (picked.length !== 1) {
      side.append(el('div', 'wy-fm-hint', picked.length ? `${picked.length} files selected` : 'Select a file to see its details.'));
      if (picked.length > 1) {
        const del = el('button', 'wy-btn', `Delete ${picked.length} files`);
        del.type = 'button';
        del.addEventListener('click', () => confirmDelete(picked));
        side.append(del);
      }
      return;
    }
    const f = picked[0];
    const kind = fileKind(f.type, f.name);
    const pv = el('div', 'wy-fm-preview');
    if (kind === 'image' && isRasterImage(f.type)) {
      const img = el('img');
      img.alt = f.name;
      pv.append(img);
      void store.get(f.id).then((r) => { if (r && !closed) img.src = urlOf(r.meta, r.blob); });
    } else pv.append(el('span', 'wy-fm-kind', KIND_ICON[kind]));
    const nameRow = el('div', 'wy-fm-field');
    const nameInput = el('input');
    nameInput.type = 'text';
    nameInput.value = f.name;
    nameInput.maxLength = 120;
    nameInput.setAttribute('aria-label', 'File name');
    const commit = async () => {
      const v = cleanFileName(nameInput.value, f.name);
      if (v === f.name) { nameInput.value = f.name; return; }
      if (files.some((x) => x.id !== f.id && x.name.toLowerCase() === v.toLowerCase())) { say('A file with that name already exists.', true); nameInput.value = f.name; return; }
      await store.update(f.id, { name: v });
      say(`Renamed to “${v}”.`);
      await refresh();
    };
    nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void commit(); } if (e.key === 'Escape') { e.stopPropagation(); nameInput.value = f.name; nameInput.blur(); } });
    nameInput.addEventListener('blur', () => void commit());
    nameRow.append(el('label', '', 'Name'), nameInput);
    const dl = el('dl', 'wy-fm-dl');
    const fact = (k: string, v: string) => dl.append(el('dt', '', k), el('dd', '', v));
    fact('Type', f.type || 'unknown');
    fact('Size', formatBytes(f.size));
    if (f.width && f.height) fact('Dimensions', `${f.width} × ${f.height} px`);
    fact('Added', new Date(f.createdAt).toLocaleString());
    if (f.updatedAt !== f.createdAt) fact('Changed', new Date(f.updatedAt).toLocaleString());
    const actions = el('div', 'wy-fm-actions');
    const act = (label: string, fn: () => void, cls = 'wy-btn') => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', fn); actions.append(b); return b; };
    act(options.insertLabel ?? 'Insert', () => void insert(), 'wy-btn wy-btn-primary');
    if (options.imageEditor !== false && isRasterImage(f.type)) act('✎ Edit image', () => void editImage(f));
    act('Download', () => void download(f));
    act('Delete', () => confirmDelete([f]));
    side.append(pv, nameRow, dl, actions);
  }

  async function download(f: StoredFile) {
    const r = await store.get(f.id);
    if (!r) return;
    const a = el('a');
    a.href = URL.createObjectURL(r.blob);
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function confirmDelete(items: StoredFile[]) {
    openDialog(dlg, {
      title: items.length === 1 ? 'Delete this file?' : `Delete ${items.length} files?`,
      body: items.length === 1 ? `“${items[0].name}” will be removed from the library. Documents that already contain it keep their copy.` : 'They will be removed from the library. Documents that already contain them keep their copy.',
      actions: [{ label: 'Cancel' }, { label: 'Delete', primary: true, onClick: () => void (async () => { for (const f of items) await store.remove(f.id); say(items.length === 1 ? 'Deleted.' : `Deleted ${items.length} files.`); await refresh(); })() }],
    });
  }

  async function editImage(f: StoredFile) {
    const r = await store.get(f.id);
    if (!r) return;
    try {
      busy = true;
      const result = await openImageEditor(backdrop, { source: r.blob, name: f.name, saveLabel: 'Save' });
      if (!result) return;
      openDialog(dlg, {
        title: 'Save the edited picture',
        body: 'Replace the original, or keep it and add the edit as a new file?',
        actions: [
          { label: 'Cancel' },
          { label: 'Save as a copy', onClick: () => void (async () => { const ext = result.type === 'image/jpeg' ? 'jpg' : result.type === 'image/webp' ? 'webp' : 'png'; const base = f.name.replace(/\.[^.]+$/, ''); const rec = await store.put(result.blob, { name: uniqueName(`${base}-edited.${ext}`, files.map((x) => x.name)), width: result.width, height: result.height }); selected.clear(); selected.add(rec.id); say('Saved as a new file.'); await refresh(); })() },
          { label: 'Replace original', primary: true, onClick: () => void (async () => { await store.replace(f.id, result.blob, { width: result.width, height: result.height }); say('Picture updated.'); await refresh(); })() },
        ],
      });
    } catch (e) {
      say(e instanceof Error ? e.message : 'The picture could not be opened.', true);
    } finally {
      busy = false;
      render();
    }
  }

  async function upload(picked: File[]) {
    if (!picked.length) return;
    busy = true;
    say(`Adding ${picked.length} file${picked.length === 1 ? '' : 's'}…`);
    render();
    const { added, errors } = await addFiles(store, picked, options);
    busy = false;
    if (added.length) { selected.clear(); for (const f of added) selected.add(f.id); }
    say([added.length ? `Added ${added.length} file${added.length === 1 ? '' : 's'}.` : '', ...errors].filter(Boolean).join(' '), errors.length > 0 && !added.length);
    await refresh();
  }

  async function insert() {
    const picked = files.filter((f) => selected.has(f.id));
    if (!picked.length || !options.onInsert) return;
    busy = true;
    render();
    try {
      await options.onInsert(picked);
      close();
    } catch (e) {
      busy = false;
      say(e instanceof Error ? e.message : 'Could not insert.', true);
      render();
    }
  }

  // ---- drag and drop anywhere on the dialog
  let depth = 0;
  dlg.addEventListener('dragenter', (e) => { if (e.dataTransfer?.types.includes('Files')) { depth++; dlg.classList.add('is-dragging'); } });
  dlg.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
  dlg.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) dlg.classList.remove('is-dragging'); });
  dlg.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    depth = 0;
    dlg.classList.remove('is-dragging');
    void upload([...e.dataTransfer.files]);
  });

  const previous = document.activeElement as HTMLElement | null;
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
    previous?.focus?.();
  }
  backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close());
  backdrop.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT';
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && selected.size) { e.preventDefault(); confirmDelete(files.filter((f) => selected.has(f.id))); }
    else if (!typing && e.key === 'Enter' && selected.size) { e.preventDefault(); void insert(); }
    else if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); for (const f of visible()) selected.add(f.id); render(); }
    else if (e.key === 'Tab') {
      const f = [...dlg.querySelectorAll<HTMLElement>('button, input, select, textarea')].filter((x) => !(x as HTMLButtonElement).disabled && !x.hidden && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });
  for (const t of ['keypress', 'keyup', 'beforeinput', 'paste', 'cut', 'copy']) backdrop.addEventListener(t, (e) => e.stopPropagation());
  root.append(backdrop);
  uploadBtn.focus();
  void refresh();
  return close;
}
