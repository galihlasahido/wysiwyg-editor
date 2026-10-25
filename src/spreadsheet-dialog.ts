/** A small modal form for the spreadsheet: a few labelled fields, OK and Cancel. No dependencies. */

export type Field =
  | { id: string; label: string; type: 'text'; value?: string; placeholder?: string; maxLength?: number }
  | { id: string; label: string; type: 'number'; value?: string; min?: number; max?: number }
  | { id: string; label: string; type: 'select'; value?: string; options: { label: string; value: string }[] }
  | { id: string; label: string; type: 'checkbox'; value?: boolean };

export interface FormOptions {
  title: string;
  fields: Field[];
  submit?: string;
  /** Return an error message to keep the dialog open, or nothing to accept. */
  validate?: (values: Record<string, string | boolean>) => string | undefined;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let seq = 0;

/** Shows the form inside `root` (which carries the theme); resolves with the values, or null when cancelled. */
export function formDialog(root: HTMLElement, o: FormOptions): Promise<Record<string, string | boolean> | null> {
  return new Promise((resolve) => {
    const back = el('div', 'wy-ss-modal');
    const box = el('form', 'wy-ss-dialog');
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true');
    const id = `wy-ss-dlg-${++seq}`;
    const h = el('h2', 'wy-ss-dialog-title', o.title); h.id = `${id}-t`;
    box.setAttribute('aria-labelledby', h.id);
    box.append(h);
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    for (const f of o.fields) {
      const row = el('label', f.type === 'checkbox' ? 'wy-ss-dialog-row is-check' : 'wy-ss-dialog-row');
      const lab = el('span', 'wy-ss-dialog-label', f.label);
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.type === 'select') {
        const s = el('select'); for (const op of f.options) s.add(new Option(op.label, op.value, false, op.value === f.value)); input = s;
      } else {
        const i = el('input'); i.type = f.type;
        if (f.type === 'checkbox') i.checked = !!f.value;
        else { i.value = f.value ?? ''; if (f.type === 'text') { if (f.placeholder) i.placeholder = f.placeholder; i.maxLength = f.maxLength ?? 200; } else { if (f.min !== undefined) i.min = String(f.min); if (f.max !== undefined) i.max = String(f.max); } }
        input = i;
      }
      input.id = `${id}-${f.id}`; input.name = f.id;
      if (f.type === 'checkbox') row.append(input, lab); else row.append(lab, input);
      box.append(row);
      inputs.set(f.id, input);
    }
    const err = el('div', 'wy-ss-dialog-error'); err.setAttribute('role', 'alert'); err.hidden = true;
    const actions = el('div', 'wy-ss-factions');
    const cancel = el('button', 'wy-ss-fbtn2', 'Cancel'); cancel.type = 'button';
    const ok = el('button', 'wy-ss-fbtn2 is-primary', o.submit ?? 'OK'); ok.type = 'submit';
    actions.append(cancel, ok);
    box.append(err, actions);
    back.append(box);
    root.append(back);
    let done = false;
    const finish = (v: Record<string, string | boolean> | null) => { if (done) return; done = true; document.removeEventListener('keydown', key, true); back.remove(); resolve(v); };
    const values = () => { const out: Record<string, string | boolean> = {}; for (const [k, i] of inputs) out[k] = i instanceof HTMLInputElement && i.type === 'checkbox' ? i.checked : i.value; return out; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); }
      else if (e.key === 'Tab') { // keep the focus inside
        const f = [...box.querySelectorAll<HTMLElement>('input,select,button')].filter((x) => !(x as HTMLInputElement).disabled);
        if (!f.length) return;
        const first = f[0]; const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    box.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = values();
      const msg = o.validate?.(v);
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      finish(v);
    });
    cancel.addEventListener('click', () => finish(null));
    back.addEventListener('mousedown', (e) => { if (e.target === back) finish(null); });
    (box.querySelector('input,select') as HTMLElement | null)?.focus();
  });
}
