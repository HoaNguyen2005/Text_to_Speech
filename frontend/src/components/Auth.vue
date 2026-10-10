<script setup>
import { ref } from 'vue';
import { useAuth } from '@/composables/useAuth';

const props = defineProps(['session', 'authLoading', 'authError']);
const emit = defineEmits(['login', 'register']);

const isRegisterMode = ref(false);
const fullName = ref('');
const email = ref('');
const password = ref('');
const gender = ref('other');
const showPassword = ref(false);

const submitForm = () => {
  if (isRegisterMode.value) {
    emit('register', email.value, password.value, fullName.value, gender.value);
  } else {
    emit('login', email.value, password.value);
  }
};

const switchMode = () => {
  isRegisterMode.value = !isRegisterMode.value;
};
</script>

<template>
  <div class="auth-wrapper">
    <div class="auth-box">
      <h2 class="auth-title">{{ isRegisterMode ? 'Đăng Ký Tài Khoản' : 'Đăng Nhập' }}</h2>
      <div class="auth-form">
        <!-- Chỉ hiện khi đăng ký -->
        <template v-if="isRegisterMode">
          <div class="form-group">
            <label>Họ và tên</label>
            <input type="text" v-model="fullName" placeholder="Nhập họ và tên..." class="auth-input" />
          </div>
          
          <div class="form-group">
            <label>Giới tính</label>
            <select v-model="gender" class="auth-input auth-select">
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
              <option value="other">Khác</option>
            </select>
          </div>
        </template>

        <div class="form-group">
          <label>Email</label>
          <input type="email" v-model="email" placeholder="Nhập email..." class="auth-input" />
        </div>

        <div class="form-group">
          <label>Mật khẩu</label>
          <div class="password-wrapper">
            <input 
              :type="showPassword ? 'text' : 'password'" 
              v-model="password" 
              placeholder="Nhập mật khẩu..." 
              class="auth-input" 
              @keyup.enter="submitForm" 
            />
            <button 
              type="button" 
              class="toggle-password-btn" 
              @click="showPassword = !showPassword"
              tabindex="-1"
              title="Hiện/Ẩn mật khẩu"
            >
              <svg v-if="!showPassword" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
            </button>
          </div>
        </div>
        
        <button class="auth-submit-btn" @click="submitForm" :disabled="authLoading">
          <span v-if="!authLoading">{{ isRegisterMode ? 'Đăng Ký' : 'Đăng Nhập' }}</span>
          <span v-else class="spinner-small"></span>
        </button>
        
        <p class="auth-error" v-if="authError">{{ authError }}</p>
        
        <p class="auth-switch">
          {{ isRegisterMode ? 'Đã có tài khoản?' : 'Chưa có tài khoản?' }}
          <a href="#" @click.prevent="switchMode">
            {{ isRegisterMode ? 'Đăng nhập ngay' : 'Đăng ký ngay' }}
          </a>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: #f3f4f6;
}

.auth-box {
  background: #ffffff;
  padding: 3rem;
  border-radius: 16px;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 400px;
}

.auth-title {
  font-size: 1.75rem;
  font-weight: 700;
  text-align: center;
  margin-bottom: 2rem;
  color: #111827;
}

.auth-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.form-group label {
  font-size: 0.9rem;
  font-weight: 600;
  color: #374151;
}

.auth-input {
  width: 100%;
  padding: 0.875rem 1rem;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.auth-input:focus {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.password-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.password-wrapper .auth-input {
  padding-right: 2.5rem;
}

.toggle-password-btn {
  position: absolute;
  right: 0.5rem;
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.25rem;
  transition: color 0.2s;
}

.toggle-password-btn:hover {
  color: #4b5563;
}

.toggle-password-btn:focus {
  outline: none;
}

.auth-select {
  appearance: none;
  background-color: #fff;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='m6 8 4 4 4-4'/%3E%3C/svg%3E");
  background-position: right 0.5rem center;
  background-repeat: no-repeat;
  background-size: 1.5em 1.5em;
  cursor: pointer;
}

.auth-submit-btn {
  background: #111827;
  color: #ffffff;
  padding: 1rem;
  border-radius: 8px;
  font-weight: 600;
  font-size: 1.05rem;
  border: none;
  cursor: pointer;
  transition: background-color 0.2s;
  display: flex;
  justify-content: center;
  align-items: center;
}

.auth-submit-btn:hover {
  background: #374151;
}

.auth-submit-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.auth-error {
  color: #dc2626;
  font-size: 0.9rem;
  text-align: center;
  margin: 0;
}

.auth-switch {
  text-align: center;
  font-size: 0.95rem;
  color: #6b7280;
  margin-top: 1rem;
}

.auth-switch a {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
}

.auth-switch a:hover {
  text-decoration: underline;
}

.spinner-small {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
