<script setup>
import UiIcon from './UiIcon.vue';
defineProps({ title: String, description: String, eyebrow: String, icon: { type: String, default: 'wave' } });
const bars = [16, 30, 22, 45, 32, 62, 40, 76, 54, 92, 68, 100, 74, 50, 86, 60, 40, 68, 32, 50, 24, 36, 16];
</script>

<template>
  <section class="studio-banner" aria-labelledby="workspace-title">
    <div class="banner-copy">
      <p class="eyebrow"><UiIcon :name="icon" />{{ eyebrow }}</p>
      <h1 id="workspace-title">{{ title }}</h1>
      <p class="banner-description">{{ description }}</p>
      <div v-if="$slots.default" class="banner-actions"><slot /></div>
    </div>
    <div class="banner-art" aria-hidden="true">
      <span class="banner-orbit orbit-one" /><span class="banner-orbit orbit-two" />
      <div class="banner-wave"><span v-for="(bar, index) in bars" :key="index" :style="{ height: bar + '%' }" /></div>
      <span class="banner-art-caption"><UiIcon name="headphones" />{{ $t("TỪ CHỮ VIẾT ĐẾN THANH ÂM") }}</span>
    </div>
  </section>
</template>
