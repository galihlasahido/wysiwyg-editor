import { toggleMark } from 'prosemirror-commands';
import type { EditorPlugin } from '../types';
import { isSafeHref } from '../url';
import { markActive } from './helpers';


export const Link: EditorPlugin = {
  name: 'link',
  marks: {
    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (n) => {
            const href = (n as HTMLElement).getAttribute('href') ?? '';
            return isSafeHref(href) ? { href, title: (n as HTMLElement).getAttribute('title') } : false;
          },
        },
      ],
      // Checked again on output: nodes can also arrive from collaboration, which bypasses parseDOM.
      toDOM: (m) => ['a', { href: isSafeHref(m.attrs.href) ? m.attrs.href : '#', title: m.attrs.title, rel: 'noopener noreferrer' }, 0],
    },
  },
  setup(editor) {
    editor.registerCommand('link', (e, href?: string) => {
      const type = e.schema.marks.link;
      const { state, dispatch } = e.view;
      if (markActive(state, type)) return toggleMark(type)(state, dispatch);
      const url = href ?? window.prompt('Link URL');
      if (!url || !isSafeHref(url)) return false;
      return toggleMark(type, { href: url })(state, dispatch);
    });
  },
  toolbar: [{ name: 'link', label: 'Link', icon: '🔗', command: 'link', isActive: (s) => markActive(s, s.schema.marks.link) }],
};
