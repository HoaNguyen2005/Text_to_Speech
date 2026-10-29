<script setup>
import ThemeToggle from '@/components/ThemeToggle.vue';
import LocaleSelector from '@/components/LocaleSelector.vue';
defineProps(['authLoading', 'authError', 'identitySession']);
defineEmits(['login', 'register', 'logout', 'retry']);
const waveform = [14, 24, 18, 36, 52, 32, 68, 84, 54, 40, 70, 96, 78, 48, 62, 90,
  100, 74, 44, 64, 84, 56, 38, 70, 92, 66, 48, 80, 60, 36, 50, 72, 42, 28, 46, 30, 18, 24];
</script>

<template>
  <div class="welcome-page">
    <header class="welcome-header">
      <div class="welcome-brand" aria-label="Text2Speech">
        <span class="brand-symbol" aria-hidden="true">
          <svg viewBox="0 0 40 40" fill="none">
            <path d="M11 17v6M17 11v18M23 14v12M29 17v6" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          </svg>
        </span>
        <span>Text2Speech<span class="brand-period">.</span></span>
      </div>
      <div class="welcome-header-actions"><span class="header-caption">{{ $t("Bài giảng & sách nói AI") }}</span><LocaleSelector /><ThemeToggle /></div>
    </header>

    <main class="welcome-main">
      <section class="welcome-story" aria-labelledby="welcome-title">
        <div class="story-intro">
          <p class="story-eyebrow"><span aria-hidden="true"></span> {{ $t("TỪ VĂN BẢN ĐẾN GIỌNG NÓI") }}</p>
          <h1 id="welcome-title">{{ $t("Để nội dung của bạn") }}<br /><span>{{ $t("cất thành lời.") }}</span></h1>
          <p class="story-description">{{ $t("Biến văn bản thành bài giảng và sách nói với giọng đọc tiếng Việt. Sáng tạo, lắng nghe và lưu lại trong một không gian.") }}</p>
        </div>
        <div class="sound-illustration" aria-hidden="true">
          <div class="sound-heading">
            <span class="sound-label">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path d="M14 3v5h4M9 12h5M9 16h6" />
              </svg> {{ $t("Từ trang viết đến thanh âm") }} </span>
            <span class="sound-badge">{{ $t("Giọng đọc tiếng Việt") }}</span>
          </div>
          <div class="sound-wave">
            <span v-for="(bar, index) in waveform" :key="index" :style="{ height: bar + '%' }"></span>
          </div>
          <div class="sound-caption"><span>{{ $t("Ý tưởng của bạn") }}</span><span class="sound-line"></span><span>{{ $t("Trải nghiệm nghe mới") }}</span></div>
        </div>
        <ul class="welcome-features">
          <li>
            <span class="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5ZM4 17h14M8 7h6M8 11h4" />
              </svg>
            </span>
            <span><strong>{{ $t("Tạo bài giảng") }}</strong><small>{{ $t("Từ văn bản, Word & PDF") }}</small></span>
          </li>
          <li>
            <span class="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" />
              </svg>
            </span>
            <span><strong>{{ $t("Giọng đọc riêng") }}</strong><small>{{ $t("Mang âm sắc của bạn") }}</small></span>
          </li>
          <li>
            <span class="feature-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 11a9 9 0 1 1 3 8M3 5v6h6M12 7v5l3 2" />
              </svg>
            </span>
            <span><strong>{{ $t("Lưu lịch sử") }}</strong><small>{{ $t("Nghe lại khi bạn cần") }}</small></span>
          </li>
        </ul>
      </section>

      <section class="welcome-account" aria-labelledby="account-title" :aria-busy="authLoading">
        <div class="account-symbol" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 13v-1a8 8 0 0 1 16 0v1" /><rect x="3" y="12" width="4" height="8" rx="2" /><rect x="17" y="12" width="4" height="8" rx="2" />
          </svg>
        </div>
        <p class="account-eyebrow">{{ $t("KHÔNG GIAN CỦA BẠN") }}</p>
        <h2 id="account-title">{{ $t("Bắt đầu sáng tạo") }}</h2>
        <p class="account-description">{{ $t("Đăng nhập để tạo bài giảng, khám phá giọng đọc và tiếp tục những nội dung của bạn.") }}</p>
        <div v-if="authLoading" class="account-status" role="status">
          <span class="status-spinner" aria-hidden="true"></span>{{ $t("Đang kết nối dịch vụ đăng nhập…") }} </div>
        <div class="account-actions">
          <button type="button" class="account-button account-button-primary" :disabled="authLoading" @click="$emit('login')">
            <span>{{ $t("Đăng nhập") }}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
          <div class="account-divider"><span></span><p>{{ $t("Bạn mới đến Text2Speech?") }}</p><span></span></div>
          <button type="button" class="account-button account-button-secondary" :disabled="authLoading" @click="$emit('register')">{{ $t("Tạo tài khoản") }}</button>
        </div>
        <div v-if="identitySession || authError" class="account-recovery">
          <button v-if="authError" type="button" :disabled="authLoading" @click="$emit('retry')">{{ $t("Thử lại kết nối") }}</button>
          <button v-if="identitySession" type="button" :disabled="authLoading" @click="$emit('logout')">{{ $t("Đăng xuất phiên hiện tại") }}</button>
        </div>
        <p class="account-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
          </svg>
          <span>{{ $t("Một tài khoản cho mọi nội dung của bạn.") }}</span>
        </p>
      </section>
    </main>

    <footer class="welcome-footer">
      <span>{{ $t("Text2Speech · Biến ý tưởng thành thanh âm") }}</span>
      <span>{{ $t("Được tạo cho nội dung tiếng Việt") }}</span>
    </footer>
  </div>
</template>

<style scoped>
.welcome-page {
  --welcome-ink: var(--ink);
  --welcome-muted: var(--muted);
  --welcome-accent: var(--accent);
  width: 100%;
  min-height: 100vh;
  min-height: 100svh;
  display: flex;
  flex-direction: column;
  padding: 0 48px;
  color: var(--welcome-ink);
  background: var(--canvas);
}
.welcome-header, .welcome-main, .welcome-footer { width: 100%; max-width: 1120px; margin: 0 auto; }
.welcome-header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 30px 0; }
.welcome-brand { display: inline-flex; align-items: center; gap: 11px; font-size: 21px; font-weight: 800; letter-spacing: -0.7px; }
.brand-symbol { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 11px; background: var(--action); color: var(--on-action); }
.brand-symbol svg { width: 38px; height: 38px; }
.brand-period { color: var(--welcome-accent); }
.header-caption { color: var(--welcome-muted); font-size: 13px; }
.welcome-main { flex: 1; display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(340px, 1fr); align-items: center; gap: 80px; padding: 44px 0 64px; }
.welcome-story { min-width: 0; }
.story-eyebrow { display: flex; align-items: center; gap: 9px; margin: 0 0 22px; color: var(--text-body); font-size: 11px; font-weight: 700; letter-spacing: 1.8px; }
.story-eyebrow > span { width: 6px; height: 6px; border-radius: 50%; background: var(--welcome-accent); }
#welcome-title { margin: 0; font-size: clamp(36px, 4.2vw, 54px); font-weight: 750; line-height: 1.15; letter-spacing: -2.5px; }
#welcome-title > span { color: var(--welcome-accent); }
.story-description { max-width: 480px; margin: 24px 0 0; color: var(--text-body); font-size: 16px; line-height: 1.85; }
.sound-illustration { margin-top: 32px; padding: 24px; border: 1px solid var(--hero-line); border-radius: 18px; background: var(--hero-bg); box-shadow: var(--shadow); }
.sound-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.sound-label { display: inline-flex; align-items: center; gap: 8px; color: var(--text-body); font-size: 12px; font-weight: 500; }
.sound-label svg { width: 17px; height: 17px; }
.sound-badge { padding: 5px 8px; border-radius: 6px; background: var(--accent-soft); color: var(--accent); font-size: 11px; white-space: nowrap; }
.sound-wave { display: flex; align-items: center; justify-content: space-between; gap: 5px; height: 72px; margin: 24px 0 20px; }
.sound-wave > span { width: 5px; max-height: 100%; border-radius: 10px; background: var(--wave-faint); }
.sound-wave > span:nth-child(n+8):nth-child(-n+29) { background: var(--accent); }
.sound-wave > span:nth-child(n+15):nth-child(-n+23) { background: var(--accent); }
.sound-caption { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 11px; }
.sound-line { flex: 1; height: 1px; background: var(--line); }
.welcome-features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 18px; padding: 0; margin: 28px 0 0; list-style: none; }
.welcome-features li { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; }
.feature-icon { display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); color: var(--text-body); }
.feature-icon svg { width: 17px; height: 17px; }
.welcome-features strong, .welcome-features small { display: block; }
.welcome-features strong { font-size: 13px; font-weight: 600; line-height: 1.5; }
.welcome-features small { margin-top: 3px; font-size: 11px; color: var(--welcome-muted); line-height: 1.6; }
.welcome-account { width: 100%; padding: 36px; border: 1px solid var(--line); border-top: 4px solid var(--accent); border-radius: 22px; background: var(--surface); box-shadow: var(--shadow-float); }
.account-symbol { display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 24px; border: 1px solid var(--accent-line); border-radius: 14px; background: var(--accent-soft); color: var(--welcome-accent); }
.account-symbol svg { width: 25px; height: 25px; }
.account-eyebrow { margin: 0 0 9px; color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: 1.6px; }
#account-title { margin: 0; font-size: 28px; line-height: 1.35; font-weight: 700; letter-spacing: -1px; }
.account-description { margin: 14px 0 0; color: var(--welcome-muted); font-size: 14px; line-height: 1.8; }
.account-actions { margin-top: 30px; }
.account-button { display: flex; align-items: center; justify-content: center; gap: 12px; width: 100%; min-height: 49px; padding: 13px 18px; border-radius: 9px; font: inherit; font-size: 14px; font-weight: 600; cursor: pointer; transition: background .15s, border-color .15s, box-shadow .15s; }
.account-button-primary { border: 1px solid var(--action); background: var(--action); color: var(--on-action); }
.account-button-primary svg { width: 18px; height: 18px; }
.account-button-primary:hover:not(:disabled) { background: var(--action-hover); border-color: var(--action-hover); box-shadow: var(--shadow); }
.account-button-secondary { border: 1px solid var(--line-strong); background: var(--surface); color: var(--welcome-ink); }
.account-button-secondary:hover:not(:disabled) { background: var(--surface-raised); border-color: var(--line-strong); }
.account-divider { display: flex; align-items: center; gap: 10px; margin: 19px 0; }
.account-divider > span { flex: 1; height: 1px; background: var(--line); }
.account-divider > p { margin: 0; color: var(--muted); font-size: 12px; }
.account-note { display: flex; align-items: center; justify-content: center; gap: 7px; margin: 26px 0 0; padding-top: 22px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.6; }
.account-note svg { width: 13px; height: 13px; flex-shrink: 0; }
.account-status, .account-error { margin-top: 20px; padding: 12px; border-radius: 8px; font-size: 12px; line-height: 1.7; }
.account-status { display: flex; align-items: center; gap: 9px; background: var(--accent-soft); color: var(--accent); }
.status-spinner { width: 14px; height: 14px; flex-shrink: 0; border: 2px solid var(--accent-line); border-top-color: var(--accent); border-radius: 50%; animation: status-spin .8s linear infinite; }
.account-error { background: var(--danger-bg); color: var(--danger); overflow-wrap: anywhere; }
.account-recovery { display: flex; flex-direction: column; align-items: center; gap: 12px; margin-top: 20px; }
.account-recovery button { padding: 4px; border: 0; background: transparent; color: var(--text-body); font: inherit; font-size: 12px; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
button:focus-visible { outline: 3px solid var(--accent); outline-offset: 4px; }
button:disabled { opacity: .6; cursor: wait; }
.welcome-footer { display: flex; justify-content: space-between; gap: 16px; padding: 20px 0 24px; border-top: 1px solid var(--line); color: var(--muted); font-size: 11px; line-height: 1.6; }
@keyframes status-spin { to { transform: rotate(360deg); } }
@media (max-width: 1050px) {
  .welcome-page { padding: 0 32px; }
  .welcome-main { gap: 40px; grid-template-columns: minmax(0, 1.25fr) minmax(320px, 1fr); }
  .welcome-account { padding: 30px; }
  #welcome-title { font-size: 42px; letter-spacing: -1.8px; }
  .sound-heading { flex-wrap: wrap; }
}
@media (max-width: 760px) {
  .welcome-page { padding: 0 24px; }
  .welcome-header { padding: 24px 0; gap: 12px; }
  .header-caption { display: none; }
  .welcome-main { max-width: 480px; grid-template-columns: minmax(0, 1fr); gap: 32px; padding: 24px 0 40px; }
  .welcome-story { display: contents; }
  .story-intro { order: 1; }
  .welcome-account { order: 2; }
  .sound-illustration { order: 3; margin-top: 0; }
  .welcome-features { order: 4; margin-top: 0; }
  #welcome-title { font-size: clamp(30px, 6.5vw, 40px); }
  .story-eyebrow { margin-bottom: 16px; font-size: 10px; letter-spacing: 1.3px; }
  .story-description { font-size: 14px; margin-top: 18px; }
  .sound-illustration { padding: 16px 20px; }
  .sound-wave { height: 48px; margin: 18px 0; gap: 4px; }
  .welcome-features { gap: 12px; }
  .welcome-features li { gap: 8px; }
  .welcome-account { padding: 28px; }
  .account-symbol { margin-bottom: 18px; }
  .welcome-footer { flex-direction: column; align-items: center; text-align: center; gap: 4px; font-size: 10px; }
}
@media (max-width: 380px) {
  .welcome-page { padding: 0 18px; }
  .welcome-account { padding: 24px; }
  #welcome-title { letter-spacing: -1.2px; }
  .sound-badge { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .account-button { transition: none; }
  .status-spinner { animation: none; }
}
</style>
