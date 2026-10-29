<script setup>
import UiIcon from './UiIcon.vue';
import { useLocale } from '@/composables/useLocale';
const { locale, setLocale } = useLocale();
</script>

<template>
  <label class="locale-control">
    <UiIcon name="language" />
    <span class="sr-only">{{ $t('Ngôn ngữ') }}</span>
    <select :value="locale" :aria-label="$t('Chọn ngôn ngữ giao diện')" @change="setLocale($event.target.value)">
      <option value="vi" lang="vi">Tiếng Việt</option>
      <option value="en" lang="en">English</option>
    </select>
  </label>
</template>
