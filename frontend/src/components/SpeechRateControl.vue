<script setup>
import { computed, useId } from 'vue';
const props = defineProps({ modelValue: { type: Number, default: 0 }, disabled: Boolean, hint: { type: String, default: '' } });
const emit = defineEmits(['update:modelValue']);
const id = useId();
const speed = computed(() => (1 + props.modelValue / 100).toFixed(2) + 'x');
const fill = computed(() => `${(props.modelValue + 25) / 75 * 100}%`);
</script>

<template>
  <div class="speech-rate">
    <div class="speech-rate-heading"><label :for="id">{{ $t('Tốc độ đọc') }}</label><output :for="id">{{ speed }}</output><button v-if="modelValue !== 0" type="button" class="text-button" :disabled="disabled" @click="emit('update:modelValue', 0)">{{ $t('Đặt lại') }}</button></div>
    <input :id="id" type="range" min="-25" max="50" step="5" :value="modelValue" :disabled="disabled" :aria-valuetext="speed" :style="{ '--range-fill': fill }" @input="emit('update:modelValue', Number($event.target.value))" />
    <div class="speech-rate-labels"><span>{{ $t('Chậm hơn') }} · 0.75x</span><span>{{ $t('Nhanh hơn') }} · 1.50x</span></div>
    <p v-if="hint" class="speech-rate-hint">{{ hint }}</p>
  </div>
</template>

<style scoped>
.speech-rate { padding: 4px 0; min-width: 0; }
.speech-rate-heading { display:flex;align-items:center;gap:8px;min-height:28px;margin-bottom:9px;font-size:13px; }
.speech-rate-heading label { font-weight:600;color:var(--ink); }
.speech-rate-heading output { color:var(--accent);font-weight:750;font-variant-numeric:tabular-nums; }
.speech-rate-heading button { margin-left:auto;font-size:11px; }
.speech-rate input { display:block;appearance:none;width:100%;height:6px;border:0;border-radius:99px;margin:12px 0 15px;background:linear-gradient(to right,var(--accent) var(--range-fill),var(--line) var(--range-fill));cursor:pointer; }
.speech-rate input::-webkit-slider-thumb { appearance:none;width:17px;height:17px;border:2px solid var(--surface);border-radius:50%;background:var(--accent);box-shadow:0 1px 5px #0003; }
.speech-rate input::-moz-range-thumb { width:13px;height:13px;border:2px solid var(--surface);border-radius:50%;background:var(--accent); }
.speech-rate input:focus-visible { outline:2px solid var(--accent);outline-offset:7px; }
.speech-rate input:disabled { opacity:.5;cursor:default; }
.speech-rate-labels { display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted); }
.speech-rate-hint { margin:10px 0 0;font-size:11px;line-height:1.65;color:var(--muted); }
</style>
