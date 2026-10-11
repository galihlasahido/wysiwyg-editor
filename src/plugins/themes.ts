import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

/** A colour theme in a few colours. The rest of the interface colours are derived from these. */
export interface ThemePalette {
  /** Decides the browser's own controls (scrollbars, form fields) and the `light` / `dark` state of the editor. */
  mode: 'light' | 'dark';
  /** Toolbar, ribbon and panels. */
  bg: string;
  surface: string;
  fg: string;
  muted: string;
  border: string;
  /** Buttons, selections, focus. */
  accent: string;
  /** Area around the pages. */
  workspace: string;
  /** The paper and its text. */
  pageBg: string;
  pageFg: string;
  /** Links in the document. Default: the accent. */
  link?: string;
}

export interface Theme {
  /** Id used by `editor.execute('colorTheme', id)`. */
  name: string;
  label: string;
  palette: ThemePalette;
  /** Any further `--wy-*` variables to set, with or without the leading dashes. */
  vars?: Record<string, string>;
}

const mix = (a: string, pct: number, b: string) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/** Expands a palette into the editor's CSS variables. */
export function themeVars(p: ThemePalette): Record<string, string> {
  const link = p.link ?? p.accent;
  const dark = p.mode === 'dark';
  return {
    '--wy-bg': p.bg, '--wy-surface': p.surface, '--wy-surface-2': mix(p.surface, 88, p.fg), '--wy-fg': p.fg, '--wy-fg-2': mix(p.fg, 88, p.bg), '--wy-muted': p.muted,
    '--wy-border': p.border, '--wy-border-2': mix(p.border, 75, p.fg), '--wy-hover': mix(p.surface, 86, p.fg), '--wy-pressed': mix(p.surface, 76, p.fg),
    '--wy-accent': p.accent, '--wy-accent-strong': mix(p.accent, 78, dark ? '#fff' : '#000'), '--wy-accent-bg': mix(p.accent, 24, p.bg), '--wy-accent-bg-2': mix(p.accent, 11, p.bg), '--wy-accent-border': mix(p.accent, 55, p.bg),
    '--wy-workspace': p.workspace, '--wy-ruler-zone': mix(p.workspace, 82, p.fg),
    '--wy-page-bg': p.pageBg, '--wy-page-fg': p.pageFg, '--wy-page-border': mix(p.pageBg, 74, p.pageFg), '--wy-page-surface': mix(p.pageBg, 96, p.pageFg),
    '--wy-page-muted': mix(p.pageFg, 76, p.pageBg), '--wy-page-header': mix(p.pageFg, 62, p.pageBg), '--wy-code-bg': mix(p.pageBg, 92, p.pageFg), '--wy-link': link,
    '--ic-accent': p.accent,
  };
}

/** The themes that come with the editor. `light` and `dark` are the stock look. */
export const defaultThemes: Theme[] = [
  { name: 'light', label: 'Light', palette: { mode: 'light', bg: '#ffffff', surface: '#fafafa', fg: '#1a1a1a', muted: '#6b7280', border: '#e3e3e3', accent: '#2563eb', workspace: '#e5e7eb', pageBg: '#ffffff', pageFg: '#1a1a1a' } },
  { name: 'dark', label: 'Dark', palette: { mode: 'dark', bg: '#2b2b2b', surface: '#242424', fg: '#f3f3f3', muted: '#b0b0b0', border: '#444444', accent: '#6ea8ff', workspace: '#1c1c1c', pageBg: '#2a2a2a', pageFg: '#ececec', link: '#8ab8ff' } },
  { name: 'sepia', label: 'Sepia', palette: { mode: 'light', bg: '#f6efe0', surface: '#efe6d2', fg: '#3b2f1e', muted: '#6e5d44', border: '#ddd0b4', accent: '#9a5b13', workspace: '#d9cdb2', pageBg: '#fbf5e6', pageFg: '#3b2f1e' } },
  { name: 'ocean', label: 'Ocean', palette: { mode: 'light', bg: '#f3f9fc', surface: '#e6f2f8', fg: '#0f2a3a', muted: '#4a6677', border: '#c9e0ec', accent: '#0b7aa8', workspace: '#c4dbe8', pageBg: '#ffffff', pageFg: '#0f2a3a' } },
  { name: 'forest', label: 'Forest', palette: { mode: 'light', bg: '#f4f8f3', surface: '#e8f0e6', fg: '#1d2f20', muted: '#52684f', border: '#d0e0cc', accent: '#2f7d3b', workspace: '#c9d9c5', pageBg: '#ffffff', pageFg: '#1d2f20' } },
  { name: 'rose', label: 'Rose', palette: { mode: 'light', bg: '#fff7f8', surface: '#fdeaee', fg: '#35161e', muted: '#7a4a58', border: '#f3d2da', accent: '#c02659', workspace: '#eccfd7', pageBg: '#ffffff', pageFg: '#35161e' } },
  { name: 'solarized', label: 'Solarized', palette: { mode: 'light', bg: '#fdf6e3', surface: '#f5eed8', fg: '#2b3a40', muted: '#586e75', border: '#e4dcc3', accent: '#268bd2', workspace: '#d8d0b6', pageBg: '#fdf6e3', pageFg: '#2b3a40', link: '#1f6fa8' } },
  { name: 'midnight', label: 'Midnight', palette: { mode: 'dark', bg: '#0f1626', surface: '#0b111e', fg: '#e6ebf5', muted: '#a3adc2', border: '#243049', accent: '#7aa2ff', workspace: '#070b14', pageBg: '#151d30', pageFg: '#e6ebf5', link: '#9bbcff' } },
  { name: 'nord', label: 'Nord', palette: { mode: 'dark', bg: '#2e3440', surface: '#272c36', fg: '#eceff4', muted: '#b4bdcc', border: '#434c5e', accent: '#88c0d0', workspace: '#20242c', pageBg: '#323946', pageFg: '#eceff4', link: '#8fbcdc' } },
  { name: 'high-contrast', label: 'High contrast', palette: { mode: 'dark', bg: '#000000', surface: '#000000', fg: '#ffffff', muted: '#e0e0e0', border: '#8a8a8a', accent: '#ffd400', workspace: '#000000', pageBg: '#000000', pageFg: '#ffffff', link: '#6fc3ff' } },
];

export interface ThemesOptions {
  /** Theme applied on start. Default: leave the editor's own `theme` option as it is. */
  initial?: string;
  /** Replace the built-in list. */
  themes?: Theme[];
  /** Add to the built-in list (same name replaces). */
  extra?: Theme[];
}

/** The API stored on `editor.extensions.themes`. */
export interface ThemeApi {
  list(): Theme[];
  current(): string | null;
  register(theme: Theme): void;
  apply(name: string): boolean;
  clear(): void;
}

const key = (v: string) => (v.startsWith('--') ? v : `--${v}`);

/**
 * Colour themes: `editor.execute('colorTheme', 'sepia')`, the View → Themes menu, or `editor.extensions.themes`.
 * A theme sets the CSS variables on the editor element, so it never leaks outside it. Switching Dark Mode afterwards returns to the stock look.
 */
export function Themes(options: ThemesOptions = {}): EditorPlugin {
  let applied: string[] = [];
  let active: string | null = null;
  let own = false; // true while this plugin is the one changing the editor's theme state
  return {
    name: 'themes',
    setup(editor: Editor) {
      const registry = new Map<string, Theme>();
      for (const t of options.themes ?? defaultThemes) registry.set(t.name, t);
      for (const t of options.extra ?? []) registry.set(t.name, t);

      const clear = () => {
        for (const k of applied) editor.root.style.removeProperty(k);
        applied = [];
        active = null;
        delete editor.root.dataset.colorTheme;
      };
      const apply = (name: string): boolean => {
        const theme = registry.get(name);
        if (!theme) return false;
        clear();
        const vars = { ...themeVars(theme.palette), ...Object.fromEntries(Object.entries(theme.vars ?? {}).map(([k, v]) => [key(k), v])) };
        own = true;
        try { editor.setTheme(theme.palette.mode); } finally { own = false; }
        for (const [k, v] of Object.entries(vars)) { editor.root.style.setProperty(k, v); applied.push(k); }
        editor.root.dataset.colorTheme = name;
        active = name;
        editor.emit('colorTheme', { name });
        return true;
      };
      const api: ThemeApi = {
        list: () => [...registry.values()],
        current: () => active,
        register: (t) => { registry.set(t.name, t); },
        apply,
        clear: () => { clear(); },
      };
      editor.extensions.themes = api;

      // Dark Mode / Switch Background used on their own mean "back to the stock look".
      const off = editor.on('theme', () => { if (!own && active) clear(); });
      editor.on('destroy', off);

      editor.registerCommand('colorTheme', (_e, name: string) => apply(name));
      editor.registerCommand('cycleColorTheme', () => {
        const names = [...registry.keys()];
        return apply(names[(names.indexOf(active ?? '') + 1) % names.length]);
      });
      editor.registerCommand('clearColorTheme', () => (clear(), true));
      if (options.initial) editor.on('ready', () => { apply(options.initial as string); });
      return [];
    },
    ribbon: [{
      tab: 'view',
      after: 'dark',
      group: {
        id: 'themes',
        label: 'Themes',
        controls: [{
          kind: 'menu' as const, id: 'colorTheme', label: 'Themes', icon: 'darkMode', need: 'colorTheme', size: 'large' as const,
          entries: (e: Editor) => ((e.extensions.themes as ThemeApi | undefined)?.list() ?? []).map((t) => ({ label: t.label, command: 'colorTheme', args: [t.name], checked: (ed: Editor) => (ed.extensions.themes as ThemeApi).current() === t.name })),
        }],
      },
    }],
  };
}
