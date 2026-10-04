import { InputRule, inputRules, textblockTypeInputRule, wrappingInputRule } from 'prosemirror-inputrules';
import type { MarkType } from 'prosemirror-model';
import type { EditorPlugin } from '../types';

function markRule(re: RegExp, type: MarkType) {
  return new InputRule(re, (state, match, start, end) => {
    const text = match[1];
    return state.tr
      .insertText(text, start, end)
      .addMark(start, start + text.length, type.create())
      .removeStoredMark(type);
  });
}

/** Markdown-style shortcuts: `# `, `- `, `1. `, `> `, ``` , `**bold**`, `_italic_`, `` `code` ``. */
export const Autoformat: EditorPlugin = {
  name: 'autoformat',
  setup(editor) {
    const { nodes, marks } = editor.schema;
    const rules: InputRule[] = [];
    if (nodes.heading) rules.push(textblockTypeInputRule(/^(#{1,4})\s$/, nodes.heading, (m) => ({ level: m[1].length })));
    if (nodes.blockquote) rules.push(wrappingInputRule(/^\s*>\s$/, nodes.blockquote));
    if (nodes.code_block) rules.push(textblockTypeInputRule(/^```([\w+#-]{0,20})\s$/, nodes.code_block, (m) => ({ language: m[1] ? m[1].toLowerCase() : null })));
    if (nodes.bullet_list) rules.push(wrappingInputRule(/^\s*([-+*])\s$/, nodes.bullet_list));
    if (nodes.task_list) rules.unshift(wrappingInputRule(/^\s*\[( |x)?\]\s$/, nodes.task_list));
    if (nodes.ordered_list)
      rules.push(
        wrappingInputRule(/^(\d+)\.\s$/, nodes.ordered_list, (m) => ({ order: +m[1] }), (m, node) => node.childCount + node.attrs.order === +m[1]),
      );
    if (marks.bold) rules.push(markRule(/(?:\*\*)([^*]+)(?:\*\*)$/, marks.bold));
    if (marks.italic) rules.push(markRule(/_([^_]+)_$/, marks.italic));
    if (marks.code) rules.push(markRule(/`([^`]+)`$/, marks.code));
    return [inputRules({ rules })];
  },
};
