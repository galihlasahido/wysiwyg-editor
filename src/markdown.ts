import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer, type MarkdownSerializerState } from 'prosemirror-markdown';
import type { Node as PMNode, Schema } from 'prosemirror-model';

const noMark = { open: '', close: '', mixable: true, expelEnclosingWhitespace: true };

const knownNodes: Record<string, (state: MarkdownSerializerState, node: PMNode, parent: PMNode, index: number) => void> = {
    blockquote(state, node) {
      state.wrapBlock('> ', null, node, () => state.renderContent(node));
    },
    code_block(state, node) {
      state.write('```\n');
      state.text(node.textContent, false);
      state.ensureNewLine();
      state.write('```');
      state.closeBlock(node);
    },
    heading(state, node) {
      state.write(state.repeat('#', node.attrs.level) + ' ');
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    horizontal_rule(state, node) {
      state.write('---');
      state.closeBlock(node);
    },
    bullet_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    ordered_list(state, node) {
      const start = node.attrs.order || 1;
      state.renderList(node, '   ', (i) => `${start + i}. `);
    },
    merge_field(state, node) {
      state.write(`{{${node.attrs.name}}}`);
    },
    mention(state, node) {
      state.write(`@${state.esc(node.attrs.label)}`);
    },
    toc(state, node) {
      state.write('[TOC]');
      state.closeBlock(node);
    },
    footnote(state, node) {
      state.write(`^[${state.esc(node.attrs.text)}]`);
    },
    page_break(state, node) {
      state.closeBlock(node);
    },
    task_list(state, node) {
      state.renderList(node, '  ', () => '- ');
    },
    task_item(state, node) {
      state.write(node.attrs.checked ? '[x] ' : '[ ] ');
      state.renderContent(node);
    },
    list_item(state, node) {
      state.renderContent(node);
    },
    paragraph(state, node) {
      state.renderInline(node);
      state.closeBlock(node);
    },
    image(state, node) {
      state.write(`![${state.esc(node.attrs.alt || '')}](${node.attrs.src})`);
    },
    hard_break(state, node, parent, index) {
      for (let i = index + 1; i < parent.childCount; i++)
        if (parent.child(i).type !== node.type) {
          state.write('\\\n');
          return;
        }
    },
    text(state, node) {
      state.text(node.text!);
    },
    // GFM table (cells flattened to plain text).
    table(state: MarkdownSerializerState, node) {
      node.forEach((row, _o, i) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(cell.textContent.replace(/\|/g, '\\|').replace(/\n/g, ' ')));
        state.write(`| ${cells.join(' | ')} |\n`);
        if (i === 0) state.write(`| ${cells.map(() => '---').join(' | ')} |\n`);
      });
      state.closeBlock(node);
    },
};

/**
 * Node types without a dedicated handler (new plugins, custom nodes) fall back to their text, or to their content for
 * blocks, so exporting Markdown never throws because of a node it does not know.
 */
const nodes = new Proxy(knownNodes, {
  get: (target, name: string) =>
    target[name] ??
    ((state: MarkdownSerializerState, node: PMNode) => {
      if (node.isInline) state.text(node.textContent || node.type.spec.leafText?.(node) || '');
      else {
        state.renderContent(node);
        if (node.isLeaf) state.closeBlock(node);
      }
    }),
});

const serializer = new MarkdownSerializer(
  nodes,
  {
    bold: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
    italic: { open: '_', close: '_', mixable: true, expelEnclosingWhitespace: true },
    code: { open: '`', close: '`', escape: false },
    strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
    link: {
      open: '[',
      close: (_s, mark) => `](${mark.attrs.href}${mark.attrs.title ? ` "${mark.attrs.title.replace(/"/g, '\\"')}"` : ''})`,
    },
    underline: noMark,
    subscript: noMark,
    superscript: noMark,
    font_family: noMark,
    font_size: noMark,
    text_color: noMark,
    highlight: noMark,
    comment: noMark,
    insertion: noMark,
    deletion: noMark,
  },
);

export function docToMarkdown(doc: PMNode): string {
  return serializer.serialize(doc);
}

export function markdownToDoc(schema: Schema, md: string): PMNode {
  const { nodes, marks } = schema;
  const tokens: Record<string, any> = {};
  tokens.paragraph = { block: 'paragraph' };
  if (nodes.blockquote) tokens.blockquote = { block: 'blockquote' };
  if (nodes.list_item) tokens.list_item = { block: 'list_item' };
  if (nodes.bullet_list) tokens.bullet_list = { block: 'bullet_list' };
  if (nodes.ordered_list)
    tokens.ordered_list = { block: 'ordered_list', getAttrs: (t: any) => ({ order: +t.attrGet('start') || 1 }) };
  if (nodes.heading) tokens.heading = { block: 'heading', getAttrs: (t: any) => ({ level: +t.tag.slice(1) }) };
  if (nodes.code_block) {
    tokens.code_block = { block: 'code_block', noCloseToken: true };
    tokens.fence = { block: 'code_block', getAttrs: () => ({}), noCloseToken: true };
  }
  if (nodes.horizontal_rule) tokens.hr = { node: 'horizontal_rule' };
  if (nodes.image)
    tokens.image = {
      node: 'image',
      getAttrs: (t: any) => ({ src: t.attrGet('src'), alt: (t.children?.[0]?.content ?? t.content) || null }),
    };
  if (nodes.hard_break) tokens.hardbreak = { node: 'hard_break' };
  if (marks.italic) tokens.em = { mark: 'italic' };
  if (marks.bold) tokens.strong = { mark: 'bold' };
  if (marks.code) tokens.code_inline = { mark: 'code', noCloseToken: true };
  if (marks.link)
    tokens.link = {
      mark: 'link',
      getAttrs: (t: any) => ({ href: t.attrGet('href'), title: t.attrGet('title') || null }),
    };
  // 'zero' disables raw HTML; commonmark preset keeps links/images safe-by-validateLink.
  const md_ = new MarkdownIt('commonmark', { html: false });
  return new MarkdownParser(schema, md_ as unknown as ConstructorParameters<typeof MarkdownParser>[1], tokens).parse(md);
}
