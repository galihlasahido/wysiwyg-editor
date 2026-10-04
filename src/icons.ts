/**
 * Icon set: original 24x24 outline icons in the style of modern office suites (single-weight strokes, with
 * an accent color on the part that carries the meaning). `currentColor` follows the text color; accents use
 * CSS variables so themes can recolor them.
 */
const A = 'var(--ic-accent, #2563eb)';
const G = 'var(--ic-green, #16a34a)';
const R = 'var(--ic-red, #dc2626)';
const Y = 'var(--ic-yellow, #f2b600)';
const O = 'var(--ic-orange, #e8912d)';

const table = (extra = '') =>
  `<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14"/>${extra}`;
const bubble = '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h10A1.5 1.5 0 0 1 17 5.5v7a1.5 1.5 0 0 1-1.5 1.5H10l-4 3.5V14h-.5A1.5 1.5 0 0 1 4 12.5z"/>';
const badge = (fill: string, mark: string) => `<circle cx="18" cy="17" r="4.5" fill="${fill}" stroke="none"/>${mark}`;
const doc = '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>';

export const ICONS: Record<string, string> = {
  // ---- clipboard & history
  undo: '<path d="M9 5 5 9l4 4"/><path d="M5 9h9a5 5 0 0 1 0 10h-3"/>',
  redo: '<path d="m15 5 4 4-4 4"/><path d="M19 9h-9a5 5 0 0 0 0 10h3"/>',
  paste: `<rect x="5" y="5" width="14" height="16" rx="2"/><rect x="9" y="3" width="6" height="4" rx="1" fill="${A}" fill-opacity=".25"/>`,
  cut: '<circle cx="7" cy="17" r="2.5"/><circle cx="17" cy="17" r="2.5"/><path d="M8.5 15 17 4M15.5 15 7 4"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
  formatPainter: `<rect x="4" y="3.5" width="12.5" height="6" rx="1.5"/><path d="M16.5 6.5h2a1.5 1.5 0 0 1 1.5 1.5v2.5a1.5 1.5 0 0 1-1.5 1.5H11v2.5"/><rect x="9" y="14.5" width="4" height="6.5" rx="1" fill="${O}" stroke="${O}"/>`,

  // ---- font
  bold: '<path d="M7 4.5h5.5a3.2 3.2 0 0 1 0 6.5H7zM7 11h6.5a3.2 3.2 0 0 1 0 6.5H7z" stroke-width="1.9"/>',
  italic: '<path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15"/>',
  underline: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20.5h14"/>',
  strike: '<path d="M16.5 7.5C16 5.6 14.3 4.5 12 4.5c-2.5 0-4.2 1.2-4.2 3.2 0 4 8.6 2.3 8.6 6.6 0 2-1.9 3.2-4.4 3.2-2.4 0-4.2-1-4.8-3"/><path d="M4 12h16"/>',
  subscript: '<path d="M4 5l9 11M13 5 4 16"/><path d="M16 17.5a2 2 0 1 1 3.4 1.4L16 21.5h4.2"/>',
  superscript: '<path d="M4 8l9 11M13 8 4 19"/><path d="M16 3.5a2 2 0 1 1 3.4 1.4L16 7.5h4.2"/>',
  fontGrow: '<path d="M3 20 9 5l6 15M5.2 15h7.6"/><path d="M17 8.5 19.5 5.5 22 8.5"/>',
  fontShrink: '<path d="M3 20 9 5l6 15M5.2 15h7.6"/><path d="M17 5.5 19.5 8.5 22 5.5"/>',
  clearFormatting: `<path d="M2.5 19 7 7l4.5 12M4.2 15.5h5.6"/><path d="m13 15.5 5-5.5 3.5 3.5-4 4.5h-4.5z" stroke="${A}"/><path d="M11 21h10"/>`,
  textColor: `<path d="M6 16 12 3l6 13M8.2 11.5h7.6"/><rect x="4" y="19" width="16" height="2.6" rx=".6" fill="${R}" stroke="none"/>`,
  highlight: `<path d="m14 3.5 6 6-8.5 8.5-5 1 1-5z"/><path d="m9 12.5 4 4"/><rect x="3" y="20.4" width="18" height="2.2" rx=".6" fill="${Y}" stroke="none"/>`,
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>',

  // ---- paragraph
  bulletList: '<circle cx="4.5" cy="7" r="1.2" fill="currentColor"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor"/><circle cx="4.5" cy="17" r="1.2" fill="currentColor"/><path d="M9.5 7h11M9.5 12h11M9.5 17h11"/>',
  orderedList: '<path d="M10 7h11M10 12h11M10 17h11"/><path d="M3.5 5.6 5 4.8V9.2"/><path d="M3.3 12.3c.5-.9 2.6-.9 2.6.4 0 .9-2.6 1.7-2.6 3h2.8"/><path d="M3.3 17.2h2.4l-1.3 1.6a1.2 1.2 0 1 1-1.1 1.7" transform="translate(0 -.4)"/>',
  taskList: '<rect x="3.5" y="4" width="5.5" height="5.5" rx="1.2"/><path d="m4.7 6.8 1.3 1.3 2.2-2.6" stroke="var(--ic-accent, #2563eb)"/><path d="M12.5 6.8h8.5"/><rect x="3.5" y="14.5" width="5.5" height="5.5" rx="1.2"/><path d="M12.5 17.3h8.5"/>',
  outdent: '<path d="M11 6h10M11 12h10M11 18h10"/><path d="M7 9l-4 3 4 3z" fill="currentColor"/>',
  indent: '<path d="M11 6h10M11 12h10M11 18h10"/><path d="M3 9l4 3-4 3z" fill="currentColor"/>',
  'direction-ltr': '<path d="M14.5 4H10a3.5 3.5 0 0 0 0 7h4.5M14.5 4v13M10.5 4v7"/><path d="M4 20h13m-2.6-2.6L17 20l-2.6 2.6"/>',
  'direction-rtl': '<path d="M9.5 4H14a3.5 3.5 0 0 1 0 7H9.5M9.5 4v13M13.5 4v7"/><path d="M20 20H7m2.6-2.6L7 20l2.6 2.6"/>',
  'align-left': '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  'align-center': '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  'align-right': '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  'align-justify': '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  lineSpacing: `<path d="M8 5v14M5 8l3-3 3 3M5 16l3 3 3-3" stroke="${A}"/><path d="M14 7h7M14 12h7M14 17h7"/>`,
  spacingBefore: `<path d="M12 4v7M9 7l3-3 3 3" stroke="${A}"/><path d="M5 15h14M5 19h14"/>`,
  spacingAfter: `<path d="M5 5h14M5 9h14"/><path d="M12 13v7M9 17l3 3 3-3" stroke="${A}"/>`,
  indentLeft: '<path d="M3 5h18M11 10h10M11 14h10M3 19h18"/><path d="M3 9.5l4 2.5-4 2.5z" fill="currentColor"/>',
  indentRight: '<path d="M3 5h18M3 10h10M3 14h10M3 19h18"/><path d="M21 9.5 17 12l4 2.5z" fill="currentColor"/>',

  // ---- blocks & insert
  blockQuote: '<path d="M9.5 7C6.5 7 5 9 5 12v5h5v-5H7c0-2 .8-3 2.5-3zM19.5 7c-3 0-4.5 2-4.5 5v5h5v-5h-3c0-2 .8-3 2.5-3z"/>',
  codeBlock: '<path d="M9 4C7 4 6 5 6 7v2c0 1-1 2-2 3 1 1 2 2 2 3v2c0 2 1 3 3 3M15 4c2 0 3 1 3 3v2c0 1 1 2 2 3-1 1-2 2-2 3v2c0 2-1 3-3 3"/>',
  horizontalRule: '<path d="M3 12h18"/><path d="M7 6h10M7 18h10" opacity=".4"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 10 18.7l1-1"/>',
  image: `<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.7" fill="${O}" stroke="none"/><path d="m4 18 5-5 3 3 3-3 5.5 5" stroke="${A}"/>`,
  crop: `<path d="M7 3v14a1 1 0 0 0 1 1h13"/><path d="M3 7h14a1 1 0 0 1 1 1v13" stroke="${A}"/>`,
  cropReset: `<path d="M7 3v14a1 1 0 0 0 1 1h13"/><path d="M3 7h14a1 1 0 0 1 1 1v13" opacity=".4"/><path d="M16 5a6 6 0 0 1 4 4M20 5v4h-4" stroke="${A}"/>`,
  alt: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 15l2.500-6 2.500 6M7.800 13.200h3.400M15 9v6M15 9h2a1.500 1.500 0 0 1 0 3h-2"/>',
  uploadImage: `<path d="M12 15V4m-3.5 3.5L12 4l3.5 3.5" stroke="${A}"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>`,
  imageCaption: '<rect x="3.5" y="4" width="17" height="11" rx="2"/><path d="m4 13 4-4 3 3 3-3 5.5 5"/><path d="M7 19h10"/>',
  insertTable: table(`<path d="M3.5 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3h-17z" fill="${A}" fill-opacity=".28" stroke="none"/>`),
  pageBreak: '<path d="M6 3.5v4.5a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V3.5"/><path d="M3 12h3M9 12h2M13 12h2M18 12h3"/><path d="M6 20.5V16a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v4.5"/>',
  toc: `<rect x="4.5" y="3.5" width="15" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5" /><path d="M8 8h.01M8 12h.01M8 16h.01" stroke="${A}" stroke-width="2.2"/>`,
  updateToc: '<path d="M20 11a8 8 0 0 0-14-4L4 9M4 4v5h5M4 13a8 8 0 0 0 14 4l2-2M20 20v-5h-5"/>',
  removeToc: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  footnote: `<path d="M3 19 8 6l5 13M4.8 15h6.4"/><path d="M15 7.2 17.2 6v6" stroke="${A}"/>`,
  endnote: `${doc}<path d="M9 14h6M9 17.5h4" /><path d="M9 10h2" stroke="${A}"/>`,
  headerFooter: `<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="7.5" y="5.5" width="9" height="3.2" rx=".6" fill="${O}" stroke="none"/><rect x="7.5" y="15.3" width="9" height="3.2" rx=".6" fill="${O}" stroke="none"/>`,
  pageNumber: `<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M10.2 8.5l-1 7M14.2 8.5l-1 7M8.4 10.8h7.2M8 13.2h7.2" stroke="${A}"/>`,
  specialCharacters: '<path d="M5 19h4.5v-1.7C7 16.3 5.5 14 5.5 11.5a6.5 6.5 0 0 1 13 0c0 2.5-1.5 4.8-4 5.8V19H19"/>',
  emoji: '<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10" r=".9" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r=".9" fill="currentColor" stroke="none"/><path d="M8.5 14c1 1.5 2.2 2.2 3.5 2.2s2.5-.7 3.5-2.2"/>',
  mention: '<circle cx="12" cy="12" r="3.4"/><path d="M15.4 12v1.6a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.4 6.8"/>',

  // ---- tables
  addRow: table(`<circle cx="18" cy="18" r="4.4" fill="${G}" stroke="none"/><path d="M18 16v4M16 18h4" stroke="#fff"/>`),
  addColumn: table(`<circle cx="18" cy="18" r="4.4" fill="${G}" stroke="none"/><path d="M18 16v4M16 18h4" stroke="#fff"/>`),
  deleteRow: table(`<circle cx="18" cy="18" r="4.4" fill="${R}" stroke="none"/><path d="M16 18h4" stroke="#fff"/>`),
  deleteColumn: table(`<circle cx="18" cy="18" r="4.4" fill="${R}" stroke="none"/><path d="M16 18h4" stroke="#fff"/>`),
  deleteTable: `<rect x="3.5" y="5" width="17" height="14" rx="2" opacity=".5"/><path d="M7 8l10 8M17 8 7 16" stroke="${R}"/>`,
  mergeCells: `<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M12 5.5v3.5M12 15v3.5"/><path d="M8 12h8m-2.2-2.2L16 12l-2.2 2.2M10.2 9.8 8 12l2.2 2.2" stroke="${A}"/>`,
  splitCell: `<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M12 5.5v13" stroke-dasharray="2 2"/><path d="M9 12H6m1.5-1.5L6 12l1.5 1.5M15 12h3m-1.5-1.5L18 12l-1.5 1.5" stroke="${A}"/>`,
  toggleHeaderRow: table(`<path d="M3.5 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v3.2h-17z" fill="${A}" fill-opacity=".4" stroke="none"/>`),
  cellColor: `<path d="m5 11 6.5-6.5 6.5 6.5-6 6a2 2 0 0 1-2.8 0z"/><path d="m5 11h13"/><path d="M19.5 14.5s2 2.2 2 3.5a2 2 0 0 1-4 0c0-1.3 2-3.500 2-3.500z" fill="${A}" stroke="none"/><rect x="3" y="20.5" width="14" height="2" rx=".6" fill="${Y}" stroke="none"/>`,

  // ---- editing
  find: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>',
  replace: `<path d="M4 8h12l-3-3M20 16H8l3 3" /><circle cx="18" cy="8" r="2" stroke="${A}"/>`,
  selectAll: '<path d="M6 3.5l12 8-5.5 1.5L10 18.5z"/>',

  // ---- layout
  margins: `<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 3v18M16 3v18M5 7h14M5 17h14" stroke="${A}" stroke-dasharray="1.6 1.6"/>`,
  orientation: `<rect x="4" y="3.5" width="10.5" height="14.5" rx="1.5"/><path d="M14 20.5h3.5a2.5 2.5 0 0 0 2.5-2.5v-3m-2.6 2.2L20 14.700l2.600 2.500" stroke="${A}"/>`,
  size: `<rect x="7" y="4" width="11" height="16" rx="1.5"/><path d="M4 4v16M2.5 5.5 4 4l1.5 1.500M2.5 18.500 4 20l1.500-1.500" stroke="${A}"/>`,
  pageColor: `<path d="m5.5 11 6.500-6.500 6.500 6.500-6 6a2 2 0 0 1-2.800 0z"/><path d="M20.200 13.500s1.800 2 1.800 3.200a1.800 1.800 0 0 1-3.600 0c0-1.200 1.800-3.200 1.800-3.200z" fill="${A}" stroke="none"/><path d="M5 11h13"/>`,

  // ---- review
  comment: `${bubble}<circle cx="18" cy="6.500" r="4" fill="${G}" stroke="none"/><path d="M18 4.500v4M16 6.500h4" stroke="#fff"/>`,
  commentPrev: `${bubble}${badge(A, '<path d="M19.500 17h-4m1.500-1.500L15.500 17 17 18.500" stroke="#fff"/>')}`,
  commentNext: `${bubble}${badge(A, '<path d="M15.500 17h4m-1.500-1.500L19.500 17 18 18.500" stroke="#fff"/>')}`,
  commentDelete: `${bubble}${badge(R, '<path d="m16 15 4 4M20 15l-4 4" stroke="#fff"/>')}`,
  showComments: bubble + '<path d="M8 8h5M8 11h3" opacity=".6"/>',
  trackChanges: `<path d="M14.500 5 19 9.500 9.500 19H5v-4.500z"/><path d="m12.500 7 4.500 4.500" /><path d="M13 20.500h8" stroke="${A}"/>`,
  acceptChange: `${doc}${badge(G, '<path d="m15.600 17 1.500 1.500 2.800-3" stroke="#fff"/>')}`,
  rejectChange: `${doc}${badge(R, '<path d="m16 15 4 4M20 15l-4 4" stroke="#fff"/>')}`,
  prevChange: `${doc}${badge(A, '<path d="M19.500 17h-4m1.500-1.500L15.500 17 17 18.500" stroke="#fff"/>')}`,
  nextChange: `${doc}${badge(A, '<path d="M15.500 17h4m-1.500-1.500L19.500 17 18 18.500" stroke="#fff"/>')}`,
  acceptAll: `<path d="M5 3.5h7l3.500 3.500V13" /><path d="M5 3.500V17h6"/><circle cx="16.500" cy="17" r="5" fill="${G}" stroke="none"/><path d="m14 17 2 2 3.500-3.800" stroke="#fff"/>`,
  rejectAll: `<path d="M5 3.5h7l3.500 3.500V13" /><path d="M5 3.500V17h6"/><circle cx="16.500" cy="17" r="5" fill="${R}" stroke="none"/><path d="m14.200 14.700 4.600 4.600M18.800 14.700l-4.600 4.600" stroke="#fff"/>`,
  spellcheck: `<path d="M3.500 14 7 4.500 10.500 14M4.700 11.200h4.600"/><path d="m12.500 15.500 3.200 3.200 6-7.200" stroke="${G}"/>`,
  wordCount: '<path d="M4 5.5h16M4 9.5h16M4 13.5h6"/><text x="17" y="19.5" text-anchor="middle" font-size="7.5" font-weight="700" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">123</text>',
  translate: `<path d="M3 6h9M7.500 4v2M5 6c.5 3 2.500 5.500 6 7M10.500 6c-.5 3-3 6-7 8"/><path d="m13 20.500 4-10 4 10M14.500 17h5" stroke="${A}"/>`,
  versions: '<path d="M4 12a8 8 0 1 0 2.500-5.800L4 8.500M4 4v4.500h4.500"/><path d="M12 8v4l3 2"/>',
  ai: `<path d="M11 3.500l1.800 5.200 5.200 1.800-5.200 1.800L11 17.500l-1.800-5.200L4 10.500l5.200-1.800z" stroke="${A}"/><path d="M18.500 15l.8 2.200 2.200.8-2.200.8-.8 2.200-.8-2.200-2.200-.8 2.200-.8z" stroke="${A}"/>`,
  template: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M4 9h16M10 9v11.500"/>',
  accessibility: `<circle cx="12" cy="5.500" r="1.800"/><path d="M5 9l7 1.500L19 9M12 10.500V15m0 0-2.500 5M12 15l2.500 5"/>`,

  // ---- view
  pages: `${doc}<path d="M9 13h6M9 16.500h4" opacity=".5"/>`,
  readView: '<path d="M12 6C10 4.500 7 4 4 4.500v13c3-.5 6 0 8 1.500 2-1.500 5-2 8-1.500v-13C17 4 14 4.500 12 6zM12 6v13"/>',
  zoom: '<circle cx="10.500" cy="10.500" r="6"/><path d="m15 15 5.500 5.500M8 10.500h5M10.500 8v5"/>',
  zoom100: `<rect x="3" y="6" width="18" height="12" rx="2" stroke="${A}"/><text x="12" y="14.8" text-anchor="middle" font-size="7.5" font-weight="700" font-family="system-ui, sans-serif" fill="currentColor" stroke="none">100</text>`,
  ruler: `<rect x="3" y="8" width="18" height="8" rx="1.500"/><path d="M7 8v3.500M10.500 8v2M14 8v3.500M17.500 8v2"/>`,
  navigation: `<rect x="3.500" y="4.500" width="17" height="15" rx="2"/><path d="M9.500 4.500v15"/><rect x="4" y="5" width="5" height="14" fill="${A}" fill-opacity=".3" stroke="none"/>`,
  showHeaderFooter: `<rect x="5" y="3" width="14" height="18" rx="2"/><rect x="7.500" y="5.500" width="9" height="3.200" rx=".6" fill="${O}" stroke="none"/><rect x="7.500" y="15.300" width="9" height="3.200" rx=".6" fill="${O}" stroke="none"/>`,
  showFootnotes: `<path d="M3 19 8 6l5 13M4.800 15h6.400"/><path d="M15 7.200 17.200 6v6" stroke="${A}"/>`,
  darkMode: '<circle cx="12" cy="12" r="8.500"/><path d="M12 3.500a8.500 8.500 0 0 1 0 17z" fill="currentColor"/>',
  lightMode: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M5.600 18.400 7 17M17 7l1.400-1.400"/>',
  switchBackground: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600 7 7M17 17l1.400 1.400M5.600 18.400 7 17M17 7l1.400-1.400"/>',
  print: '<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="2"/><path d="M7 14h10v6H7z"/>',

  // ---- restricted editing
  lock: `<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/>`,
  unlock: `<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 7.6-1.7" stroke="${A}"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/>`,
  editRegion: `<rect x="3.5" y="5" width="17" height="14" rx="2" stroke-dasharray="2.5 2" stroke="${A}"/><path d="m9 15 .6-2.6 5.2-5.2a1.4 1.4 0 0 1 2 2L11.600 14.400z"/>`,
  authorMode: `<path d="M5 20v-3.5L16.500 5a2 2 0 0 1 3 3L8 19.500z"/><path d="m14.500 7 3 3" /><path d="M5 20h6" stroke="${A}"/>`,

  // ---- file / misc
  newDocument: `${doc}<path d="M12 11v6M9 14h6" stroke="${A}"/>`,
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  export: '<path d="M12 3.500v11m-4-4 4 4 4-4"/><path d="M5 16.500v3.500h14v-3.500"/>',
  openFile: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  keyboard: '<rect x="3" y="6.500" width="18" height="11" rx="2"/><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7.500 14h9"/>',
  help: '<circle cx="12" cy="12" r="8.500"/><path d="M9.500 9.500a2.500 2.500 0 0 1 5 .5c0 1.500-2.500 2-2.500 3.500M12 16.800v.01"/>',
  chevron: '<path d="m6.500 9.500 5.500 5.500 5.500-5.500"/>',
  check: '<path d="m5 12.500 4.500 4.500L19 7.500"/>',
};

// Aliases: several commands share an icon.
ICONS.insertImage = ICONS.image;
ICONS.lockBlocks = ICONS.lock;
ICONS.unlockBlocks = ICONS.unlock;
ICONS.editableRegion = ICONS.editRegion;
ICONS.removeEditableRegion = ICONS.editRegion;
ICONS.cropImage = ICONS.crop;
ICONS.imageAlt = ICONS.alt;
ICONS.toggleTracking = ICONS.trackChanges;

export function hasIcon(name: string): boolean {
  return name in ICONS;
}

/** Inline SVG for `name` (empty string if unknown). Size is in CSS px. */
export function icon(name: string, size = 20): string {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="wy-ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}
