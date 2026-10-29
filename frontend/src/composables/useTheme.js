import { computed, readonly, ref } from 'vue';

const storageKey = 'text2speech.theme';
const theme = ref(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
let preference = null;
let initialized = false;
const system = window.matchMedia('(prefers-color-scheme: dark)');
const valid = value => value === 'light' || value === 'dark';
// A non-sensitive, host-only cookie shares this choice with Keycloak on another port.
function cookiePreference() {
  try { const value = document.cookie.split(';').map(item => item.trim()).find(item => item.startsWith('tts_theme='))?.slice(10); return valid(value) ? value : null; }
  catch { return null; }
}
function saveCookie(value) {
  try { document.cookie = `tts_theme=${value || ''}; Path=/; Max-Age=${value ? 31536000 : 0}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`; } catch { /* Storage can be disabled. */ }
}
function savePreference(value) {
  saveCookie(value);
  try { if (value) localStorage.setItem(storageKey, value); else localStorage.removeItem(storageKey); } catch { /* Keep the in-memory choice. */ }
}
function apply(value) {
  theme.value = value;
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
}
export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  try { const saved = localStorage.getItem(storageKey); preference = valid(saved) ? saved : null; } catch { /* Private browsing may block storage. */ }
  preference = cookiePreference() || preference;
  if (preference) savePreference(preference);
  apply(preference || (system.matches ? 'dark' : 'light'));
  system.addEventListener('change', event => {
    if (!preference) apply(event.matches ? 'dark' : 'light');
  });
  window.addEventListener('storage', event => {
    if (event.key !== storageKey && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : null;
    saveCookie(preference);
    apply(preference || (system.matches ? 'dark' : 'light'));
  });
  window.addEventListener('focus', () => {
    const shared = cookiePreference();
    if (shared && shared !== preference) {
      preference = shared;
      savePreference(preference);
      apply(preference);
    }
  });
}
export function useTheme() {
  const isDark = computed(() => theme.value === 'dark');
  function toggleTheme() {
    preference = isDark.value ? 'light' : 'dark';
    apply(preference);
    savePreference(preference);
  }
  return { theme: readonly(theme), isDark, toggleTheme };
}
