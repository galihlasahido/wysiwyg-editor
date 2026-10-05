import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { applyContributions, createEditor, defaultPlugins, definePlugin, DEFAULT_RIBBON, type EditorPlugin } from '../src';
import { resolveLayout } from '../src/toolbar';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const host = () => { const e = document.body.appendChild(document.createElement('div')); roots.push(e); return e; };
const labels = (ed: { root: HTMLElement }) => [...ed.root.querySelectorAll('.wy-toolbar button')].map((b) => b.getAttribute('aria-label'));

describe('toolbar layout', () => {
  it('still accepts a plain list of names with | separators', () => {
    const ed = createEditor({ element: host(), plugins: defaultPlugins, toolbar: ['bold', '|', 'italic'] });
    expect(labels(ed)).toEqual(['Bold', 'Italic']);
    expect(ed.root.querySelectorAll('.wy-toolbar .wy-sep')).toHaveLength(1);
    ed.destroy();
  });
  it('supports groups, new rows, a spacer, and unknown names are ignored', () => {
    const ed = createEditor({ element: host(), plugins: defaultPlugins, toolbar: { items: [{ group: 'Text', items: ['bold', 'italic'] }, '-', 'link', '>', 'underline', 'does-not-exist'] } });
    const bar = ed.root.querySelector('.wy-tb-bar')!;
    expect(bar.querySelector('.wy-tb-group[role=group][aria-label=Text]')!.querySelectorAll('button')).toHaveLength(2);
    expect(bar.querySelector('.wy-tb-break')).not.toBeNull();
    expect(bar.querySelector('.wy-tb-spacer')).not.toBeNull();
    const order = [...bar.children].map((c) => c.className.split(' ')[0]);
    expect(order).toEqual(['wy-tb-group', 'wy-tb-break', 'wy-btn', 'wy-tb-spacer', 'wy-btn']);
    ed.destroy();
  });
  it('lets you define a button inline and run your own code', () => {
    let hits = 0;
    const ed = createEditor({ element: host(), plugins: defaultPlugins, toolbar: ['bold', { name: 'stamp', label: 'Stamp', icon: '★', run: () => void hits++ }] });
    const stamp = ed.root.querySelector('button[aria-label=Stamp]') as HTMLButtonElement;
    expect(stamp.innerHTML).toContain('★');
    stamp.click();
    expect(hits).toBe(1);
    ed.destroy();
  });
  it('hide removes items from the default layout; position and sticky become classes', () => {
    const ed = createEditor({ element: host(), plugins: defaultPlugins, toolbar: { hide: ['bold'], position: 'bottom', sticky: true, align: 'center' } });
    expect(labels(ed)).not.toContain('Bold');
    expect(labels(ed)).toContain('Italic');
    const tb = ed.root.querySelector('.wy-toolbar')!;
    expect(['is-bottom', 'is-sticky', 'is-align-center'].every((c) => tb.classList.contains(c))).toBe(true);
    expect(ed.root.lastElementChild).toBe(tb); // below the text
    ed.destroy();
  });
  it('setToolbar rearranges at runtime and false hides it', () => {
    const ed = createEditor({ element: host(), plugins: defaultPlugins, toolbar: ['bold'] });
    ed.setToolbar(['italic', 'underline']);
    expect(labels(ed)).toEqual(['Italic', 'Underline']);
    expect(ed.root.querySelectorAll('.wy-toolbar')).toHaveLength(1);
    ed.setToolbar({ items: ['link'], position: 'bottom' });
    expect(labels(ed)).toEqual(['Link']);
    ed.setToolbar(false);
    expect(ed.root.querySelector('.wy-toolbar')).toBeNull();
    ed.destroy();
  });
  it('overflow "more" adds a hidden menu button and moves nothing when everything fits', () => {
    const ed = createEditor({ element: host(), plugins: defaultPlugins, toolbar: { items: ['bold', 'italic'], overflow: 'more' } });
    const more = ed.root.querySelector('.wy-tb-more') as HTMLButtonElement;
    expect(more).not.toBeNull();
    expect(more.hidden).toBe(true);
    expect(ed.root.querySelector('.wy-toolbar')!.classList.contains('is-overflow-more')).toBe(true);
    ed.destroy();
  });
  it('resolveLayout ignores names it does not know and keeps objects', () => {
    const r = resolveLayout(['a', 'zzz', { name: 'mine', label: 'Mine', run: () => {} }], [{ name: 'a', label: 'A', command: 'a' }]);
    expect(r.map((x) => ('name' in x ? x.name : x.type))).toEqual(['a', 'mine']);
  });
});

describe('plugin API', () => {
  const Callout: EditorPlugin = definePlugin({
    name: 'callout',
    nodes: { callout: { group: 'block', content: 'block+', defining: true, toDOM: () => ['aside', { class: 'callout' }, 0], parseDOM: [{ tag: 'aside.callout' }] } },
    setup(editor) { editor.registerCommand('callout', () => true); },
    toolbar: [{ name: 'callout', label: 'Callout', icon: '💡', command: 'callout' }],
  });

  it('requires: a missing dependency fails fast with a clear message', () => {
    const Needy: EditorPlugin = { name: 'needy', requires: ['callout'] };
    expect(() => createEditor({ element: host(), plugins: [...defaultPlugins, Needy] })).toThrow(/"needy" requires the plugin "callout"/);
    const ed = createEditor({ element: host(), plugins: [...defaultPlugins, Callout, Needy] });
    ed.destroy();
  });
  it('keymap binds keys to command names or functions', () => {
    let called = 0;
    const P: EditorPlugin = { name: 'keys', setup: (e) => void e.registerCommand('ping', () => (called++, true)), keymap: { 'Mod-Alt-p': 'ping', 'Mod-Alt-q': () => (called += 10, true) } };
    const ed = createEditor({ element: host(), plugins: [...defaultPlugins, P] });
    const press = (key: string) => ed.view.someProp('handleKeyDown', (f) => f(ed.view, new KeyboardEvent('keydown', { key, ctrlKey: true, altKey: true, bubbles: true })));
    press('p');
    press('q');
    expect(called).toBe(11);
    ed.destroy();
  });
  it('onReady and destroy hooks run once, at the right times', () => {
    const log: string[] = [];
    const P: EditorPlugin = { name: 'life', setup: () => void log.push('setup'), onReady: (e) => void log.push(`ready:${!!e.view}`), destroy: () => void log.push('destroy') };
    const ed = createEditor({ element: host(), plugins: [...defaultPlugins, P] });
    expect(log).toEqual(['setup', 'ready:true']);
    ed.destroy();
    expect(log).toEqual(['setup', 'ready:true', 'destroy']);
  });
  it('events: ready, change, selection, command and destroy, with unsubscribe and isolation of a failing listener', () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    const P: EditorPlugin = { name: 'events', setup: (e) => { e.on('ready', () => seen.push('ready')); e.registerCommand('noop', () => true); } };
    const ed = createEditor({ element: host(), plugins: [...defaultPlugins, P], content: '<p>hello</p>' });
    expect(seen).toEqual(['ready']);
    const off = ed.on('change', () => seen.push('change'));
    ed.on('change', () => { throw new Error('boom'); });
    ed.on('change', () => seen.push('change2'));
    ed.on('selection', () => seen.push('selection'));
    ed.on('command', (c: { name: string }) => seen.push(`cmd:${c.name}`));
    ed.view.dispatch(ed.view.state.tr.insertText('x', 1));
    expect(seen).toContain('change');
    expect(seen).toContain('change2'); // not stopped by the listener that threw
    expect(errors.length).toBe(1);
    ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, 3)));
    expect(seen).toContain('selection');
    ed.execute('noop');
    expect(seen).toContain('cmd:noop');
    off();
    const n = seen.filter((s) => s === 'change').length;
    ed.view.dispatch(ed.view.state.tr.insertText('y', 1));
    expect(seen.filter((s) => s === 'change').length).toBe(n);
    ed.on('destroy', () => seen.push('destroy'));
    ed.destroy();
    expect(seen).toContain('destroy');
    console.error = orig;
  });
  it('ribbon contributions add a group to an existing tab, or create a tab', () => {
    const P: EditorPlugin = definePlugin({
      name: 'extra',
      setup: (e) => void e.registerCommand('hello', () => true),
      ribbon: [
        { tab: 'insert', after: 'tables', group: { id: 'mine', label: 'Mine', controls: [{ kind: 'command', id: 'hello', command: 'hello', label: 'Hello', icon: 'link', size: 'large' }] } },
        { tab: 'tools', tabLabel: 'Tools', group: { id: 'tools1', label: 'Tools', controls: [{ kind: 'command', id: 'hello2', command: 'hello', label: 'Hello again', icon: 'link' }] } },
      ],
    });
    const tabs = applyContributions(DEFAULT_RIBBON, [P]);
    const insert = tabs.find((t) => t.id === 'insert')!;
    expect(insert.groups.map((g) => g.id).indexOf('mine')).toBe(insert.groups.map((g) => g.id).indexOf('tables') + 1);
    expect(tabs.find((t) => t.id === 'tools')).toBeTruthy();
    expect(DEFAULT_RIBBON.find((t) => t.id === 'tools')).toBeUndefined(); // the default is not mutated
    const ed = createEditor({ element: host(), plugins: [...defaultPlugins, P], ribbon: true });
    expect([...ed.root.querySelectorAll('[role=tab]')].map((t) => t.textContent?.trim())).toContain('Tools');
    expect(ed.root.querySelector('button[aria-label="Hello"], button[title="Hello"]')).not.toBeNull();
    ed.destroy();
  });
  it('ribbon customize has the final say', () => {
    const ed = createEditor({ element: host(), plugins: defaultPlugins, ribbon: { customize: (tabs) => tabs.filter((t) => t.id === 'home' || t.id === 'insert') } });
    const names = [...ed.root.querySelectorAll('[role=tab]')].map((t) => t.textContent?.trim());
    expect(names).toEqual(expect.arrayContaining(['Home', 'Insert']));
    expect(names).not.toContain('Review');
    ed.destroy();
  });
});
