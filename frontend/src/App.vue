<script setup>
import { computed, watch } from 'vue';

// Components & Composables
import Auth from '@/components/Auth.vue';
import AppShell from '@/layouts/AppShell.vue';
import DesktopEngineBar from '@/components/DesktopEngineBar.vue';
import NotificationCenter from '@/components/NotificationCenter.vue';
import UpgradePlanDialog from '@/components/UpgradePlanDialog.vue';
import { useFeedback, confirmAction } from '@/composables/useNotifications';
import { useAuth } from '@/composables/useAuth';
import { useRouter } from 'vue-router';

// Khởi tạo Auth
const { session, authLoading, authError, identitySession, handleLogin, handleRegister, handleLogout: logout, retryAuth } = useAuth();
const router = useRouter();
const authFeedback = useFeedback('error', { key: 'auth-error' });
watch(authError, message => { authFeedback.value = message; }, { immediate: true });
async function handleLogout() {
  if (await confirmAction('Bạn muốn đăng xuất khỏi Text2Speech?', { title: 'Đăng xuất tài khoản', confirmLabel: 'Đăng xuất' })) await logout();
}

watch(() => session.value?.user?.role, (role) => {
  if (role === 'admin' && !router.currentRoute.value.meta.shared) router.replace('/admin');
  else if (router.currentRoute.value.path === '/admin') router.replace('/');
});
const tierClass = computed(() => session.value?.tier_info?.effective_class || session.value?.user?.account_class || 'free');
</script>

<template>
  <div class="app-container">
    <div v-if="!session" class="desktop-preauth-bar">
      <DesktopEngineBar />
    </div>
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

    <AppShell v-else :user="session.user" :tier="tierClass" @logout="handleLogout">
      <router-view />
    </AppShell>
  </div>
  <NotificationCenter />
  <UpgradePlanDialog v-if="session" />
</template>

<style scoped>
.desktop-preauth-bar {
  position: fixed;
  bottom: 14px;
  left: 16px;
  z-index: 40;
  max-width: calc(100vw - 32px);
}
</style>
