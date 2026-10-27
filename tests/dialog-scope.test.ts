import { describe, expect, it } from 'vitest';
import { askDialog, createEditor } from '../src';

// The colour variables are defined on the editor. A dialog opened on a root outside any editor (the page body) must carry its own,
// or its background is undefined and the modal comes out transparent.
describe('dialog colours outside an editor', () => {
  it('a dialog on the page body gets its own variable scope', () => {
    const p = askDialog(document.body, { title: 'Name' });
    const backdrop = document.querySelector('.wy-ask-backdrop')!;
    expect(backdrop.classList.contains('wy-modal-scope')).toBe(true);
    expect(['light', 'dark']).toContain(backdrop.getAttribute('data-theme'));
    (backdrop.querySelector('button[type=button]') as HTMLButtonElement).click();
    return expect(p).resolves.toBeNull();
  });

  it('follows a data-theme on an ancestor', () => {
    const host = document.createElement('div');
    host.setAttribute('data-theme', 'dark');
    document.body.append(host);
    void askDialog(host, { title: 'Name' });
    expect(host.querySelector('.wy-ask-backdrop')!.getAttribute('data-theme')).toBe('dark');
    host.remove();
  });

  it('inside an editor it adds nothing (the editor already provides the variables)', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const editor = createEditor({ element: el });
    void askDialog(editor.root, { title: 'Name' });
    expect(editor.root.querySelector('.wy-ask-backdrop')!.classList.contains('wy-modal-scope')).toBe(false);
    editor.destroy();
    el.remove();
  });
});
