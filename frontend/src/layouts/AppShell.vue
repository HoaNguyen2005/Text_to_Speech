<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import UiIcon from '@/components/UiIcon.vue';
const props = defineProps({ user: { type: Object, required: true } });
defineEmits(['logout']);
const route = useRoute();
const isAdmin = computed(() => props.user.role === 'admin');
const name = computed(() => props.user.fullName || props.user.email || 'Tài khoản');
const initials = computed(() => name.value.trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toUpperCase());
const navigation = computed(() => isAdmin.value
  ? [{ to: '/admin', label: 'Tổng quan quản trị', icon: 'grid' }]
  : [{ to: '/', label: 'Tạo bài giảng', icon: 'wave' }, { to: '/book', label: 'Sách nói AI', icon: 'book' }, { to: '/history', label: 'Lịch sử của tôi', icon: 'history' }]);
</script>

<template>
  <div class="app-shell">
    <a href="#main-content" class="skip-link">Đến nội dung chính</a>
    <aside class="shell-sidebar">
      <router-link :to="isAdmin ? '/admin' : '/'" class="shell-brand" aria-label="Text2Speech — Trang chủ">
        <span class="brand-mark"><UiIcon name="wave" /></span>Text2Speech<span class="brand-dot">.</span>
      </router-link>
      <p class="nav-caption">{{ isAdmin ? 'QUẢN TRỊ' : 'KHÔNG GIAN LÀM VIỆC' }}</p>
      <nav class="shell-navigation" aria-label="Điều hướng chính">
        <router-link v-for="item in navigation" :key="item.to" :to="item.to" class="shell-nav-link" exact-active-class="is-active">
          <UiIcon :name="item.icon" /><span>{{ item.label }}</span>
        </router-link>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-note"><UiIcon :name="isAdmin ? 'shield' : 'headphones'" /><strong>{{ isAdmin ? 'Quản lý tập trung' : 'Sáng tạo theo cách của bạn' }}</strong><p>{{ isAdmin ? 'Tài khoản và giọng đọc trong cùng một không gian.' : 'Từ ý tưởng đến bài giảng và sách nói tiếng Việt.' }}</p></div>
        <button type="button" class="sidebar-logout" @click="$emit('logout')"><UiIcon name="logout" />Đăng xuất</button>
      </div>
    </aside>
    <div class="shell-workspace">
      <header class="shell-topbar">
        <div class="shell-breadcrumb"><span>{{ isAdmin ? 'Quản trị viên' : 'Không gian làm việc' }}</span><span class="breadcrumb-divider">/</span><strong>{{ route.meta.title || 'Text2Speech' }}</strong></div>
        <div class="shell-profile"><span class="profile-avatar">{{ initials }}</span><span class="profile-details"><strong>{{ name }}</strong><small>{{ isAdmin ? 'Quản trị viên' : 'Tài khoản cá nhân' }}</small></span></div>
      </header>
      <main id="main-content" class="shell-content" tabindex="-1"><slot /></main>
      <footer class="shell-footer"><span>Text2Speech</span><span>Bài giảng &amp; sách nói tiếng Việt</span></footer>
    </div>
  </div>
</template>
