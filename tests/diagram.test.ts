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
