/** Where a link may point: http(s), mailto, tel, an in-page anchor or a same-site path. `//host` (protocol-relative) is not allowed. */
const HREF = /^(?:https?:|mailto:|tel:|#|\/(?!\/))/i;
/** Where an image may come from: http(s), a same-site path, or a base64 raster data URL (not SVG). */
const SRC = /^(?:https?:|data:image\/(?:png|jpe?g|gif|webp|bmp|avif);base64,|\/(?!\/))/i;

export const isSafeHref = (u: unknown): u is string => typeof u === 'string' && HREF.test(u);
export const isSafeSrc = (u: unknown): u is string => typeof u === 'string' && SRC.test(u);

/** Make a URL safe to place inside Markdown `(...)`: characters that end or split the destination are percent-encoded. */
export const markdownUrl = (u: string): string => u.replace(/[()\s<>\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
