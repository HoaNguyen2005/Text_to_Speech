import { ref } from 'vue';
import Keycloak from 'keycloak-js';
import { API_BASE_URL } from '@/config';
import { locale } from '@/composables/useLocale';
import { showWelcome } from '@/composables/useNotifications';

export const session = ref(null);
export const authLoading = ref(false);
export const authError = ref('');
export const identitySession = ref(false);
const identityUrl = (import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080').replace(/\/+$/, '');
const realm = import.meta.env.VITE_KEYCLOAK_REALM || 'tts-local';
const keycloak = new Keycloak({
  url: identityUrl,
  realm,
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
async function waitForService(url, ready) {
  const signal = AbortSignal.timeout(90000);
  while (!signal.aborted) {
    try {
      const response = await fetch(url, { cache: 'no-store', signal });
      if (response.ok && ready(await response.json())) return true;
    } catch { /* A sleeping service can return HTML or be temporarily unreachable. */ }
    if (!signal.aborted) await new Promise(resolve => setTimeout(resolve, 1500));
  }
  return false;
}
const backendReady = () => waitForService(`${API_BASE_URL}/api/health`, data => data?.status === 'ok');
const keycloakReady = () => waitForService(
  `${identityUrl}/realms/${encodeURIComponent(realm)}/.well-known/openid-configuration`,
  data => Boolean(data?.issuer && data?.authorization_endpoint)
);
async function loadSignedInProfile(readiness = backendReady()) {
  if (!await readiness) {
    authError.value = 'Không thể tải hồ sơ tài khoản. Vui lòng thử lại.';
    return;
  }
  await refreshSession();
}
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
export async function refreshSession() {
  const token = await getAccessToken();
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20000)
  });
  const data = await response.json();
  if (!response.ok) {
    invalidateSession(data.error || 'Không thể tải hồ sơ tài khoản.', response.status === 401);
    throw new Error(authError.value);
  }
  session.value = { user: data.user, tier_info: data.tier_info };
  authError.value = '';
  welcomeUser(data.user, data.account_created === true);
  return session.value;
}
export function initializeAuth() {
  if (!initialized) initialized = (async () => {
    authLoading.value = true;
    clearLegacyStorage();
    keycloak.onAuthLogout = () => { session.value = null; identitySession.value = false; };
    keycloak.onAuthSuccess = () => { identitySession.value = true; };
    keycloak.onTokenExpired = () => { getAccessToken().catch(() => {}); };
    try {
      // Wake both services before the browser submits credentials or exchanges an authorization code.
      const backend = backendReady();
      if (!await keycloakReady()) throw new Error('Keycloak is unavailable');
      const authenticated = await keycloak.init({
        pkceMethod: 'S256', flow: 'standard',
        responseMode: 'query', checkLoginIframe: false, messageReceiveTimeout: 10000, locale: locale.value,
      });
      identitySession.value = authenticated;
      if (authenticated) await loadSignedInProfile(backend);
      if (!authenticated) {
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
  if (!keycloak.didInitialize || (action === 'login' && keycloak.authenticated)) return retryAuth();
  authLoading.value = true;
  authError.value = '';
  try {
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
export async function handleLogout() {
  session.value = null;
  clearLegacyStorage();
  save(logoutKey, document.documentElement.dataset.theme);
  try { await keycloak.logout({ redirectUri: redirectUri() }); }
  catch { save(logoutKey, null); authError.value = 'Không thể đăng xuất khỏi dịch vụ đăng nhập. Hãy thử lại.'; }
}
export async function retryAuth() {
  if (!keycloak.authenticated) return window.location.reload();
  authLoading.value = true;
  authError.value = '';
  try { await loadSignedInProfile(); }
  catch { authError.value ||= 'Không thể tải hồ sơ tài khoản. Vui lòng thử lại.'; }
  finally { authLoading.value = false; }
}
