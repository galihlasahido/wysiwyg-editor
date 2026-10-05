import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindEditor } from '../src/adapter';
import { wysiwyg } from '../src/svelte';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const host = () => { const e = document.body.appendChild(document.createElement('div')); roots.push(e); return e; };
const type = (b: ReturnType<typeof bindEditor>, text: string) => b.editor.view.dispatch(b.editor.view.state.tr.insertText(text, b.editor.view.state.doc.content.size - 1));

describe('bindEditor (Angular ControlValueAccessor and others)', () => {
  it('writeValue sets the document; edits are reported; the echo of an edit is not re-applied', () => {
    const b = bindEditor(host(), { value: '<p>start</p>' });
    const seen: string[] = [];
    b.onChange((h) => seen.push(h));
    expect(b.editor.getHTML()).toContain('start');
    b.writeValue('<p>from the form</p>');
    expect(b.editor.getHTML()).toContain('from the form');
    expect(seen).toEqual([]); // setting the value from outside is not an edit... 
    type(b, '!');
    expect(seen).toHaveLength(1);
    const setHTML = vi.spyOn(b.editor, 'setHTML');
    b.writeValue(seen[0]); // the form model echoing our own value back
    expect(setHTML).not.toHaveBeenCalled();
    b.writeValue(null);
    expect(setHTML).toHaveBeenCalledWith('');
    b.destroy();
  });
  it('disabled means read-only, touched fires on blur, listeners can be removed, destroy is safe twice', () => {
    const b = bindEditor(host(), { disabled: true });
    expect(b.editor.isReadOnly).toBe(true);
    b.setDisabled(false);
    expect(b.editor.isReadOnly).toBe(false);
    const touched = vi.fn();
    const off = b.onTouched(touched);
    b.editor.emit('blur', {});
    expect(touched).toHaveBeenCalledTimes(1);
    off();
    b.editor.emit('blur', {});
    expect(touched).toHaveBeenCalledTimes(1);
    b.destroy();
    b.destroy();
    expect(() => b.writeValue('<p>x</p>')).not.toThrow();
  });
});

describe('Svelte action', () => {
  it('mounts, reports edits, follows value and readOnly updates, and cleans up', () => {
    const node = host();
    const got: string[] = [];
    let ready: any = null;
    const a = wysiwyg(node, { value: '<p>one</p>', onChange: (h) => got.push(h), onReady: (e) => (ready = e) });
    expect(node.querySelector('.ProseMirror')!.textContent).toBe('one');
    expect(ready).not.toBeNull();
    ready.view.dispatch(ready.view.state.tr.insertText('!', ready.view.state.doc.content.size - 1));
    expect(got).toHaveLength(1);
    a.update({ value: '<p>two</p>', onChange: (h) => got.push(h), readOnly: true });
    expect(node.querySelector('.ProseMirror')!.textContent).toBe('two');
    expect(ready.isReadOnly).toBe(true);
    a.update({ value: got[0], onChange: () => undefined, readOnly: false }); // echo of an earlier edit: still applied as a real external change
    a.destroy();
    expect(node.querySelector('.ProseMirror')).toBeNull();
  });
});
