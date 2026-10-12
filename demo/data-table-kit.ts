// Shared by the data table demos: a panel, a line of text for what happened, and theme buttons.
import { createDataTable, defaultThemes, type DataTableApp, type DataTableAppOptions } from '../src/data-table-app';
import { $, button, el } from './samples';

export interface Demo { app: DataTableApp; log(text: string): void; panel: HTMLElement; actions: HTMLElement }

/** Draws a table in the demo page. `themes` adds the theme buttons above it. */
export function mountTable(options: Omit<DataTableAppOptions, 'element'>, themes = true): Demo {
  const actions = el('div', { class: 'actions' });
  const panel = el('div', { class: 'panel', id: 'table' });
  const out = el('pre', { class: 'demo-log', 'aria-live': 'polite' }, 'What happens appears here.');
  $('#app').append(actions, panel, out);
  const app = createDataTable({ ...options, element: panel });
  if (themes) for (const name of ['light', 'dark', ...defaultThemes.filter((t) => !['light', 'dark'].includes(t.name)).slice(0, 4).map((t) => t.name)]) actions.append(button(name, () => app.setTheme(name)));
  (window as unknown as { app: DataTableApp }).app = app;
  return { app, panel, actions, log: (text) => { out.textContent = text; } };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const pick = <T,>(list: T[], i: number) => list[i % list.length];
export const day = (i: number) => `2025-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`;
