<script setup>
import { ref } from 'vue';
import UiIcon from './UiIcon.vue';
import StudioAtmosphere from './StudioAtmosphere.vue';
import { useSceneMotion } from '@/composables/useSceneMotion';
defineProps({ title: String, description: String, eyebrow: String, icon: { type: String, default: 'wave' } });
const bars = [16, 30, 22, 45, 32, 62, 40, 76, 54, 92, 68, 100, 74, 50, 86, 60, 40, 68, 32, 50, 24, 36, 16];
const scene = ref(null);
const motionPaused = useSceneMotion(scene);
</script>

<template>
  <section ref="scene" class="studio-banner" :class="{ 'motion-paused': motionPaused }" aria-labelledby="workspace-title">
    <StudioAtmosphere :paused="motionPaused" hero />
    <div class="banner-copy">
      <p class="eyebrow"><UiIcon :name="icon" />{{ eyebrow }}</p>
      <h1 id="workspace-title">{{ title }}</h1>
      <p class="banner-description">{{ description }}</p>
      <div v-if="$slots.default" class="banner-actions"><slot /></div>
    </div>
    <div class="banner-art" aria-hidden="true">
      <span class="studio-float studio-float-book"><UiIcon :name="icon" /></span>
      <span class="studio-float studio-float-headphones"><UiIcon name="headphones" /></span>
      <div class="banner-wave"><span v-for="(bar, index) in bars" :key="index" :style="{ height: bar + '%', '--wave-delay': index * -.21 + 's' }" /></div>
      <span class="banner-art-caption"><UiIcon name="headphones" />{{ $t("TỪ CHỮ VIẾT ĐẾN THANH ÂM") }}</span>
    </div>
  </section>
</template>
