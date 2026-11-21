<script setup>
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { useTheme } from '@/composables/useTheme';

const props = defineProps({ paused: Boolean, hero: Boolean });
const StudioLines = defineAsyncComponent(() => import('./StudioLines.vue'));
const Particles = defineAsyncComponent(() => import('./vue-bits/Particles.vue'));
const { isDark } = useTheme();
const reduced = ref(true), compact = ref(false), ready = ref(false), failed = ref(false);
const layer = ref(null);
watchEffect(onCleanup => {
  if ((!props.hero && !failed.value) || reduced.value || compact.value || props.paused) return;
  const element = layer.value;
  const scene = element?.closest('.studio-banner, .welcome-page, .app-shell');
  if (!scene) return;
  const target = props.hero ? scene : element;
  const reset = () => {
    target.style.removeProperty('--studio-x');
    target.style.removeProperty('--studio-y');
  };
  const move = event => {
    if (event.pointerType === 'touch') return;
    const rect = element.getBoundingClientRect();
    target.style.setProperty('--studio-x', ((event.clientX - rect.left) / rect.width - .5) * 32 + 'px');
    target.style.setProperty('--studio-y', ((event.clientY - rect.top) / rect.height - .5) * 20 + 'px');
  };
  scene.addEventListener('pointermove', move, { passive: true });
  scene.addEventListener('pointerleave', reset);
  onCleanup(() => {
    scene.removeEventListener('pointermove', move);
    scene.removeEventListener('pointerleave', reset);
    reset();
  });
});
const particleColors = ['#ffffff', '#b7e9ff', '#d1c0ff'];
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
  <div ref="layer" class="studio-atmosphere" aria-hidden="true">
    <span class="aurora-band aurora-violet"></span>
    <span class="aurora-band aurora-cyan"></span>
    <Particles v-if="hero && !reduced && !failed" class="particles-layer" :paused="paused" :interactive="!compact"
      :count="compact ? 90 : 180" :colors="particleColors" @ready="ready=true" @unavailable="failed=true;ready=false" />
    <StudioLines v-else-if="!hero && !reduced && !failed" :dark="isDark" :compact="compact" :paused="paused"
      @ready="ready=true" @unavailable="failed=true;ready=false" />
    <span v-if="hero && !ready" class="particles-fallback"></span>
    <svg v-if="!hero" v-show="!ready" class="atmosphere-lines" viewBox="0 0 1200 400" fill="none" preserveAspectRatio="none">
      <path fill="var(--wave-mid)" stroke="none" d="M-100 110Q260 228 660 266T1300 355Q985 300 660 282T-100 137Z" />
      <path stroke="var(--hero-accent)" stroke-width="3" d="M-100 137Q260 244 660 282T1300 360" />
      <path d="M-100 142Q260 250 660 285T1300 364" />
    </svg>
  </div>
</template>
