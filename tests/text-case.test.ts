import { afterEach, describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { convertCase, createEditor } from '../src';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));
const make = (content: string) => {
  const el = document.body.appendChild(document.createElement('div'));
  roots.push(el);
  return createEditor({ element: el, content });
};
const select = (ed: ReturnType<typeof make>, from: number, to = from) => ed.view.dispatch(ed.view.state.tr.setSelection(TextSelection.create(ed.view.state.doc, from, to)));
const text = (ed: ReturnType<typeof make>) => ed.view.state.doc.textContent;

describe('convertCase', () => {
  it.each([
    ['hello World', 'upper', 'HELLO WORLD'],
    ['Hello World', 'lower', 'hello world'],
    ['Hello wORLD', 'toggle', 'hELLO World'],
    ['the quick brown fox', 'title', 'The Quick Brown Fox'],
    ['HELLO there. how are you? fine', 'sentence', 'Hello there. How are you? Fine'],
    ['Hello World again', 'snake', 'hello_world_again'],
    ['Hello World again', 'camel', 'helloWorldAgain'],
    ['hello world again', 'pascal', 'HelloWorldAgain'],
    ['Hello World again', 'kebab', 'hello-world-again'],
    ['fooBarBaz', 'snake', 'foo_bar_baz'],
    ['foo_bar-baz qux', 'camel', 'fooBarBazQux'],
    ['XMLHttpRequest', 'snake', 'xml_http_request'],
    ['café été', 'upper', 'CAFÉ ÉTÉ'],
  ] as const)('%s → %s', (input, kind, out) => expect(convertCase(input, kind)).toBe(out));
});

describe('changing case in the editor', () => {
  it('converts the selection and keeps marks on each piece', () => {
    const ed = make('<p>hello <strong>big</strong> world</p>');
    select(ed, 1, ed.view.state.doc.content.size - 1);
    expect(ed.execute('caseUpper')).toBe(true);
    expect(ed.getHTML()).toBe('<p>HELLO <strong>BIG</strong> WORLD</p>');
    ed.destroy();
  });
  it('without a selection it changes the word at the caret', () => {
    const ed = make('<p>one two three</p>');
    select(ed, 6); // inside "two"
    ed.execute('caseUpper');
    expect(text(ed)).toBe('one TWO three');
    ed.destroy();
  });
  it('snake and camel turn the selection into one identifier', () => {
    const ed = make('<p>Hello World again</p>');
    select(ed, 1, ed.view.state.doc.content.size - 1);
    ed.execute('caseSnake');
    expect(text(ed)).toBe('hello_world_again');
    select(ed, 1, ed.view.state.doc.content.size - 1);
    ed.execute('caseCamel');
    expect(text(ed)).toBe('helloWorldAgain');
    ed.destroy();
  });
  it('toggle flips every letter, and twice gives the original back', () => {
    const ed = make('<p>Hello World</p>');
    select(ed, 1, 12);
    ed.execute('caseToggle');
    expect(text(ed)).toBe('hELLO wORLD');
    select(ed, 1, 12);
    ed.execute('caseToggle');
    expect(text(ed)).toBe('Hello World');
    ed.destroy();
  });
  it('title case works across a bold boundary', () => {
    const ed = make('<p>big <strong>red</strong>dog</p>');
    select(ed, 1, ed.view.state.doc.content.size - 1);
    ed.execute('caseTitle');
    expect(ed.getHTML()).toBe('<p>Big <strong>Red</strong>dog</p>');
    ed.destroy();
  });
  it('Shift+F3 cycles lower → UPPER → Title → Sentence', () => {
    const ed = make('<p>hello big world</p>');
    const end = () => select(ed, 1, ed.view.state.doc.content.size - 1);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) { end(); ed.execute('cycleCase'); seen.push(text(ed)); }
    expect(seen).toEqual(['HELLO BIG WORLD', 'Hello Big World', 'Hello big world', 'hello big world']);
    ed.destroy();
  });
  it('does nothing in a read-only editor', () => {
    const ed = make('<p>abc</p>');
    ed.setReadOnly?.(true);
    select(ed, 1, 4);
    expect(ed.execute('caseUpper')).toBe(false);
    ed.destroy();
  });
});
