import { afterEach, describe, expect, it } from 'vitest';
import { Autosave, createEditor, defaultPlugins } from '../src';

const els: HTMLElement[] = [];
afterEach(() => { els.splice(0).forEach((e) => e.remove()); document.querySelectorAll('.wy-ctx-layer').forEach((n) => n.remove()); });
const make = (floating: any = true, extra: object = {}) => {
  const element = document.createElement('div');
  document.body.append(element);
  els.push(element);
  return createEditor({ element, plugins: defaultPlugins, content: '<p>hello</p>', floating, ...extra });
};

describe('floating bar', () => {
  it('wraps the toolbar in a card with a menu bar', () => {
    const e = make();
    const card = e.root.querySelector('.wy-floating')!;
    expect(card).toBeTruthy();
    expect(card.querySelector('.wy-fl-tools .wy-toolbar')).toBeTruthy();
    expect([...card.querySelectorAll('.wy-fl-menu')].map((b) => b.textContent)).toEqual(['File', 'Edit', 'View', 'Insert', 'Format']);
    expect(e.root.classList.contains('has-floating')).toBe(true);
  });

  it('is off by default', () => {
    expect(make(false).root.querySelector('.wy-floating')).toBeNull();
  });

  it('opens a drop-down that runs a command', () => {
    const e = make();
    const edit = [...e.root.querySelectorAll<HTMLButtonElement>('.wy-fl-menu')].find((b) => b.textContent === 'Edit')!;
    edit.click();
    expect(edit.getAttribute('aria-expanded')).toBe('true');
    const items = [...document.querySelectorAll<HTMLElement>('.wy-ctx-item')].map((i) => i.querySelector('.wy-ctx-label')!.textContent);
    expect(items).toContain('Select all');
    [...document.querySelectorAll<HTMLElement>('.wy-ctx-item')].find((i) => i.textContent?.includes('Select all'))!.click();
    expect(e.view.state.selection.from).toBe(0);
    expect(e.view.state.selection.to).toBe(e.view.state.doc.content.size);
    expect(edit.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the title (editable with onTitle), the header controls and the menus you give', () => {
    const end = document.createElement('button');
    end.textContent = 'Share';
    let named = '';
    const e = make({ title: 'Plan', onTitle: (t: string) => { named = t; }, end, menus: [{ label: 'Mine', entries: [{ label: 'Hi', run: () => undefined }] }] });
    const input = e.root.querySelector<HTMLInputElement>('input.wy-fl-title')!;
    expect(input.value).toBe('Plan');
    input.value = 'Budget';
    input.dispatchEvent(new Event('change'));
    expect(named).toBe('Budget');
    expect(e.root.querySelector('.wy-fl-end button')!.textContent).toBe('Share');
    expect([...e.root.querySelectorAll('.wy-fl-menu')].map((b) => b.textContent)).toEqual(['Mine']);
  });

  it('menus: false leaves the menu bar out; a read-only title is plain text', () => {
    const e = make({ title: 'Doc', menus: false });
    expect(e.root.querySelector('.wy-fl-menus')).toBeNull();
    expect(e.root.querySelector('span.wy-fl-title')!.textContent).toBe('Doc');
  });

  it('shows the save status from Autosave', async () => {
    const e = make({ title: 'Doc' }, { plugins: [...defaultPlugins, Autosave({ save: async () => undefined, delayMs: 10 })] });
    e.view.dispatch(e.view.state.tr.insertText('x', 1));
    const st = e.root.querySelector<HTMLElement>('.wy-fl-status')!;
    expect(st.hidden).toBe(false);
    expect(st.textContent).toBe('Unsaved changes');
    for (let i = 0; i < 50 && st.textContent !== 'Saved'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(st.textContent).toBe('Saved');
  });

  it('works with the ribbon, and cleans up on destroy', () => {
    const e = make(true, { ribbon: true });
    expect(e.root.querySelector('.wy-floating .wy-ribbon')).toBeTruthy();
    e.destroy();
    expect(document.querySelector('.wy-floating')).toBeNull();
  });
});
