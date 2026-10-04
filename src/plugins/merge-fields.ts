import type { Node as PMNode } from 'prosemirror-model';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

export interface MergeField { name: string; label?: string }

const NAME = /^[\w.-]{1,60}$/;

/**
 * Merge fields (placeholders like {{first_name}}) as atomic inline chips, with a dropdown to insert them.
 * Use `renderMergeFields` to produce the final document for a given set of values.
 */
export function MergeFields(fields: MergeField[]): EditorPlugin {
  const allowed = new Set(fields.map((f) => f.name));
  return {
    name: 'merge-fields',
    nodes: {
      merge_field: {
        inline: true,
        group: 'inline',
        atom: true,
        attrs: { name: {} },
        parseDOM: [{ tag: 'span[data-merge-field]', getAttrs: (n) => { const v = (n as HTMLElement).getAttribute('data-merge-field') ?? ''; return NAME.test(v) ? { name: v } : false; } }],
        toDOM: (n) => ['span', { class: 'wy-merge', 'data-merge-field': n.attrs.name }, `{{${n.attrs.name}}}`],
        leafText: (n) => `{{${n.attrs.name}}}`,
      },
    },
    setup(editor: Editor) {
      editor.registerCommand('insertMergeField', (e, name: string) => {
        if (typeof name !== 'string' || !NAME.test(name) || (allowed.size && !allowed.has(name))) return false;
        const { state, dispatch } = e.view;
        dispatch(state.tr.replaceSelectionWith(state.schema.nodes.merge_field.create({ name }), false).scrollIntoView());
        return true;
      });
    },
    toolbar: [
      {
        type: 'select',
        name: 'mergeField',
        label: 'Insert merge field',
        command: 'insertMergeField',
        options: [{ label: '{{ }} Merge field', value: '' }, ...fields.map((f) => ({ label: f.label ?? f.name, value: f.name }))],
        getValue: () => '',
      },
    ],
  };
}

/** Names of the merge fields used in a document (in order, without duplicates). */
export function getMergeFields(doc: PMNode): string[] {
  const out = new Set<string>();
  doc.descendants((n) => void (n.type.name === 'merge_field' && out.add(n.attrs.name)));
  return [...out];
}

export interface RenderOptions {
  /** What to do with a field that has no value: leave `{{name}}` (default), or replace it with nothing. */
  missing?: 'keep' | 'empty';
}

/**
 * Fill merge fields with `data` and return the HTML. Values are inserted as text nodes, so a value like
 * `<img onerror=...>` can never become markup.
 */
export function renderMergeFields(html: string, data: Record<string, unknown>, options: RenderOptions = {}): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  for (const el of Array.from(box.querySelectorAll<HTMLElement>('span[data-merge-field]'))) {
    const name = el.getAttribute('data-merge-field') ?? '';
    const v = Object.prototype.hasOwnProperty.call(data, name) ? data[name] : undefined;
    if (v === undefined || v === null) {
      if (options.missing === 'empty') el.remove();
      else el.replaceWith(document.createTextNode(`{{${name}}}`));
    } else el.replaceWith(document.createTextNode(String(v)));
  }
  return box.innerHTML;
}
