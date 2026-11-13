<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import { useTheme } from '@/composables/useTheme';

const props = defineProps({ paused: Boolean, hero: Boolean });
const FloatingLines = defineAsyncComponent(() => import('./vue-bits/FloatingLines.vue'));
const Particles = defineAsyncComponent(() => import('./vue-bits/Particles.vue'));
const { isDark } = useTheme();
const reduced = ref(true), compact = ref(false), ready = ref(false), failed = ref(false);
const lineCount = computed(() => compact.value ? [2, 3, 2] : [4, 6, 4]);
const lineDistance = [6, 5, 6];
const particleColors = ['#ffffff', '#b7e9ff', '#d1c0ff'];
const colors = computed(() => props.hero || isDark.value
  ? ['#a78bfa', '#67e8f9', '#c4b5fd'] : ['#6032ba', '#29818a', '#8c6adc']);
let motionQuery, sizeQuery;
function updatePreferences() {
  reduced.value = motionQuery.matches;
  compact.value = sizeQuery.matches;
  if (reduced.value) ready.value = false;
}
onMounted(() => {
  motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
  sizeQuery = matchMedia('(max-width: 600px)');
  updatePreferences();
  motionQuery.addEventListener('change', updatePreferences);
  sizeQuery.addEventListener('change', updatePreferences);
});
onBeforeUnmount(() => {
  motionQuery?.removeEventListener('change', updatePreferences);
  sizeQuery?.removeEventListener('change', updatePreferences);
});
</script>

<template>
  <div class="studio-atmosphere" aria-hidden="true">
    <span class="aurora-band aurora-violet"></span>
    <span class="aurora-band aurora-cyan"></span>
    <Particles v-if="hero && !reduced && !failed" class="particles-layer" :paused="paused" :interactive="!compact"
      :count="compact ? 90 : 180" :colors="particleColors" @ready="ready=true" @unavailable="failed=true;ready=false" />
    <FloatingLines v-else-if="!hero && !reduced && !failed" class="floating-lines-layer"
      :paused="paused" :lines-gradient="colors" :line-count="lineCount"
      :line-distance="lineDistance" :animation-speed=".45" :interactive="!compact"
      :bend-radius="2.5" :bend-strength="-.8" :mouse-damping=".1" :parallax="!compact" :parallax-strength=".11"
      @ready="ready=true" @unavailable="failed=true;ready=false" />
    <span v-if="hero && !ready" class="particles-fallback"></span>
    <svg v-if="!hero" v-show="!ready" class="atmosphere-lines" viewBox="0 0 1200 400" fill="none" preserveAspectRatio="none">
      <path d="M-100 320C200 30 370 440 650 180S1000 80 1300 120" />
      <path d="M-100 340C200 50 370 460 650 200S1000 100 1300 140" />
      <path d="M-100 360C200 70 370 480 650 220S1000 120 1300 160" />
    </svg>
  </div>
</template>
