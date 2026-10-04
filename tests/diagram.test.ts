import { describe, expect, it } from 'vitest';
import { Diagram, createEditor, defaultPlugins, parseDiagram, renderDiagram } from '../src';

const make = (content?: string) => createEditor({ element: document.body.appendChild(document.createElement('div')), plugins: [...defaultPlugins, Diagram], content });

describe('diagram', () => {
  it('parses untrusted JSON safely', () => {
    expect(parseDiagram('not json').shapes).toEqual([]);
    const m = parseDiagram({ w: 99999, h: -5, shapes: [{ id: 'a', type: 'evil', x: 1e9, y: 'x', w: 5, h: 5, text: 'x'.repeat(500), fill: 'url(javascript:1)' }, { id: 'a' }, { id: 'bad id!' }, null], arrows: [{ from: 'a', to: 'a' }, { from: 'a', to: 'zz' }] });
    expect(m.w).toBe(1600);
    expect(m.h).toBe(80);
    expect(m.shapes).toHaveLength(1);
    expect(m.shapes[0]).toMatchObject({ type: 'rect', x: 4000, y: 0, w: 20, fill: '#dbeafe' });
    expect(m.shapes[0].text).toHaveLength(200);
    expect(m.arrows).toEqual([]);
  });
  it('renders labels as text, never as markup', () => {
    const svg = renderDiagram(parseDiagram({ shapes: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 100, h: 40, text: '<img src=x onerror=alert(1)>', fill: '#ffffff' }] }));
    expect(svg.querySelector('img')).toBeNull();
    expect(svg.textContent).toContain('<img src=x');
  });
  it('inserts, serialises and parses back', () => {
    const ed = make('<p>hi</p>');
    expect(ed.execute('insertDiagram')).toBe(true);
    const html = ed.getHTML();
    expect(html).toContain('data-diagram');
    expect(html).toContain('Do the work');
    const ed2 = make(html);
    expect(ed2.view.dom.querySelectorAll('.wy-diagram').length).toBe(1);
    expect(ed2.view.dom.textContent).toContain('Start');
    ed.destroy();
    ed2.destroy();
  });
  it('drops a hostile data attribute when parsing HTML', () => {
    const ed = make('<figure data-diagram=\'{"shapes":[{"id":"a","text":"ok","fill":"red;x"}],"w":"<script>"}\'></figure>');
    expect(ed.getHTML()).not.toContain('<script>');
    expect(ed.getHTML()).toContain('#dbeafe');
    ed.destroy();
  });
});

describe('diagram audit regressions', () => {
  const insert = (ed: ReturnType<typeof make>) => { ed.execute('insertDiagram'); return ed.view.dom.querySelector('.wy-diagram') as HTMLElement; };
  const bar = (fig: HTMLElement, label: string) => [...fig.querySelectorAll<HTMLButtonElement>('.wy-diagram-bar button')].find((b) => b.textContent === label)!;

  it('Backspace inside the text box edits the text, not the shape', () => {
    const ed = make('<p>x</p>');
    const fig = insert(ed);
    (fig.querySelector('.wy-diagram-edit') as HTMLElement).click();
    const shape = fig.querySelector('.wy-d-shape') as SVGElement;
    shape.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = fig.querySelector('.wy-diagram-input') as HTMLTextAreaElement;
    expect(input).not.toBeNull();
    const shapesBefore = fig.querySelectorAll('.wy-d-shape').length;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    expect(fig.querySelectorAll('.wy-d-shape').length).toBe(shapesBefore);
    ed.destroy();
  });
  it('a read-only editor cannot enter edit mode or change the diagram', () => {
    const ed = make('<p>x</p>');
    const fig = insert(ed);
    const data = () => ed.view.state.doc.child(0).attrs.data;
    const before = data();
    ed.setReadOnly(true);
    (fig.querySelector('.wy-diagram-edit') as HTMLElement).click();
    expect(fig.classList.contains('is-editing')).toBe(false);
    expect(data()).toBe(before);
    ed.destroy();
  });
  it('caps the number of shapes it can add', () => {
    const ed = make('<p>x</p>');
    const fig = insert(ed);
    (fig.querySelector('.wy-diagram-edit') as HTMLElement).click();
    for (let i = 0; i < 230; i++) bar(fig, 'Rectangle').click();
    expect(parseDiagram(JSON.parse(JSON.stringify(fig.getAttribute('data-diagram')))).shapes.length).toBeLessThanOrEqual(200);
    ed.destroy();
  });
});
