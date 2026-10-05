import { afterEach, describe, expect, it } from 'vitest';
import { FormFields, RestrictedEditing, cleanValue, createEditor, defaultPlugins, parseOptions } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content = '<p></p>', extra: any[] = [], opts = {}) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content, plugins: [...defaultPlugins, FormFields(opts), ...extra] });
};
const fire = (el: Element, type = 'change') => el.dispatchEvent(new Event(type, { bubbles: true }));

describe('field values are validated', () => {
  it('per kind', () => {
    expect(cleanValue('checkbox', 'true', [])).toBe('true');
    expect(cleanValue('checkbox', 'yes', [])).toBe('false');
    expect(cleanValue('select', 'Card', ['Card', 'Cash'])).toBe('Card');
    expect(cleanValue('select', 'Bitcoin', ['Card', 'Cash'])).toBe('');
    expect(cleanValue('date', '2026-10-05', [])).toBe('2026-10-05');
    expect(cleanValue('date', '2026-13-45', [])).toBe('');
    expect(cleanValue('date', '<script>', [])).toBe('');
    expect(cleanValue('text', 'x'.repeat(900), [])).toHaveLength(500);
  });
  it('options come from JSON or a | list, capped and trimmed', () => {
    expect(parseOptions('["a"," b ",3,""]')).toEqual(['a', 'b']);
    expect(parseOptions('x|y')).toEqual(['x', 'y']);
    expect(parseOptions(JSON.stringify(Array.from({ length: 80 }, (_, i) => `o${i}`)))).toHaveLength(50);
  });
});

describe('FormFields', () => {
  it('inserts each kind and fills them through the real controls', () => {
    const ed = make();
    ed.execute('insertField', 'checkbox', { label: 'I agree', required: true });
    ed.execute('insertField', 'select', { label: 'Payment', options: ['Card', 'Cash'] });
    ed.execute('insertField', 'date', { label: 'Start' });
    ed.execute('insertField', 'text', { label: 'Full name' });
    const dom = ed.view.dom;
    const box = dom.querySelector('input[type=checkbox]') as HTMLInputElement;
    box.checked = true; fire(box);
    const sel = dom.querySelector('select') as HTMLSelectElement;
    sel.value = 'Cash'; fire(sel);
    const date = dom.querySelector('input[type=date]') as HTMLInputElement;
    date.value = '2026-10-05'; fire(date);
    const text = dom.querySelector('input[type=text]') as HTMLInputElement;
    text.value = 'Ana Lestari'; fire(text, 'input');
    expect((ed.extensions.form as any).getData()).toEqual({ i_agree: true, payment: 'Cash', start: '2026-10-05', full_name: 'Ana Lestari' });
    ed.destroy();
  });

  it('saves the value in the HTML (with visible text), and rebuilds from it', () => {
    const ed = make('<p>Name: <span data-field="text" data-name="n" data-label="" data-value="Budi"></span> <span data-field="checkbox" data-name="ok" data-value="true"></span></p>');
    const html = ed.getHTML();
    expect(html).toContain('data-value="Budi"');
    expect(html).toContain('>Budi<');
    expect(html).toContain('☑');
    expect((ed.view.dom.querySelector('input[type=text]') as HTMLInputElement).value).toBe('Budi');
    ed.destroy();
  });

  it('drops hostile markup: bad kind, name, value and options', () => {
    const ed = make('<p><span data-field="script" data-value="x"></span><span data-field="select" data-name="a b<c" data-label="<img src=x onerror=alert(1)>" data-options=\'["ok","<b>"]\' data-value="nope"></span><span data-field="date" data-value="javascript:1"></span></p>');
    expect(ed.view.dom.querySelectorAll('.wy-field')).toHaveLength(2);
    const f = (ed.extensions.form as any).list();
    expect(f[0]).toMatchObject({ kind: 'select', name: '', value: '' });
    expect(f[1]).toMatchObject({ kind: 'date', value: '' });
    expect(ed.view.dom.querySelector('img:not(.ProseMirror-separator)')).toBeNull(); // the label is text, never markup
    ed.destroy();
  });

  it('works inside a locked section and in a read-only editor, while text there stays locked', () => {
    const ed = make('<section data-locked><p>Terms <span data-field="checkbox" data-name="agree" data-value="false"></span> and more</p></section>', [RestrictedEditing({ authorControls: false })]);
    const box = ed.view.dom.querySelector('input[type=checkbox]') as HTMLInputElement;
    box.checked = true; fire(box);
    expect((ed.extensions.form as any).getData()).toEqual({ agree: true }); // allowed in the lock
    const before = ed.getHTML();
    ed.view.dispatch(ed.view.state.tr.insertText('X', 3));
    expect(ed.getHTML()).toBe(before); // text in the lock is still refused
    ed.setReadOnly(true);
    const box2 = ed.view.dom.querySelector('input[type=checkbox]') as HTMLInputElement;
    expect(box2.disabled).toBe(false);
    box2.checked = false; fire(box2);
    expect((ed.extensions.form as any).getData()).toEqual({ agree: false });
    ed.destroy();
  });

  it('fillInReadOnly: false disables the controls when read-only', () => {
    const ed = make('<p><span data-field="checkbox" data-name="a" data-value="false"></span></p>', [], { fillInReadOnly: false });
    ed.setReadOnly(true);
    ed.setHTML(ed.getHTML()); // rebuild the control in read-only mode
    expect((ed.view.dom.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    ed.destroy();
  });

  it('validate lists missing required fields and outlines them; setFieldValue fills from code', () => {
    const ed = make();
    ed.execute('insertField', 'text', { label: 'Name', required: true, name: 'name' });
    ed.execute('insertField', 'checkbox', { label: 'Agree', required: true, name: 'agree' });
    expect((ed.extensions.form as any).validate()).toEqual(['name', 'agree']);
    expect(ed.view.dom.querySelectorAll('.wy-field.is-invalid')).toHaveLength(2);
    ed.execute('setFieldValue', 'name', 'Ana');
    ed.execute('setFieldValue', 'agree', true);
    expect((ed.extensions.form as any).validate()).toEqual([]);
    expect(ed.execute('setFieldValue', 'nope', 'x')).toBe(false);
    ed.destroy();
  });

  it('emits field-change and exports answers to Markdown', () => {
    const ed = make();
    const seen: unknown[] = [];
    ed.on('field-change', (e) => seen.push(e));
    ed.execute('insertField', 'checkbox', { label: 'Agree', name: 'agree' });
    const box = ed.view.dom.querySelector('input') as HTMLInputElement;
    box.checked = true; fire(box);
    expect(seen).toEqual([{ name: 'agree', kind: 'checkbox', value: true }]);
    expect(ed.getMarkdown()).toContain('Agree [x]');
    ed.destroy();
  });

  it('gives each field a unique name and refuses a drop-down without options', () => {
    const ed = make();
    ed.execute('insertField', 'text', { label: 'Name' });
    ed.execute('insertField', 'text', { label: 'Name' });
    expect((ed.extensions.form as any).list().map((f: any) => f.name)).toEqual(['name', 'name_2']);
    expect(ed.execute('insertField', 'select', { label: 'Pick', options: [] })).toBe(false);
    expect(ed.execute('insertField', 'bogus' as any)).toBe(false);
    ed.destroy();
  });
});
