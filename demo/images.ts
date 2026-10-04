import { createEditor } from '../src';
import { $, button, el, makeImage } from './samples';

const list = el('div', { class: 'status' });
$('#app').append(
  el('div', { class: 'demo-note' }, 'Drag an image file into the editor, paste one, or use ', el('strong', {}, 'Insert → Picture'), '. Uploads go through the ', el('code', {}, 'uploadImage'), ' adapter (here simulated, with progress). Click an image to get the ', el('strong', {}, 'Picture'), ' tab: ', el('strong', {}, 'Crop'), ', width, caption and alt text.'),
  el('div', { class: 'actions', id: 'actions' }),
  el('div', { class: 'panel' }, el('div', { id: 'editor' })),
  el('div', { class: 'panel', style: 'margin-top:12px' }, el('h2', {}, 'Uploads'), list),
);

/** Simulated upload: reads the file and reports progress; resolves to a data URL the editor can store. */
function upload(file: File): Promise<string> {
  const row = el('div', {}, `${file.name} `);
  const bar = el('progress', { max: 100, value: 0 });
  row.append(bar);
  list.append(row);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      let p = 0;
      const t = setInterval(() => {
        bar.value = p += 20;
        if (p >= 100) {
          clearInterval(t);
          row.append(' ✓');
          resolve(reader.result as string);
        }
      }, 120);
    };
    reader.readAsDataURL(file);
  });
}

const editor = createEditor({
  element: $('#editor'),
  ribbon: true,
  uploadImage: upload,
  content: `<h2>Photo essay</h2><p>Click the picture to crop it. <img src="${makeImage(480, 270, 'Sample 1', 200)}" alt="A blue and green gradient grid" width="320" data-caption="A generated sample image"> Resize with the corner handle.</p><p></p>`,
});

$('#actions').append(
  button('Add a generated image', () => editor.execute('image', makeImage(400, 240, `Image ${Math.floor(Math.random() * 90 + 10)}`, Math.floor(Math.random() * 360)))),
  button('Upload from device…', () => editor.execute('uploadImage')),
);
