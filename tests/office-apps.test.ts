import { afterEach, describe, expect, it } from 'vitest';
import { createSpreadsheet } from '../src/spreadsheet-app';
import { createPresentation } from '../src/presentation-app';

const hosts: HTMLElement[] = [];
afterEach(() => { hosts.splice(0).forEach((h) => h.remove()); });
const host = () => { const h = document.createElement('div'); document.body.append(h); hosts.push(h); return h; };

describe('spreadsheet app', () => {
  it('builds with either menu, switches between them and cleans up', () => {
    const sheet = createSpreadsheet({ element: host(), menu: 'classic', title: 'Book' });
    expect(sheet.el.querySelector('.wy-oc.is-classic .wy-oc-tab')).toBeTruthy();
    expect([...sheet.el.querySelectorAll('.wy-oc-tab')].map((t) => t.textContent)).toEqual(['File', 'Home', 'Insert', 'Formulas', 'Data', 'View']);
    sheet.setMenu('floating');
    expect(sheet.el.querySelector('.wy-oc.is-floating .wy-oc-menu-btn')).toBeTruthy();
    expect(sheet.el.querySelector('.wy-oc-tab')).toBeNull();
    expect(sheet.el.classList.contains('is-floating')).toBe(true);
    sheet.destroy();
    expect(document.querySelector('.wy-ss-app')).toBeNull();
  });
  it('reads and writes cells by name, with formulas, CSV and JSON', () => {
    const sheet = createSpreadsheet({ element: host() });
    sheet.setValue('A1', '4'); sheet.setValue('A2', '5'); sheet.setValue('A3', '=A1*A2');
    expect(sheet.getValue('A3')).toBe(20);
    expect(sheet.getRaw('A3')).toBe('=A1*A2');
    sheet.setValue('B1', '=1/0');
    expect(sheet.getValue('B1')).toBe('#DIV/0!');
    expect(sheet.toCSV('A1:A3')).toBe('4\n5\n20');
    const json = JSON.stringify(sheet.getData());
    const other = createSpreadsheet({ element: host(), data: json });
    expect(other.getValue('A3')).toBe(20);
    sheet.undo();
    expect(sheet.getRaw('B1')).toBe('');
    expect(() => sheet.getValue('nonsense')).toThrow();
    expect(sheet.getData().sheets[0].name).toBe('Sheet1');
  });
  it('announces changes and saves after a pause', async () => {
    const saved: unknown[] = [];
    const events: string[] = [];
    const sheet = createSpreadsheet({ element: host(), saveDelayMs: 10, save: async (d) => { saved.push(d); } });
    sheet.on('save', (e) => events.push((e as { status: string }).status));
    sheet.setValue('A1', 'x');
    for (let i = 0; i < 50 && !saved.length; i++) await new Promise((r) => setTimeout(r, 10));
    expect(saved).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(['unsaved', 'saving', 'saved']);
  });
  it('read-only keeps the data and hides the editing', () => {
    const sheet = createSpreadsheet({ element: host(), readOnly: true, data: { sheets: [{ name: 'S', rows: 5, cols: 5, cells: { A1: { v: '1' } } }] } });
    expect(sheet.el.classList.contains('is-readonly')).toBe(true);
    sheet.view.startEdit('x');
    expect(sheet.view.isEditing).toBe(false);
    sheet.setReadOnly(false);
    sheet.view.startEdit('x');
    expect(sheet.view.isEditing).toBe(true);
  });
});

describe('presentation app', () => {
  it('builds with either menu and keeps one slide selected', () => {
    const deck = createPresentation({ element: host(), menu: 'classic' });
    expect([...deck.el.querySelectorAll('.wy-oc-tab')].map((t) => t.textContent)).toEqual(['File', 'Home', 'Insert', 'Design', 'Transitions', 'Slide Show', 'View']);
    expect(deck.el.querySelectorAll('.wy-pr-thumb')).toHaveLength(1);
    deck.setMenu('floating');
    expect([...deck.el.querySelectorAll('.wy-oc-menu-btn')].map((t) => t.textContent)).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Slide', 'Arrange']);
    deck.addSlide('titleContent');
    expect(deck.getData().slides).toHaveLength(2);
    expect(deck.current).toBe(1);
    expect(deck.el.querySelectorAll('.wy-pr-thumb')).toHaveLength(2);
    deck.undo();
    expect(deck.getData().slides).toHaveLength(1);
    deck.destroy();
    expect(document.querySelector('.wy-pr-app')).toBeNull();
  });
  it('setData cleans what it is given', () => {
    const deck = createPresentation({ element: host() });
    deck.setData({ title: 'T', width: 1280, height: 720, theme: 'x', slides: [{ id: 'a', layout: 'blank', notes: '', els: [{ id: 'e', type: 'text', x: 0, y: 0, w: 100, h: 50, html: '<img src=x onerror=1>hi' }] }] } as never);
    expect(deck.getData().theme).toBe('office');
    expect(deck.getData().slides[0].els[0].html).toBe('hi');
    expect(deck.el.querySelector('.wy-pr-stagebox img')).toBeNull();
  });
  it('the slide show opens, moves and closes', () => {
    const deck = createPresentation({ element: host() });
    deck.addSlide('blank');
    const show = deck.present(0);
    expect(deck.el.querySelector('.wy-pr-counter')!.textContent).toBe('1 / 2');
    show.goTo(1);
    expect(deck.el.querySelector('.wy-pr-counter')!.textContent).toBe('2 / 2');
    show.close();
    expect(deck.el.querySelector('.wy-pr-show')).toBeNull();
  });
  it('read-only does not change the deck', () => {
    const deck = createPresentation({ element: host(), readOnly: true });
    deck.addSlide();
    expect(deck.getData().slides).toHaveLength(1);
  });
});
