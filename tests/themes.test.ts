import { describe, expect, it } from 'vitest';
import { createEditor, defaultPlugins, Themes, defaultThemes, themeVars } from '../src';
import type { ThemeApi } from '../src';

function make(extra: Parameters<typeof Themes>[0] = {}) {
  const element = document.createElement('div');
  document.body.append(element);
  return createEditor({ element, plugins: [...defaultPlugins.filter((p) => p.name !== 'themes'), Themes(extra)] });
}

describe('themes', () => {
  it('ships several themes', () => {
    expect(defaultThemes.map((t) => t.name)).toEqual(expect.arrayContaining(['light', 'dark', 'sepia', 'ocean', 'midnight', 'nord', 'high-contrast']));
  });

  it('applies a theme as CSS variables on the editor element only', () => {
    const e = make();
    expect(e.execute('colorTheme', 'sepia')).toBe(true);
    expect(e.root.dataset.colorTheme).toBe('sepia');
    expect(e.root.style.getPropertyValue('--wy-page-bg')).toBe('#fbf5e6');
    expect(document.documentElement.style.getPropertyValue('--wy-page-bg')).toBe('');
    expect(e.theme).toBe('light');
  });

  it('sets the chrome to dark for dark themes', () => {
    const e = make();
    e.execute('colorTheme', 'midnight');
    expect(e.theme).toBe('dark');
    expect(e.isPageDark).toBe(true);
  });

  it('rejects an unknown name and keeps the current theme', () => {
    const e = make();
    e.execute('colorTheme', 'ocean');
    expect(e.execute('colorTheme', 'nope')).toBe(false);
    expect(e.root.dataset.colorTheme).toBe('ocean');
  });

  it('switching to another theme removes the previous one’s variables', () => {
    const e = make({ extra: [{ name: 'x', label: 'X', palette: { ...defaultThemes[0].palette }, vars: { 'wy-custom': 'red' } }] });
    e.execute('colorTheme', 'x');
    expect(e.root.style.getPropertyValue('--wy-custom')).toBe('red');
    e.execute('colorTheme', 'nord');
    expect(e.root.style.getPropertyValue('--wy-custom')).toBe('');
  });

  it('Dark Mode on its own returns to the stock look', () => {
    const e = make();
    e.execute('colorTheme', 'forest');
    e.execute('toggleTheme');
    expect(e.root.dataset.colorTheme).toBeUndefined();
    expect(e.root.style.getPropertyValue('--wy-page-bg')).toBe('');
    expect(e.theme).toBe('dark');
  });

  it('cycles through the list and wraps', () => {
    const e = make();
    const api = e.extensions.themes as ThemeApi;
    const n = api.list().length;
    for (let i = 0; i < n; i++) e.execute('cycleColorTheme');
    expect(api.current()).toBe(api.list()[n - 1].name);
    e.execute('cycleColorTheme');
    expect(api.current()).toBe(api.list()[0].name);
  });

  it('registers a custom theme and applies it at start', () => {
    const e = make({ initial: 'brand', extra: [{ name: 'brand', label: 'Brand', palette: { ...defaultThemes[0].palette, accent: '#ff0066' } }] });
    return new Promise<void>((resolve) => setTimeout(() => {
      expect(e.root.style.getPropertyValue('--wy-accent')).toBe('#ff0066');
      resolve();
    }, 20));
  });

  it('derives every interface colour from the palette', () => {
    const vars = themeVars(defaultThemes[0].palette);
    for (const k of ['--wy-bg', '--wy-hover', '--wy-accent-bg', '--wy-page-border', '--wy-code-bg', '--wy-link']) expect(vars[k]).toBeTruthy();
  });

  it('clearColorTheme restores the base look', () => {
    const e = make();
    e.execute('colorTheme', 'rose');
    e.execute('clearColorTheme');
    expect(e.root.dataset.colorTheme).toBeUndefined();
    expect(e.root.style.getPropertyValue('--wy-accent')).toBe('');
  });
});
