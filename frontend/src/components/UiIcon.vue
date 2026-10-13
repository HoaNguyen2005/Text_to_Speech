<script setup>
import { computed } from 'vue';
const props = defineProps({ name: { type: String, default: 'wave' } });
const paths = {
  wave: 'M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4',
  book: 'M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5ZM4 17h14M8 7h6M8 11h4',
  document: 'M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM14 3v5h4M9 12h5M9 16h6',
  history: 'M3 11a9 9 0 1 1 3 8M3 5v6h6M12 7v5l3 2',
  mic: 'M9 6a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0V6ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  grid: 'M3 3h7v7H3V3ZM14 3h7v7h-7V3ZM3 14h7v7H3v-7ZM14 14h7v7h-7v-7Z',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3ZM8 12l3 3 5-6',
  upload: 'M12 16V3M7 8l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  logout: 'M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4M14 8l4 4-4 4M9 12h12',
  search: 'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM17 17l4 4',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M6 18 18 6',
  check: 'M5 12l4 4L19 6',
  refresh: 'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M18 18a8 8 0 0 1-13-3',
  headphones: 'M4 13v-1a8 8 0 0 1 16 0v1M3 14a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0v-4ZM17 14a2 2 0 0 1 4 0v4a2 2 0 0 1-4 0v-4Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
  spark: 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
};
const path = computed(() => paths[props.name] || paths.wave);
</script>

<template>
  <svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="path" />
  </svg>
</template>
