<script setup>
import UiIcon from './UiIcon.vue';
import { useTheme } from '@/composables/useTheme';
const { isDark, toggleTheme } = useTheme();
</script>

<template>
  <button type="button" class="theme-toggle" :aria-label="$t('Chế độ tối')" :aria-pressed="isDark"
    :title="isDark?$t('Chuyển sang giao diện sáng'):$t('Chuyển sang giao diện tối')" @click="toggleTheme">
    <UiIcon :name="isDark ? 'moon' : 'sun'" />
    <span aria-hidden="true">{{ isDark ? $t("Tối") : $t("Sáng") }}</span>
    <span class="theme-toggle-track" aria-hidden="true"><span /></span>
  </button>
</template>
