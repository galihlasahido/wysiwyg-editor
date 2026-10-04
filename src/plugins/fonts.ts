import { toggleMark } from 'prosemirror-commands';
import type { MarkSpec } from 'prosemirror-model';
import type { EditorState } from 'prosemirror-state';
import type { EditorPlugin } from '../types';
import { LINE_HEIGHTS } from './helpers';

export const FONT_FAMILIES = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS'];
export const FONT_SIZES = ['10', '12', '14', '16', '18', '24', '32', '48'];

function firstFamily(v: string): string | null {
  const first = v.split(',')[0].trim().replace(/^["']|["']$/g, '');
  return FONT_FAMILIES.find((f) => f.toLowerCase() === first.toLowerCase()) ?? null;
}

const fontFamily: MarkSpec = {
  attrs: { value: {} },
  parseDOM: [{ style: 'font-family', getAttrs: (v) => { const f = firstFamily(v as string); return f ? { value: f } : false; } }],
  toDOM: (m) => ['span', { style: `font-family: '${m.attrs.value}'` }, 0],
};

const fontSize: MarkSpec = {
  attrs: { value: {} },
  parseDOM: [{ style: 'font-size', getAttrs: (v) => { const m = /^(\d+(?:\.\d+)?)px$/.exec(v as string); return m && FONT_SIZES.includes(String(+m[1])) ? { value: String(+m[1]) } : false; } }],
  toDOM: (m) => ['span', { style: `font-size: ${m.attrs.value}px` }, 0],
};

function markValue(state: EditorState, name: string): string {
  const type = state.schema.marks[name];
  const { $from, from, to, empty } = state.selection;
  if (empty) return (state.storedMarks || $from.marks()).find((m) => m.type === type)?.attrs.value ?? '';
  let v = '';
  state.doc.nodesBetween(from, to, (n) => void (v ||= n.marks.find((m) => m.type === type)?.attrs.value ?? ''));
  return v;
}

/** Font family, font size and line spacing. */
export const Fonts: EditorPlugin = {
  name: 'fonts',
  marks: { font_family: fontFamily, font_size: fontSize },
  setup(editor) {
    const setMark = (name: string) => (e: typeof editor, value: string) => {
      const type = e.schema.marks[name];
      const { state, dispatch } = e.view;
      const { from, to, empty } = state.selection;
      dispatch(empty ? state.tr.removeStoredMark(type) : state.tr.removeMark(from, to, type));
      return value ? toggleMark(type, { value })(e.view.state, e.view.dispatch) : true;
    };
    editor.registerCommand('fontFamily', setMark('font_family'));
    editor.registerCommand('fontSize', setMark('font_size'));
    editor.registerCommand('lineHeight', (e, value: string) => {
      const { state, dispatch } = e.view;
      const tr = state.tr;
      state.doc.nodesBetween(state.selection.from, state.selection.to, (node, pos) => {
        if (node.isTextblock && 'lineHeight' in node.type.spec.attrs!) tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: value || null });
      });
      dispatch(tr);
      return true;
    });
  },
  toolbar: [
    { type: 'select', name: 'fontFamily', label: 'Font', command: 'fontFamily', options: [{ label: 'Font', value: '' }, ...FONT_FAMILIES.map((f) => ({ label: f, value: f }))], getValue: (s) => markValue(s, 'font_family') },
    { type: 'select', name: 'fontSize', label: 'Font size', command: 'fontSize', options: [{ label: 'Size', value: '' }, ...FONT_SIZES.map((f) => ({ label: f, value: f }))], getValue: (s) => markValue(s, 'font_size') },
    { type: 'select', name: 'lineHeight', label: 'Line spacing', command: 'lineHeight', options: [{ label: 'Spacing', value: '' }, ...LINE_HEIGHTS.map((l) => ({ label: l, value: l }))], getValue: (s) => s.selection.$from.parent.attrs.lineHeight ?? '' },
  ],
};
