<script setup>
import { watch } from 'vue';

// Components & Composables
import Auth from '@/components/Auth.vue';
import AppShell from '@/layouts/AppShell.vue';
import { useAuth } from '@/composables/useAuth';
import { useRouter } from 'vue-router';

// Khởi tạo Auth
const { session, authLoading, authError, identitySession, handleLogin, handleRegister, handleLogout, retryAuth } = useAuth();
const router = useRouter();

watch(() => session.value?.user?.role, (role) => {
  if (role === 'admin') router.replace('/admin');
  else if (router.currentRoute.value.path === '/admin') router.replace('/');
});
</script>

<template>
  <div class="app-container">
    <!-- Màn hình Đăng Nhập / Đăng Ký -->
    <Auth 
      v-if="!session" 
      :session="session"
      :authLoading="authLoading"
      :authError="authError"
      :identitySession="identitySession"
      @login="handleLogin"
      @register="handleRegister"
      @logout="handleLogout"
      @retry="retryAuth"
    />

    <AppShell v-else :user="session.user" @logout="handleLogout">
      <router-view />
    </AppShell>
  </div>
</template>
