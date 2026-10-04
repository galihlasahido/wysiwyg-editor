import { keymap } from 'prosemirror-keymap';
import type { EditorPlugin, ToolbarButton } from '../types';
import { markActive, toggleMark } from './helpers';

const defs = [
  { name: 'bold', key: 'Mod-b', label: 'Bold', icon: '<b>B</b>' },
  { name: 'italic', key: 'Mod-i', label: 'Italic', icon: '<i>I</i>' },
  { name: 'underline', key: 'Mod-u', label: 'Underline', icon: '<u>U</u>' },
  { name: 'strike', key: 'Mod-Shift-x', label: 'Strikethrough', icon: '<s>S</s>' },
  { name: 'code', key: 'Mod-e', label: 'Inline code', icon: '&lt;/&gt;' },
  { name: 'subscript', key: 'Mod-,', label: 'Subscript', icon: 'x<sub>2</sub>' },
  { name: 'superscript', key: 'Mod-.', label: 'Superscript', icon: 'x<sup>2</sup>' },
] as const;

export const BasicStyles: EditorPlugin = {
  name: 'basic-styles',
  marks: {
    bold: {
      parseDOM: [
        { tag: 'strong' },
        { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null },
        { style: 'font-weight=bold' },
      ],
      toDOM: () => ['strong', 0],
    },
    italic: { parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }], toDOM: () => ['em', 0] },
    underline: { parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }], toDOM: () => ['u', 0] },
    strike: { parseDOM: [{ tag: 's' }, { tag: 'del' }, { tag: 'strike' }], toDOM: () => ['s', 0] },
    code: { parseDOM: [{ tag: 'code' }], toDOM: () => ['code', 0] },
    // A text cannot be both at once.
    subscript: { excludes: 'superscript', parseDOM: [{ tag: 'sub' }, { style: 'vertical-align=sub' }], toDOM: () => ['sub', 0] },
    superscript: { excludes: 'subscript', parseDOM: [{ tag: 'sup:not([data-footnote])' }, { style: 'vertical-align=super' }], toDOM: () => ['sup', 0] },
  },
  setup(editor) {
    const keys: Record<string, any> = {};
    for (const d of defs) {
      const cmd = toggleMark(editor.schema.marks[d.name]);
      editor.registerCommand(d.name, (e) => cmd(e.view.state, e.view.dispatch));
      keys[d.key] = cmd;
    }
    return [keymap(keys)];
  },
  toolbar: defs.map(
    (d): ToolbarButton => ({
      name: d.name,
      label: d.label,
      icon: d.icon,
      command: d.name,
      isActive: (s) => markActive(s, s.schema.marks[d.name]),
    }),
  ),
};
