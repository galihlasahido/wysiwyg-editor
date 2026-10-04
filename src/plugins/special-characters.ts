import type { EditorPlugin } from '../types';

export const SPECIAL_CHARACTERS = [
  '©', '®', '™', '°', '±', '×', '÷', '≠', '≤', '≥', '∞', '√', 'π', 'Ω', 'µ',
  '€', '£', '¥', '¢', '§', '¶', '†', '‡', '•', '…', '–', '—', '«', '»', '“', '”',
  '←', '↑', '→', '↓', '↔', '⇒', '✓', '✗', '★', '☆', '♥', '☺',
];

/** Insert a special character from a dropdown. */
export const SpecialCharacters: EditorPlugin = {
  name: 'special-characters',
  setup(editor) {
    editor.registerCommand('insertText', (e, text: string) => {
      if (!text) return false;
      const { state, dispatch } = e.view;
      dispatch(state.tr.insertText(text).scrollIntoView());
      return true;
    });
  },
  toolbar: [
    {
      type: 'select',
      name: 'specialCharacters',
      label: 'Special characters',
      command: 'insertText',
      options: [{ label: 'Ω', value: '' }, ...SPECIAL_CHARACTERS.map((c) => ({ label: c, value: c }))],
      getValue: () => '',
    },
  ],
};
