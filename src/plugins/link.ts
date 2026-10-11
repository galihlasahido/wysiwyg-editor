import { toggleMark } from 'prosemirror-commands';
import { TextSelection } from 'prosemirror-state';
import { askDialog } from '../dialog';
import type { ContextMenuEntry, EditorPlugin } from '../types';
import { isSafeHref } from '../url';
import { markActive, markRunAt } from './helpers';


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
      if (href === undefined) {
        const quote = state.selection.empty ? '' : state.doc.textBetween(state.selection.from, state.selection.to, ' ');
        void askDialog(e.root, { title: 'Insert link', label: 'Address', description: 'http(s), mailto, tel, #anchor or a /path.', quote, placeholder: 'https://example.com', submitLabel: 'Insert', validate: (v) => (isSafeHref(v) ? null : 'Use an address that starts with https://, http://, mailto:, tel:, # or /.') }).then((url) => url && e.execute('link', url));
        return true;
      }
      if (!isSafeHref(href)) return false;
      return toggleMark(type, { href })(state, dispatch);
    });
  },
  contextMenuOrder: 30,
  contextMenu({ state, readonly }) {
    const run = markRunAt(state, 'link');
    const href = run && String(run.mark.attrs.href ?? '');
    if (!run || !href || !isSafeHref(href)) return readonly ? [] : state.selection.empty ? [] : [{ label: 'Link…', icon: '🔗', command: 'link' }];
    const items: ContextMenuEntry[] = [
      { label: 'Open link', icon: '↗', readOnly: true, run: () => { window.open(href, '_blank', 'noopener,noreferrer'); } },
      { label: 'Copy link address', readOnly: true, run: () => { void navigator.clipboard?.writeText(href).catch(() => undefined); } },
    ];
    if (!readonly) items.push('-', { label: 'Edit link…', icon: '🔗', run: (e) => {
      const { from, to } = run;
      e.view.dispatch(e.view.state.tr.setSelection(TextSelection.create(e.view.state.doc, from, to)));
      e.view.dispatch(e.view.state.tr.removeMark(from, to, e.schema.marks.link));
      e.execute('link');
    } }, { label: 'Remove link', danger: true, run: (e) => { e.view.dispatch(e.view.state.tr.removeMark(run.from, run.to, e.schema.marks.link)); } });
    return items;
  },
  toolbar: [{ name: 'link', label: 'Link', icon: '🔗', command: 'link', isActive: (s) => markActive(s, s.schema.marks.link) }],
};
