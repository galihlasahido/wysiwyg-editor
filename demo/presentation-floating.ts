import { createPresentation } from '../src/presentation-app';
import { codePanel } from './samples';
import { productDeck } from './presentation-kit';

const sheet = createPresentation({
  element: document.getElementById('deck')!,
  data: productDeck(),
  menu: 'floating',
  storageKey: 'wy-demo-presentation-floating',
  height: '80vh',
});
(window as unknown as { deck: typeof sheet }).deck = sheet;
document.querySelector('.demo-main')!.append(codePanel(`
import { createPresentation } from 'wysiwygido/presentation';
import 'wysiwygido/style.css';

const deck = createPresentation({
  element,
  menu: 'floating',                       // 'classic' (tabbed ribbon) or 'floating' (rounded card)
  data: { title: 'Product update', theme: 'ocean', slides: [{ layout: 'title', els: [/* … */], notes: '' }] },
  save: (data) => fetch('/api/deck', { method: 'PUT', body: JSON.stringify(data) }),
});
deck.addSlide('titleContent');
deck.present(0);                  // the slide show; present(0, true) opens the presenter view
deck.toHTML();                    // one self-contained page, one slide per printed page
`));
