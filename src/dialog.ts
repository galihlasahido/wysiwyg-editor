export interface DialogAction { label: string; primary?: boolean; onClick?: () => void }

/**
 * A modal dialog inside the editor root (focus moves in, Escape or the backdrop closes, focus returns to the
 * editor). `body` may be a string (shown as text) or an element.
 */
export function openDialog(root: HTMLElement, options: { title: string; body: string | HTMLElement; actions?: DialogAction[]; onClose?: () => void }): () => void {
  const backdrop = document.createElement('div');
  backdrop.className = 'wy-dialog-backdrop';
  const dlg = document.createElement('div');
  dlg.className = 'wy-dialog';
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
