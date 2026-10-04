import { setBlockType } from 'prosemirror-commands';
import type { EditorPlugin } from '../types';
import { alignAttrs, alignDOM } from './helpers';

const LEVELS = [1, 2, 3, 4];

export const Heading: EditorPlugin = {
  name: 'heading',
  nodes: {
    heading: {
      attrs: { level: { default: 1 }, align: { default: null } },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: LEVELS.map((level) => ({ tag: `h${level}`, getAttrs: (n) => ({ level, ...alignAttrs(n) }) })),
      toDOM: (node) => [`h${node.attrs.level}`, alignDOM(node.attrs.align), 0],
    },
  },
  setup(editor) {
    editor.registerCommand('heading', (e, value: string) => {
      const { paragraph, heading } = e.schema.nodes;
      const cmd = value === 'paragraph' ? setBlockType(paragraph) : setBlockType(heading, { level: Number(value) });
      return cmd(e.view.state, e.view.dispatch);
    });
  },
  toolbar: [
    {
      type: 'select',
      name: 'heading',
      label: 'Heading',
      command: 'heading',
      options: [
        { label: 'Paragraph', value: 'paragraph' },
        ...LEVELS.map((l) => ({ label: `Heading ${l}`, value: String(l) })),
      ],
      getValue: (s) => {
        const n = s.selection.$from.parent;
        return n.type.name === 'heading' ? String(n.attrs.level) : 'paragraph';
      },
    },
  ],
};
