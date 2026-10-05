import { createEditor } from './index';
import type { Editor, EditorConfig } from './editor';
import type { EditorPlugin } from './types';

/** Options readable from attributes; anything richer is set as a property (`el.plugins = [...]`). */
const OBSERVED = ['value', 'readonly', 'theme', 'placeholder', 'locale', 'ribbon', 'paged', 'outline', 'name'] as const;

export interface WysiwygElement extends HTMLElement {
  /** The editor, once the element is connected. */
  readonly editor: Editor | null;
  /** The document as HTML (get and set). */
  value: string;
  readOnly: boolean;
  /** Plugins to install. Set before the element is connected (default: every standard plugin). */
  plugins: EditorPlugin[] | undefined;
  /** Extra options for `createEditor` (toolbar layout, pages, locale…). Set before the element is connected. */
  config: Partial<EditorConfig> & Record<string, unknown>;
}

/**
 * Register the `<wysiwyg-editor>` custom element (once). Works in any framework or plain HTML:
 *
 *   <wysiwyg-editor value="<p>Hello</p>" ribbon paged theme="dark" name="body"></wysiwyg-editor>
 *
 * Attributes: `value`, `readonly`, `theme` (light | dark | auto), `placeholder`, `locale`, `ribbon`, `paged` (A4 pages with a ruler),
 * `outline`, `name` (the HTML is submitted with a surrounding form under this name). Properties: `value`, `readOnly`, `plugins`, `config`,
 * `editor`. Events: `editor-ready` and `editor-change` (`detail.html`). Load the stylesheet (`wysiwyg-editor/style.css`) in the page:
 * the element renders in the light DOM so the document can be styled and printed like any other content.
 */
export function defineEditorElement(tag = 'wysiwyg-editor'): void {
  if (typeof customElements === 'undefined' || customElements.get(tag)) return;

  const Base = HTMLElement;
  class WysiwygEditorElement extends Base implements WysiwygElement {
    static formAssociated = true;
    static get observedAttributes() { return [...OBSERVED]; }

    editor: Editor | null = null;
    plugins: EditorPlugin[] | undefined;
    config: Partial<EditorConfig> & Record<string, unknown> = {};
    private html: string | null = null;
    private internals: ElementInternals | null = null;
    private initial = '';

    constructor() {
      super();
      try { this.internals = this.attachInternals?.() ?? null; } catch { this.internals = null; }
    }

    get value(): string { return this.editor ? this.editor.getHTML() : this.html ?? this.getAttribute('value') ?? ''; }
    set value(v: string) {
      this.html = String(v ?? '');
      if (this.editor && this.editor.getHTML() !== this.html) this.editor.setHTML(this.html);
      this.sync();
    }
    get readOnly(): boolean { return this.editor ? this.editor.isReadOnly : this.hasAttribute('readonly'); }
    set readOnly(v: boolean) { if (v) this.setAttribute('readonly', ''); else this.removeAttribute('readonly'); }

    connectedCallback() {
      if (this.editor) return;
      // Attributes and properties are all set by now, even when the element was created by a framework before it was attached.
      this.initial = this.value;
      const host = document.createElement('div');
      this.replaceChildren(host);
      const { value: _v, ...rest } = this.config as Record<string, unknown>;
      const options: Record<string, unknown> = {
        element: host,
        content: this.initial,
        plugins: this.plugins,
        readOnly: this.hasAttribute('readonly'),
        theme: this.getAttribute('theme') ?? undefined,
        placeholder: this.getAttribute('placeholder') ?? undefined,
        locale: this.getAttribute('locale') ?? undefined,
        ribbon: this.hasAttribute('ribbon') || undefined,
        pages: this.hasAttribute('paged') ? true : undefined,
        outline: this.hasAttribute('outline') || undefined,
        ...rest,
        onChange: (html: string) => {
          this.html = html;
          this.sync();
          (rest.onChange as ((h: string) => void) | undefined)?.(html);
          this.dispatchEvent(new CustomEvent('editor-change', { detail: { html }, bubbles: true, composed: true }));
        },
      };
      this.editor = createEditor(options as unknown as Parameters<typeof createEditor>[0]);
      this.sync();
      this.dispatchEvent(new CustomEvent('editor-ready', { detail: { editor: this.editor }, bubbles: true, composed: true }));
    }

    disconnectedCallback() {
      // keep the content so the element can be moved and reconnected
      if (this.editor) { this.html = this.editor.getHTML(); this.editor.destroy(); this.editor = null; }
      this.replaceChildren();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
      if (name === 'value' && value !== null && !this.editor) this.html = value;
      else if (name === 'value' && value !== null && this.editor) this.value = value;
      else if (name === 'readonly' && this.editor) this.editor.setReadOnly(value !== null);
      else if (name === 'theme' && this.editor && (value === 'light' || value === 'dark')) this.editor.setTheme(value);
    }

    private sync() {
      try { this.internals?.setFormValue(this.value); } catch { /* not form-associated here */ }
    }

    // ---- form participation
    formResetCallback() { this.value = this.initial; }
    formDisabledCallback(disabled: boolean) { this.editor?.setReadOnly(disabled || this.hasAttribute('readonly')); }
  }
  customElements.define(tag, WysiwygEditorElement);
}
