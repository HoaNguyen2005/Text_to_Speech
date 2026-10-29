<script setup>
import { computed, ref } from 'vue';
import UiIcon from './UiIcon.vue';
import { translate } from '@/composables/useLocale';
import { notify } from '@/composables/useNotifications';
import { stripCues } from '@/services/expressions';

const props = defineProps({
  title: { type: String, default: '' },
  metadata: { type: Object, default: null },
  text: { type: String, default: '' },
  introduction: { type: String, default: '' },
  sections: { type: Array, default: () => [] },
  disabled: Boolean,
});
const format = ref('md');
const hasContent = computed(() => Boolean(props.text.trim() || props.sections.some(section => section.text?.trim())));
const cleanLine = value => String(value || '').replace(/[\r\n]+/gu, ' ').trim();
const markdownLabel = value => cleanLine(value).replace(/[\\`*_{}\[\]<>#!|]/gu, '\\$&');

function download() {
  if (props.disabled || !hasContent.value) return;
  let url;
  try {
    const markdown = format.value === 'md';
    const title = cleanLine(props.metadata?.title || props.title) || translate('Bản tóm tắt');
    const heading = value => markdown ? markdownLabel(value) : cleanLine(value);
    const field = (label, value) => markdown
      ? `**${heading(translate(label))}:** ${heading(value || translate('Chưa cung cấp'))}`
      : `${translate(label)}: ${cleanLine(value) || translate('Chưa cung cấp')}`;
    const content = [
      markdown ? `# ${heading(title)}` : title,
      translate('Bản tóm tắt do AI hỗ trợ'),
      field('Tác giả', props.metadata?.author),
      field('Nguồn', props.metadata?.source),
      translate('Thông tin nguồn do người tạo cung cấp. Hãy đối chiếu tác phẩm gốc khi cần thông tin chi tiết.'),
    ];
    if (props.text.trim()) content.push(props.text.trim());
    else {
      if (props.introduction.trim()) content.push(props.introduction.trim());
      props.sections.forEach((section, index) => {
        content.push(`${markdown ? '## ' : ''}${index + 1}. ${heading(section.title)}`, section.text || '');
      });
    }
    // Download locally; document text never becomes HTML or an extra AI request.
    const body = stripCues(content.join('\n\n')).replace(/\r\n?/gu, '\n') + '\n';
    const filename = title.normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 100).trim() || 'sach';
    const blob = new Blob([markdown ? '' : '\uFEFF', body], {
      type: markdown ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8',
    });
    url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tom-tat-${filename}.${format.value}`;
    document.body.append(link);
    try { link.click(); } finally { link.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify('Đã xuất bản tóm tắt.', { kind: 'success' });
  } catch {
    if (url) URL.revokeObjectURL(url);
    notify('Chưa tải được bản tóm tắt. Hãy thử lại.', { kind: 'error' });
  }
}
</script>

<template>
  <div class="summary-download">
    <select v-model="format" class="input summary-download-format" :disabled="disabled || !hasContent" :aria-label="$t('Định dạng tải bản tóm tắt')">
      <option value="md">Markdown (.md)</option><option value="txt">Text (.txt)</option>
    </select>
    <button type="button" class="btn small" :disabled="disabled || !hasContent" @click="download"><UiIcon name="download" />{{ $t('Tải bản tóm tắt') }}</button>
  </div>
</template>

<style scoped>
.summary-download { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.summary-download-format { width: 150px; min-height: 34px; padding: 7px 28px 7px 10px; font-size: 11px; }
</style>
