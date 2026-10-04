import type { Editor } from '../editor';
import type { EditorPlugin } from '../types';

const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'ul', 'ol', 'li', 'blockquote', 'pre', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'div', 'hr']);

/** Pretty-print editor HTML: one block per line, indented by nesting. Inline markup stays on its line. */
export function formatHtml(html: string): string {
  const box = document.createElement('div');
  box.innerHTML = html;
  const lines: string[] = [];
  const walk = (el: Element, depth: number) => {
    for (const child of Array.from(el.childNodes)) {
      const pad = '  '.repeat(depth);
      if (child.nodeType === Node.TEXT_NODE) {
        const t = (child.textContent ?? '').trim();
        if (t) lines.push(pad + escape(t));
      } else if (child instanceof Element) {
        const tag = child.tagName.toLowerCase();
        if (!BLOCKS.has(tag)) {
          lines.push(pad + child.outerHTML);
        } else if (tag === 'pre' || tag === 'hr' || !child.children.length || ![...child.children].some((c) => BLOCKS.has(c.tagName.toLowerCase()))) {
          lines.push(pad + child.outerHTML); // leaf blocks and <pre> keep their content exactly
        } else {
          const open = child.outerHTML.slice(0, child.outerHTML.indexOf('>') + 1);
          lines.push(pad + open);
          walk(child, depth + 1);
          lines.push(`${pad}</${tag}>`);
        }
      }
    }
  };
  walk(box, 0);
  return lines.join('\n');
}
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Edit the document as HTML. Leaving source mode parses the text with the editor schema, so anything the editor
 * does not support (scripts, unknown tags and attributes, unsafe URLs) is dropped. Entering and leaving are one
 * undo step each way.
 */
export const SourceEditing: EditorPlugin = {
  name: 'source-editing',
  setup(editor: Editor) {
    let area: HTMLTextAreaElement | null = null;
    let wasReadOnly = false;

    const enter = () => {
      area = document.createElement('textarea');
      area.className = 'wy-source';
      area.spellcheck = false;
      area.setAttribute('aria-label', editor.t('source', 'HTML source'));
      area.value = formatHtml(editor.getHTML());
      editor.root.classList.add('wy-source-mode');
      editor.workspace.append(area);
      wasReadOnly = editor.isReadOnly;
      editor.setReadOnly(true);
      area.focus();
    };
    const leave = (apply: boolean) => {
      if (!area) return;
      const text = area.value;
      area.remove();
      area = null;
      editor.root.classList.remove('wy-source-mode');
      editor.setReadOnly(wasReadOnly);
      if (apply) editor.replaceHTML(text);
      editor.view.focus();
    };

    editor.registerCommand('toggleSource', () => ((area ? leave(true) : enter()), true), { readOnlySafe: true });
    editor.registerCommand('cancelSource', () => (area ? (leave(false), true) : false), { readOnlySafe: true });
    editor.registerCommand('getSource', () => !!area, { readOnlySafe: true });
    editor.extensions.sourceActive = () => !!area;
  },
  toolbar: [{ name: 'source', label: 'Source (edit HTML)', icon: '&lt;/&gt;', command: 'toggleSource', isActive: () => false }],
};
