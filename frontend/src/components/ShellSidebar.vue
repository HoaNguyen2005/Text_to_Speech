<script setup>
import { computed, useId } from 'vue';
import UiIcon from './UiIcon.vue';

const props = defineProps({ user: { type: Object, required: true }, collapsed: Boolean, mobile: Boolean });
defineEmits(['toggle', 'navigate', 'logout']);
const accountId = useId();
const isAdmin = computed(() => props.user.role === 'admin');
const name = computed(() => props.user.fullName || props.user.email || 'Tài khoản');
const initials = computed(() => name.value.trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toUpperCase());
const navigation = computed(() => isAdmin.value
  ? [{ to: '/admin', label: 'Tổng quan quản trị', icon: 'grid' }, { to: '/profile', label: 'Hồ sơ', icon: 'user' }]
  : [{ to: '/', label: 'Tạo bài giảng', icon: 'wave' }, { to: '/book', label: 'Sách nói AI', icon: 'book' },
    { to: '/history', label: 'Lịch sử', icon: 'history' }, { to: '/voices', label: 'Giọng của bạn', icon: 'mic' },
    { to: '/profile', label: 'Hồ sơ', icon: 'user' }]);
</script>

<template>
  <div class="sidebar-inner" :class="{ 'is-compact': collapsed }">
    <div class="sidebar-heading">
      <router-link :to="isAdmin ? '/admin' : '/'" class="sidebar-brand" :aria-label="$t('Text2Speech — Trang chủ')" @click="$emit('navigate')">
        <span class="sidebar-mark"><UiIcon name="wave" /></span>
        <span class="sidebar-wordmark" :aria-hidden="collapsed">Text2Speech<span>.</span></span>
      </router-link>
      <button type="button" class="sidebar-icon-button sidebar-toggle" :class="{ 'points-left': !mobile && !collapsed }" :aria-label="$t(mobile ? 'Đóng menu' : collapsed ? 'Mở rộng menu' : 'Thu gọn menu')"
        :title="$t(mobile ? 'Đóng menu' : collapsed ? 'Mở rộng menu' : 'Thu gọn menu')" :aria-expanded="mobile || !collapsed" @click="$emit('toggle')">
        <UiIcon :name="mobile ? 'close' : 'chevron'" />
      </button>
    </div>
    <p class="sidebar-caption" :aria-hidden="collapsed">{{ isAdmin ? $t('QUẢN TRỊ') : $t('KHÔNG GIAN LÀM VIỆC') }}</p>
    <nav class="sidebar-navigation" :aria-label="$t('Điều hướng chính')">
      <router-link v-for="item in navigation" :key="item.to" :to="item.to" class="sidebar-link" exact-active-class="is-active"
        :aria-label="$t(item.label)" :title="collapsed ? $t(item.label) : undefined" @click="$emit('navigate')">
        <UiIcon :name="item.icon" /><span class="sidebar-label" :aria-hidden="collapsed">{{ $t(item.label) }}</span>
        <span v-if="collapsed" class="sidebar-tooltip" aria-hidden="true">{{ $t(item.label) }}</span>
      </router-link>
    </nav>
    <div class="sidebar-account">
      <button type="button" class="sidebar-account-button" :popovertarget="accountId" :aria-label="$t('Menu tài khoản')" :title="collapsed ? name : undefined">
        <span class="sidebar-avatar">{{ initials }}</span>
        <span class="sidebar-account-name" :aria-hidden="collapsed"><strong>{{ name }}</strong><small>{{ isAdmin ? $t('Quản trị viên') : $t('Tài khoản cá nhân') }}</small></span>
        <UiIcon class="sidebar-account-more" name="more" />
      </button>
      <div :id="accountId" popover="auto" class="sidebar-account-popover" :class="{ 'from-compact': collapsed }">
        <p><strong>{{ name }}</strong><small>{{ user.email }}</small></p>
        <router-link to="/profile" class="sidebar-account-action" @click="$event.currentTarget.closest('[popover]').hidePopover(); $emit('navigate')"><UiIcon name="user" />{{ $t('Hồ sơ') }}</router-link>
        <button type="button" class="sidebar-account-action account-signout" @click="$event.currentTarget.closest('[popover]').hidePopover(); $emit('logout')"><UiIcon name="logout" />{{ $t('Đăng xuất') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sidebar-inner { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 14px 12px 12px; transition: padding var(--sidebar-duration, 0s) var(--sidebar-ease); }
.sidebar-heading { position: relative; display: flex; align-items: center; min-height: 38px; }
.sidebar-brand { display: flex; align-items: center; gap: 9px; min-width: 0; margin-right: 28px; color: var(--ink); text-decoration: none; transition: gap var(--sidebar-duration, 0s), transform var(--sidebar-duration, 0s) var(--sidebar-ease); }
.sidebar-mark { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; background: var(--action); color: var(--on-action); border-radius: 11px; }
.sidebar-mark .ui-icon { width: 21px; height: 21px; }
.sidebar-wordmark { max-width: 150px; overflow: hidden; font-size: 17px; font-weight: 750; letter-spacing: -.65px; white-space: nowrap; }
.sidebar-wordmark > span { color: var(--accent); }
.sidebar-icon-button { display: grid; place-items: center; flex-shrink: 0; width: 28px; height: 32px; padding: 4px; border: 0; border-radius: 8px; color: var(--muted); background: transparent; }
.sidebar-icon-button:hover { color: var(--ink); background: var(--surface-raised); }
.sidebar-icon-button .ui-icon { width: 17px; height: 17px; }
.sidebar-toggle { position: absolute; top: 3px; right: 0; transition: top var(--sidebar-duration, 0s) var(--sidebar-ease), right var(--sidebar-duration, 0s) var(--sidebar-ease); }
.sidebar-toggle .ui-icon { transition: transform var(--sidebar-duration, 0s) var(--sidebar-ease); }
.sidebar-toggle.points-left .ui-icon { transform: rotate(180deg); }
.sidebar-caption { margin: 28px 10px 10px; min-height: 15px; overflow: hidden; white-space: nowrap; font-size: 9px; font-weight: 650; letter-spacing: 1.15px; color: var(--muted); }
.sidebar-navigation { display: flex; flex-direction: column; gap: 5px; flex: 1; min-height: 0; overflow-y: auto; }
.sidebar-link { position: relative; display: flex; align-items: center; gap: 11px; flex-shrink: 0; min-height: 44px; padding: 10px 12px; border-radius: 11px; color: var(--text-body); font-size: 13px; font-weight: 550; text-decoration: none; transition: background .16s, color .16s, padding var(--sidebar-duration, 0s) var(--sidebar-ease), gap var(--sidebar-duration, 0s); }
.sidebar-label { min-width: 0; max-width: 170px; overflow: hidden; white-space: nowrap; }
.sidebar-link > .ui-icon { width: 19px; height: 19px; }
.sidebar-link:hover { color: var(--ink); background: var(--surface-raised); }
.sidebar-link.is-active { color: var(--accent); background: var(--accent-soft); font-weight: 650; }
.sidebar-link.is-active::before { content: ''; position: absolute; inset: 14px auto 14px 0; width: 3px; border-radius: 4px; background: var(--accent); }
.sidebar-account { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--line); }
.sidebar-account-button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 6px; border: 0; border-radius: 12px; text-align: left; background: transparent; color: var(--ink); transition: padding var(--sidebar-duration, 0s) var(--sidebar-ease), gap var(--sidebar-duration, 0s); }
.sidebar-account-button:hover { background: var(--surface-raised); }
.sidebar-avatar { display: grid; place-items: center; width: 34px; height: 34px; flex-shrink: 0; border: 1px solid var(--accent-line); border-radius: 11px; background: var(--accent-soft); color: var(--accent); font-size: 11px; font-weight: 700; }
.sidebar-account-name { display: flex; flex-direction: column; gap: 3px; min-width: 0; max-width: 170px; flex: 1; overflow: hidden; white-space: nowrap; }
.sidebar-account-name strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; font-weight: 650; }
.sidebar-account-name small { font-size: 10px; color: var(--muted); }
.sidebar-account-button > .ui-icon { width: 16px; height: 16px; color: var(--muted); }
.sidebar-wordmark, .sidebar-label, .sidebar-account-name { opacity: 1; transform: translateX(0); transition: max-width var(--sidebar-duration, 0s) var(--sidebar-ease), opacity var(--sidebar-duration, 0s), transform var(--sidebar-duration, 0s) var(--sidebar-ease); }
.sidebar-caption, .sidebar-account-more { transition: opacity var(--sidebar-duration, 0s), width var(--sidebar-duration, 0s) var(--sidebar-ease); }
.sidebar-account-popover { position: fixed; inset: auto auto 98px 24px; width: 224px; margin: 0; padding: 6px; border: 1px solid var(--line); border-radius: 15px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-float); font: inherit; }
.sidebar-account-popover > p { margin: 0 4px 6px; padding: 10px 6px; border-bottom: 1px solid var(--line); }
.sidebar-account-popover strong, .sidebar-account-popover small { display: block; overflow-wrap: anywhere; }
.sidebar-account-popover strong { font-size: 12px; }
.sidebar-account-popover small { margin-top: 4px; font-size: 11px; color: var(--muted); }
.sidebar-account-action { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 42px; padding: 10px; border: 0; border-radius: 9px; background: transparent; color: var(--text-body); text-decoration: none; font-size: 12px; }
.sidebar-account-action:hover { background: var(--surface-raised); }
.sidebar-account-action .ui-icon { width: 17px; height: 17px; }
.account-signout { color: var(--danger); }
.is-compact { padding-inline: 10px; }
.is-compact .sidebar-brand { gap: 0; margin-right: 0; transform: translateX(8px); }
.is-compact .sidebar-toggle { top: 44px; right: calc(50% - 14px); }
.is-compact .sidebar-caption { opacity: 0; }
.is-compact .sidebar-navigation { overflow: visible; }
.is-compact .sidebar-link { gap: 0; padding-inline: 15px; }
.is-compact .sidebar-account-button { gap: 0; padding-inline: 8px; }
.is-compact .sidebar-wordmark, .is-compact .sidebar-label, .is-compact .sidebar-account-name { max-width: 0; opacity: 0; transform: translateX(-6px); }
.is-compact .sidebar-account-more { width: 0; opacity: 0; }
.sidebar-account-popover.from-compact { inset: auto auto 24px 96px; }
.sidebar-tooltip { position: absolute; left: calc(100% + 18px); padding: 7px 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow); font-size: 12px; white-space: nowrap; visibility: hidden; opacity: 0; pointer-events: none; }
.sidebar-link:hover .sidebar-tooltip, .sidebar-link:focus-visible .sidebar-tooltip { visibility: visible; opacity: 1; }
@media (max-width: 950px) { .sidebar-account-popover { bottom: 100px; } }
@media (max-height: 540px) { .is-compact .sidebar-navigation { overflow: auto; } }
@media (prefers-reduced-motion: reduce) { .sidebar-inner, .sidebar-inner * { transition: none; } }
</style>
