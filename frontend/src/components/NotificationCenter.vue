<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import UiIcon from './UiIcon.vue';
import { activeDialog, notifications, dismissNotification, settleDialog, notify } from '@/composables/useNotifications';

const dialogElement = ref(null);
const actionBusy = ref(new Set());
const visibleNotifications = computed(() => notifications.value.slice(0, 5));
const titleFor = kind => ({ success: 'Thành công', error: 'Có lỗi xảy ra', warning: 'Cần lưu ý', info: 'Thông báo' }[kind] || 'Thông báo');
const iconFor = kind => ({ success: 'check', error: 'close', warning: 'shield', info: 'spark' }[kind] || 'spark');
let previousOverflow;
watch(activeDialog, async value => {
  await nextTick();
  if (value && activeDialog.value?.id === value.id) {
    previousOverflow ??= document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Explicit inert also covers assistive technology on older dialog implementations.
    document.querySelector('.app-container')?.setAttribute('inert', '');
    if (!dialogElement.value.open) dialogElement.value.showModal();
    dialogElement.value.querySelector('[data-initial-focus]')?.focus();
  } else if (!activeDialog.value) {
    document.querySelector('.app-container')?.removeAttribute('inert');
    dialogElement.value?.close();
    if (previousOverflow !== undefined) document.body.style.overflow = previousOverflow;
    previousOverflow = undefined;
  }
}, { immediate: true });
async function runAction(item) {
  if (actionBusy.value.has(item.id)) return;
  actionBusy.value.add(item.id);
  dismissNotification(item.id);
  try { await item.action.run(); }
  catch { notify('Không thực hiện được thao tác. Vui lòng thử lại.', { kind: 'error', key: 'popup-action-error' }); }
  finally { actionBusy.value.delete(item.id); }
}
onBeforeUnmount(() => {
  document.querySelector('.app-container')?.removeAttribute('inert');
  if (previousOverflow !== undefined) document.body.style.overflow = previousOverflow;
});
</script>

<template>
  <Teleport to="body">
    <section class="notification-stack" :aria-label="$t('Thông báo hệ thống')" aria-live="polite" aria-relevant="additions text">
      <TransitionGroup name="notification">
        <article v-for="item in visibleNotifications" :key="item.id" class="notification-card" :class="item.kind" :role="item.kind === 'error' ? 'alert' : 'status'" aria-atomic="true">
          <span class="notification-symbol"><UiIcon :name="iconFor(item.kind)" /></span>
          <div class="notification-content"><strong>{{ $t(item.title || titleFor(item.kind)) }}</strong><p>{{ $t(item.message) }}</p>
            <button v-if="item.action" class="text-button" type="button" :disabled="actionBusy.has(item.id)" @click="runAction(item)">{{ $t(item.action.label) }}</button>
          </div>
          <button class="notification-close" type="button" :aria-label="$t('Đóng thông báo')" @click="dismissNotification(item.id)"><UiIcon name="close" /></button>
        </article>
      </TransitionGroup>
      <button v-if="notifications.length > 5" class="btn small" type="button" @click="visibleNotifications.forEach(item => dismissNotification(item.id))">{{ $t('Xem thông báo tiếp theo ({0})', [notifications.length - 5]) }}</button>
    </section>

    <dialog ref="dialogElement" class="notification-dialog" aria-labelledby="popup-title" aria-describedby="popup-message" @cancel.prevent="settleDialog(false)" @click="event => { if (event.target === dialogElement) settleDialog(false); }">
      <div v-if="activeDialog" class="popup-content" :class="activeDialog.kind">
        <header class="popup-brand"><span><UiIcon name="wave" />Text2Speech<span class="popup-dot">.</span></span><button class="notification-close" type="button" :aria-label="$t('Đóng thông báo')" @click="settleDialog(false)"><UiIcon name="close" /></button></header>
        <span class="popup-symbol"><UiIcon :name="iconFor(activeDialog.kind)" /></span>
        <h2 id="popup-title">{{ $t(activeDialog.title) }}</h2>
        <p id="popup-message">{{ $t(activeDialog.message) }}</p>
        <footer class="popup-actions">
          <button v-if="activeDialog.confirmation" type="button" class="btn" data-initial-focus @click="settleDialog(false)">{{ $t(activeDialog.cancelLabel) }}</button>
          <button type="button" class="btn" :class="activeDialog.danger ? 'popup-danger' : 'primary'" :data-initial-focus="activeDialog.confirmation ? undefined : ''" @click="settleDialog(true)">{{ $t(activeDialog.confirmLabel) }}<UiIcon v-if="!activeDialog.confirmation" name="arrow" /></button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>

<style>
.notification-stack, .notification-dialog { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
.notification-stack { position: fixed; z-index: 1500; top: 24px; right: 24px; display: flex; flex-direction: column; gap: 12px; width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 48px); overflow-y: auto; padding: 4px; pointer-events: none; }
.notification-stack > * { pointer-events: auto; }
.notification-stack:empty { display: none; }
.notification-card { display: flex; align-items: flex-start; gap: 12px; padding: 18px; border: 1px solid var(--line); border-left: 4px solid var(--accent); border-radius: 14px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-float); }
.notification-card.success { border-left-color: var(--success); }
.notification-card.error { border-left-color: var(--danger); }
.notification-card.warning { border-left-color: var(--warning); }
.notification-symbol, .popup-symbol { flex-shrink: 0; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); border: 1px solid var(--accent-line); }
.notification-symbol { width: 34px; height: 34px; border-radius: 10px; }
.success .notification-symbol, .success .popup-symbol { color: var(--success); background: var(--success-bg); border-color: var(--success-line); }
.error .notification-symbol, .error .popup-symbol { color: var(--danger); background: var(--danger-bg); border-color: var(--danger-line); }
.warning .notification-symbol, .warning .popup-symbol { color: var(--warning); background: var(--warning-bg); border-color: var(--line-strong); }
.notification-content { min-width: 0; flex: 1; }
.notification-content strong { font-size: 14px; line-height: 1.5; }
.notification-content p { margin: 5px 0 0; font-size: 13px; line-height: 1.7; color: var(--text-body); overflow-wrap: anywhere; white-space: pre-line; }
.notification-content .text-button { margin-top: 10px; }
.notification-close { flex-shrink: 0; width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); display: grid; place-items: center; cursor: pointer; padding: 5px; }
.notification-close:hover { background: var(--surface-raised); color: var(--ink); }
.notification-close:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.notification-dialog { position: fixed; inset: 0; padding: 0; margin: auto; width: min(480px, calc(100vw - 32px)); max-height: calc(100dvh - 40px); border: 1px solid var(--line); border-radius: 22px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-float); overflow-y: auto; }
.notification-dialog::backdrop { background: rgb(9 26 27 / 55%); backdrop-filter: blur(5px); }
.popup-content { padding: 24px 30px 30px; }
.popup-brand { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 28px; }
.popup-brand > span { display: flex; align-items: center; gap: 7px; font-size: 15px; font-weight: 800; }
.popup-brand > span > .ui-icon { width: 24px; height: 24px; color: var(--accent); }
.popup-dot { color: var(--accent); margin-left: -6px; }
.popup-symbol { width: 56px; height: 56px; border-radius: 17px; margin-bottom: 20px; }
.popup-symbol .ui-icon { width: 27px; height: 27px; }
.popup-content h2 { margin: 0; font-size: 25px; line-height: 1.35; letter-spacing: -.6px; }
.popup-content > p { margin: 14px 0 0; color: var(--text-body); font-size: 14px; line-height: 1.85; overflow-wrap: anywhere; white-space: pre-line; }
.popup-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--line); }
.popup-actions .btn { min-height: 42px; }
.popup-actions .popup-danger { background: var(--danger); color: var(--surface); border-color: var(--danger); }
.popup-actions .popup-danger:hover { filter: brightness(.92); }
.notification-enter-active, .notification-leave-active { transition: opacity .18s, transform .18s; }
.notification-enter-from, .notification-leave-to { opacity: 0; transform: translateX(20px); }
@media (max-width: 600px) { .notification-stack { top: 12px; right: 12px; width: calc(100vw - 24px); max-height: calc(100dvh - 24px); } .popup-content { padding: 22px; } .popup-actions .btn { flex: 1; } }
@media (prefers-reduced-motion: reduce) { .notification-enter-active, .notification-leave-active { transition: none; } .notification-dialog::backdrop { backdrop-filter: none; } }
</style>
