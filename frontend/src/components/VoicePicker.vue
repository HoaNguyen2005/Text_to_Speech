<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import api from '@/services/api';
import { session, refreshSession } from '@/services/auth';
import { notify, confirmAction } from '@/composables/useNotifications';
import UiIcon from './UiIcon.vue';
import VoiceEditorDialog from './VoiceEditorDialog.vue';
import { openUpgrade } from '@/composables/useAccountTier';

const props = defineProps({
  modelValue: String,
  voices: { type: Array, default: () => [] },
  disabled: Boolean,
  loading: Boolean,
  provider: { type: String, default: 'edge' },
  manage: Boolean,
  admin: Boolean,
  hideTrigger: Boolean,
  inline: Boolean,
  initialGroup: { type: String, default: 'system' }
});
const emit = defineEmits(['update:modelValue', 'refresh', 'lock']);

const opened = ref(false);
const dialog = ref(null);
const search = ref('');
const tab = ref(props.initialGroup);
const gender = ref('all');
const playing = ref('');
const preparing = ref('');
const lastVoice = ref(null);
const currentTime = ref(0);
const duration = ref(0);
const editOpen = ref(false);
const editing = ref(null);
const hiding = ref('');
let audio, objectUrl, abort, sequence = 0;
let nextTab;

const keyOf = voice => voice.choice_id || voice.voice_id;
const originOf = voice => voice.origin || (!voice._id || voice.is_global ? 'system' : 'user');
const tierOf = voice => (voice?.class === 'gold' || voice?.class === 'diamond') ? voice.class : 'free';
const chosen = computed(() => props.voices.find(v => keyOf(v) === props.modelValue));
const chosenTier = computed(() => tierOf(chosen.value));
const hasOwnVoices = computed(() => props.voices.some(voice => originOf(voice) === 'user'));
const systemCount = computed(() => props.voices.filter(voice => originOf(voice) === 'system').length);
const ownCount = computed(() => props.voices.filter(voice => originOf(voice) === 'user').length);
const activePreviewVoice = computed(() => {
  const currentId = playing.value || preparing.value;
  if (currentId) return props.voices.find(v => keyOf(v) === currentId) || lastVoice.value;
  return lastVoice.value;
});
const filtered = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('vi');
  return props.voices.filter(v =>
    originOf(v) === (tab.value === 'mine' ? 'user' : 'system') &&
    (gender.value === 'all' || v.gender === gender.value) &&
    (!query || [v.name, v.voice_id, v.description].join(' ').toLocaleLowerCase('vi').includes(query))
  );
});

const initials = name => (name || '').trim().split(/\s+/u).slice(-2).map(w => w[0]).join('').toUpperCase();
const formatSeconds = value => {
  const total = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
const toggleGender = value => { gender.value = gender.value === value ? 'all' : value; };
const resetFilters = () => { gender.value = 'all'; search.value = ''; };

function stop() {
  sequence++;
  abort?.abort();
  abort = null;
  if (audio) {
    audio.pause();
    audio.src = '';
    audio = null;
  }
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = null;
  playing.value = '';
  preparing.value = '';
  currentTime.value = 0;
  duration.value = 0;
}

watch(opened, async open => {
  if (props.inline) return;
  await nextTick();
  if (open) {
    tab.value = nextTab || (chosen.value ? (originOf(chosen.value) === 'user' ? 'mine' : 'system') : props.initialGroup);
    nextTab = undefined;
    dialog.value?.showModal?.();
  } else {
    stop();
    dialog.value?.close?.();
  }
});
watch(() => [props.provider, props.voices], () => {
  const currentId = playing.value || preparing.value;
  if (!currentId) return;
  if (!props.voices.some(v => keyOf(v) === currentId)) stop();
});
watch(() => session.value?.tier_info?.effective_class, () => emit('refresh'));

function choose(voice) {
  if (props.disabled) return;
  if (voice.usable === false) {
    openUpgrade();
    return;
  }
  emit('update:modelValue', keyOf(voice));
  if (!props.inline) opened.value = false;
}

async function play(voice) {
  if (!voice) return;
  const voiceKey = keyOf(voice);
  if (playing.value === voiceKey || preparing.value === voiceKey) {
    stop();
    return;
  }
  stop();
  const current = sequence;
  lastVoice.value = voice;
  preparing.value = voiceKey;
  abort = new AbortController();
  try {
    const endpoint = voice._id ? `/api/voices/${voice._id}/preview` : `/api/voices/presets/${voice.provider || props.provider}/${voice.voice_id}/preview`;
    const { data } = await api.get(endpoint, { responseType: 'blob', timeout: 20 * 60 * 1000, signal: abort.signal });
    if (current !== sequence) return;
    objectUrl = URL.createObjectURL(data);
    audio = new Audio(objectUrl);
    audio.onloadedmetadata = () => {
      if (current === sequence) duration.value = Math.min(audio?.duration || 30, 30);
    };
    audio.onended = () => { if (current === sequence) stop(); };
    audio.ontimeupdate = () => {
      if (current !== sequence || !audio) return;
      currentTime.value = Math.min(audio.currentTime || 0, 30);
      if (audio.duration) duration.value = Math.min(audio.duration, 30);
      if (audio.currentTime >= 30) stop();
    };
    audio.onerror = () => {
      if (current === sequence) {
        stop();
        notify('Không phát được giọng nghe mẫu.', { kind: 'error' });
      }
    };
    await audio.play();
    if (current === sequence) playing.value = voiceKey;
  } catch (error) {
    if (current !== sequence || error.code === 'ERR_CANCELED') return;
    let message = error.response?.data?.error;
    if (error.response?.data instanceof Blob) {
      try { message = JSON.parse(await error.response.data.text()).error; } catch {}
    }
    stop();
    notify(message || 'Không phát được giọng nghe mẫu.', { kind: 'error' });
  } finally {
    if (current === sequence) preparing.value = '';
  }
}

async function hide(voice) {
  stop();
  if (props.admin) {
    emit('lock', voice);
    return;
  }
  if (!await confirmAction({ key: 'Ẩn giọng mẫu “{0}” khỏi danh sách sử dụng?', params: [voice.name] }, { title: 'Ẩn giọng mẫu', confirmLabel: 'Ẩn giọng', danger: true })) return;
  hiding.value = voice.voice_id;
  try {
    await api.delete(`/api/voices/${voice._id}`);
    if (props.modelValue === keyOf(voice)) emit('update:modelValue', '');
    emit('refresh');
    await refreshSession().catch(() => {});
    notify('Đã ẩn giọng mẫu khỏi danh sách sử dụng.', { kind: 'success' });
  } catch (error) {
    notify(error.response?.data?.error || 'Không thể ẩn giọng mẫu.', { kind: 'error' });
  } finally {
    hiding.value = '';
  }
}

function edit(voice) {
  stop();
  editing.value = voice;
  editOpen.value = true;
}

function saved(voice) {
  if (voice) {
    tab.value = voice.is_global ? 'system' : 'mine';
    search.value = '';
    gender.value = 'all';
    if (!props.inline && !editing.value && !opened.value) {
      nextTab = tab.value;
      opened.value = true;
    }
  }
  emit('refresh');
}

defineExpose({ open: () => { if (!props.inline) opened.value = true; }, edit, add: () => edit(null) });
onBeforeUnmount(() => {
  stop();
  if (!props.inline) dialog.value?.close?.();
});
</script>

<template>
  <button
    v-if="!hideTrigger && !inline"
    type="button"
    class="voice-picker-trigger"
    :class="chosenTier !== 'free' ? `tier-trigger-${chosenTier}` : ''"
    :disabled="disabled || loading"
    aria-haspopup="dialog"
    @click="opened = true"
  >
    <span class="voice-avatar" :class="chosenTier !== 'free' ? `avatar-tier-${chosenTier}` : ''">
      <UiIcon name="wave" />
      <span v-if="chosenTier !== 'free'" class="avatar-tier-spark" aria-hidden="true">✦</span>
    </span>
    <span class="voice-trigger-body">
      <span class="voice-name-frame" :class="chosenTier !== 'free' ? `is-${chosenTier}` : ''">
        <span class="voice-trigger-name" :class="chosenTier !== 'free' ? `tier-text-${chosenTier}` : ''">
          {{ loading ? $t('Đang tải danh sách giọng…') : chosen?.name || $t(manage ? 'Mở thư viện giọng' : 'Chọn giọng đọc') }}
        </span>
      </span>
    </span>
    <UiIcon name="chevron" />
  </button>

  <Teleport to="body" :disabled="inline">
    <component
      :is="inline ? 'div' : 'dialog'"
      ref="dialog"
      class="voice-picker-surface"
      :class="inline ? 'voice-picker-inline' : 'voice-picker-dialog'"
      :aria-labelledby="!inline ? 'voice-picker-heading' : undefined"
      :aria-label="inline ? $t('Thư viện giọng đọc') : undefined"
      @cancel.prevent="!inline && (opened = false)"
      @click="event => { if (!inline && event.target === dialog) opened = false; }"
    >
      <header v-if="!inline" class="voice-picker-header">
        <h2 id="voice-picker-heading">{{ $t(manage ? 'Thư viện giọng đọc' : 'Chọn giọng đọc') }}</h2>
        <button type="button" class="btn small voice-picker-close" :aria-label="$t('Đóng')" @click="opened = false">
          <UiIcon name="close" />
        </button>
      </header>

      <div class="voice-picker-body">
        <aside class="voice-picker-sidebar" :aria-label="$t('Giới tính')">
          <div class="voice-filter-group">
            <h3 class="voice-filter-label">{{ $t('Giới tính') }}</h3>
            <div class="voice-gender-pills">
              <button type="button" class="voice-filter-pill" :class="{ active: gender === 'male' }" :aria-pressed="gender === 'male'" @click="toggleGender('male')">
                <span aria-hidden="true">♂</span>{{ $t('Nam') }}
              </button>
              <button type="button" class="voice-filter-pill" :class="{ active: gender === 'female' }" :aria-pressed="gender === 'female'" @click="toggleGender('female')">
                <span aria-hidden="true">♀</span>{{ $t('Nữ') }}
              </button>
              <button type="button" class="voice-filter-pill" :class="{ active: gender === 'all' }" :aria-pressed="gender === 'all'" @click="gender = 'all'">
                {{ $t('Tất cả giới tính') }}
              </button>
            </div>
          </div>
          <button type="button" class="text-button voice-reset-filters" :disabled="gender === 'all' && !search" @click="resetFilters">
            <UiIcon name="refresh" />{{ $t('Đặt lại bộ lọc') }}
          </button>
        </aside>

        <div class="voice-picker-main">
          <div class="voice-picker-topbar">
            <div class="voice-picker-tabs">
              <button type="button" :class="{ active: tab === 'system' }" :aria-pressed="tab === 'system'" @click="tab = 'system'">
                <UiIcon name="wave" />{{ $t('Giọng hệ thống') }}
                <span class="voice-tab-count">{{ systemCount }}</span>
              </button>
              <button type="button" :class="{ active: tab === 'mine' }" :aria-pressed="tab === 'mine'" @click="tab = 'mine'">
                <UiIcon name="mic" />{{ $t('Giọng của bạn') }}
                <span class="voice-tab-count">{{ ownCount }}</span>
              </button>
            </div>
            <div class="voice-picker-searchbar">
              <div class="search-field voice-picker-search">
                <UiIcon name="search" />
                <input v-model="search" class="input" type="search" :aria-label="$t('Tìm giọng đọc')" :placeholder="$t('Tìm tên giọng đọc…')" />
              </div>
              <button v-if="session" type="button" class="btn primary small voice-picker-add" :disabled="disabled" @click="edit(null)">
                <UiIcon name="plus" />{{ $t('Thêm giọng mới') }}
              </button>
            </div>
          </div>

          <div class="voice-picker-count">
            <strong>{{ filtered.length }} {{ $t('giọng đọc') }}</strong>
            <span class="voice-count-hint">{{ $t('Bấm vào dòng để nghe thử') }}</span>
          </div>

          <div class="voice-picker-list">
            <div
              v-for="(voice, index) in filtered"
              :key="keyOf(voice)"
              role="button"
              tabindex="0"
              class="voice-row"
              :class="[
                {
                  selected: keyOf(voice) === modelValue,
                  playing: playing === keyOf(voice) || preparing === keyOf(voice),
                  locked: voice.usable === false
                },
                tierOf(voice) !== 'free' ? `row-tier-${tierOf(voice)}` : ''
              ]"
              :style="{ '--voice-enter-delay': Math.min(index, 8) * 24 + 'ms' }"
              :aria-label="$t('Nghe mẫu {0}', [voice.name])"
              @click="play(voice)"
              @keydown.enter.self.prevent="play(voice)"
              @keydown.space.self.prevent="play(voice)"
            >
              <span class="voice-avatar voice-row-avatar" :class="tierOf(voice) !== 'free' ? `avatar-tier-${tierOf(voice)}` : ''" aria-hidden="true">
                <span class="voice-avatar-initials">{{ initials(voice.name) }}</span>
                <span class="voice-avatar-play">
                  <span v-if="preparing === keyOf(voice)" class="spinner" />
                  <UiIcon v-else :name="playing === keyOf(voice) ? 'pause' : 'play'" />
                </span>
                <span v-if="tierOf(voice) !== 'free'" class="avatar-tier-spark">✦</span>
              </span>

              <div class="voice-row-info">
                <div class="voice-row-titleline">
                  <span class="voice-name-frame" :class="tierOf(voice) !== 'free' ? `is-${tierOf(voice)}` : ''">
                    <strong class="voice-row-name" :class="tierOf(voice) !== 'free' ? `tier-text-${tierOf(voice)}` : ''" :title="voice.name">
                      {{ voice.name }}
                    </strong>
                  </span>
                  <span v-if="keyOf(voice) === modelValue" class="voice-selected-mark" :title="$t('Đã chọn')">
                    <UiIcon name="check" />
                  </span>
                </div>
                <p class="voice-row-desc" :title="voice.description">{{ voice.description || $t('Nghe mẫu để chọn giọng phù hợp.') }}</p>
              </div>

              <div class="voice-row-meta">
                <span class="voice-lang-tag"><span class="voice-flag-vn" aria-hidden="true">★</span>{{ $t('Tiếng Việt') }}</span>
                <span class="voice-gender-tag">{{ voice.gender === 'female' ? '♀' : '♂' }} {{ $t(voice.gender === 'female' ? 'Nữ' : 'Nam') }}</span>
                <span class="voice-class" :class="tierOf(voice)">{{ ({ free: 'Free', gold: 'Gold', diamond: 'Diamond' })[tierOf(voice)] }}</span>
                <code v-if="admin && voice.voice_id" class="voice-code-tag">{{ voice.voice_id }}</code>
                <span v-if="admin && voice.is_active === false" class="pill amber">{{ $t('Đã khóa') }}</span>
              </div>

              <div class="voice-row-actions">
                <button
                  type="button"
                  class="btn small voice-use-btn"
                  :class="{ 'is-selected': keyOf(voice) === modelValue, 'is-upgrade': voice.usable === false }"
                  :disabled="disabled"
                  :title="voice.usable === false ? $t('Nâng cấp để dùng giọng này') : undefined"
                  @click.stop="choose(voice)"
                >
                  <UiIcon name="wave" />
                  <span>{{ $t('Chọn') }}</span>
                </button>
                <div v-if="voice.can_edit" class="voice-row-manage">
                  <button type="button" class="text-button" :disabled="disabled" @click.stop="edit(voice)">
                    <UiIcon name="edit" />{{ $t('Chỉnh sửa') }}
                  </button>
                  <button type="button" class="text-button" :disabled="disabled || hiding === voice.voice_id" @click.stop="hide(voice)">
                    {{ $t(admin ? (voice.is_active === false ? 'Mở khóa' : 'Khóa') : 'Ẩn giọng') }}
                  </button>
                </div>
              </div>
            </div>

            <p v-if="!filtered.length" class="voice-empty">
              {{ $t(loading ? 'Đang tải danh sách giọng…' : tab === 'mine' && !hasOwnVoices && !search && gender === 'all' ? 'Bạn chưa có giọng riêng. Bấm Thêm giọng mới để bắt đầu.' : 'Không tìm thấy giọng đọc phù hợp.') }}
            </p>
          </div>
        </div>
      </div>

      <footer class="voice-picker-footer">
        <div class="voice-player-bar">
          <template v-if="activePreviewVoice">
            <button
              type="button"
              class="btn small voice-player-toggle"
              :class="{ playing: playing === keyOf(activePreviewVoice) || preparing === keyOf(activePreviewVoice) }"
              :aria-label="playing === keyOf(activePreviewVoice) || preparing === keyOf(activePreviewVoice) ? $t('Dừng') : $t('Nghe mẫu')"
              @click="play(activePreviewVoice)"
            >
              <span v-if="preparing === keyOf(activePreviewVoice)" class="spinner" />
              <UiIcon v-else :name="playing === keyOf(activePreviewVoice) ? 'pause' : 'play'" />
            </button>
            <span class="voice-player-label">{{ $t('Đang nghe thử') }}:</span>
            <span class="voice-name-frame" :class="tierOf(activePreviewVoice) !== 'free' ? `is-${tierOf(activePreviewVoice)}` : ''">
              <strong class="voice-player-name" :class="tierOf(activePreviewVoice) !== 'free' ? `tier-text-${tierOf(activePreviewVoice)}` : ''">
                {{ activePreviewVoice.name }}
              </strong>
            </span>
            <span class="voice-player-time">{{ formatSeconds(currentTime) }} / {{ formatSeconds(duration || 30) }}</span>
          </template>
          <small v-else>{{ $t('Chọn giọng để nghe thử tối đa 30 giây.') }}</small>
        </div>
        <button type="button" class="text-button" :disabled="loading" @click="emit('refresh')">
          <UiIcon name="refresh" />{{ $t('Tải lại') }}
        </button>
      </footer>
    </component>
  </Teleport>

  <VoiceEditorDialog v-model:open="editOpen" :voice="editing" @saved="saved" />
</template>

<style>
.voice-picker-trigger {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 64px;
  padding: 11px 14px;
  border: 1.5px solid var(--input-border);
  border-radius: 14px;
  background: var(--input-bg);
  color: var(--ink);
  text-align: left;
  font: inherit;
  cursor: pointer;
  box-shadow: var(--input-shadow);
  transition: border-color .16s, background-color .16s, box-shadow .16s;
}
.voice-picker-trigger:hover:not(:disabled) {
  border-color: var(--input-border-hover);
  background: var(--input-bg-hover);
}
.voice-picker-trigger.tier-trigger-gold {
  border-color: var(--gold-border);
  box-shadow: var(--input-shadow), 0 0 0 1px rgb(245 158 11 / 16%);
}
.voice-picker-trigger.tier-trigger-diamond {
  border-color: var(--diamond-border);
  box-shadow: var(--input-shadow), 0 0 0 1px rgb(56 189 248 / 18%);
}
.voice-picker-trigger:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3.5px var(--focus-ring);
}
.voice-trigger-body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}
.voice-trigger-name {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.voice-avatar {
  position: relative;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 750;
}
.voice-picker-trigger > .ui-icon {
  width: 17px;
  color: var(--muted);
}
.voice-picker-trigger:disabled {
  opacity: .6;
  cursor: not-allowed;
}

.voice-picker-surface {
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  color: var(--ink);
}
.voice-picker-dialog {
  overflow: hidden;
  padding: 0;
  width: min(1160px, calc(100vw - 36px));
  max-height: calc(100dvh - 36px);
  border: 1px solid var(--line);
  border-radius: 22px;
  margin: auto;
  box-shadow: var(--shadow-float);
}
.voice-picker-dialog:not([open]) {
  display: none;
}
.voice-picker-dialog::backdrop {
  background: rgb(9 26 27 / 48%);
  backdrop-filter: blur(5px);
}
.voice-picker-inline {
  border: 1px solid var(--line);
  border-radius: 16px;
  overflow: hidden;
  background: var(--surface);
}
.voice-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 22px 12px;
  gap: 16px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.voice-picker-header h2 {
  margin: 0;
  font: 700 18px/1.35 'Inter', sans-serif;
  letter-spacing: -.3px;
}
.voice-picker-dialog .voice-picker-close {
  width: 34px;
  height: 34px;
  padding: 0;
  border-color: var(--btn-border);
  border-radius: 50%;
  background: var(--btn-bg);
  color: var(--ink);
}

.voice-picker-body {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  flex: 1;
  min-height: 0;
}
.voice-picker-sidebar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 18px;
  padding: 18px 16px;
  border-right: 1px solid var(--line);
  background: var(--surface-raised);
}
.voice-filter-group {
  display: grid;
  gap: 10px;
}
.voice-filter-label {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
}
.voice-gender-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.voice-filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 36px;
  padding: 6px 12px;
  border: 1.5px solid var(--btn-border);
  border-radius: 999px;
  background: var(--btn-bg);
  color: var(--ink);
  font: 600 12px/1.2 'Inter', sans-serif;
  cursor: pointer;
  transition: border-color .15s, background-color .15s, box-shadow .15s, color .15s;
}
.voice-filter-pill:hover {
  border-color: var(--btn-border-hover);
  background: var(--btn-bg-hover);
}
.voice-filter-pill.active {
  border-color: var(--ink);
  background: var(--ink);
  color: var(--canvas);
}
.voice-reset-filters {
  justify-content: flex-start;
  font-size: 12px;
  color: var(--muted);
}
.voice-reset-filters:hover:not(:disabled) {
  color: var(--ink);
}

.voice-picker-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.voice-picker-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}
.voice-picker-tabs {
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  background: var(--surface-raised);
  border: 1px solid var(--line);
  border-radius: 999px;
  min-width: 0;
}
.voice-picker-tabs button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 34px;
  padding: 6px 12px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted);
  font: 600 12px/1.3 'Inter', sans-serif;
  cursor: pointer;
  transition: background-color .15s, color .15s;
}
.voice-picker-tabs button > .ui-icon {
  width: 14px;
  height: 14px;
  color: var(--accent);
  flex-shrink: 0;
}
.voice-picker-tabs button.active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: 0 2px 6px rgb(10 30 25 / 8%);
}
.voice-tab-count {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  background: var(--canvas);
  border-radius: 10px;
  min-width: 18px;
  padding: 2px 5px;
  box-sizing: border-box;
}
.voice-picker-searchbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 240px;
  justify-content: flex-end;
}
.voice-picker-search {
  flex: 1;
  max-width: 360px;
  min-width: 170px;
}
.voice-picker-search .input {
  min-height: 40px;
  height: 40px;
  border-radius: 999px;
  font-size: 13px;
}
.voice-picker-search > .ui-icon {
  top: 12px;
  width: 15px;
  height: 15px;
}
.voice-picker-add {
  border-radius: 999px;
  padding: 8px 14px;
  white-space: nowrap;
}

.voice-picker-count {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 20px 6px;
  font-size: 12px;
  color: var(--muted);
  flex-shrink: 0;
}
.voice-picker-count strong {
  color: var(--ink);
  font-weight: 650;
}
.voice-count-hint {
  font-size: 11px;
}

.voice-picker-list {
  flex: 1;
  min-height: 220px;
  max-height: 54dvh;
  overflow-y: auto;
  padding: 6px 14px 16px;
  display: grid;
  align-content: start;
  gap: 6px;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}
.voice-picker-inline .voice-picker-list {
  max-height: 60dvh;
}
.voice-row {
  display: grid;
  grid-template-columns: 42px minmax(190px, 1.45fr) minmax(170px, 1.1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  border: 1px solid transparent;
  border-radius: 14px;
  background: var(--surface);
  cursor: pointer;
  transition: background-color .14s, border-color .14s, box-shadow .14s;
  animation: voice-card-enter .24s ease-out backwards;
  animation-delay: var(--voice-enter-delay, 0ms);
}
.voice-row:hover,
.voice-row:focus-visible {
  background: var(--surface-raised);
  border-color: var(--line);
  outline: none;
}
.voice-row.selected {
  background: var(--accent-soft);
  border-color: var(--accent-line);
}
.voice-row.playing {
  background: var(--surface-raised);
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-line);
}
.voice-row.row-tier-gold:hover,
.voice-row.row-tier-gold.selected {
  border-color: var(--gold-border);
}
.voice-row.row-tier-diamond:hover,
.voice-row.row-tier-diamond.selected {
  border-color: var(--diamond-border);
}

.voice-row-avatar {
  overflow: visible;
}
.voice-avatar-initials {
  transition: opacity .14s;
}
.voice-avatar-play {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--ink);
  color: var(--canvas);
  opacity: 0;
  transition: opacity .14s, transform .14s;
  z-index: 1;
}
.voice-avatar-play > .ui-icon {
  width: 15px;
  height: 15px;
}
.voice-avatar-play .spinner {
  width: 14px;
  height: 14px;
  border-color: rgb(255 255 255 / 35%);
  border-top-color: currentColor;
}
.voice-row-avatar .avatar-tier-spark {
  z-index: 2;
}
.voice-row:hover .voice-avatar-play,
.voice-row:focus-within .voice-avatar-play,
.voice-row.playing .voice-avatar-play {
  opacity: 1;
}
.voice-row.playing .voice-avatar-play {
  background: var(--accent);
  color: #ffffff;
}
.voice-row:hover .voice-avatar-initials,
.voice-row:focus-within .voice-avatar-initials,
.voice-row.playing .voice-avatar-initials {
  opacity: 0;
}

.voice-row-info {
  min-width: 0;
  display: grid;
  gap: 4px;
}
.voice-row-titleline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.voice-row-name {
  font-size: 13px;
  font-weight: 700;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.voice-row-desc {
  margin: 0;
  font-size: 12px;
  line-height: 1.4;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.voice-selected-mark {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--accent-soft);
  color: var(--accent);
}
.voice-selected-mark > .ui-icon {
  width: 11px;
  height: 11px;
}

.voice-row-meta {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
}
.voice-lang-tag,
.voice-gender-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-body);
  white-space: nowrap;
}
.voice-flag-vn {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #da251d;
  color: #ffdf00;
  font-size: 9px;
  line-height: 1;
  flex-shrink: 0;
}
.voice-gender-tag {
  color: var(--muted);
  font-size: 11px;
}
.voice-class {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  background: var(--surface-raised);
  border: 1px solid var(--line);
  color: var(--text-body);
  line-height: 1.3;
}
.voice-class.gold {
  color: var(--gold-ink);
  background: var(--gold-bg);
  border-color: var(--gold-border);
}
.voice-class.diamond {
  color: var(--diamond-ink);
  background: var(--diamond-bg);
  border-color: var(--diamond-border);
}
.voice-code-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--surface-raised);
  border: 1px solid var(--line);
  color: var(--muted);
  max-width: 16ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}
.voice-use-btn {
  min-height: 32px;
  padding: 5px 12px;
  border-radius: 999px;
  border-color: var(--ink);
  background: var(--ink);
  color: var(--canvas);
  font-size: 12px;
  font-weight: 650;
  opacity: 0;
  pointer-events: none;
  transform: translateX(4px);
  transition: opacity .14s, transform .14s, background-color .14s;
}
.voice-use-btn:hover:not(:disabled) {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: #ffffff;
}
.voice-use-btn.is-upgrade {
  background: var(--gold-bg);
  border-color: var(--gold-border);
  color: var(--gold-ink);
}
.voice-use-btn > .ui-icon {
  width: 14px;
  height: 14px;
}
.voice-row:hover .voice-use-btn,
.voice-row:focus-within .voice-use-btn,
.voice-row.playing .voice-use-btn {
  opacity: 1;
  pointer-events: auto;
  transform: none;
}
.voice-row-manage {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.voice-row-manage .text-button {
  font-size: 11px;
  min-height: 28px;
  padding: 2px 6px;
}
.voice-row-manage .ui-icon {
  width: 12px;
  height: 12px;
}

.voice-picker-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
  background: var(--surface-raised);
  color: var(--muted);
  flex-shrink: 0;
}
.voice-player-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.voice-player-toggle {
  width: 34px;
  height: 34px;
  min-height: 34px;
  padding: 0;
  border-radius: 50%;
  flex-shrink: 0;
}
.voice-player-toggle.playing {
  background: var(--accent-soft);
  border-color: var(--accent-line);
  color: var(--accent);
}
.voice-player-toggle > .ui-icon {
  width: 14px;
  height: 14px;
}
.voice-player-toggle .spinner {
  width: 13px;
  height: 13px;
}
.voice-player-label {
  font-size: 12px;
  color: var(--muted);
  white-space: nowrap;
}
.voice-player-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.voice-player-time {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  white-space: nowrap;
}
.voice-picker-footer small,
.voice-picker-footer .text-button {
  font-size: 12px;
}
.voice-picker-footer .ui-icon {
  width: 13px;
  height: 13px;
}
.voice-empty {
  text-align: center;
  margin: auto;
  padding: 40px 16px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.7;
}
.voice-picker-surface button:focus-visible,
.voice-picker-trigger:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: 2px;
}

@media (hover: none) {
  .voice-use-btn {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
}
@media (max-width: 960px) {
  .voice-picker-body {
    grid-template-columns: 1fr;
  }
  .voice-picker-sidebar {
    border-right: 0;
    border-bottom: 1px solid var(--line);
    flex-direction: row;
    align-items: center;
    flex-wrap: wrap;
    padding: 12px 16px;
    gap: 10px;
  }
  .voice-filter-group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .voice-row {
    grid-template-columns: 40px minmax(0, 1fr) auto;
    gap: 10px 12px;
  }
  .voice-row-meta {
    grid-column: 2 / 4;
  }
}
@media (max-width: 600px) {
  .voice-picker-dialog {
    width: calc(100vw - 16px);
    max-height: calc(100dvh - 16px);
    border-radius: 18px;
  }
  .voice-picker-topbar {
    padding: 12px 14px;
  }
  .voice-picker-searchbar {
    width: 100%;
    min-width: 0;
    flex-wrap: wrap;
  }
  .voice-picker-search {
    max-width: none;
  }
  .voice-picker-list {
    padding: 6px 10px 12px;
    max-height: 50dvh;
  }
  .voice-row {
    padding: 10px;
  }
  .voice-use-btn {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
  .voice-player-label {
    display: none;
  }
  .voice-picker-footer {
    padding: 10px 14px;
    flex-wrap: wrap;
  }
}

@keyframes voice-card-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .voice-row,
  .voice-picker-dialog[open] {
    animation: none;
    transition: none;
  }
}
</style>
