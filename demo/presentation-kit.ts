import { addEls, addSlide, newDeck, newImageEl, newShapeEl, newTextEl, textToHTML, updateEls, updateSlide, type Deck, type SlideEl } from '../src/presentation-model';

const svg = (inner: string) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">${inner}</svg>`)}`;
const chart = svg('<rect width="400" height="300" fill="#f8fafc"/><g fill="#2563eb"><rect x="40" y="170" width="50" height="100"/><rect x="120" y="120" width="50" height="150"/><rect x="200" y="80" width="50" height="190"/><rect x="280" y="30" width="50" height="240"/></g><path d="M20 280H380" stroke="#64748b" stroke-width="3"/>');

const byPh = (d: Deck, sid: string, ph: string): SlideEl => d.slides.find((s) => s.id === sid)!.els.find((e) => e.ph === ph)!;
const fill = (d: Deck, sid: string, ph: string, html: string): Deck => updateEls(d, sid, [byPh(d, sid, ph).id], { html });
const lines = (...l: string[]) => textToHTML(l.join('\n'));

/** A short deck that shows what the app does: a title, bullets, two columns with a shape and a picture, a section and a close. */
export function productDeck(): Deck {
  let d = newDeck('Product update');
  const s1 = d.slides[0].id;
  d = fill(d, s1, 'title', 'Product update');
  d = fill(d, s1, 'subtitle', 'Q4 review · what shipped, what is next');
  d = updateSlide(d, s1, { notes: 'Welcome everyone. Keep this to 20 minutes.' });

  let r = addSlide(d, 1, 'titleContent'); d = r.deck; const s2 = r.slide.id;
  d = fill(d, s2, 'title', 'What shipped');
  d = fill(d, s2, 'body', lines('Spreadsheet app with formulas and filters', 'Presentation app with themes and transitions', 'Floating menu for every editor', 'Faster tables: 100,000 rows'));
  d = updateSlide(d, s2, { transition: 'fade', notes: 'Demo the spreadsheet if time allows.' });

  r = addSlide(d, 2, 'twoContent'); d = r.deck; const s3 = r.slide.id;
  d = fill(d, s3, 'title', 'Growth');
  d = fill(d, s3, 'body', lines('Weekly users up 38%', 'Documents created: 1.2M', 'Support tickets down 21%'));
  const pic = newImageEl(d, chart, { w: 400, h: 300 }, 'Bar chart: growth by quarter');
  const body2 = byPh(d, s3, 'body2');
  d = updateEls(d, s3, [body2.id], { html: '' });
  d = { ...d, slides: d.slides.map((s) => (s.id === s3 ? { ...s, els: s.els.filter((e) => e.id !== body2.id) } : s)) };
  d = addEls(d, s3, [{ ...pic, x: 700, y: 180, w: 480, h: 360 }]);
  d = updateSlide(d, s3, { transition: 'slide' });

  r = addSlide(d, 3, 'section'); d = r.deck; const s4 = r.slide.id;
  d = fill(d, s4, 'title', 'What is next');
  d = fill(d, s4, 'subtitle', 'Three bets for the new year');
  d = updateSlide(d, s4, { transition: 'zoom' });

  r = addSlide(d, 4, 'titleOnly'); d = r.deck; const s5 = r.slide.id;
  d = fill(d, s5, 'title', 'Roadmap');
  const mk = (label: string, x: number, color: string): SlideEl => ({ ...newShapeEl(d, 'chevron'), x, y: 250, w: 340, h: 150, fill: color, html: textToHTML(label), style: { size: 30, b: 1, color: '#ffffff', align: 'center', valign: 'middle' } });
  d = addEls(d, s5, [mk('Q1 · Charts', 80, '#2563eb'), mk('Q2 · Tables', 440, '#7c3aed'), mk('Q3 · Collaboration', 800, '#db2777')]);
  const note = { ...newTextEl(d, 'Dates are estimates and may move.'), x: 80, y: 480, w: 1000, h: 60, style: { size: 22, i: 1 as const, color: '#6b7280' } };
  d = addEls(d, s5, [note]);
  d = updateSlide(d, s5, { transition: 'fade' });

  r = addSlide(d, 5, 'title'); d = r.deck; const s6 = r.slide.id;
  d = fill(d, s6, 'title', 'Thank you');
  d = fill(d, s6, 'subtitle', 'Questions?');
  return { ...d, theme: 'ocean' };
}
