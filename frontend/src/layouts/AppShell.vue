<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import UiIcon from '@/components/UiIcon.vue';
import ThemeToggle from '@/components/ThemeToggle.vue';
import LocaleSelector from '@/components/LocaleSelector.vue';
import ShellSidebar from '@/components/ShellSidebar.vue';
import StudioAtmosphere from '@/components/StudioAtmosphere.vue';
import { useSceneMotion } from '@/composables/useSceneMotion';
defineProps({ user: { type: Object, required: true } });
defineEmits(['logout']);
const route = useRoute();
const backdrop = ref(null);
const motionPaused = useSceneMotion(backdrop);
const collapsed = ref(false), sidebar = ref(null), drawer = ref(null), mobileOpen = ref(false);
const sidebarAnimated = ref(false);
const toggleSidebar = () => { sidebarAnimated.value = true; collapsed.value = !collapsed.value; };
const collapseKey = 'text2speech.sidebar.collapsed';
const closeMobile = () => { drawer.value?.close(); mobileOpen.value = false; };
const openMobile = async () => { mobileOpen.value = true; await nextTick(); drawer.value?.showModal(); };
let screenQuery;
const updateScreen = () => {
  sidebar.value?.querySelector('[popover]')?.hidePopover();
  if (!screenQuery.matches) closeMobile();
};
onMounted(() => {
  try { collapsed.value = localStorage.getItem(collapseKey) === 'true'; } catch {}
  screenQuery = matchMedia('(max-width: 950px)');
  screenQuery.addEventListener('change', updateScreen);
});
watch(collapsed, value => { try { localStorage.setItem(collapseKey, String(value)); } catch {} });
watch(() => route.fullPath, closeMobile);
onBeforeUnmount(() => { screenQuery?.removeEventListener('change', updateScreen); closeMobile(); });
</script>

<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': collapsed, 'sidebar-animated': sidebarAnimated }">
    <div ref="backdrop" class="shell-backdrop" :class="{ 'motion-paused': motionPaused }" aria-hidden="true"><StudioAtmosphere :paused="motionPaused" /></div>
    <a href="#main-content" class="skip-link">{{ $t("Đến nội dung chính") }}</a>
    <aside ref="sidebar" class="shell-sidebar">
      <ShellSidebar :user="user" :collapsed="collapsed" @toggle="toggleSidebar" @logout="$emit('logout')" />
    </aside>
    <dialog id="mobile-navigation" ref="drawer" class="sidebar-drawer" :aria-label="$t('Điều hướng chính')"
      @close="mobileOpen = false" @click="event => { if (event.target === drawer) closeMobile(); }">
      <ShellSidebar :user="user" mobile @toggle="closeMobile" @navigate="closeMobile" @logout="closeMobile(); $emit('logout')" />
    </dialog>
    <div class="shell-workspace">
      <header class="shell-topbar">
        <div class="shell-topbar-leading">
          <button type="button" class="shell-menu-button" :aria-label="$t('Mở menu')" :aria-expanded="mobileOpen" aria-controls="mobile-navigation" @click="openMobile"><UiIcon name="menu" /></button>
          <div class="shell-breadcrumb"><span>{{ user.role === 'admin' ? $t("Quản trị viên") : $t("Không gian làm việc") }}</span><span class="breadcrumb-divider">/</span><strong>{{ $t(route.meta.title || 'Text2Speech') }}</strong></div>
        </div>
        <div class="shell-topbar-actions"><LocaleSelector /><ThemeToggle /></div>
      </header>
      <main id="main-content" class="shell-content" tabindex="-1"><slot /></main>
      <footer class="shell-footer"><span>Text2Speech</span><span>{{ $t("Bài giảng & sách nói tiếng Việt") }}</span></footer>
    </div>
  </div>
</template>
<style scoped>
.app-shell { position: relative; isolation: isolate; --sidebar-width: 248px; --sidebar-duration: 0s; --sidebar-ease: cubic-bezier(.22, 1, .36, 1); }
.shell-backdrop { position: fixed; inset: 0; z-index: -1; pointer-events: none; }
.sidebar-animated { --sidebar-duration: .32s; }
.sidebar-collapsed { --sidebar-width: 72px; }
.shell-sidebar { position: fixed; inset: 12px auto 12px 12px; z-index: 20; width: var(--sidebar-width); display: flex; flex-direction: column; border: 1px solid var(--line); border-radius: 20px; background: var(--surface); box-shadow: var(--shadow); transition: width var(--sidebar-duration) var(--sidebar-ease); }
.shell-workspace { margin-left: calc(var(--sidebar-width) + 24px); min-width: 0; min-height: 100vh; display: flex; flex-direction: column; transition: margin-left var(--sidebar-duration) var(--sidebar-ease); }
.shell-topbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 72px; padding: 12px 36px; border-bottom: 1px solid var(--line); background: var(--canvas); }
.shell-topbar-leading, .shell-topbar-actions { display: flex; align-items: center; gap: 12px; min-width: 0; }
.shell-breadcrumb { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; font-size: 12px; color: var(--muted); }
.shell-breadcrumb strong { font-weight: 550; color: var(--ink); }
.breadcrumb-divider { color: var(--line-strong); }
.shell-menu-button { display: none; align-items: center; justify-content: center; width: 42px; height: 42px; padding: 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--text-body); }
.sidebar-drawer { position: fixed; inset: 12px auto 12px 12px; width: min(292px, calc(100vw - 24px)); height: calc(100dvh - 24px); max-height: none; max-width: none; margin: 0; padding: 0; overflow: visible; border: 1px solid var(--line); border-radius: 20px; background: var(--surface); color: var(--ink); box-shadow: var(--shadow-float); }
.sidebar-drawer::backdrop { background: rgb(12 9 24 / 55%); backdrop-filter: blur(4px); }
:global(body:has(.sidebar-drawer[open])) { overflow: hidden; }
@media (max-width: 1150px) { .shell-topbar { padding-inline: 28px; } }
@media (max-width: 950px) {
  .shell-sidebar { display: none; }
  .shell-workspace { margin-left: 0; transition: none; }
  .shell-menu-button { display: flex; flex-shrink: 0; }
  .shell-topbar { padding: 12px 24px; }
}
@media (max-width: 760px) { .shell-breadcrumb > span { display: none; } }
@media (max-width: 540px) {
  .shell-topbar { padding: 12px 16px; gap: 8px; }
  .shell-topbar-actions { gap: 8px; }
  .shell-breadcrumb { display: none; }
}
@media (prefers-reduced-motion: reduce) { .app-shell.sidebar-animated { --sidebar-duration: 0s; } }
</style>
