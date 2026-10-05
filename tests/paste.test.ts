import { afterEach, describe, expect, it } from 'vitest';
import { Slice } from 'prosemirror-model';
import { cleanPastedHTML, createEditor, defaultPlugins, hasPasteableText } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content = '<p></p>') => { const el = document.body.appendChild(document.createElement('div')); roots.push(el); return createEditor({ element: el, content, plugins: defaultPlugins }); };

// What Word for Mac puts on the clipboard for "text, then a numbered list with lettered sub-items".
const sp = "<span style='font:7.0pt \"Times New Roman\"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span>";
const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=ProgId content=Word.Document><meta name=Generator content="Microsoft Word 15"><style><!-- p.MsoNormal {margin:0in;font-size:12.0pt} --></style></head><body lang=EN-US style='tab-interval:.5in'>
<!--StartFragment--><p class=MsoNormal><span lang=EN-US style='font-size:12.0pt;font-family:Calibri'>Jkljlk<o:p></o:p></span></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p>
<p class=MsoListParagraphCxSpFirst style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-fareast-font-family:Arial'><span style='mso-list:Ignore'>1.${sp}</span></span><![endif]><span lang=EN-US>Jlkjklj</span><o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:1.5in;text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>a.${sp}</span><![endif]>Kljkljkljl<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>2.${sp}</span><![endif]>Lkjkljl<o:p></o:p></p>
<p class=MsoListParagraphCxSpMiddle style='margin-left:1.0in;text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>3.${sp}</span><![endif]>Jkhjlj<o:p></o:p></p>
<p class=MsoListParagraphCxSpLast style='margin-left:1.5in;text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='mso-list:Ignore'>a.${sp}</span><![endif]>Lkjklj<o:p></o:p></p>
<p class=MsoNormal><o:p>&nbsp;</o:p></p><!--EndFragment--></body></html>`;

describe('Word paste', () => {
  it('turns Word list paragraphs into real nested lists and drops Word noise', () => {
    const out = cleanPastedHTML(WORD);
    expect(out).not.toMatch(/mso-|<o:p|MsoNormal|StartFragment|supportLists|font-size|Calibri|<style|lang=/i);
    const box = document.createElement('div');
    box.innerHTML = out;
    expect(box.querySelector('p')!.textContent).toBe('Jkljlk');
    const ol = box.querySelector('ol')!;
    expect([...ol.children].map((li) => li.querySelector(':scope > p')!.textContent)).toEqual(['Jlkjklj', 'Lkjkljl', 'Jkhjlj']);
    expect(ol.querySelector(':scope > li > ol > li > p')!.textContent).toBe('Kljkljkljl'); // nested under the first item
    expect(box.querySelectorAll('ol').length).toBe(3); // the top list and one nested list per group of lettered items
    expect(box.textContent).not.toMatch(/1\.\s|a\.\s/); // the fake "1." markers are gone
  });

  it('pastes as an editable list in the editor, not as a picture', () => {
    const ed = make();
    // jsdom has no ClipboardEvent, so run the same transform the view applies to pasted HTML and parse the result
    const transform = ed.view.someProp('transformPastedHTML', (f) => f)!;
    ed.setHTML(transform(WORD, ed.view));
    const html = ed.getHTML();
    expect(html).toContain('<ol>');
    expect(html).toContain('<li><p>Jlkjklj</p><ol type="a">'); // nested, with its own a. b. numbering
    expect(html).not.toContain('<img');
    ed.destroy();
  });

  it('bullets stay bullets; the kind can change between lists', () => {
    const html = "<p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>·<span>&nbsp;</span></span><![endif]>one</p><p class=MsoListParagraph style='mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>·</span><![endif]>two</p><p class=MsoListParagraph style='mso-list:l2 level1 lfo3'><![if !supportLists]><span style='mso-list:Ignore'>5.</span><![endif]>five</p>";
    const box = document.createElement('div');
    box.innerHTML = cleanPastedHTML(html);
    expect([...box.children].map((e) => e.tagName)).toEqual(['UL', 'OL']);
    expect(box.querySelector('ol')!.getAttribute('start')).toBe('5');
  });

  it('keeps bold, italic, underline and colour, drops fonts and sizes', () => {
    const out = cleanPastedHTML("<p class=MsoNormal><span style='font-family:Arial;font-size:14pt;font-weight:bold;color:#C00000;mso-bidi-font-weight:normal'>Hi</span><span style='color:windowtext'> there</span><o:p></o:p></p>");
    expect(out).toContain('font-weight: bold');
    expect(out).toContain('color: #C00000');
    expect(out).not.toMatch(/Arial|14pt|windowtext|mso-/);
  });

  it('removes pictures that point at local files and leaves ordinary HTML alone', () => {
    expect(cleanPastedHTML("<p class=MsoNormal>x <img src='file:///C:/Users/me/a.png'></p>")).not.toContain('img');
    const plain = '<p style="font-size:30px">Hello <b>world</b></p>';
    expect(cleanPastedHTML(plain)).toBe(plain);
  });

  it('Google Docs: unwraps the fake bold wrapper', () => {
    const out = cleanPastedHTML('<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234"><p dir="ltr"><span style="font-weight:700">Bold</span> plain</p></b>');
    expect(out).not.toContain('docs-internal-guid');
    expect(out).not.toMatch(/^<b/);
  });
});

describe('image on the clipboard next to text', () => {
  const png = () => new File([new Uint8Array([137, 80, 78, 71])], 'image.png', { type: 'image/png' });
  const paste = (ed: ReturnType<typeof make>, data: Record<string, string>, files: File[]) => {
    const event = { clipboardData: { files, getData: (t: string) => data[t] ?? '' }, preventDefault() {} } as unknown as ClipboardEvent;
    return !!ed.view.someProp('handlePaste', (f) => f(ed.view, event, Slice.empty));
  };
  it('ignores the screenshot Word attaches when there is HTML or text (so the list stays editable)', () => {
    const ed = make();
    expect(paste(ed, { 'text/html': WORD, 'text/plain': 'Jkljlk' }, [png()])).toBe(false);
    expect(paste(ed, { 'text/plain': 'just text' }, [png()])).toBe(false);
    ed.destroy();
  });
  it('still pastes a real picture (nothing but an image, or an <img> with no text)', () => {
    const ed = make();
    expect(paste(ed, {}, [png()])).toBe(true);
    expect(paste(ed, { 'text/html': '<img src="https://x.test/a.png">' }, [png()])).toBe(true);
    ed.destroy();
  });
  it('hasPasteableText', () => {
    expect(hasPasteableText({ getData: (t) => (t === 'text/plain' ? '  hi ' : '') })).toBe(true);
    expect(hasPasteableText({ getData: (t) => (t === 'text/html' ? '<p>&nbsp;</p><img src=x>' : '') })).toBe(false);
    expect(hasPasteableText(null)).toBe(false);
  });
});

describe('list numbering styles', () => {
  it('reads letter and roman markers', async () => {
    const { markerStyle } = await import('../src/paste');
    expect(markerStyle('1.', 1)).toEqual({ type: '1', start: 1 });
    expect(markerStyle('3)', 1)).toEqual({ type: '1', start: 3 });
    expect(markerStyle('a.', 2)).toEqual({ type: 'a', start: 1 });
    expect(markerStyle('c.', 2)).toEqual({ type: 'a', start: 3 });
    expect(markerStyle('B.', 1)).toEqual({ type: 'A', start: 2 });
    expect(markerStyle('i.', 3)).toEqual({ type: 'i', start: 1 }); // roman at the third level
    expect(markerStyle('i.', 2)).toEqual({ type: 'a', start: 9 }); // a letter at the second
    expect(markerStyle('iv.', 2)).toEqual({ type: 'i', start: 4 });
    expect(markerStyle('IX.', 1)).toEqual({ type: 'I', start: 9 });
  });
  it('keeps a. b. as an alphabetical list through Word paste and through HTML', () => {
    const ed = make();
    const html = `<p class=MsoListParagraph style='mso-list:l0 level1 lfo1'><span style='mso-list:Ignore'>1.</span>one</p><p class=MsoListParagraph style='mso-list:l0 level2 lfo1'><span style='mso-list:Ignore'>a.</span>sub a</p><p class=MsoListParagraph style='mso-list:l0 level2 lfo1'><span style='mso-list:Ignore'>b.</span>sub b</p>`;
    const transform = ed.view.someProp('transformPastedHTML', (f) => f)!;
    ed.setHTML(transform(html, ed.view));
    expect(ed.getHTML()).toContain('<ol type="a">');
    ed.setHTML('<ol start="3" type="I"><li><p>x</p></li></ol><ol type="bogus"><li><p>y</p></li></ol>');
    expect(ed.getHTML()).toContain('<ol start="3" type="I">');
    expect(ed.getHTML()).not.toContain('bogus');
    ed.destroy();
  });
});
