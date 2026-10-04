import type { EditorPlugin } from '../types';

export interface DocTemplate { id: string; label: string; html: string }

export const DEFAULT_TEMPLATES: DocTemplate[] = [
  { id: 'blank', label: 'Blank', html: '<p></p>' },
  { id: 'meeting', label: 'Meeting notes', html: '<h1>Meeting notes</h1><p><strong>Date:</strong> </p><p><strong>Attendees:</strong> </p><h2>Agenda</h2><ul><li><p></p></ul><h2>Decisions</h2><p></p><h2>Action items</h2><ul data-task-list><li data-task data-checked="false"><p></p></li></ul>' },
  { id: 'proposal', label: 'Project proposal', html: '<h1>Project proposal</h1><div data-toc></div><h2>Background</h2><p></p><h2>Goals</h2><ul><li><p></p></ul><h2>Plan</h2><p></p><h2>Budget</h2><p></p>' },
  { id: 'letter', label: 'Letter', html: '<p style="text-align: right">Date</p><p>Dear Name,</p><p></p><p>Sincerely,</p><p>Your name</p>' },
];

/** Start a document from a template (replaces the content as one undoable step). */
export function Templates(templates: DocTemplate[] = DEFAULT_TEMPLATES): EditorPlugin {
  return {
    name: 'templates',
    setup(editor) {
      editor.registerCommand('applyTemplate', (e, id: string) => {
        const t = templates.find((x) => x.id === id);
        if (!t) return false;
        e.replaceHTML(t.html);
        return true;
      });
    },
    toolbar: [
      {
        type: 'select',
        name: 'template',
        label: 'Template',
        command: 'applyTemplate',
        options: [{ label: 'Template', value: '' }, ...templates.map((t) => ({ label: t.label, value: t.id }))],
        getValue: () => '',
      },
    ],
  };
}
