import { ref } from 'vue';
import Keycloak from 'keycloak-js';
import { API_BASE_URL } from '@/config';
import { locale } from '@/composables/useLocale';
import { notify, showWelcome } from '@/composables/useNotifications';

export const session = ref(null);
export const authLoading = ref(false);
export const authError = ref('');
export const identitySession = ref(false);
const keycloak = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || 'http://localhost:8080',
  realm: import.meta.env.VITE_KEYCLOAK_REALM || 'tts-local',
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
  session.value = { user: data.user };
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
      const authenticated = await keycloak.init({
        onLoad: 'check-sso', pkceMethod: 'S256', flow: 'standard',
        responseMode: 'query', checkLoginIframe: false, messageReceiveTimeout: 10000, locale: locale.value,
      });
      identitySession.value = authenticated;
      if (authenticated) await refreshSession();
      if (!authenticated && saved(logoutKey)) notify('Bạn đã đăng xuất thành công.', { kind: 'success', key: 'logout' });
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
  save(logoutKey, '1');
  try { await keycloak.logout({ redirectUri: redirectUri() }); }
  catch { save(logoutKey, null); authError.value = 'Không thể đăng xuất khỏi dịch vụ đăng nhập. Hãy thử lại.'; }
}
export const retryAuth = () => window.location.reload();
