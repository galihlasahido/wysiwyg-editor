import { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import type { EditorView, NodeView } from 'prosemirror-view';
import { askDialog } from '../dialog';
import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

export type FieldKind = 'checkbox' | 'select' | 'date' | 'text';
const KINDS: FieldKind[] = ['checkbox', 'select', 'date', 'text'];

/** Transactions carrying this meta change only the value of a field: Restricted editing lets them through even in a locked section. */
export const FIELD_META = 'wy-field';

export interface FormFieldsOptions {
  /** Let people fill the fields while the editor is read-only (a form to complete, not to edit). Default true. */
  fillInReadOnly?: boolean;
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : '');
const NAME = /^[\w.-]{1,60}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseOptions(v: unknown): string[] {
  let list: unknown = v;
  if (typeof v === 'string') { try { list = JSON.parse(v); } catch { list = v.split('|'); } }
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').map((x) => clean(x, 100).trim()).filter(Boolean).slice(0, 50) : [];
}

/** A value that is valid for the kind (and options), or '' . */
export function cleanValue(kind: FieldKind, value: unknown, options: string[]): string {
  const v = typeof value === 'string' ? value : '';
  if (kind === 'checkbox') return v === 'true' ? 'true' : 'false';
  if (kind === 'select') return options.includes(v) ? v : '';
  if (kind === 'date') return DATE.test(v) && !Number.isNaN(Date.parse(v)) ? v : '';
  return clean(v, 500);
}

export interface FieldInfo { name: string; kind: FieldKind; label: string; value: string | boolean; required: boolean; empty: boolean; pos: number }

/** Every field in the document, in order. */
export function listFields(doc: PMNode): FieldInfo[] {
  const out: FieldInfo[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name !== 'form_field') return;
    const a = n.attrs;
    const checkbox = a.kind === 'checkbox';
    out.push({ name: a.name, kind: a.kind, label: a.label, value: checkbox ? a.value === 'true' : a.value, required: !!a.required, empty: checkbox ? a.value !== 'true' : !a.value, pos });
  });
  return out;
}

/**
 * Form fields inside the document: checkboxes, drop-downs, date pickers and text boxes. They are real controls, so people can fill them
 * in a locked section or in a read-only editor (`fillInReadOnly`), and the document can hand back the answers (`getFormData`) and say what
 * is still missing (`validateForm`). The saved HTML keeps the value; Word and Markdown export show it as text.
 */
export function FormFields(options: FormFieldsOptions = {}): EditorPlugin {
  const fillable = options.fillInReadOnly !== false;

  class FieldView implements NodeView {
    dom: HTMLElement;
    private control!: HTMLInputElement | HTMLSelectElement;
    constructor(private node: PMNode, private view: EditorView, private getPos: () => number | undefined, private editor: Editor) {
      this.dom = document.createElement('span');
      this.dom.contentEditable = 'false';
      this.build();
    }
    private build() {
      const a = this.node.attrs;
      this.dom.className = `wy-field wy-field-${a.kind}${a.required ? ' is-required' : ''}`;
      this.dom.replaceChildren();
      const label = a.label ? document.createElement('span') : null;
      if (label) { label.className = 'wy-field-label'; label.textContent = a.label; }
      let control: HTMLInputElement | HTMLSelectElement;
      if (a.kind === 'select') {
        const sel = document.createElement('select');
        sel.add(new Option('Choose…', ''));
        for (const o of parseOptions(a.options)) sel.add(new Option(o, o));
        sel.value = a.value;
        control = sel;
      } else {
        const input = document.createElement('input');
        input.type = a.kind === 'checkbox' ? 'checkbox' : a.kind === 'date' ? 'date' : 'text';
        if (a.kind === 'checkbox') input.checked = a.value === 'true';
        else input.value = a.value;
        if (a.kind === 'text') { input.maxLength = 500; input.placeholder = a.label || 'Type here'; input.size = Math.max(10, Math.min(40, (a.value || a.label || '').length + 4)); }
        control = input;
      }
      control.setAttribute('aria-label', a.label || a.name || a.kind);
      if (a.required) control.setAttribute('aria-required', 'true');
      control.disabled = !this.canFill();
      control.addEventListener('change', () => this.commit());
      if (a.kind === 'text') control.addEventListener('input', () => this.commit(true));
      this.control = control;
      if (a.kind === 'checkbox') this.dom.append(control, ...(label ? [label] : []));
      else this.dom.append(...(label ? [label, ' '] : []), control);
    }
    private canFill() { return this.view.editable || fillable; }
    private commit(typing = false) {
      const pos = this.getPos();
      if (pos === undefined || !this.canFill()) return;
      const a = this.node.attrs;
      const raw = a.kind === 'checkbox' ? String((this.control as HTMLInputElement).checked) : this.control.value;
      const value = cleanValue(a.kind, raw, parseOptions(a.options));
      if (value === a.value) return;
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, { ...a, value }).setMeta(FIELD_META, true);
      if (typing) tr.setMeta('addToHistory', true);
      this.view.dispatch(tr);
      this.editor.emit('field-change', { name: a.name, kind: a.kind, value: a.kind === 'checkbox' ? value === 'true' : value });
    }
    update(node: PMNode) {
      if (node.type !== this.node.type) return false;
      const same = JSON.stringify(node.attrs) === JSON.stringify(this.node.attrs);
      const onlyValue = !same && node.attrs.kind === this.node.attrs.kind && node.attrs.options === this.node.attrs.options && node.attrs.label === this.node.attrs.label && node.attrs.required === this.node.attrs.required;
      this.node = node;
      if (same) return true;
      if (onlyValue && document.activeElement === this.control) return true; // the person is typing here: do not rebuild under them
      this.build();
      return true;
    }
    stopEvent() { return true; }
    ignoreMutation() { return true; }
    selectNode() { this.dom.classList.add('ProseMirror-selectednode'); }
    deselectNode() { this.dom.classList.remove('ProseMirror-selectednode'); }
  }

  return {
    name: 'form-fields',
    nodes: {
      form_field: {
        group: 'inline',
        inline: true,
        atom: true,
        selectable: true,
        draggable: false,
        attrs: { kind: { default: 'text' }, name: { default: '' }, label: { default: '' }, value: { default: '' }, options: { default: '' }, required: { default: false } },
        leafText: (n: PMNode) => (n.attrs.kind === 'checkbox' ? (n.attrs.value === 'true' ? '☑' : '☐') : n.attrs.value),
        parseDOM: [{
          tag: 'span[data-field]',
          getAttrs: (dom) => {
            const el = dom as HTMLElement;
            const kind = el.getAttribute('data-field') as FieldKind;
            if (!KINDS.includes(kind)) return false;
            const options = kind === 'select' ? parseOptions(el.getAttribute('data-options')) : [];
            const name = el.getAttribute('data-name') ?? '';
            return { kind, name: NAME.test(name) ? name : '', label: clean(el.getAttribute('data-label'), 120), options: JSON.stringify(options), required: el.hasAttribute('data-required'), value: cleanValue(kind, el.getAttribute('data-value'), options) };
          },
        }],
        // Saved with the value as visible text too, so a reader without scripts (or a printout) shows the answer.
        toDOM: (n: PMNode) => {
          const a = n.attrs;
          const shown = a.kind === 'checkbox' ? (a.value === 'true' ? '☑' : '☐') : a.value || '____';
          return ['span', { class: `wy-field wy-field-${a.kind}`, 'data-field': a.kind, 'data-name': a.name, 'data-label': a.label, 'data-value': a.value, ...(a.kind === 'select' ? { 'data-options': a.options } : {}), ...(a.required ? { 'data-required': '' } : {}) }, `${a.label ? `${a.label}: ` : ''}${shown}`];
        },
      },
    },
    setup(editor: Editor) {
      const ask = (e: Editor, kind: FieldKind): Promise<{ label: string; options: string[]; name: string } | null> =>
        askDialog(e.root, {
          title: { checkbox: 'Insert checkbox', select: 'Insert drop-down', date: 'Insert date field', text: 'Insert text field' }[kind],
          label: kind === 'select' ? 'Question, then options (one per line)' : 'Label',
          description: kind === 'select' ? 'First line is the label; each following line is a choice.' : 'Shown next to the field.',
          multiline: kind === 'select', rows: 5, submitLabel: 'Insert', required: kind === 'select',
          value: kind === 'select' ? 'Payment method\nBank transfer\nCard\nCash' : '',
          validate: (v) => (kind === 'select' && v.split('\n').filter((l) => l.trim()).length < 3 ? 'Give a label and at least two options.' : null),
        }).then((v) => {
          if (v === null) return null;
          if (kind === 'select') { const [label, ...rest] = v.split('\n').map((l) => l.trim()).filter(Boolean); return { label, options: rest, name: '' }; }
          return { label: v, options: [], name: '' };
        });

      const uniqueName = (e: Editor, base: string) => {
        const taken = new Set(listFields(e.view.state.doc).map((f) => f.name));
        let n = base.toLowerCase().replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'field';
        if (!taken.has(n)) return n;
        for (let i = 2; ; i++) if (!taken.has(`${n}_${i}`)) return `${n}_${i}`;
      };
      const insert = (e: Editor, kind: FieldKind, spec: { label?: string; options?: string[]; name?: string; required?: boolean; value?: string }) => {
        const options = (spec.options ?? []).map((o) => clean(o, 100)).filter(Boolean).slice(0, 50);
        if (kind === 'select' && options.length < 1) return false;
        const name = spec.name && NAME.test(spec.name) ? spec.name : uniqueName(e, spec.label || kind);
        const node = e.schema.nodes.form_field.create({ kind, name, label: clean(spec.label, 120), options: JSON.stringify(options), required: !!spec.required, value: cleanValue(kind, spec.value ?? (kind === 'checkbox' ? 'false' : ''), options) });
        e.view.dispatch(e.view.state.tr.replaceSelectionWith(node, false).scrollIntoView());
        return true;
      };
      editor.registerCommand('insertField', (e, kind: FieldKind, spec?: { label?: string; options?: string[]; name?: string; required?: boolean; value?: string }) => {
        if (!KINDS.includes(kind)) return false;
        if (spec) return insert(e, kind, spec);
        void ask(e, kind).then((r) => r && insert(e, kind, r));
        return true;
      });
      editor.registerCommand('setFieldValue', (e, name: string, value: string | boolean) => {
        const f = listFields(e.view.state.doc).find((x) => x.name === name);
        if (!f) return false;
        const node = e.view.state.doc.nodeAt(f.pos)!;
        const v = cleanValue(f.kind, typeof value === 'boolean' ? String(value) : value, parseOptions(node.attrs.options));
        e.view.dispatch(e.view.state.tr.setNodeMarkup(f.pos, undefined, { ...node.attrs, value: v }).setMeta(FIELD_META, true));
        return true;
      }, { readOnlySafe: fillable });
      /** The answers: `{ fieldName: value }` (booleans for checkboxes). */
      editor.extensions.form = {
        getData: () => Object.fromEntries(listFields(editor.view.state.doc).map((f) => [f.name, f.value])),
        /** Names of required fields that are still empty; each is also outlined in the document. */
        validate: () => {
          const missing = listFields(editor.view.state.doc).filter((f) => f.required && f.empty);
          editor.view.dom.querySelectorAll('.wy-field').forEach((el) => el.classList.remove('is-invalid'));
          const fields = [...editor.view.dom.querySelectorAll('.wy-field')];
          const all = listFields(editor.view.state.doc);
          all.forEach((f, i) => { if (f.required && f.empty) fields[i]?.classList.add('is-invalid'); });
          return missing.map((f) => f.name);
        },
        list: () => listFields(editor.view.state.doc),
      };
      return [new Plugin({ props: { nodeViews: { form_field: (node: PMNode, view: EditorView, getPos: () => number | undefined) => new FieldView(node, view, getPos, editor) } } })];
    },
    toolbar: [
      { name: 'fieldCheckbox', label: 'Checkbox', icon: '☑', command: 'insertField', args: ['checkbox'] },
      { name: 'fieldSelect', label: 'Drop-down', icon: '▾', command: 'insertField', args: ['select'] },
      { name: 'fieldDate', label: 'Date field', icon: '📅', command: 'insertField', args: ['date'] },
      { name: 'fieldText', label: 'Text field', icon: '▭', command: 'insertField', args: ['text'] },
    ],
  };
}
