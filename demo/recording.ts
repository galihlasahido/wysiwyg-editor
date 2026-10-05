import { Recording, createEditor, defaultPlugins } from '../src';
import { $, codePanel, el } from './samples';

$('#app').append(
  el('div', { class: 'demo-note' }, el('strong', {}, '🎙'), ' records audio, ', el('strong', {}, '🖥'), ' records your screen, ', el('strong', {}, '🗣'), ' types what you say (Chrome, Edge and Safari have speech recognition; Firefox does not). Press Esc while recording to throw it away. Recordings are embedded here; in a real app pass ', el('code', {}, 'upload'), ' to store them on your server.'),
  el('div', { class: 'status', id: 'status', 'aria-live': 'polite' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
);
const editor = createEditor({ element: $('#editor'), content: '<h1>Meeting notes</h1><p>Press 🗣 and speak, or 🎙 to attach a voice note.</p><p></p>', plugins: [...defaultPlugins, Recording({ maxSeconds: 120 })] });
(window as unknown as { editor: typeof editor }).editor = editor;
editor.on('recording-status', (e) => { $('#status').textContent = (e as { message: string }).message; });
$('#app').append(codePanel(`
plugins: [...defaultPlugins, Recording({
  maxSeconds: 300,
  upload: async (blob, kind) => (await fetch('/api/media', { method: 'POST', body: blob }).then((r) => r.json())).url,
  dictationLang: 'id-ID',
})],
editor.execute('recordAudio'); editor.execute('recordScreen'); editor.execute('stopRecording'); editor.execute('toggleDictation');
`));
