import { createEditor, defaultPlugins } from '../src';
import { $, codePanel, el } from './samples';

$('#app').append(
  el('div', { class: 'demo-note' }, 'Each editor has its own interface language and direction (', el('code', {}, "locale: 'ar'"), ' switches the toolbar to Arabic and the layout to right-to-left). Paragraphs can also be set one by one with the direction buttons, for mixed text.'),
  el('div', { class: 'cols' },
    el('div', { class: 'panel' }, el('h2', {}, 'English (LTR)'), el('div', { id: 'en' })),
    el('div', { class: 'panel' }, el('h2', {}, 'العربية (RTL)'), el('div', { id: 'ar' })),
  ),
);
createEditor({ element: $('#en'), plugins: defaultPlugins, content: '<h1>Welcome</h1><p>This document is available in two languages. Edit either side.</p><ul><li><p>Simple to start</p></li><li><p>Easy to extend</p></li></ul><p dir="rtl">مثال: نص عربي داخل فقرة</p>' });
createEditor({ element: $('#ar'), plugins: defaultPlugins, locale: 'ar', content: '<h1 dir="rtl">مرحبًا</h1><p dir="rtl">هذا المستند متاح بلغتين. يمكنك تحرير أي جانب.</p><ul dir="rtl"><li><p dir="rtl">سهل البدء</p></li><li><p dir="rtl">سهل التوسيع</p></li></ul><p dir="ltr">Example: English text inside a paragraph</p>' });
$('#app').append(codePanel(`
createEditor({ element, locale: 'ar' });      // RTL layout + Arabic toolbar
editor.execute('direction', 'rtl');            // one paragraph, for mixed text
`));
