import axe from 'axe-core';
import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { Comments, Editor, Pages, Outline, Templates, TrackChanges, Versions, defaultPlugins } from '../src';

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function make(config: Partial<ConstructorParameters<typeof Editor>[0]> = {}, extra: ConstructorParameters<typeof Editor>[0]['plugins'] = []) {
  document.body.innerHTML = '<main></main>';
  const e = new Editor({ element: document.querySelector('main')!, content: '<h1>Title</h1><p>Hello <a href="https://x.test">link</a></p><table><tr><th>A</th></tr><tr><td>1</td></tr></table><ul><li><p>x</p></li></ul>', plugins: [...defaultPlugins, ...extra], ...config });
  editors.push(e);
  return e;
}

// jsdom has no layout/colors, so contrast is checked statically in the CSS (see below) instead of by axe.
const audit = async (root: HTMLElement) =>
  (await axe.run(root, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } })).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 80)).join(' | ')}`);

describe('accessibility (axe-core)', () => {
  it('default editor has no violations', async () => {
    expect(await audit(make().root)).toEqual([]);
  });

  it('full-featured paged editor with side panels has no violations', async () => {
    const comments = Comments({ author: 'Ana' });
    const e = make({}, [Pages(), Outline, comments, TrackChanges(), Versions(), Templates()]);
    e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, 1, 4)));
    e.execute('addComment', 'a comment');
    expect(await audit(e.root)).toEqual([]);
  });

  it('read-only and RTL editors have no violations', async () => {
    expect(await audit(make({ readOnly: true }).root)).toEqual([]);
    expect(await audit(make({ direction: 'rtl', locale: 'ar' }).root)).toEqual([]);
  });
});

describe('keyboard and ARIA', () => {
  it('exposes the editable area as a labelled multiline textbox', () => {
    const e = make({ placeholder: 'Write here' });
    expect(e.view.dom.getAttribute('role')).toBe('textbox');
    expect(e.view.dom.getAttribute('aria-multiline')).toBe('true');
    expect(e.view.dom.getAttribute('aria-label')).toBe('Write here');
  });

  it('has a single toolbar tab stop and moves with the arrow keys (roving tabindex)', () => {
    const e = make();
    const controls = [...e.toolbar.el.querySelectorAll<HTMLElement>('button, select')];
    expect(controls.filter((c) => c.tabIndex === 0)).toHaveLength(1);
    controls[0].focus();
    controls[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(controls[1]);
    expect(controls[1].tabIndex).toBe(0);
    expect(controls[0].tabIndex).toBe(-1);
    controls[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(controls.at(-1));
    controls.at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(controls[0]); // wraps
    controls[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(controls[0]);
  });

  it('only toggle buttons announce a pressed state', () => {
    const e = make();
    const byLabel = (l: string) => e.toolbar.el.querySelector<HTMLElement>(`[aria-label="${l}"]`)!;
    expect(byLabel('Bold').hasAttribute('aria-pressed')).toBe(true);
    expect(byLabel('Undo').hasAttribute('aria-pressed')).toBe(false);
  });

  it('every toolbar control has an accessible name', () => {
    const e = make({}, [Pages(), Comments(), TrackChanges(), Versions(), Templates()]);
    for (const c of e.toolbar.el.querySelectorAll<HTMLElement>('button, select')) {
      expect(c.getAttribute('aria-label') || c.textContent?.trim(), c.outerHTML).toBeTruthy();
    }
  });
});

describe('text contrast in the stylesheet (WCAG AA 4.5:1)', () => {
  // Rules scoped to the dark theme/page are checked against dark backgrounds, not white, so leave them out here.
  const css = (require('node:fs').readFileSync('src/styles.css', 'utf8') as string)
    .split('\n')
    .filter((line) => !/\[data-(theme|page)='dark'\]/.test(line) && !/\.wy-(tok|code)-/.test(line))
    .join('\n');
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
  };

  it('uses no light-gray text colors that fail contrast on white', () => {
    const colors = [...css.matchAll(/(?<![-\w])color:\s*(#[0-9a-f]{6})/gi)].map((m) => m[1].toLowerCase());
    const failing = [...new Set(colors)].filter((c) => ratio(c, '#ffffff') < 4.5 && c !== '#ffffff');
    expect(failing).toEqual([]);
  });

  /** Token color rules, split by theme: [selector, color]. */
  const tokenRules = () => {
    const all = require('node:fs').readFileSync('src/styles.css', 'utf8') as string;
    return [...all.matchAll(/([^{}]*\.wy-tok-[^{}]*)\{[^}]*?color:\s*(#[0-9a-f]{6})/gi)].map((m) => ({ selector: m[1], color: m[2].toLowerCase() }));
  };

  it('syntax-highlight colors stay readable on the dark code background', () => {
    const dark = tokenRules().filter((r) => !r.selector.includes("data-theme='light'"));
    expect(dark.length).toBeGreaterThanOrEqual(6);
    expect([...new Set(dark.map((r) => r.color))].filter((c) => ratio(c, '#1e1e1e') < 4.5)).toEqual([]);
  });

  it('light-theme syntax colors stay readable on the white editor and on the light gutter', () => {
    const light = tokenRules().filter((r) => r.selector.includes("data-theme='light'"));
    expect(light.length).toBeGreaterThanOrEqual(6);
    for (const bg of ['#ffffff', '#f6f8fa']) {
      expect([...new Set(light.map((r) => r.color))].filter((c) => ratio(c, bg) < 4.5)).toEqual([]);
    }
  });
});
