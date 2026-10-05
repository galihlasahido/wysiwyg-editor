/**
 * Svelte action (Svelte 3, 4 and 5; it needs no import from Svelte):
 *
 *   <div use:wysiwyg={{ value: html, onChange: (h) => (html = h), plugins, readOnly }}></div>
 *
 * Editor options are read when the element mounts; `value` and `readOnly` stay in sync afterwards.
 */
import { bindEditor, type AdapterConfig, type EditorBinding } from './adapter';
import type { Editor } from './index';

export interface WysiwygActionParams extends AdapterConfig {
  value?: string;
  onChange?: (html: string) => void;
  readOnly?: boolean;
  /** Receives the editor once it exists. */
  onReady?: (editor: Editor) => void;
}

export function wysiwyg(node: HTMLElement, params: WysiwygActionParams = {}) {
  const { value, onChange, readOnly, onReady, ...config } = params;
  const binding: EditorBinding = bindEditor(node, { ...config, value, disabled: readOnly });
  let current = params;
  const off = binding.onChange((html) => current.onChange?.(html));
  onReady?.(binding.editor);
  return {
    update(next: WysiwygActionParams) {
      current = next;
      if (next.value !== undefined) binding.writeValue(next.value);
      binding.setDisabled(!!next.readOnly);
    },
    destroy() { off(); binding.destroy(); },
  };
}
