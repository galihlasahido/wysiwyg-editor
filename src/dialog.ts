export interface DialogAction { label: string; primary?: boolean; onClick?: () => void }

/**
 * A modal dialog inside the editor root (focus moves in, Escape or the backdrop closes, focus returns to the
 * editor). `body` may be a string (shown as text) or an element.
 */
export function openDialog(root: HTMLElement, options: { title: string; body: string | HTMLElement; actions?: DialogAction[]; onClose?: () => void; /** A large dialog that covers the screen (for content you read, such as a comparison). */ wide?: boolean }): () => void {
  const backdrop = document.createElement('div');
  backdrop.className = options.wide ? 'wy-dialog-backdrop wy-ask-backdrop' : 'wy-dialog-backdrop';
  const dlg = document.createElement('div');
  dlg.className = options.wide ? 'wy-dialog wy-dialog-wide' : 'wy-dialog';
  dlg.setAttribute('role', 'dialog');
  dlg.setAttribute('aria-modal', 'true');
  const h = document.createElement('h2');
  h.textContent = options.title;
  h.id = `wy-dlg-${Math.random().toString(36).slice(2, 8)}`;
  dlg.setAttribute('aria-labelledby', h.id);
  const body = document.createElement('div');
  if (typeof options.body === 'string') body.textContent = options.body;
  else body.append(options.body);
  const bar = document.createElement('div');
  bar.className = 'wy-dialog-actions';
  const previous = document.activeElement as HTMLElement | null;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    previous?.focus?.();
    options.onClose?.();
  };
  for (const a of options.actions ?? [{ label: 'Close', primary: true }]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'wy-btn';
    b.textContent = a.label;
    if (a.primary) b.style.fontWeight = '600';
    b.addEventListener('click', () => (a.onClick?.(), close()));
    bar.append(b);
  }
  dlg.append(h, body, bar);
  backdrop.append(dlg);
  backdrop.addEventListener('mousedown', (e) => e.target === backdrop && close());
  backdrop.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') (e.stopPropagation(), close());
    if (e.key === 'Tab') {
      // keep focus inside the dialog
      const f = [...dlg.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]')].filter((x) => !x.hasAttribute('disabled'));
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
      else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
    }
  });
  root.append(backdrop);
  (bar.querySelector<HTMLElement>('button.wy-btn') ?? dlg).focus();
  return close;
}

export interface AskOptions {
  title: string;
  /** Label above the field. */
  label?: string;
  /** Short explanation under the title. */
  description?: string;
  /** Text this is about (the selected text a comment attaches to). Shown as a quote, as plain text. */
  quote?: string;
  /** Anything else worth showing above the field, such as the thread being replied to. */
  context?: HTMLElement;
  /** Who is writing: shows a coloured initial next to the field. */
  author?: string;
  value?: string;
  placeholder?: string;
  /** A multi-line box (Enter adds a line, Ctrl/Cmd+Enter sends) instead of a one-line field (Enter sends). */
  multiline?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  /** An empty answer is not accepted. Default true. */
  required?: boolean;
  maxLength?: number;
  /** Return an error message to refuse the value. */
  validate?: (value: string) => string | null;
  /** Show a live preview under the field. Called when the dialog opens and (debounced) after each change. */
  preview?: (value: string, host: HTMLElement) => void | Promise<void>;
  /** Buttons that insert a piece of text at the cursor (formula templates, diagram starters). */
  snippets?: { label: string; value: string; title?: string; /** Replace the whole text instead of inserting at the cursor (a starter template). */ replace?: boolean }[];
  /** Fixed-width font, for code and formulas. */
  monospace?: boolean;
  /** Visible lines of a multi-line field. Default 3. */
  rows?: number;
  /** Wider dialog, for editors with a preview. */
  wide?: boolean;
}

/** A stable colour for a name, so the same person always gets the same avatar. */
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 42%)`;
}

export function avatar(name: string, size = 28): HTMLElement {
  const a = document.createElement('span');
  a.className = 'wy-avatar';
  a.textContent = (name.trim()[0] ?? '?').toUpperCase();
  a.style.background = avatarColor(name);
  a.style.width = a.style.height = `${size}px`;
  a.style.fontSize = `${Math.round(size * 0.46)}px`;
  a.title = name;
  a.setAttribute('aria-hidden', 'true');
  return a;
}

/**
 * Ask for a line or a paragraph of text in a proper modal (instead of `window.prompt`). Resolves with the trimmed
 * text, or null when cancelled. Focus moves into the field, Tab stays inside, Escape or Cancel closes, and focus returns to
 * where it was. A click on the backdrop only cancels while nothing has been typed, so a stray click cannot lose a draft.
 */
export function askDialog(root: HTMLElement, o: AskOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2, 8);
    const required = o.required !== false;
    const backdrop = document.createElement('div');
    backdrop.className = 'wy-ask-backdrop';
    const dlg = document.createElement('form');
    dlg.className = `wy-dialog wy-ask${o.wide ? ' is-wide' : ''}`;
    dlg.setAttribute('role', 'dialog');
    dlg.setAttribute('aria-modal', 'true');
    dlg.setAttribute('aria-labelledby', `wy-ask-t-${id}`);
    dlg.noValidate = true;

    const head = document.createElement('div');
    head.className = 'wy-ask-head';
    const h = document.createElement('h2');
    h.id = `wy-ask-t-${id}`;
    h.textContent = o.title;
    head.append(h);
    dlg.append(head);
    if (o.description) {
      const p = document.createElement('p');
      p.className = 'wy-ask-desc';
      p.textContent = o.description;
      dlg.append(p);
    }
    if (o.quote?.trim()) {
      const q = document.createElement('blockquote');
      q.className = 'wy-ask-quote';
      q.textContent = o.quote.length > 240 ? `${o.quote.slice(0, 240)}…` : o.quote;
      dlg.append(q);
    }
    if (o.context) dlg.append(o.context);

    const row = document.createElement('div');
    row.className = 'wy-ask-row';
    if (o.author) row.append(avatar(o.author, 32));
    const field = document.createElement('div');
    field.className = 'wy-ask-field';
    if (o.label) {
      const l = document.createElement('label');
      l.htmlFor = `wy-ask-f-${id}`;
      l.textContent = o.label;
      field.append(l);
    }
    const input = o.multiline ? document.createElement('textarea') : document.createElement('input');
    input.id = `wy-ask-f-${id}`;
    input.className = 'wy-ask-input';
    if (input instanceof HTMLTextAreaElement) input.rows = o.rows ?? 3;
    else input.type = 'text';
    if (o.monospace) input.classList.add('is-mono');
    input.value = o.value ?? '';
    if (o.placeholder) input.placeholder = o.placeholder;
    if (o.maxLength) input.maxLength = o.maxLength;
    const error = document.createElement('div');
    error.className = 'wy-ask-error';
    error.id = `wy-ask-e-${id}`;
    error.setAttribute('role', 'alert');
    input.setAttribute('aria-describedby', error.id);
    if (o.snippets?.length) {
      const bar = document.createElement('div');
      bar.className = 'wy-ask-snippets';
      for (const sn of o.snippets) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wy-btn';
        b.textContent = sn.label;
        if (sn.title) b.title = sn.title;
        b.addEventListener('click', () => {
          const s = sn.replace ? 0 : input.selectionStart ?? input.value.length;
          const e = sn.replace ? input.value.length : input.selectionEnd ?? s;
          input.setRangeText(sn.value, s, e, 'end');
          input.focus();
          input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        bar.append(b);
      }
      field.append(bar);
    }
    field.append(input, error);
    row.append(field);
    dlg.append(row);
    let previewHost: HTMLElement | null = null;
    if (o.preview) {
      previewHost = document.createElement('div');
      previewHost.className = 'wy-ask-preview';
      previewHost.setAttribute('aria-live', 'polite');
      previewHost.setAttribute('aria-label', 'Preview');
      dlg.append(previewHost);
    }

    const bar = document.createElement('div');
    bar.className = 'wy-ask-actions';
    const hint = document.createElement('span');
    hint.className = 'wy-ask-hint';
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
    hint.textContent = o.multiline ? `${mac ? '⌘' : 'Ctrl'}+Enter to send` : 'Enter to confirm';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'wy-btn';
    cancel.textContent = o.cancelLabel ?? 'Cancel';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'wy-btn wy-btn-primary';
    submit.textContent = o.submitLabel ?? 'OK';
    bar.append(hint, cancel, submit);
    dlg.append(bar);
    backdrop.append(dlg);

    const previous = document.activeElement as HTMLElement | null;
    let done = false;
    const finish = (value: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(previewTimer);
      backdrop.remove();
      previous?.focus?.();
      resolve(value);
    };
    const problem = (v: string): string | null => (required && !v ? 'Write something first.' : o.validate?.(v) ?? null);
    let previewTimer: ReturnType<typeof setTimeout> | undefined;
    const showPreview = () => { if (previewHost && o.preview) void Promise.resolve(o.preview(input.value, previewHost)).catch(() => {}); };
    const refresh = () => {
      const v = input.value.trim();
      submit.disabled = required && !v;
      if (error.textContent) error.textContent = '';
      if (previewHost) { clearTimeout(previewTimer); previewTimer = setTimeout(showPreview, 150); }
    };
    input.addEventListener('input', refresh);
    dlg.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      const msg = problem(v);
      if (msg) {
        error.textContent = msg;
        input.focus();
        return;
      }
      finish(v);
    });
    cancel.addEventListener('click', () => finish(null));
    backdrop.addEventListener('mousedown', (e) => e.target === backdrop && !input.value.trim() && finish(null));
    backdrop.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); return; }
      if (e.key === 'Enter' && o.multiline && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dlg.requestSubmit(); return; }
      if (e.key === 'Tab') {
        const f = [...dlg.querySelectorAll<HTMLElement>('button, input, textarea, select')].filter((x) => !(x as HTMLButtonElement).disabled);
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // keys typed in the dialog must not reach the editor underneath
    for (const t of ['keypress', 'keyup', 'beforeinput', 'paste', 'cut', 'copy']) backdrop.addEventListener(t, (e) => e.stopPropagation());
    root.append(backdrop);
    refresh();
    showPreview();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    // `editor.execute` hands focus back to the editor right after the command returns: take it again once that has happened.
    const reclaim = () => { if (!done && !dlg.contains(document.activeElement)) input.focus(); };
    queueMicrotask(reclaim);
    setTimeout(reclaim, 0);
  });
}
