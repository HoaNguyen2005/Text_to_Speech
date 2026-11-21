<script setup>
import FloatingLines from './vue-bits/FloatingLines.vue';

defineProps({ paused: Boolean, dark: Boolean, compact: Boolean });
defineEmits(['ready', 'unavailable']);
const desktop = [4, 6, 4], mobile = [2, 3, 2], distances = [6, 5, 6];
const lightPalette = ['#6032ba', '#29818a', '#8c6adc'];
const darkPalette = ['#a78bfa', '#67e8f9', '#c4b5fd'];
</script>

<template>
  <FloatingLines class="studio-lines" :class="{ 'studio-lines-dark': dark }"
    :paused="paused" :lines-gradient="dark ? darkPalette : lightPalette"
    :line-count="compact ? mobile : desktop" :line-distance="distances"
    :animation-speed=".45" :interactive="!compact" :bend-radius="2.5" :bend-strength="-.8"
    :mouse-damping=".1" :parallax="!compact" :parallax-strength=".11"
    @ready="$emit('ready')" @unavailable="$emit('unavailable')" />
</template>

<style scoped>
.studio-lines { opacity: .27; }
.studio-lines-dark { opacity: .24; }
</style>
