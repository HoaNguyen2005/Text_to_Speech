<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import api from '@/services/api';
import { cloudWakeState, session } from '@/services/auth';
import UiIcon from './UiIcon.vue';

const props = defineProps({ compact: Boolean });

const desktopBridge = typeof window !== 'undefined' ? window.desktopApp : null;
const isDesktop = Boolean(desktopBridge?.isDesktop);
const status = ref(null);
const webHardware = ref(null);
const detailsOpen = ref(false);
const restarting = ref(false);
let unsubscribe = null;
let webTimer = null;

async function refreshWebHardware() {
  if (isDesktop || !session.value) return;
  try {
    const { data } = await api.get('/api/speech/local-hardware', { timeout: 6000 });
    webHardware.value = data;
  } catch {}
}

onMounted(async () => {
  if (isDesktop) {
    status.value = await desktopBridge.getStatus().catch(() => null);
    unsubscribe = desktopBridge.onStatus((next) => {
      status.value = next;
    });
  } else {
    await refreshWebHardware();
    webTimer = setInterval(refreshWebHardware, 20000);
  }
});

onBeforeUnmount(() => {
  unsubscribe?.();
  if (webTimer) clearInterval(webTimer);
});

const hardware = computed(() => status.value?.hardware || null);
const toolchain = computed(() => status.value?.toolchain || null);
const setup = computed(() => status.value?.setup || { running: false, percent: 0, message: '' });
const engineInfo = computed(() => status.value?.services?.engine || null);
const vieneuInfo = computed(() => status.value?.services?.vieneu || null);
const workerInfo = computed(() => status.value?.services?.worker || null);
const cloudInfo = computed(() => status.value?.cloud || null);

const deviceKind = computed(() => {
  const dev = engineInfo.value?.device || webHardware.value?.device || (hardware.value?.hasNvidiaGpu ? 'cuda' : 'cpu');
  return String(dev).startsWith('cuda') ? 'gpu' : 'cpu';
});

const gpuLabel = computed(() => engineInfo.value?.gpuName || hardware.value?.gpuName || webHardware.value?.gpu_name || '');

const badgeText = computed(() => {
  if (setup.value.running) return `${setup.value.percent || 0}%`;
  if (deviceKind.value === 'gpu') return gpuLabel.value ? `GPU · ${gpuLabel.value}` : 'GPU CUDA';
  return 'CPU Mode';
});

const statusReady = computed(() => {
  if (isDesktop) return Boolean(engineInfo.value?.online);
  return Boolean(webHardware.value?.engine_online);
});

const showBanner = computed(() => {
  if (cloudWakeState.value?.waking) return true;
  if (isDesktop && setup.value?.running) return true;
  return false;
});

async function handleRestart() {
  if (!desktopBridge?.restartServices || restarting.value) return;
  restarting.value = true;
  try {
    status.value = await desktopBridge.restartServices();
  } finally {
    restarting.value = false;
  }
}

async function handleWarmup() {
  await desktopBridge?.warmupCloud?.().catch(() => {});
}
</script>

<template>
  <div v-if="isDesktop || session || cloudWakeState.waking" class="desktop-engine-bar" :class="{ compact }">
    <button
      v-if="isDesktop || session"
      type="button"
      class="desktop-hw-pill"
      :class="[deviceKind === 'gpu' ? 'is-gpu' : 'is-cpu', statusReady ? 'is-online' : 'is-starting']"
      :title="$t('Xem trạng thái phần cứng & Engine trên máy')"
      @click="detailsOpen = true"
    >
      <span class="desktop-hw-dot" aria-hidden="true"></span>
      <UiIcon :name="deviceKind === 'gpu' ? 'spark' : 'wave'" />
      <span class="desktop-hw-text">{{ badgeText }}</span>
    </button>

    <div v-if="showBanner" class="desktop-progress-pill" role="status">
      <span class="spinner" aria-hidden="true"></span>
      <span>
        {{
          setup.running
            ? setup.message
            : $t(cloudWakeState.message || 'Đang đánh thức máy chủ Cloud (Render), vui lòng đợi trong giây lát…')
        }}
      </span>
    </div>

    <Teleport to="body">
      <dialog v-if="detailsOpen" open class="desktop-status-dialog" aria-labelledby="desktop-hw-title" @click.self="detailsOpen = false">
        <div class="desktop-status-card">
          <header class="desktop-status-head">
            <div>
              <h2 id="desktop-hw-title">{{ $t('Thiết bị xử lý & Engine trên máy') }}</h2>
              <p>{{ $t('Tự động ưu tiên GPU NVIDIA (CUDA) và chuyển về CPU khi cần.') }}</p>
            </div>
            <button type="button" class="btn small" :aria-label="$t('Đóng')" @click="detailsOpen = false">
              <UiIcon name="close" />
            </button>
          </header>

          <div class="desktop-status-grid">
            <div class="desktop-stat-box">
              <small>{{ $t('Phần cứng ưu tiên') }}</small>
              <strong>{{ deviceKind === 'gpu' ? (gpuLabel || 'NVIDIA CUDA') : 'CPU' }}</strong>
              <span>{{ hardware?.cpuModel || webHardware?.cpu_model || $t('Chế độ tự động GPU/CPU') }}</span>
            </div>
            <div class="desktop-stat-box">
              <small>OpenVoice Engine (:8000)</small>
              <strong>{{ (isDesktop ? engineInfo?.online : webHardware?.engine_online) ? $t('Sẵn sàng') : $t('Đang khởi động') }}</strong>
              <span>{{ $t('Thiết bị') }}: {{ engineInfo?.device || webHardware?.device || 'cpu' }}</span>
            </div>
            <div class="desktop-stat-box">
              <small>VieNeu-TTS (:8001)</small>
              <strong>{{ (isDesktop ? vieneuInfo?.online : webHardware?.vieneu_online) ? $t('Sẵn sàng') : $t('Đang khởi động') }}</strong>
              <span>{{ $t('Thiết bị') }}: {{ vieneuInfo?.device || webHardware?.vieneu_device || 'auto' }}</span>
            </div>
            <div class="desktop-stat-box">
              <small>{{ isDesktop ? 'Book Worker & Cloud' : $t('Định tuyến Engine') }}</small>
              <strong>{{ isDesktop ? (workerInfo?.running ? $t('Worker đang chạy') : $t('Chưa bật Worker')) : (webHardware?.local_engine_first ? 'Local First' : 'Auto') }}</strong>
              <span v-if="isDesktop">Backend Cloud: {{ cloudInfo?.backend || '—' }} · Auth: {{ cloudInfo?.keycloak || '—' }}</span>
              <span v-if="isDesktop && toolchain">
                Python: {{ toolchain.pythonVersion || '—' }} ({{ toolchain.pythonSource }}) · FFmpeg: {{ toolchain.ffmpegReady ? `${$t('Sẵn sàng')} (${toolchain.ffmpegSource})` : $t('Đang kiểm tra') }}
              </span>
            </div>
          </div>

          <div v-if="isDesktop && setup.running" class="desktop-setup-box" role="status">
            <div class="desktop-setup-top">
              <span>{{ setup.message }}</span>
              <strong>{{ setup.percent }}%</strong>
            </div>
            <div class="desktop-setup-track"><span :style="{ width: `${setup.percent}%` }"></span></div>
          </div>

          <details v-if="isDesktop && (status?.logs?.setup?.length || status?.logs?.engine?.length)" class="desktop-logs-box">
            <summary>{{ $t('Xem nhật ký Engine / Cài đặt') }}</summary>
            <pre>{{ [...(status.logs.setup || []), ...(status.logs.engine || []).slice(-10)].join('\n') }}</pre>
          </details>

          <footer class="desktop-status-actions">
            <button v-if="isDesktop" type="button" class="btn small" @click="handleWarmup">
              <UiIcon name="refresh" />{{ $t('Đánh thức Cloud') }}
            </button>
            <button v-if="isDesktop" type="button" class="btn primary small" :disabled="restarting" @click="handleRestart">
              <span v-if="restarting" class="spinner" aria-hidden="true"></span>
              <UiIcon v-else name="refresh" />
              {{ $t('Khởi động lại Engine') }}
            </button>
            <button type="button" class="btn small" @click="detailsOpen = false">{{ $t('Đóng') }}</button>
          </footer>
        </div>
      </dialog>
    </Teleport>
  </div>
</template>

<style scoped>
.desktop-engine-bar { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.desktop-hw-pill {
  display: inline-flex; align-items: center; gap: 7px; min-height: 38px; max-width: 240px;
  padding: 5px 12px; border-radius: 999px; border: 1.5px solid var(--btn-border);
  background: var(--btn-bg); color: var(--ink); font: 600 12px/1.2 var(--font-ui, inherit);
  cursor: pointer; transition: border-color .15s, background-color .15s;
}
.desktop-hw-pill:hover { border-color: var(--btn-border-hover); background: var(--btn-bg-hover); }
.desktop-hw-pill.is-gpu { border-color: var(--gold-border); background: var(--gold-bg); color: var(--gold-ink); }
.desktop-hw-pill > .ui-icon { width: 14px; height: 14px; flex-shrink: 0; }
.desktop-hw-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.desktop-hw-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; background: var(--warning, #d97706); }
.desktop-hw-pill.is-online .desktop-hw-dot { background: var(--success, #16a34a); box-shadow: 0 0 0 3px rgb(22 163 74 / 20%); }
.desktop-progress-pill {
  display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 999px;
  background: var(--accent-soft); border: 1px solid var(--accent-line); color: var(--ink); font-size: 12px; font-weight: 550;
}
.desktop-status-dialog {
  position: fixed; inset: 0; z-index: 90; width: 100%; height: 100%; max-width: none; max-height: none;
  margin: 0; padding: 20px; border: 0; background: rgb(9 12 22 / 55%); backdrop-filter: blur(4px);
  display: grid; place-items: center;
}
.desktop-status-card {
  width: min(620px, 100%); max-height: 85dvh; overflow-y: auto; padding: 22px; border-radius: 18px;
  border: 1px solid var(--line); background: var(--surface); color: var(--ink); box-shadow: var(--shadow-float); display: grid; gap: 16px;
}
.desktop-status-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.desktop-status-head h2 { margin: 0; font-size: 18px; }
.desktop-status-head p { margin: 4px 0 0; font-size: 12px; color: var(--muted); }
.desktop-status-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.desktop-stat-box { padding: 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-raised); display: grid; gap: 4px; }
.desktop-stat-box small { font-size: 11px; color: var(--muted); }
.desktop-stat-box strong { font-size: 13px; color: var(--ink); }
.desktop-stat-box span { font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
.desktop-setup-box { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--accent-line); border-radius: 12px; background: var(--accent-soft); }
.desktop-setup-top { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; }
.desktop-setup-track { height: 7px; border-radius: 999px; background: var(--surface); overflow: hidden; }
.desktop-setup-track > span { display: block; height: 100%; background: var(--accent); transition: width .25s; }
.desktop-logs-box summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--muted); }
.desktop-logs-box pre {
  margin: 8px 0 0; padding: 10px; max-height: 180px; overflow: auto; border-radius: 10px;
  background: var(--canvas); border: 1px solid var(--line); font-size: 11px; line-height: 1.45; white-space: pre-wrap;
}
.desktop-status-actions { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; border-top: 1px solid var(--line); padding-top: 14px; }
@media (max-width: 600px) { .desktop-status-grid { grid-template-columns: 1fr; } .desktop-hw-pill { max-width: 150px; } }
</style>
