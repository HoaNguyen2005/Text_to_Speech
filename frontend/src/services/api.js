import axios from 'axios';
import { API_BASE_URL } from '@/config';

// Axios instance dùng chung cho toàn app:
// - baseURL trỏ tới Backend Gateway
// - tự gắn token JWT (nếu đã đăng nhập) vào mọi request
const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export default api;
