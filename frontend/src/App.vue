<script setup>
import { computed, watch } from 'vue';

// Components & Composables
import Auth from '@/components/Auth.vue';
import AppShell from '@/layouts/AppShell.vue';
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

    <AppShell v-else :key="session.user._id" :user="session.user" :tier="tierClass" @logout="handleLogout">
      <router-view v-slot="{ Component }">
        <KeepAlive include="LectureCreator,BookSummarizer">
          <component :is="Component" />
        </KeepAlive>
      </router-view>
    </AppShell>
  </div>
  <NotificationCenter />
  <UpgradePlanDialog v-if="session" />
</template>
