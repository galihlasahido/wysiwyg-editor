/** Vue 3 wrapper (needs the optional `vue` peer dependency). */
import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue';
import { createEditor, type Editor, type EditorConfig } from './index';

/**
 * `<WysiwygEditor v-model="html" />`. Editor options are read once on mount; `modelValue` and `readOnly`
 * stay in sync. The `Editor` instance is exposed as `editor` (via a template ref).
 */
export const WysiwygEditor = defineComponent({
  name: 'WysiwygEditor',
  props: {
    modelValue: { type: String, default: '' },
    readOnly: { type: Boolean, default: false },
    plugins: { type: Array as PropType<EditorConfig['plugins']>, default: undefined },
    pages: { type: [Boolean, Object] as PropType<Parameters<typeof createEditor>[0]['pages']>, default: false },
    outline: { type: Boolean, default: false },
    placeholder: { type: String, default: undefined },
    direction: { type: String as PropType<'ltr' | 'rtl' | 'auto'>, default: undefined },
    locale: { type: String, default: undefined },
  },
  emits: ['update:modelValue'],
  setup(props, { emit, expose }) {
    const host = ref<HTMLElement | null>(null);
    let editor: Editor | null = null;
    let lastEmitted: string | undefined;

    onMounted(() => {
      editor = createEditor({
        element: host.value!,
        content: props.modelValue,
        plugins: props.plugins,
        pages: props.pages,
        outline: props.outline,
        placeholder: props.placeholder,
        direction: props.direction,
        locale: props.locale,
        readOnly: props.readOnly,
        onChange: (html) => {
          lastEmitted = html;
          emit('update:modelValue', html);
        },
      });
    });
    onBeforeUnmount(() => {
      editor?.destroy();
      editor = null;
    });

    watch(() => props.modelValue, (value) => {
      if (editor && value !== lastEmitted && value !== editor.getHTML()) editor.setHTML(value);
    });
    watch(() => props.readOnly, (ro) => editor && editor.isReadOnly !== ro && editor.setReadOnly(ro));

    expose({ getEditor: () => editor });
    return () => h('div', { ref: host });
  },
});
