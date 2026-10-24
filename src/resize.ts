/**
 * Call `fn` when the size of `el` changes, once per frame. A ResizeObserver whose callback changes the layout it watches makes
 * browsers report "ResizeObserver loop completed with undelivered notifications"; running the callback in the next frame avoids it.
 */
export function observeSize(el: Element, fn: () => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  let frame = 0;
  const ro = new ResizeObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; fn(); });
  });
  ro.observe(el);
  return () => { ro.disconnect(); if (frame) cancelAnimationFrame(frame); };
}
