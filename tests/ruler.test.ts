import { describe, expect, it } from 'vitest';
import { Ruler, type RulerHost } from '../src/ruler';

function setup(initial: { ml?: number; mr?: number; p?: { left: number; right: number; firstLine: number } | null } = {}) {
  const state = { ml: initial.ml ?? 96, mr: initial.mr ?? 96, p: initial.p === undefined ? { left: 0, right: 0, firstLine: 0 } : initial.p };
  const calls: string[] = [];
  const guides: (number | null)[] = [];
  const host: RulerHost = {
    width: () => 794,
    margins: () => ({ left: state.ml, right: state.mr }),
    setMargins: (m) => {
      calls.push(`margins ${JSON.stringify(m)}`);
      if (m.left !== undefined) state.ml = m.left;
      if (m.right !== undefined) state.mr = m.right;
    },
    paragraph: () => state.p,
    setParagraph: (p) => {
      calls.push(`paragraph ${JSON.stringify(p)}`);
      if (state.p) Object.assign(state.p, { left: p.left ?? state.p.left, right: p.right ?? state.p.right, firstLine: p.firstLine ?? state.p.firstLine });
    },
    scale: () => 1,
    guide: (x) => guides.push(x),
  };
  const ruler = new Ruler(host);
  ruler.rebuild();
  document.body.append(ruler.el);
  const marker = (label: string) => ruler.el.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  const key = (label: string, k: string, shift = false) => marker(label).dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));
  const drag = (label: string, from: number, to: number) => {
    const el = marker(label);
    const ev = (type: string, x: number) => el.dispatchEvent(new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true }));
    ev('pointerdown', from);
    ev('pointermove', to);
    ev('pointerup', to);
  };
  return { ruler, state, calls, guides, marker, key, drag };
}

describe('Ruler', () => {
  it('draws a cm scale with zero at the left margin and shaded margin zones', () => {
    const { ruler } = setup();
    const labels = [...ruler.el.querySelectorAll('text')].map((t) => t.textContent);
    expect(labels).toContain('1');
    expect(labels).not.toContain('0'); // zero sits at the margin edge, unlabelled
    expect((ruler.el.querySelector('.wy-ruler-zone-left') as HTMLElement).style.width).toBe('96px');
    expect((ruler.el.querySelector('.wy-ruler-zone-right') as HTMLElement).style.width).toBe('96px');
  });

  it('places markers relative to the margin and exposes slider semantics', () => {
    const { marker } = setup({ p: { left: 40, right: 20, firstLine: -10 } });
    expect(marker('Left indent').style.left).toBe('136px'); // margin 96 + indent 40
    expect(marker('First line indent').style.left).toBe('126px');
    expect(marker('Right indent').style.left).toBe('678px'); // 794 - 96 - 20
    expect(marker('Left indent').getAttribute('role')).toBe('slider');
    expect(marker('Left indent').getAttribute('aria-valuenow')).toBe('40');
  });

  it('hides the indent markers when there is no paragraph at the cursor', () => {
    const { marker } = setup({ p: null });
    expect(marker('Left indent').hidden).toBe(true);
    expect(marker('Left margin').hidden).toBe(false);
  });

  it('dragging the left-indent box moves the indent only, once on release, with a guide line', () => {
    const { drag, calls, guides, state } = setup({ p: { left: 0, right: 0, firstLine: 15 } });
    drag('Left indent', 100, 160);
    expect(calls).toEqual(['paragraph {"left":60}']); // first line is relative, so it moves along without being sent
    expect(state.p!.firstLine).toBe(15);
    expect(guides.at(-1)).toBeNull(); // guide hidden after the drag
    expect(guides.some((g) => g === 156)).toBe(true); // shown at 96 + 60 while dragging
  });

  it('dragging the hanging marker keeps the first line where it is on the page', () => {
    const { drag, calls } = setup({ p: { left: 20, right: 0, firstLine: 30 } });
    drag('Hanging indent', 0, 25);
    expect(calls).toEqual(['paragraph {"left":45,"firstLine":5}']); // first line stays at 96+20+30 = 146 = 96+45+5
  });

  it('dragging the first-line marker, right indent and margins', () => {
    const a = setup({ p: { left: 40, right: 0, firstLine: 0 } });
    a.drag('First line indent', 0, -25);
    expect(a.calls).toEqual(['paragraph {"firstLine":-25}']);

    const b = setup();
    b.drag('Right indent', 700, 650); // moving left increases the right indent
    expect(b.calls).toEqual(['paragraph {"right":50}']);

    const c = setup();
    c.drag('Left margin', 96, 140);
    c.drag('Right margin', 698, 650);
    expect(c.calls).toEqual(['margins {"left":140}', 'margins {"right":144}']);
  });

  it('clamps drags to sensible bounds', () => {
    const a = setup();
    a.drag('Left indent', 0, -500);
    expect(a.calls).toEqual([]); // nothing to change: already 0
    a.drag('Left indent', 0, 5000);
    expect(JSON.parse(a.calls[0].replace('paragraph ', '')).left).toBe(794 - 96 - 96 - 0 - 20); // leaves 20px of text width
    const b = setup();
    b.drag('Left margin', 96, 9999);
    expect(JSON.parse(b.calls[0].replace('margins ', '')).left).toBe(794 / 2 - 50);
  });

  it('commits nothing when the drag is cancelled or does not move', () => {
    const { marker, calls, guides } = setup();
    const el = marker('Left indent');
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, button: 0, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointermove', { clientX: 140, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointercancel', { bubbles: true }));
    expect(calls).toEqual([]);
    expect(guides.at(-1)).toBeNull();
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, button: 0, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { clientX: 100, bubbles: true }));
    expect(calls).toEqual([]);
    // the right mouse button must not start a drag
    const seen = guides.length;
    el.dispatchEvent(new MouseEvent('pointerdown', { clientX: 100, button: 2, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointermove', { clientX: 150, bubbles: true }));
    el.dispatchEvent(new MouseEvent('pointerup', { clientX: 150, bubbles: true }));
    expect(guides.length).toBe(seen);
    expect(calls).toEqual([]);
  });

  it('supports the keyboard: arrows move by 1px, Shift+arrow by 10px', () => {
    const { key, calls } = setup();
    key('Left indent', 'ArrowRight');
    key('Left indent', 'ArrowRight', true);
    key('Right margin', 'ArrowLeft'); // moving the right edge left grows the right margin
    key('Left indent', 'a');
    expect(calls).toEqual(['paragraph {"left":1}', 'paragraph {"left":11}', 'margins {"right":97}']);
  });

  it('survives rebuilds mid-drag: the marker element is the same node afterwards', () => {
    const { ruler, marker } = setup();
    const before = marker('Left margin');
    ruler.rebuild();
    ruler.rebuild();
    expect(marker('Left margin')).toBe(before);
  });
});
