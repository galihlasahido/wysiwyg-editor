#!/usr/bin/env python3
"""Regenerate the landing page (index.html) from the list of demos below.

Run from the repository root:  python3 scripts/gen-landing.py
"""
import html, os, sys

GROUPS = [
 ('Editors', 'Complete editors in different shapes.', [
   ('feature-rich', 'Feature-rich editor', 'Ribbon, pages and ruler, comments, suggestions, versions and collaboration in one.', ['Ribbon', 'Pages', 'Ruler']),
   ('restricted-editing', 'Locked sections and fill-in areas', 'A feature-rich document where parts (title, table of contents, legal text) cannot be edited and the rest is filled in like normal text.', ['Template', 'Locked', 'Forms']),
   ('editor-types', 'Different user interfaces', 'Classic, inline with a balloon toolbar, and a document editor with ribbon and pages.', ['Classic', 'Inline', 'Document']),
   ('web-component', 'Web component', 'One HTML tag, <wysiwyg-editor>: attributes, events and normal form submission, in any framework or none.', ['Custom element', 'Forms']),
   ('custom-plugin', 'Custom plugins and toolbar layout', 'Write your own plugin (node, command, buttons, shortcut, ribbon tab, events) and arrange the toolbar: groups, rows, spacer, position, overflow menu.', ['Plugins', 'Toolbar']),
   ('headless', 'Headless editor', 'No built-in UI: drive the engine from your own buttons through commands and state.', ['API', 'Custom UI']),
   ('mobile', 'Mobile friendly', 'A wrapping compact toolbar with touch-sized controls in a 375px frame.', ['Responsive', 'Touch']),
 ]),
 ('Coding', 'Developer-oriented UIs, from a full code editor to docs and notebooks.', [
   ('code-editor', 'Full code editor', 'Line numbers, highlighting, folding, multiple cursors, minimap, bracket matching, comments, several files, run and preview, command palette.', ['IDE', 'Folding', 'Multi-cursor']),
   ('markdown-live', 'Markdown with live preview', 'The code editor with line numbers beside a rendered, sanitised preview.', ['Markdown', 'Live']),
   ('coding-docs', 'Developer docs', 'Highlighted code blocks with a language picker, Copy, smart indentation and a sandboxed Run button.', ['Code', 'Run']),
   ('coding-notebook', 'Notebook', 'Prose and runnable cells with outputs under each cell and a shared kernel.', ['Code', 'Notebook']),
   ('coding-playground', 'Playground', 'HTML, CSS and JavaScript blocks with a live sandboxed preview and console.', ['HTML/CSS/JS', 'Live']),
   ('coding-readme', 'README editor', 'Write visually, get Markdown with language fences, or edit the Markdown.', ['Markdown', 'Code']),
 ]),
 ('Real-world documents', 'Complete workflows built from the same parts.', [
   ('contract-form', 'Contract form', 'Locked clauses, fill-in fields, a progress list of empty fields, export to Word or PDF.', ['Forms', 'Locked', '.docx']),
   ('resume-builder', 'Resume builder', 'Locked headings keep the layout; template, accent colour and print to PDF.', ['Template', 'Print']),
   ('legal-review', 'Legal document review', 'Locked standard clauses, suggestions, comments and versions on paged layout.', ['Review', 'Locked']),
   ('meeting-notes', 'Meeting notes', 'Templates, @mentions, checklists and an action-item list collected on the side.', ['Templates', 'Mentions']),
   ('spreadsheet', 'Spreadsheet-lite', 'Tables with formulas: SUM, AVERAGE, IF, cell and range references, safe parser, errors like #DIV/0!.', ['Table', 'Formulas']),
   ('diagram', 'Diagrams and whiteboard', 'Editable flowcharts in the document: shapes, arrows, drag, rename, colours; stored as SVG-ready JSON.', ['SVG', 'Diagram']),
   ('slides', 'Slides / presentation', 'A document that becomes a deck: slides split by lines, speaker notes, themes, full-screen present, standalone export.', ['Slides', 'Present']),
   ('blog-cms', 'Blog / CMS editor', 'Title, slug, cover, body with images, responsive preview, HTML and Markdown output.', ['CMS', 'Preview']),
   ('wiki', 'Knowledge base / wiki', 'Linked pages stored in the browser, search, backlinks, table of contents, versions.', ['Wiki', 'Links']),
   ('bilingual', 'Bilingual (LTR + RTL)', 'English and Arabic side by side, each with its own direction and interface language.', ['RTL', 'i18n']),
   ('email-campaign', 'Email campaign', 'Merge fields, per-recipient validation and a table-based email preview.', ['Email', 'Merge fields']),
 ]),
 ('Collaboration and review', 'Working together, asynchronously or live.', [
   ('collab-realtime', 'Real-time collaboration', 'Two editors, one Yjs document: remote cursors, per-user undo, offline edits that merge.', ['Yjs', 'Cursors']),
   ('collab-async', 'Comments, suggestions and history', 'Threaded comments, accept or reject tracked changes, restore versions.', ['Review', 'Track changes']),
 ]),
 ('Documents', 'Getting content in and out.', [
   ('export-word-pdf', 'Export to Word and PDF', 'Download .docx with page setup, headers and footers, or print to PDF.', ['.docx', 'PDF']),
   ('import-word', 'Import from Word', 'Open a .docx and get clean, schema-validated content. One undo step.', ['.docx', 'Import']),
   ('email', 'Email editing', 'Compose, then preview the table-based, inline-styled HTML and the plain-text part.', ['Email', 'HTML']),
   ('markdown', 'Markdown editor', 'WYSIWYG and Markdown side by side, kept in sync.', ['Markdown']),
   ('source-editing', 'Source editing', 'Edit the HTML directly; unsupported or unsafe markup is dropped on the way back.', ['HTML', 'Sanitised']),
 ]),
 ('Content tools', 'Helpers that speed up writing.', [
   ('ai', 'AI assistant', 'Improve, fix, shorten, expand, summarize or translate. Streams into a preview you accept or discard.', ['AI', 'Streaming']),
   ('productivity', 'Productivity', 'Templates, slash commands, @-mentions and Markdown shortcuts.', ['Slash', 'Mentions']),
   ('merge-fields', 'Merge fields', 'Placeholders like {{first_name}} rendered per recipient, safely.', ['Templates', 'Safe']),
   ('math-diagrams', 'Math and diagrams', 'LaTeX equations drawn by KaTeX and Mermaid diagrams (flowchart, sequence, class, state, ER, Gantt, pie, mind map), with dialogs that preview as you type.', ['KaTeX', 'Mermaid']),
   ('save-endpoint', 'Save to your endpoint (with comments)', 'Autosave sends the post and its comment threads to an API; a simulated backend shows the stored row, retries when offline and a 409 conflict.', ['Autosave', 'API']),
   ('dialogs', 'Modal dialogs', 'The dialogs behind comments, links, alt text and footnotes, and askDialog() for your own code: validation, live preview, snippets.', ['Modal', 'askDialog']),
   ('image-editor', 'Image editor', 'The image editor on its own: drop a picture, crop, rotate, resize, adjust, filter, draw, add text, zoom and pan, then download.', ['Canvas', 'Crop', 'Filters']),
   ('file-manager', 'Files and image editing', 'A file library (upload, drag and drop, search, rename, download, delete) and an image editor: crop, rotate, resize, adjust, filters, draw, text.', ['Files', 'Image editor']),
   ('embeds', 'Embedded media', 'Paste a YouTube, Vimeo or OpenStreetMap link and get a player or map; only listed services, sandboxed frames, link kept on print.', ['Video', 'Maps']),
   ('images', 'Images: upload, resize, crop', 'Upload with progress, resize, crop, caption and alt text.', ['Images', 'Crop']),
 ]),
]

FEATURES = [
 ('Ribbon, toolbar or nothing', 'Office-style tabbed ribbon, a compact toolbar, a floating balloon toolbar, or no UI at all and your own buttons.'),
 ('Pages like a word processor', 'Paged layout with a draggable ruler, margins, indents, headers and footers, page numbers, zoom and dark mode.'),
 ('A real code editor', 'Line numbers, syntax highlighting, bracket matching, auto-closing, comment toggling, line operations and several files, on the same engine.'),
 ('Review and collaboration', 'Comments, tracked changes, version history, and real-time co-editing over Yjs with remote cursors.'),
 ('Locked sections and forms', 'Lock parts of a document (titles, a table of contents, legal text) and leave fill-in areas editable, enforced on every change.'),
 ('Word, PDF, Markdown, email', 'Import and export .docx, print to PDF, round-trip Markdown, and email-safe HTML.'),
 ('Safe by design', 'A schema decides what exists: unknown markup, event handlers and unsafe URLs are dropped. User text is never parsed as HTML.'),
 ('Accessible and modular', 'ARIA roles, keyboard operation, axe-core in the tests, RTL; everything is a plugin on a small core.'),
]

def card(n, t, d, tags):
    return (f'<a class="card" href="./demo/{n}.html"><h3>{html.escape(t)}</h3><p>{html.escape(d)}</p>'
            f'<div class="tags">{"".join(f"<span class=tag>{html.escape(x)}</span>" for x in tags)}</div></a>')

def main():
    # only list demos whose page exists, so a card never points at a missing file
    missing = [n for _, _, cards in GROUPS for (n, *_rest) in cards if not os.path.exists(f'demo/{n}.html')]
    groups = [(g, s, [c for c in cards if c[0] not in missing]) for g, s, cards in GROUPS]
    total = sum(len(c) for _, _, c in groups)
    if missing:
        print('skipping (no page yet):', ', '.join(missing), file=sys.stderr)
    sections = ''.join(f'''
    <section id="{g.lower().replace(' ', '-')}">
      <h2>{html.escape(g)}</h2>
      <p class="lead">{html.escape(sub)}</p>
      <div class="cards">{''.join(card(*c) for c in cards)}</div>
    </section>''' for g, sub, cards in groups)
    feat = ''.join(f'<div class="feat"><h3>{html.escape(t)}</h3><p>{html.escape(d)}</p></div>' for t, d in FEATURES)
    template = open('scripts/landing.template.html').read()
    page = template.replace('{{FEATURES}}', feat).replace('{{SECTIONS}}', sections).replace('{{TOTAL}}', str(total))
    open('index.html', 'w').write(page)
    print(f'index.html: {total} demos')

main()
