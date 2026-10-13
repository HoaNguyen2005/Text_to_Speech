import { ref } from 'vue';
import Keycloak from 'keycloak-js';
import { API_BASE_URL } from '@/config';

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
        responseMode: 'query', checkLoginIframe: false, messageReceiveTimeout: 10000,
      });
      identitySession.value = authenticated;
      if (authenticated) await refreshSession();
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
    if (action === 'register') await keycloak.register({ redirectUri: redirectUri() });
    else await keycloak.login({ redirectUri: redirectUri(), prompt: 'login' });
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
  try { await keycloak.logout({ redirectUri: redirectUri() }); }
  catch { authError.value = 'Không thể đăng xuất khỏi dịch vụ đăng nhập. Hãy thử lại.'; }
}
export const retryAuth = () => window.location.reload();
