import { ref } from 'vue';
import Keycloak from 'keycloak-js';
import { API_BASE_URL } from '@/config';
import { locale } from '@/composables/useLocale';
import { notify, showWelcome } from '@/composables/useNotifications';

export const session = ref(null);
export const authLoading = ref(false);
export const authError = ref('');
export const identitySession = ref(false);
export const cloudWakeState = ref({ waking: false, attempt: 0, message: '' });
const desktopConfig = typeof window !== 'undefined' ? window.desktopApp?.config : null;
const isDesktopApp = typeof window !== 'undefined' && Boolean(window.desktopApp?.isDesktop);
const keycloakUrl = desktopConfig?.keycloakUrl || import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080';
const keycloakRealm = desktopConfig?.keycloakRealm || import.meta.env.VITE_KEYCLOAK_REALM || 'tts-local';
const keycloak = new Keycloak({
  url: keycloakUrl,
  realm: keycloakRealm,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT_ID || 'tts-frontend',
});
let initialized, refreshing;
let welcomedInMemory;
const welcomeKey = 'text2speech.welcomed-session';
const logoutKey = 'text2speech.logout-pending';
function saved(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function save(key, value) { try { value == null ? sessionStorage.removeItem(key) : sessionStorage.setItem(key, value); } catch {} }
function welcomeUser(user, accountCreated) {
  // Store only session identity metadata, never access/refresh tokens.
  const identity = `${keycloak.subject}:${keycloak.tokenParsed?.sid || keycloak.sessionId || keycloak.tokenParsed?.auth_time}`;
  if (welcomedInMemory === identity || saved(welcomeKey) === identity) return;
  welcomedInMemory = identity; save(welcomeKey, identity);
  const name = user.fullName || user.email || 'bạn';
  showWelcome({ key: accountCreated ? 'Chúc mừng {0}! Tài khoản của bạn đã được tạo thành công. Hãy bắt đầu tạo nội dung đầu tiên cùng Text2Speech.'
    : 'Xin chào {0}! Bạn đã đăng nhập thành công. Không gian sáng tạo của bạn đã sẵn sàng.', params: [name] }, {
    title: accountCreated ? 'Đăng ký thành công!' : 'Chào mừng trở lại!',
  });
}
const redirectUri = () => new URL('/', window.location.origin).href;
function clearLegacyStorage() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}
export function invalidateSession(message = 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', clearIdentity = true) {
  session.value = null;
  authError.value = message;
  if (clearIdentity) keycloak.clearToken();
}
export async function getAccessToken(force = false) {
  if (!keycloak.authenticated) throw new Error('Bạn cần đăng nhập để tiếp tục.');
  try {
    if (!refreshing) refreshing = keycloak.updateToken(force ? -1 : 30).finally(() => { refreshing = undefined; });
    await refreshing;
    return keycloak.token;
  } catch {
    invalidateSession('Không thể làm mới phiên đăng nhập. Vui lòng đăng nhập lại.');
    throw new Error(authError.value);
  }
}
export function warmupCloudServices() {
  try {
    fetch(`${API_BASE_URL}/api/health`, { mode: 'cors', cache: 'no-store' }).catch(() => {});
    fetch(`${keycloakUrl}/realms/${keycloakRealm}/.well-known/openid-configuration`, { mode: 'cors', cache: 'no-store' }).catch(() => {});
    window.desktopApp?.warmupCloud?.().catch(() => {});
  } catch {}
}
export async function refreshSession() {
  const token = await getAccessToken();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(35000)
      });
      if ([502, 503, 504].includes(response.status) && attempt < 3) {
        cloudWakeState.value = { waking: true, attempt, message: 'Đang đánh thức máy chủ Cloud (Render), vui lòng đợi trong giây lát…' };
        await new Promise((resolve) => setTimeout(resolve, 2500));
        continue;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        cloudWakeState.value = { waking: false, attempt: 0, message: '' };
        invalidateSession(data.error || 'Không thể tải hồ sơ tài khoản.', response.status === 401);
        throw new Error(authError.value);
      }
      cloudWakeState.value = { waking: false, attempt: 0, message: '' };
      session.value = { user: data.user, tier_info: data.tier_info };
      authError.value = '';
      welcomeUser(data.user, data.account_created === true);
      return session.value;
    } catch (error) {
      const isColdStart = error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.name === 'TypeError';
      if (isColdStart && attempt < 3) {
        cloudWakeState.value = { waking: true, attempt, message: 'Đang đánh thức máy chủ Cloud (Render), vui lòng đợi trong giây lát…' };
        await new Promise((resolve) => setTimeout(resolve, 2500));
        continue;
      }
      cloudWakeState.value = { waking: false, attempt: 0, message: '' };
      throw error;
    }
  }
}
async function waitForKeycloakReady(maxAttempts = 15) {
  const endpoint = `${keycloakUrl.replace(/\/+$/, '')}/realms/${encodeURIComponent(keycloakRealm)}/.well-known/openid-configuration`;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await fetch(endpoint, { mode: 'cors', cache: 'no-store', signal: AbortSignal.timeout(6000) });
      if (resp.ok) {
        cloudWakeState.value = { waking: false, attempt: 0, message: '' };
        return true;
      }
    } catch {}
    if (attempt < maxAttempts) {
      cloudWakeState.value = {
        waking: true,
        attempt,
        message: 'Đang đánh thức máy chủ đăng nhập (Render), vui lòng đợi trong giây lát…',
      };
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
  }
  cloudWakeState.value = { waking: false, attempt: 0, message: '' };
  return false;
}
export function initializeAuth() {
  if (!initialized) initialized = (async () => {
    authLoading.value = true;
    clearLegacyStorage();
    warmupCloudServices();
    keycloak.onAuthLogout = () => { session.value = null; identitySession.value = false; };
    keycloak.onAuthSuccess = () => { identitySession.value = true; };
    keycloak.onTokenExpired = () => { getAccessToken().catch(() => {}); };
    try {
      const authenticated = await keycloak.init({
        pkceMethod: 'S256', flow: 'standard',
        responseMode: 'query', checkLoginIframe: false, messageReceiveTimeout: 30000, locale: locale.value,
      });
      identitySession.value = authenticated;
      if (authenticated) await refreshSession();
      if (!authenticated && !isDesktopApp) {
        // Start the browser flow before showing the welcome card so its forms
        // and the authentication cookies belong to the same Keycloak origin.
        const target = new URL(await keycloak.createLoginUrl({ locale: locale.value }));
        target.searchParams.set('kc_locale', locale.value);
        const logoutTheme = saved(logoutKey);
        target.hash = logoutTheme ? 'tts-signed-out' : 'tts-welcome';
        if (logoutTheme === 'light' || logoutTheme === 'dark') target.hash += `:${logoutTheme}`;
        window.location.replace(target.href);
      }
      save(logoutKey, null);
    } catch (error) {
      session.value = null;
      authError.value ||= 'Không thể kết nối dịch vụ đăng nhập. Hãy kiểm tra kết nối và thử lại.';
    } finally { authLoading.value = false; }
  })();
  return initialized;
}
async function redirect(action) {
  authLoading.value = true;
  authError.value = '';
  try {
    if (isDesktopApp) {
      const ready = await waitForKeycloakReady();
      if (!ready) {
        authError.value = 'Không thể kết nối dịch vụ đăng nhập. Hãy kiểm tra kết nối và thử lại.';
        authLoading.value = false;
        return;
      }
    }
    // The SDK still creates/saves state, nonce and the PKCE verifier. Only add
    // an explicit locale to its URL so an older Keycloak preference cannot win.
    const options = { redirectUri: redirectUri(), locale: locale.value };
    const target = new URL(await (action === 'register'
      ? keycloak.createRegisterUrl(options)
      : keycloak.createLoginUrl({ ...options, prompt: 'login' })));
    target.searchParams.set('kc_locale', locale.value);
    window.location.assign(target.href);
  } catch {
    authError.value = 'Không thể mở trang đăng nhập. Hãy thử lại.';
    authLoading.value = false;
  }
}
export const handleLogin = () => redirect('login');
export const handleRegister = () => redirect('register');
export async function manageAccount(){
  try{window.location.assign(keycloak.createAccountUrl({redirectUri:new URL('/profile',window.location.origin).href}));}
  catch{notify('Không mở được trang quản lý tài khoản. Hãy thử lại.',{kind:'error'});}
}
export async function handleLogout() {
  session.value = null;
  clearLegacyStorage();
  save(logoutKey, document.documentElement.dataset.theme);
  try { await keycloak.logout({ redirectUri: redirectUri() }); }
  catch { save(logoutKey, null); authError.value = 'Không thể đăng xuất khỏi dịch vụ đăng nhập. Hãy thử lại.'; }
}
export const retryAuth = () => window.location.reload();
