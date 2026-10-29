<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import UiIcon from '@/components/UiIcon.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import LocaleSelector from '@/components/LocaleSelector.vue';
const props = defineProps({ user: { type: Object, required: true } });
defineEmits(['logout']);
const route = useRoute();
const isAdmin = computed(() => props.user.role === 'admin');
const name = computed(() => props.user.fullName || props.user.email || 'Tài khoản');
const initials = computed(() => name.value.trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toUpperCase());
const navigation = computed(() => isAdmin.value
  ? [{ to: '/admin', label: 'Tổng quan quản trị', icon: 'grid' },{to:'/profile',label:'Thông tin cá nhân',icon:'user'}]
  : [{ to: '/', label: 'Tạo bài giảng', icon: 'wave' }, { to: '/book', label: 'Sách nói AI', icon: 'book' }, { to: '/history', label: 'Lịch sử của tôi', icon: 'history' },{to:'/voices',label:'Giọng của bạn',icon:'mic'},{to:'/profile',label:'Thông tin cá nhân',icon:'user'}]);
</script>

<template>
  <div class="app-shell">
    <a href="#main-content" class="skip-link">{{ $t("Đến nội dung chính") }}</a>
    <aside class="shell-sidebar">
      <router-link :to="isAdmin ? '/admin' : '/'" class="shell-brand" :aria-label="$t('Text2Speech — Trang chủ')">
        <span class="brand-mark"><UiIcon name="wave" /></span><span>Text2Speech<span class="brand-dot">.</span><small class="brand-subtitle">{{ $t("KHÔNG GIAN ÂM THANH") }}</small></span>
      </router-link>
      <p class="nav-caption">{{ isAdmin ? $t("QUẢN TRỊ") : $t("KHÔNG GIAN LÀM VIỆC") }}</p>
      <nav class="shell-navigation" :aria-label="$t('Điều hướng chính')">
        <router-link v-for="item in navigation" :key="item.to" :to="item.to" class="shell-nav-link" exact-active-class="is-active">
          <UiIcon :name="item.icon" /><span>{{ $t(item.label) }}</span><span class="nav-indicator" aria-hidden="true" />
        </router-link>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note"><UiIcon :name="isAdmin ? 'shield' : 'headphones'" /><strong>{{ isAdmin ? $t("Quản lý tập trung") : $t("Sáng tạo theo cách của bạn") }}</strong><p>{{ isAdmin ? $t("Tài khoản và giọng đọc trong cùng một không gian.") : $t("Từ ý tưởng đến bài giảng và sách nói tiếng Việt.") }}</p></div>
        <button type="button" class="sidebar-logout" @click="$emit('logout')"><UiIcon name="logout" />{{ $t("Đăng xuất") }}</button>
      </div>
    </aside>
    <div class="shell-workspace">
      <header class="shell-topbar">
        <div class="shell-breadcrumb"><span>{{ isAdmin ? $t("Quản trị viên") : $t("Không gian làm việc") }}</span><span class="breadcrumb-divider">/</span><strong>{{ $t(route.meta.title || 'Text2Speech') }}</strong></div>
        <div class="shell-topbar-actions"><LocaleSelector /><ThemeToggle /><router-link to="/profile" class="shell-profile" :aria-label="$t('Thông tin cá nhân')"><span class="profile-avatar">{{ initials }}</span><span class="profile-details"><strong>{{ name }}</strong><small>{{ isAdmin ? $t("Quản trị viên") : $t("Tài khoản cá nhân") }}</small></span></router-link></div>
      </header>
      <main id="main-content" class="shell-content" tabindex="-1"><slot /></main>
      <footer class="shell-footer"><span>Text2Speech</span><span>{{ $t("Bài giảng & sách nói tiếng Việt") }}</span></footer>
    </div>
  </div>
</template>
<style scoped>.shell-profile{text-decoration:none;color:inherit}.shell-profile:focus-visible{outline:2px solid var(--focus);outline-offset:5px;border-radius:12px}</style>
