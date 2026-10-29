import { ref, shallowRef, watch } from 'vue';

export const notifications = ref([]);
export const activeDialog = shallowRef(null);
const queue = [];
const timers = new Map();
const recentlyShown = new Map();
let sequence = 0;

export function dismissNotification(id) {
  clearTimeout(timers.get(id)); timers.delete(id);
  notifications.value = notifications.value.filter(item => item.id !== id);
}
export function notify(message, { kind = 'info', title, key, action, duration } = {}) {
  if (!message) return;
  const signature = JSON.stringify(message);
  const existing = key && notifications.value.find(item => item.key === key);
  if (existing && existing.signature === signature) return existing.id;
  const recent = key && recentlyShown.get(key);
  if (!existing && recent?.signature === signature && Date.now() - recent.at < 30000) return;
  if (existing) dismissNotification(existing.id);
  const id = ++sequence;
  notifications.value.push({ id, key, signature, kind, title, message, action });
  if (key) {
    recentlyShown.set(key, { signature, at: Date.now() });
    if (recentlyShown.size > 100) recentlyShown.delete(recentlyShown.keys().next().value);
  }
  // Keep notifications reachable; do not silently drop errors when several arrive.
  const milliseconds = duration ?? (kind === 'error' ? 0 : 8000);
  if (milliseconds) timers.set(id, setTimeout(() => dismissNotification(id), milliseconds));
  return id;
}

// Reactive feedback remains usable for form/retry state. Messages appear once,
// with stable keys so polling cannot stack identical popups every five seconds.
export function useFeedback(kind = 'error', options = {}) {
  const value = ref('');
  const key = options.key || `feedback-${++sequence}`;
  watch(value, message => {
    if (message) notify(message, { ...options, kind, key });
    else recentlyShown.delete(key); // A deliberate retry can report the same failure again.
  }, { flush: 'sync' });
  return value;
}
function advance() { if (!activeDialog.value) activeDialog.value = queue.shift() || null; }
function dialog(options) {
  return new Promise(resolve => { queue.push({ ...options, id: ++sequence, resolve }); advance(); });
}
export function confirmAction(message, options = {}) {
  return dialog({ kind: 'warning', title: 'Xác nhận thao tác', confirmLabel: 'Xác nhận', cancelLabel: 'Quay lại', ...options, message, confirmation: true });
}
export function showWelcome(message, options = {}) {
  return dialog({ kind: 'success', title: 'Chào mừng trở lại!', confirmLabel: 'Bắt đầu sử dụng', ...options, message, confirmation: false });
}
export function settleDialog(accepted) {
  const current = activeDialog.value;
  if (!current) return;
  activeDialog.value = null;
  current.resolve(Boolean(accepted));
  // Give the native dialog one render to close and restore focus before opening another.
  setTimeout(advance, 0);
}
