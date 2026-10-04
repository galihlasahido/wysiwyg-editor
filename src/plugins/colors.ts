import { toggleMark } from 'prosemirror-commands';
import type { MarkType } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { EditorPlugin } from '../types';

const HEX = /^#[0-9a-f]{3,8}$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i;

/** Browsers normalise inline colors to rgb(); accept both and store hex. */
function normalizeColor(v: string): string | null {
  if (HEX.test(v)) return v;
  const m = RGB.exec(v);
  if (!m) return null;
  return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
}
const textColors = ['#000000', '#e03131', '#2f9e44', '#1971c2', '#f08c00', '#7048e8'];
const highlights = ['#fff3bf', '#ffc9c9', '#b2f2bb', '#a5d8ff', '#d0bfff'];

function markValue(state: EditorState, type: MarkType): string {
  const { $from, from, to, empty } = state.selection;
  const marks = empty ? state.storedMarks || $from.marks() : [];
  let found = marks.find((m) => m.type === type);
  if (!found && !empty) state.doc.nodesBetween(from, to, (n) => void (found ||= type.isInSet(n.marks) || undefined));
  return found?.attrs.color ?? '';
}

function colorMark(css: string): import('prosemirror-model').MarkSpec {
  return {
    attrs: { color: {} },
    parseDOM: [
      {
        style: css,
        getAttrs: (v) => {
          const color = normalizeColor(v as string);
          return color ? { color } : false;
        },
      },
    ],
    toDOM: (m) => ['span', { style: `${css}: ${m.attrs.color}` }, 0],
  };
}

/** Text color and highlight, chosen from a fixed palette. */
export const Colors: EditorPlugin = {
  name: 'colors',
  marks: { text_color: colorMark('color'), highlight: colorMark('background-color') },
  setup(editor) {
    const apply = (markName: string) => (e: typeof editor, value: string) => {
      const type = e.schema.marks[markName];
      const { state, dispatch } = e.view;
      // Strip any existing mark first so colors replace rather than stack.
      const { from, to, empty } = state.selection;
      if (!empty) dispatch(state.tr.removeMark(from, to, type));
      else dispatch(state.tr.removeStoredMark(type));
      if (!value) return true;
      return toggleMark(type, { color: value })(e.view.state, e.view.dispatch);
    };
    editor.registerCommand('textColor', apply('text_color'));
    editor.registerCommand('highlight', apply('highlight'));
  },
  toolbar: [
    {
      type: 'select',
      name: 'textColor',
      label: 'Text color',
      command: 'textColor',
      options: [{ label: 'Color', value: '' }, ...textColors.map((c) => ({ label: `● ${c}`, value: c }))],
      getValue: (s) => markValue(s, s.schema.marks.text_color),
    },
    {
      type: 'select',
      name: 'highlight',
      label: 'Highlight',
      command: 'highlight',
      options: [{ label: 'Highlight', value: '' }, ...highlights.map((c) => ({ label: `▇ ${c}`, value: c }))],
      getValue: (s) => markValue(s, s.schema.marks.highlight),
    },
  ],
};
