import { ref, onMounted } from 'vue';
import api from '@/services/api';

export function useAuth() {
  const session = ref(null);
  const authLoading = ref(false);
  const authError = ref('');

  onMounted(() => {
    const token = localStorage.getItem('token');
    const user = localStorage.getItem('user');
    if (token && user) {
      session.value = { user: JSON.parse(user) };
    }
  });

  const handleLogin = async (email, password) => {
    authLoading.value = true;
    authError.value = '';
    
    try {
      const res = await api.post('/api/auth/login', {
        email,
        password,
      });
      
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      session.value = { user: res.data.user };
      return true; // Thành công
    } catch (error) {
      authError.value = error.response?.data?.error || "Lỗi đăng nhập";
      return false; // Thất bại
    } finally {
      authLoading.value = false;
    }
  };

  const handleRegister = async (email, password, fullName, gender) => {
    authLoading.value = true;
    authError.value = '';
    
    try {
      await api.post('/api/auth/register', {
        email,
        password,
        fullName,
        gender
      });
      
      authError.value = "Đăng ký thành công! Vui lòng chuyển sang Đăng nhập.";
      return true;
    } catch (error) {
      authError.value = error.response?.data?.error || "Lỗi đăng ký";
      return false;
    } finally {
      authLoading.value = false;
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    session.value = null;
  };

  return {
    session,
    authLoading,
    authError,
    handleLogin,
    handleRegister,
    handleLogout
  };
}
