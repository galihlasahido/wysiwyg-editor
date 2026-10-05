import { afterEach, describe, expect, it } from 'vitest';
import { defineEditorElement, type WysiwygElement } from '../src';

defineEditorElement();
afterEach(() => (document.body.innerHTML = ''));
const make = (attrs = '', inner = '') => {
  document.body.innerHTML = `<wysiwyg-editor ${attrs}>${inner}</wysiwyg-editor>`;
  return document.querySelector('wysiwyg-editor') as unknown as WysiwygElement;
};

describe('<wysiwyg-editor>', () => {
  it('creates an editor from attributes and reports ready', async () => {
    const seen: string[] = [];
    document.body.innerHTML = '';
    const el = document.createElement('wysiwyg-editor') as unknown as WysiwygElement;
    el.addEventListener('editor-ready', () => seen.push('ready'));
    el.setAttribute('value', '<p>Hello <strong>world</strong></p>');
    el.setAttribute('placeholder', 'Write…');
    document.body.append(el);
    expect(seen).toEqual(['ready']);
    expect(el.editor).not.toBeNull();
    expect(el.value).toBe('<p>Hello <strong>world</strong></p>');
    expect(el.querySelector('.ProseMirror')!.getAttribute('data-placeholder')).toBe('Write…');
  });
  it('value is readable and writable, and changes fire editor-change', () => {
    const el = make('value="<p>a</p>"');
    const events: string[] = [];
    el.addEventListener('editor-change', (e) => events.push((e as CustomEvent).detail.html));
    el.editor!.view.dispatch(el.editor!.view.state.tr.insertText('X', 1));
    expect(events).toEqual(['<p>Xa</p>']);
    el.value = '<p>replaced</p>';
    expect(el.editor!.getHTML()).toBe('<p>replaced</p>');
  });
  it('readonly, theme and ribbon attributes work, and attribute changes apply live', () => {
    const el = make('readonly theme="dark" ribbon');
    expect(el.editor!.isReadOnly).toBe(true);
    expect(el.editor!.theme).toBe('dark');
    expect(el.querySelector('.wy-ribbon')).not.toBeNull();
    el.removeAttribute('readonly');
    expect(el.editor!.isReadOnly).toBe(false);
    el.setAttribute('theme', 'light');
    expect(el.editor!.theme).toBe('light');
    el.readOnly = true;
    expect(el.hasAttribute('readonly')).toBe(true);
  });
  it('takes plugins and config set as properties before it is connected', () => {
    document.body.innerHTML = '';
    const el = document.createElement('wysiwyg-editor') as unknown as WysiwygElement;
    el.config = { toolbar: ['bold'] };
    document.body.append(el);
    expect([...el.querySelectorAll('.wy-toolbar button')].map((b) => b.getAttribute('aria-label'))).toEqual(['Bold']);
  });
  it('keeps its content when it is moved in the page, and cleans up when removed', () => {
    const el = make('value="<p>keep me</p>"');
    const target = document.createElement('div');
    document.body.append(target);
    target.append(el); // disconnect + connect
    expect(el.editor).not.toBeNull();
    expect(el.value).toBe('<p>keep me</p>');
    el.remove();
    expect(el.editor).toBeNull();
    expect(el.value).toBe('<p>keep me</p>');
  });
  it('defining twice is harmless and a custom tag name works', () => {
    defineEditorElement();
    defineEditorElement('my-editor');
    document.body.innerHTML = '<my-editor value="<p>x</p>"></my-editor>';
    expect(document.querySelector('my-editor .ProseMirror')).not.toBeNull();
  });
});
