import axios from 'axios';
import { API_BASE_URL } from '@/config';
import { getAccessToken, invalidateSession, refreshSession } from './auth';

const api = axios.create({ baseURL: API_BASE_URL });
api.interceptors.request.use(async (config) => {
  const token = await getAccessToken(Boolean(config._authRetry));
  config.headers.Authorization = `Bearer ${token}`;
  return config;
});
api.interceptors.response.use((response) => response, async (error) => {
  const status = error.response?.status;
  const code = error.response?.data?.code;
  if (status === 401 && error.config && !error.config._authRetry) {
    error.config._authRetry = true;
    return api(error.config);
  }
  if (status === 401) invalidateSession(error.response?.data?.error);
  if (status === 403 && ['ACCOUNT_DISABLED', 'AUTH_SYNC_PENDING'].includes(code)) {
    invalidateSession(error.response.data.error, false);
  } else if (status === 403 && code === 'INSUFFICIENT_ROLE') {
    await refreshSession().catch(() => {});
  }
  return Promise.reject(error);
});
export default api;
