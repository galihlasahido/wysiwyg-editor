/**
 * Picture styles: ready-made looks for an image (frames, shadows, rounded and oval shapes, soft edges, reflections, perspective), like the
 * gallery in Word. A style is stored on the image as its id only; the CSS comes from this fixed table (never from the document), so a
 * document cannot inject styles, and the look is written inline so it also shows in exported HTML.
 */
export interface PictureStyle {
  id: string;
  label: string;
  /** Declarations for the image's `style` attribute. */
  css: string;
}

const REFLECT = '-webkit-box-reflect:below 1px linear-gradient(transparent 66%,rgba(255,255,255,.5));margin-bottom:.9em';
const FEATHER_X = 'linear-gradient(to right,transparent,#000 12%,#000 88%,transparent)';
const FEATHER_Y = 'linear-gradient(to bottom,transparent,#000 12%,#000 88%,transparent)';
const SOFT_RECT = `-webkit-mask-image:${FEATHER_X},${FEATHER_Y};-webkit-mask-composite:source-in;mask-image:${FEATHER_X},${FEATHER_Y};mask-composite:intersect`;
const SOFT_OVAL = '-webkit-mask-image:radial-gradient(ellipse closest-side,#000 60%,transparent 100%);mask-image:radial-gradient(ellipse closest-side,#000 60%,transparent 100%)';
const LINE = '0 0 0 1px #b8b8b8';
const METAL = '0 0 0 1px #7d7d7d,inset 0 0 0 1px #fff';
const SNIP = 'clip-path:polygon(0 0,calc(100% - 20px) 0,100% 20px,100% 100%,20px 100%,0 calc(100% - 20px))';

/** In the order of the gallery (five to a row). */
export const PICTURE_STYLES: PictureStyle[] = [
  { id: 'frame-white', label: 'Simple frame, white', css: `border:6px solid #fff;box-shadow:${LINE}` },
  { id: 'frame-white-soft', label: 'Frame with soft shadow', css: `border:6px solid #fff;box-shadow:${LINE},3px 4px 8px rgba(0,0,0,.3)` },
  { id: 'metal-frame', label: 'Metal frame', css: `border:8px solid #dcdcdc;box-shadow:${METAL}` },
  { id: 'drop-shadow', label: 'Offset shadow', css: 'box-shadow:6px 6px 0 #bdbdbd' },
  { id: 'reflected-rounded', label: 'Reflected rounded rectangle', css: `border-radius:12px;${REFLECT}` },

  { id: 'soft-edge', label: 'Soft edge rectangle', css: SOFT_RECT },
  { id: 'double-frame-thick', label: 'Double frame, black', css: 'border:9px double #000' },
  { id: 'thick-black-shadow', label: 'Thick black frame, shadow', css: 'border:9px solid #000;box-shadow:5px 5px 0 #000' },
  { id: 'frame-black', label: 'Simple frame, black', css: 'border:2px solid #000;box-shadow:4px 4px 0 rgba(0,0,0,.3)' },
  { id: 'oval-black', label: 'Oval, black outline', css: 'border:3px solid #000;border-radius:50%;box-shadow:0 14px 8px -9px rgba(0,0,0,.4)' },

  { id: 'double-frame', label: 'Double frame', css: 'border:6px double #000;background:#fff' },
  { id: 'thick-black', label: 'Thick black frame', css: 'border:8px solid #000' },
  { id: 'bevel-matte', label: 'Beveled matte', css: 'border:9px solid #d6d6d6;box-shadow:0 0 0 1px #a5a5a5,inset 0 0 7px rgba(0,0,0,.4)' },
  { id: 'rounded-diagonal', label: 'Rounded diagonal corners', css: `border:5px solid #fff;border-radius:16px 0 16px 0;box-shadow:${LINE}` },
  { id: 'snip-diagonal', label: 'Snipped diagonal corners', css: `border:5px solid #fff;background:#fff;${SNIP}` },

  { id: 'moderate-frame', label: 'Moderate frame, white', css: 'border:6px solid #fff;box-shadow:2px 3px 7px rgba(0,0,0,.45)' },
  { id: 'rotated-white', label: 'Rotated, white', css: 'border:7px solid #fff;box-shadow:2px 3px 7px rgba(0,0,0,.45);transform:rotate(-5deg)' },
  { id: 'shadow-frame', label: 'Frame with shadow', css: `border:5px solid #fff;box-shadow:${LINE},5px 6px 7px rgba(0,0,0,.35)` },
  { id: 'relaxed-perspective', label: 'Relaxed perspective', css: `border:4px solid #fff;box-shadow:${LINE},5px 6px 8px rgba(0,0,0,.3);transform:perspective(520px) rotateY(14deg)` },
  { id: 'soft-oval', label: 'Soft edge oval', css: `border-radius:50%;${SOFT_OVAL}` },

  { id: 'rounded', label: 'Rounded rectangle', css: 'border-radius:14px' },
  { id: 'perspective-tilt', label: 'Perspective, tilted', css: 'border-radius:10px;box-shadow:4px 7px 9px rgba(0,0,0,.4);transform:perspective(520px) rotateX(12deg) rotate(-4deg)' },
  { id: 'perspective-right', label: 'Perspective right, reflected', css: `border:3px solid #fff;box-shadow:${LINE};transform:perspective(520px) rotateY(-16deg);${REFLECT}` },
  { id: 'perspective-left', label: 'Perspective left', css: `border:3px solid #fff;box-shadow:${LINE},4px 5px 7px rgba(0,0,0,.3);transform:perspective(520px) rotateY(16deg)` },
  { id: 'reflected-black', label: 'Reflected, black frame', css: `border:3px solid #000;border-radius:8px;${REFLECT}` },

  { id: 'reflected-white', label: 'Reflected, white frame', css: `border:6px solid #fff;box-shadow:${LINE};${REFLECT}` },
  { id: 'metal-rounded', label: 'Metal rounded rectangle', css: `border:8px solid #dcdcdc;border-radius:14px;box-shadow:${METAL}` },
  { id: 'metal-oval', label: 'Metal oval', css: `border:8px solid #dcdcdc;border-radius:50%;box-shadow:${METAL}` },
];

const byId = new Map(PICTURE_STYLES.map((s) => [s.id, s]));

/** The id if it names a known style, else null (a document can say anything; only the table is trusted). */
export const pictureStyleId = (value: unknown): string | null => (typeof value === 'string' && byId.has(value) ? value : null);

/** The declarations for a style id, or an empty string. */
export const pictureStyleCss = (id: unknown): string => byId.get(String(id))?.css ?? '';
