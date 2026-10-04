/** React wrapper (needs the optional `react` peer dependency). */
import { createElement, forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes } from 'react';
import { createEditor, type Editor, type EditorConfig } from './index';

type CreateConfig = Omit<EditorConfig, 'plugins' | 'element' | 'content'> & {
  plugins?: EditorConfig['plugins'];
  pages?: Parameters<typeof createEditor>[0]['pages'];
  outline?: boolean;
};

export interface WysiwygEditorProps extends CreateConfig, Omit<HTMLAttributes<HTMLDivElement>, 'onChange' | 'content'> {
  /** HTML content. Controlled: pass the latest value from `onChange` back in. */
  value?: string;
  onChange?: (html: string) => void;
}

/**
 * `<WysiwygEditor value onChange />`. Editor options (plugins, pages, locale…) are read once when the
 * editor is created; `value` and `readOnly` stay in sync afterwards. Use the ref to get the `Editor`.
 */
export const WysiwygEditor = forwardRef<Editor | null, WysiwygEditorProps>(function WysiwygEditor(props, ref) {
  const { value, onChange, readOnly, plugins, pages, outline, placeholder, direction, locale, uploadImage, ...divProps } = props;
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Editor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const lastEmitted = useRef<string | undefined>(undefined);

  // A layout effect, declared before useImperativeHandle: the handle is read in the same commit phase, so the
  // editor must already exist or the ref would stay null.
  useLayoutEffect(() => {
    const e = createEditor({
      element: host.current!,
      content: value ?? '',
      plugins,
      pages,
      outline,
      placeholder,
      direction,
      locale,
      uploadImage,
      readOnly,
      onChange: (html) => {
        lastEmitted.current = html;
        onChangeRef.current?.(html);
      },
    });
    editor.current = e;
    return () => {
      // Destroy on unmount; React StrictMode mounts, unmounts and re-mounts, so this must be clean.
      e.destroy();
      editor.current = null;
    };
    // The editor is created once; later prop changes are handled by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => editor.current as Editor, []);

  useEffect(() => {
    const e = editor.current;
    if (!e || value === undefined || value === lastEmitted.current || value === e.getHTML()) return;
    e.setHTML(value); // external change (not an echo of what the editor just emitted)
  }, [value]);

  useEffect(() => {
    if (editor.current && editor.current.isReadOnly !== !!readOnly) editor.current.setReadOnly(!!readOnly);
  }, [readOnly]);

  return createElement('div', { ...divProps, ref: host });
});
