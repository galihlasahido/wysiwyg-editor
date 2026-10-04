import { Comments, TrackChanges, Versions, createEditor, defaultPlugins } from '../src';
import { $, el, codePanel } from './samples';

const now = Date.now();
const H = 3600e3;
const comments = Comments({
  author: 'You',
  initial: [
    { id: 'c1', author: 'Ana Lestari', text: 'Can we cite a source for this claim?', createdAt: now - 5 * H, resolved: false, replies: [{ author: 'Budi Santoso', text: "I'll add the 2024 survey.", createdAt: now - 3 * H }] },
    { id: 'c2', author: 'Citra Dewi', text: 'Nice phrasing here.', createdAt: now - 2 * H, resolved: true, replies: [] },
  ],
});
const versions = Versions({ author: 'You' });
const plain = '<h1>Launch announcement</h1><p>We are happy to announce our new editor.</p>';
versions.store.add({ id: 'v1', label: 'First draft', createdAt: now - 26 * H, author: 'Ana Lestari', html: plain });
versions.store.add({ id: 'v2', label: 'After legal review', createdAt: now - 4 * H, author: 'Budi Santoso', html: plain.replace('happy to announce', 'pleased to announce') });

const t = (h: number) => now - h * H;
const content = `<h1>Launch announcement</h1>
<p>We are pleased to announce our new editor, which is <span data-comment-id="c1">the fastest on the market</span> and works in every browser.</p>
<p>It supports tables, images and <ins data-author="Ana Lestari" data-date="${t(6)}">real-time collaboration, </ins>comments<del data-author="Budi Santoso" data-date="${t(5)}"> and a lot of other stuff</del><ins data-author="Budi Santoso" data-date="${t(5)}"> and a full revision history</ins>.</p>
<p><span data-comment-id="c2">Getting started takes one line of code.</span> Try selecting text and adding a comment, or switch to Suggesting mode and edit.</p>`;

$('#app').append(
  el('div', { class: 'demo-note' }, 'Open the ', el('strong', {}, 'Review'), ' tab: ', el('strong', {}, 'Track Changes'), ' turns on Suggesting mode, Accept/Reject resolve changes, the arrows move between them, and ', el('strong', {}, 'Versions'), ' lists the saved versions.'),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  el('ul', { class: 'tips' }, el('li', {}, 'Green underlined text is a suggested insertion, red strikethrough a suggested deletion.'), el('li', {}, 'Click a highlighted phrase or a comment card to jump between them. Replies and Resolve live on the card.'), el('li', {}, 'Restoring a version is undoable.')),
);

createEditor({ element: $('#editor'), content, plugins: [...defaultPlugins, comments, TrackChanges({ author: 'You' }), versions], ribbon: { initialTab: 'review' } });

$('#app').append(codePanel(`
const comments = Comments({ author: 'You', initial: savedThreads });
createEditor({
  element,
  plugins: [...defaultPlugins, comments, TrackChanges({ author: 'You' }), Versions({ author: 'You' })],
  ribbon: { initialTab: 'review' },
});
editor.execute('acceptAll');       // or rejectAll, nextChange, saveVersion, restoreVersion ...
`));
