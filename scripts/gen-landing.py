#!/usr/bin/env python3
"""Regenerate the landing page (index.html) from the list of demos below.

Run from the repository root:  python3 scripts/gen-landing.py
"""
import html, json, os, sys

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
 ('Data table', 'A full data grid with no extra package: search, sort, filters, paging, groups, formulas, highlight rules, Excel / CSV / PDF, add / edit / delete dialogs with role and permission guards, rows from a server. Use it inside the editor or on its own (wysiwygido/data-table).', [
   ('data-table-crud', 'Add, edit, delete with roles', 'New, Edit and Delete in dialogs, a confirmation before deleting, and a guard by role or permission (switch the person to see it).', ['CRUD', 'Roles', 'Permissions']),
   ('data-table-server', '5,000 rows from a server', 'Paging, search, sort and filters on the server, with add, edit and delete going through it.', ['Remote', 'CRUD']),
   ('data-table-finance', 'Budget against actual', 'Calculated columns, totals, bars, highlight rules, grouping and a saved view.', ['Formulas', 'Rules', 'Groups']),
   ('data-table-inventory', 'Stock control', 'Low-stock highlights, saved views, a button for the ticked rows and one on the rows that need it.', ['Views', 'Buttons']),
   ('data-table-people', 'Staff directory', 'Row details, hidden columns, filters, a button on every row and a read-only mode.', ['Details', 'Read-only']),
   ('data-table-import', 'Import and export', 'Paste or open CSV or Excel, get a typed table, and write it out again.', ['CSV', 'Excel']),
   ('data-table', 'Data table', 'Search, sort, filter, page, edit and total a table of records; custom buttons; export to CSV, Excel and PDF; convert to and from a regular table.', ['Table', 'Excel', 'CSV']),
   ('data-table-standalone', 'Data table on its own', 'The data table with no editor around it: createDataTable, undo, themes, change events and a custom element.', ['Table', 'Stand-alone']),
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
   ('pdf-epub', 'PDF import and EPUB export', 'Open a PDF as editable text (headings, paragraphs, lists) and save the document as an EPUB e-book.', ['PDF', 'EPUB']),
   ('proofreading', 'Spelling and grammar', 'Plug in a LanguageTool-style service: underlines for spelling, grammar and style, with suggestions and Ignore.', ['Proofreading']),
   ('recording', 'Voice, screen and dictation', 'Record audio or the screen into the document and dictate text, with a visible recording bar and a cancel key.', ['Audio', 'Dictation']),
   ('charts', 'Charts from tables', 'Bar, line and pie charts built from a table, stored as data and written to Word as pictures.', ['Charts']),
   ('columns', 'Columns', 'Newspaper-style columns: wrap blocks in two to four columns with an optional rule and gap.', ['Layout']),
   ('floating-menu', 'Floating menu', 'The toolbar in a floating card with the document name, save status, your own controls, a menu bar with drop-downs and the toolbar.', ['Toolbar', 'Menu bar']),
   ('themes', 'Themes', 'Ten colour themes for the toolbar, ribbon and paper, switched at run time, plus your own from a handful of colours.', ['Theme', 'Dark mode']),
   ('captions', 'Captions and cross-references', 'Numbered figure and table captions that renumber themselves, cross-references that follow them, and a list of figures.', ['Captions', 'References']),
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


# ---- browser support table (from scripts/compat/results.json, written by scripts/compat/aggregate.mjs) ----

BROWSER_NAMES = {'chromium': 'Chrome / Edge (Chromium)', 'firefox': 'Firefox', 'webkit': 'Safari (WebKit)'}
# What the library uses that old browsers lack. Versions are the first release that has it (MDN); the "tested" table below shows what really ran.
NEEDS = [
 ('color-mix()', 'Tints: focus ring, locked sections, formula cells, minimap (the data table highlights and bars have a plain-colour fallback)', '111', '113', '16.2', 'Those tints are not drawn'),
 ('DecompressionStream', 'Opening an .xlsx file in the data table', '80', '113', '16.4', 'Excel import says it cannot read the file; CSV still works'),
 ('AbortSignal.timeout', 'Fetching remote images for Word export', '103', '100', '16', 'Word export of remote images fails; local images are fine'),
 ('BroadcastChannel', 'Two tabs editing together (collaboration demo)', '54', '38', '15.4', 'Tabs do not see each other'),
]
DIFFERENCES = [
 ('Dictation', 'Chrome, Edge and Safari. Firefox has no speech recognition.'),
 ('Running headers and footers in print / PDF', 'Chrome and Edge 131+ draw them; other browsers print the pages without them.'),
 ('Pagination', 'Measured in the browser, so page breaks can differ by a line between engines.'),
]

def short(r):
    # 94.0.4595.0 -> 94, 91.0 -> 91, WebKit 16.4 -> 16.4
    return r['version'] if r['browser'] == 'webkit' else str(r['major'])

def browsers():
    path = 'scripts/compat/results.json'
    if not os.path.exists(path):
        return ''
    data = json.load(open(path))
    runs = data['runs']
    total = runs[0]['total'] if runs else 0
    out = ['<section id="browsers"><h2>Browser support</h2>']
    cards = ''
    for b in ('chromium', 'firefox', 'webkit'):
        ok = [r for r in runs if r['browser'] == b and not r['failed']]
        if ok:
            low = min(ok, key=lambda r: r['major'] * 100 + float(r['version'].split('.')[1] or 0) if b == 'webkit' else r['major'])
            cards += f'<div class="feat"><h3>{html.escape(BROWSER_NAMES[b])} {short(low)}+</h3><p>The oldest build tested; every check passes from here up to the newest.</p></div>'
    out.append(f'<p class="lead">The editor and the data table were run in real browsers, from old releases to the newest. Each build drove the same {total} checks: the demo pages load without an error, typing, undo, bold, the paged layout, search, sort, edit, export, themes and highlights. A green version passed all of them.</p>')
    out.append(f'<div class="features">{cards}</div>')
    out.append('<h3>Tested builds</h3><table class="spec"><thead><tr><th>Browser</th><th>Versions tested</th></tr></thead><tbody>')
    for b in ('chromium', 'firefox', 'webkit'):
        pills = ''
        for r in (x for x in runs if x['browser'] == b):
            if r['failed']:
                title = html.escape(f'{r["passed"]} of {r["total"]}: ' + '; '.join(f['name'] for f in r['failed']))
                pills += f'<span class="ver bad" title="{title}">✗ {short(r)}</span>'
            else:
                pills += f'<span class="ver ok" title="All {r["total"]} checks pass">✓ {short(r)}</span>'
        out.append(f'<tr><td>{html.escape(BROWSER_NAMES[b])}</td><td>{pills}</td></tr>')
    out.append('</tbody></table>')
    out.append(f'<p class="note">Run {html.escape(data["generated"])} with Playwright 1.14 to 1.56 (headless, desktop, macOS). Older builds could not be started on this machine, and there is no test build of Safari before 16.4, so nothing below those versions was run. Phones and tablets use the same engines but were not tested separately.</p>')
    out.append('<h3>What older browsers are missing</h3><p>Below the tested versions, these are the functions the library uses that arrived later (from the browsers\' compatibility data, not from a run). Everything else it uses is older than the oldest tested build.</p><table class="spec"><thead><tr><th>Needs</th><th>Used for</th><th>Chrome / Edge</th><th>Firefox</th><th>Safari</th><th>Without it</th></tr></thead><tbody>')
    for name, use, c, f, sa, lack in NEEDS:
        out.append(f'<tr><td><code>{html.escape(name)}</code></td><td>{html.escape(use)}</td><td>{c}</td><td>{f}</td><td>{sa}</td><td>{html.escape(lack)}</td></tr>')
    out.append('</tbody></table>')
    out.append('<h3>What cannot use it</h3><ul class="tips"><li>Internet Explorer and the old Edge (EdgeHTML): the build uses modern JavaScript and CSS.</li><li>Anything older than Chrome 87, Edge 88, Firefox 78 or Safari 14: the files do not even parse.</li><li>Between those and the tested builds (for example Chrome 87 to 93, Safari 14 to 16.3): not tested, so no promise. They should load, with the gaps in the table above.</li></ul>')
    out.append('<h3>Differences between browsers (not bugs)</h3><ul class="tips">' + ''.join(f'<li><strong>{html.escape(a)}:</strong> {html.escape(b)}</li>' for a, b in DIFFERENCES) + '</ul>')
    out.append('<p>Run it yourself: <code>pnpm build:demo</code>, serve <code>demo-dist</code>, then <code>scripts/compat/run-matrix.sh</code> (see <code>scripts/compat</code> in the repository).</p></section>')
    return ''.join(out)

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
    page = template.replace('{{FEATURES}}', feat).replace('{{SECTIONS}}', sections).replace('{{TOTAL}}', str(total)).replace('{{BROWSERS}}', browsers())
    open('index.html', 'w').write(page)
    print(f'index.html: {total} demos')

main()
