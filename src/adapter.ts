/**
 * Framework-neutral binding for anything that needs a "value in, value out" control: Angular's `ControlValueAccessor`, Svelte, Solid,
 * Lit, plain scripts. It owns the editor's life (create, keep the value and read-only state in sync without echo loops, destroy).
 */
import { createEditor, type Editor, type EditorConfig } from './index';

export type AdapterConfig = Partial<Omit<EditorConfig, 'element' | 'content' | 'onChange' | 'readOnly'>> & {
  pages?: Parameters<typeof createEditor>[0]['pages'];
  outline?: boolean;
};

export interface EditorBinding {
  readonly editor: Editor;
  /** Set the HTML from outside (a form model changing). Ignored when it is what the editor just reported. */
  writeValue(html: string | null | undefined): void;
  /** Called with the HTML after every edit. Returns a function that removes the listener. */
  onChange(fn: (html: string) => void): () => void;
  /** Called when the editor loses focus (Angular's "touched"). */
  onTouched(fn: () => void): () => void;
  setDisabled(disabled: boolean): void;
  destroy(): void;
}

export function bindEditor(element: HTMLElement, config: AdapterConfig & { value?: string; disabled?: boolean } = {}): EditorBinding {
  const { value, disabled, ...rest } = config;
  const changeFns = new Set<(html: string) => void>();
  const touchedFns = new Set<() => void>();
  let last: string | undefined;
  const editor = createEditor({
    ...rest,
    element,
    content: value ?? '',
    readOnly: !!disabled,
    onChange: (html) => { last = html; changeFns.forEach((f) => f(html)); },
  });
  const onBlur = () => touchedFns.forEach((f) => f());
  editor.on('blur', onBlur);
  let destroyed = false;
  return {
    editor,
    writeValue(html) {
      if (destroyed) return;
      const next = html ?? '';
      if (next === last || next === editor.getHTML()) return; // an echo of what the editor just reported
      last = undefined;
      editor.setHTML(next);
    },
    onChange(fn) { changeFns.add(fn); return () => void changeFns.delete(fn); },
    onTouched(fn) { touchedFns.add(fn); return () => void touchedFns.delete(fn); },
    setDisabled(d) { if (!destroyed && editor.isReadOnly !== !!d) editor.setReadOnly(!!d); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editor.off('blur', onBlur);
      changeFns.clear(); touchedFns.clear();
      editor.destroy();
    },
  };
}
