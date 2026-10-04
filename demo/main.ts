import { createEditor } from '../src';

const para = '<p>Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</p>';
const content =
  '<h1>Project proposal</h1>' + para.repeat(3) +
  '<h2>Background</h2>' + para.repeat(6) +
  '<h2>Plan</h2><ul data-task-list><li data-task data-checked="true"><p>Research</p></li><li data-task data-checked="false"><p>Build</p></li></ul>' + para.repeat(8) +
  '<h2>Conclusion</h2>' + para.repeat(4);

const editor = createEditor({
  element: document.getElementById('editor')!,
  content,
  pages: { header: 'Project proposal', footer: 'Page {page} of {pages}', height: '80vh' },
  outline: true,
});
(window as any).editor = editor;
