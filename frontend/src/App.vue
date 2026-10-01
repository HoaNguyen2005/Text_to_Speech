<script setup>
import { onMounted } from 'vue';

// Components & Composables
import Auth from '@/components/Auth.vue';
import { useAuth } from '@/composables/useAuth';
import { useRouter } from 'vue-router';

// Khởi tạo Auth
const { session, authLoading, authError, handleLogin, handleRegister, handleLogout } = useAuth();
const router = useRouter();

const onLoginSuccess = async (email, password) => {
  const success = await handleLogin(email, password);
  if (success) {
    if (session.value?.user?.role === 'admin') {
      router.push('/admin');
    } else {
      router.push('/');
    }
  }
};

const onLogout = () => {
  handleLogout();
  router.push('/');
};
</script>

<template>
  <div class="app-container">
    <!-- Màn hình Đăng Nhập / Đăng Ký -->
    <Auth 
      v-if="!session" 
      :session="session"
      :authLoading="authLoading"
      :authError="authError"
      @login="onLoginSuccess"
      @register="handleRegister"
    />

    <!-- Màn hình chính sau khi đăng nhập -->
    <div v-else class="main-layout">
      <header class="top-nav">
        <div class="nav-logo">
          <span class="bars">|||</span>
          <span class="brand">Text2Speech</span>
        </div>
        <div class="nav-auth">
          <span class="user-email">👤 {{ session?.user?.fullName || session?.user?.email }}</span>
          <button class="logout-btn" @click="onLogout">Đăng Xuất</button>
        </div>
      </header>

      <main class="main-content">
        <!-- Menu cho người dùng bình thường -->
        <nav v-if="session?.user?.role !== 'admin'" class="sub-nav">
          <router-link to="/" class="nav-btn" active-class="active-nav">Tạo Bài Giảng</router-link>
          <router-link to="/book" class="nav-btn" active-class="active-nav">Sách Nói AI</router-link>
          <router-link to="/history" class="nav-btn" active-class="active-nav">Lịch Sử</router-link>
        </nav>

        <!-- Menu dành riêng cho Admin -->
        <nav v-else class="sub-nav">
          <router-link to="/admin" class="nav-btn" active-class="active-nav">Quản Trị Hệ Thống</router-link>
        </nav>
        
        <div class="router-container">
          <router-view />
        </div>
      </main>
    </div>
  </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  padding: 0;
  background-color: #f7f7f8;
}

.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f7f7f8;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #111827;
}

.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 2rem;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.nav-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 800;
  font-size: 1.25rem;
  letter-spacing: -0.02em;
}

.bars {
  font-weight: 900;
  letter-spacing: -1px;
}

.nav-auth {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.user-email {
  font-size: 0.9rem;
  color: #6b7280;
  font-weight: 500;
}

.logout-btn {
  background: #111827;
  color: #ffffff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 9999px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  transition: opacity 0.2s;
}

.logout-btn:hover {
  opacity: 0.8;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem 1rem;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
}

.hero-section {
  text-align: center;
  margin-bottom: 3rem;
  width: 100%;
}

.hero-title {
  font-size: 3.2rem;
  font-weight: 700;
  line-height: 1.1;
  margin: 0 0 1rem 0;
  letter-spacing: -0.04em;
  color: #111827;
}

.hero-subtitle {
  font-size: 1.25rem;
  color: #4b5563;
  margin: 0;
  line-height: 1.5;
}

.workspace-panel {
  width: 100%;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
}

.form-group {
  margin-bottom: 1rem;
}

.textarea-group {
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.textarea-group:focus-within {
  border-color: #111827;
  box-shadow: 0 0 0 1px #111827;
}

.sleek-textarea {
  width: 100%;
  background: transparent;
  border: none;
  font-size: 1.1rem;
  line-height: 1.6;
  color: #111827;
  resize: vertical;
  min-height: 150px;
  padding: 1rem;
  font-family: inherit;
}

.sleek-textarea:focus {
  outline: none;
}

.sleek-textarea::placeholder {
  color: #9ca3af;
  font-weight: 400;
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #f3f4f6;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.action-buttons {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-left: auto;
}

.upload-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #ffffff;
  border: 1px solid #d1d5db;
  color: #374151;
  font-size: 0.95rem;
  font-weight: 500;
  padding: 0.65rem 1.25rem;
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.2s;
}

.upload-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.control-item {
  display: flex;
  align-items: center;
}

.sleek-select {
  appearance: none;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  padding: 0.5rem 2.5rem 0.5rem 1rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: #374151;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1rem;
  transition: all 0.2s;
}

.sleek-select:hover {
  border-color: #d1d5db;
  background-color: #f3f4f6;
}

.sleek-select:focus {
  outline: none;
  border-color: #111827;
}

.generate-btn {
  background: #111827;
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 0.75rem 1.75rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  justify-content: center;
  align-items: center;
}

.generate-btn:hover:not(:disabled) {
  background: #374151;
}

.generate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner {
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

.result-panel {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid #f3f4f6;
  animation: fadeIn 0.4s ease;
}

.custom-audio {
  width: 100%;
  height: 48px;
  border-radius: 24px;
}

.custom-audio::-webkit-media-controls-panel {
  background-color: #f3f4f6;
}

.error-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 1rem;
  border-radius: 12px;
  margin-top: 1.5rem;
  font-weight: 500;
  font-size: 0.95rem;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 768px) {
  .hero-title {
    font-size: 2.5rem;
  }
  .controls-row {
    flex-direction: column;
    align-items: stretch;
  }
  .control-group {
    flex-direction: column;
    align-items: stretch;
  }
  .action-buttons {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }
  .generate-btn {
    width: 100%;
  }
  .upload-btn {
    width: 100%;
    justify-content: center;
  }
  .top-nav {
    flex-direction: column;
    gap: 1rem;
  }
}

.main-content {
  flex: 1;
  max-width: 1000px;
  margin: 0 auto;
  width: 100%;
  padding: 2rem 1rem;
}

.sub-nav {
  display: flex;
  justify-content: center;
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.nav-btn {
  padding: 0.75rem 1.5rem;
  border-radius: 9999px;
  text-decoration: none;
  font-weight: 600;
  color: #6b7280;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  transition: all 0.2s ease;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.nav-btn:hover {
  color: #111827;
  border-color: #d1d5db;
  background: #f9fafb;
}

.active-nav {
  color: #ffffff !important;
  background: #111827 !important;
  border-color: #111827 !important;
}

.router-container {
  width: 100%;
}

.main-layout {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
</style>