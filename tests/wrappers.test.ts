import { act, createElement, StrictMode, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createApp, h, nextTick, ref } from 'vue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Editor } from '../src';
import { WysiwygEditor as ReactEditor } from '../src/react';
import { WysiwygEditor as VueEditor } from '../src/vue';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<div id="host"></div>';
  host = document.getElementById('host')!;
});

describe('React wrapper', () => {
  let root: Root | null = null;
  afterEach(() => act(() => root?.unmount()));

  const render = (el: any) => {
    root = createRoot(host);
    act(() => root!.render(el));
  };
  const text = () => host.querySelector('.ProseMirror')!.innerHTML;

  it('mounts an editor with the initial value and reports changes', () => {
    const changes: string[] = [];
    const ref = createRef<Editor | null>();
    render(createElement(ReactEditor, { value: '<p>hi</p>', onChange: (h: string) => changes.push(h), ref }));
    expect(text()).toBe('<p>hi</p>');
    const e = ref.current!;
    act(() => e.view.dispatch(e.view.state.tr.insertText('X', 1)));
    expect(changes).toEqual(['<p>Xhi</p>']);
  });

  it('applies external value changes but not echoes of its own output', () => {
    let editor: Editor | null = null;
    const ref = (e: Editor | null) => {
      if (e) editor = e;
    };
    const App = ({ value }: { value: string }) => createElement(ReactEditor, { value, ref });
    render(createElement(App, { value: '<p>a</p>' }));
    act(() => root!.render(createElement(App, { value: '<p>external</p>' })));
    expect(text()).toBe('<p>external</p>');
    // an echo: the parent passes back exactly what onChange emitted; selection must not be reset
    act(() => editor!.view.dispatch(editor!.view.state.tr.insertText('Z', 1)));
    const sel = editor!.view.state.selection.from;
    act(() => root!.render(createElement(App, { value: editor!.getHTML() })));
    expect(editor!.view.state.selection.from).toBe(sel);
  });

  it('survives React StrictMode (mount, unmount, re-mount) without duplicate editors', () => {
    render(createElement(StrictMode, null, createElement(ReactEditor, { value: '<p>x</p>' })));
    expect(host.querySelectorAll('.wy-editor')).toHaveLength(1);
    expect(host.querySelectorAll('.ProseMirror')).toHaveLength(1);
  });

  it('destroys the editor on unmount and toggles read-only', () => {
    const ref = createRef<Editor | null>();
    const App = ({ ro }: { ro: boolean }) => createElement(ReactEditor, { value: '<p>x</p>', readOnly: ro, ref });
    render(createElement(App, { ro: false }));
    expect(ref.current!.view.editable).toBe(true);
    act(() => root!.render(createElement(App, { ro: true })));
    expect(ref.current!.view.editable).toBe(false);
    act(() => root!.unmount());
    root = null;
    expect(host.querySelector('.wy-editor')).toBeNull();
  });

  it('passes through div props, plugins config, and pages', () => {
    render(createElement(ReactEditor, { value: '<p>x</p>', className: 'my-class', id: 'ed', pages: true }));
    expect(host.querySelector('#ed.my-class')).not.toBeNull();
    expect(host.querySelector('.wy-paged')).not.toBeNull();
  });
});

describe('Vue wrapper', () => {
  it('supports v-model in both directions and cleans up on unmount', async () => {
    const model = ref('<p>start</p>');
    let comp: any;
    const app = createApp({ render: () => h(VueEditor, { modelValue: model.value, 'onUpdate:modelValue': (v: string) => (model.value = v), ref: (r: any) => (comp = r) }) });
    app.mount(host);
    await nextTick();
    expect(host.querySelector('.ProseMirror')!.innerHTML).toBe('<p>start</p>');

    const e: Editor = comp.getEditor();
    e.view.dispatch(e.view.state.tr.insertText('A', 1));
    expect(model.value).toBe('<p>Astart</p>');

    model.value = '<p>from parent</p>';
    await nextTick();
    expect(host.querySelector('.ProseMirror')!.innerHTML).toBe('<p>from parent</p>');

    app.unmount();
    expect(host.querySelector('.wy-editor')).toBeNull();
  });

  it('toggles read-only reactively', async () => {
    const ro = ref(false);
    let comp: any;
    const app = createApp({ render: () => h(VueEditor, { modelValue: '<p>x</p>', readOnly: ro.value, ref: (r: any) => (comp = r) }) });
    app.mount(host);
    await nextTick();
    expect(comp.getEditor().view.editable).toBe(true);
    ro.value = true;
    await nextTick();
    expect(comp.getEditor().view.editable).toBe(false);
    app.unmount();
  });
});
