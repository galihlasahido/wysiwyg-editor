import { NodeSelection, Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import type { EditorPlugin } from '../types';

/**
 * Footnotes, collected as endnotes at the end of the document. The reference is an inline atom; its
 * number comes from a CSS counter and the list is rendered as a widget, so numbering is always in
 * document order.
 */
export const Footnotes: EditorPlugin = {
  name: 'footnotes',
  nodes: {
    footnote: {
      inline: true,
      group: 'inline',
      atom: true,
      attrs: { text: { default: '' } },
      parseDOM: [{ tag: 'sup[data-footnote]', getAttrs: (n) => ({ text: (n as HTMLElement).getAttribute('data-footnote') ?? '' }) }],
      toDOM: (n) => ['sup', { class: 'wy-fn', 'data-footnote': n.attrs.text }],
    },
  },
  setup(editor) {
    const key = new PluginKey('footnotes');
    const edit = (pos: number, current: string) => {
      const text = window.prompt('Footnote', current);
      if (text === null) return;
      const { state, dispatch } = editor.view;
      if (text.trim()) dispatch(state.tr.setNodeMarkup(pos, undefined, { text: text.trim() }));
      else dispatch(state.tr.delete(pos, pos + 1)); // empty text removes the footnote
    };

    editor.registerCommand('footnote', (e, text?: string) => {
      const { state, dispatch } = e.view;
      const t = text ?? window.prompt('Footnote');
      if (!t || !t.trim()) return false;
      dispatch(state.tr.replaceSelectionWith(state.schema.nodes.footnote.create({ text: t.trim() }), false).scrollIntoView());
      return true;
    });
    editor.registerCommand('editFootnote', (e, text?: string) => {
      const sel = e.view.state.selection;
      if (!(sel instanceof NodeSelection) || sel.node.type.name !== 'footnote') return false;
      if (text !== undefined) {
        e.view.dispatch(e.view.state.tr.setNodeMarkup(sel.from, undefined, { text }));
      } else edit(sel.from, sel.node.attrs.text);
      return true;
    });

    return [
      new Plugin({
        key,
        props: {
          decorations(state) {
            const notes: string[] = [];
            state.doc.descendants((n) => void (n.type.name === 'footnote' && notes.push(n.attrs.text)));
            if (!notes.length) return null;
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                state.doc.content.size,
                () => {
                  const box = document.createElement('div');
                  box.className = 'wy-footnotes';
                  box.setAttribute('contenteditable', 'false');
                  const ol = document.createElement('ol');
                  for (const t of notes) {
                    const li = document.createElement('li');
                    li.textContent = t; // textContent: footnote text is never parsed as HTML
                    ol.append(li);
                  }
                  box.append(ol);
                  return box;
                },
                { side: 0, key: `fn:${notes.join('\u0000')}` },
              ),
            ]);
          },
          handleClickOn(_v, _pos, node, nodePos) {
            if (node.type.name !== 'footnote') return false;
            edit(nodePos, node.attrs.text);
            return true;
          },
        },
      }),
    ];
  },
  toolbar: [{ name: 'footnote', label: 'Insert footnote', icon: 'x¹', command: 'footnote' }],
};
