<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import api from '@/services/api';
import { session, refreshSession } from '@/services/auth';
import {useAccountTier} from '@/composables/useAccountTier';
import AccountUsage from '@/components/AccountUsage.vue';
import PaymentHistory from '@/components/PaymentHistory.vue';
import { notify } from '@/composables/useNotifications';
import StudioBanner from '@/components/StudioBanner.vue';
import UiIcon from '@/components/UiIcon.vue';
const form = ref({ fullName: '', gender: 'other', profile_version: 0 });
let loadedProfile;
const loading = ref(true);
const saving = ref(false);
const failed = ref(false);
const {tier,openUpgrade}=useAccountTier();

const tierClass = computed(() => tier.value?.effective_class || session.value?.user?.account_class || 'free');
const tierLabel = computed(() => ({ free: 'Free', gold: 'Gold', diamond: 'Diamond' })[tierClass.value] || 'Free');
const initials = computed(() => {
  const source = form.value.fullName || session.value?.user?.email || 'T';
  return source.trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toUpperCase() || 'T';
});
const tierTextClass = computed(() => (tierClass.value === 'gold' || tierClass.value === 'diamond') ? `tier-text-${tierClass.value}` : '');
const avatarTierClass = computed(() => (tierClass.value === 'gold' || tierClass.value === 'diamond') ? `avatar-tier-${tierClass.value}` : '');

function applyProfile(user) {
  loadedProfile={fullName:user.fullName||'',gender:user.gender||'other'};
  form.value = {
    fullName: user.fullName || '',
    gender: user.gender || 'other',
    profile_version: user.profile_version || 0,
  };
  session.value = { ...session.value, user };
}
watch(()=>session.value?.user?.profile_version,version=>{
  const user=session.value?.user;
  // A plan update changes the shared version without changing profile fields.
  if(user&&loadedProfile&&user.fullName===loadedProfile.fullName&&user.gender===loadedProfile.gender)form.value.profile_version=version||0;
});

async function load() {
  loading.value = true;
  failed.value = false;
  try {
    const { data } = await api.get('/api/auth/me');
    applyProfile(data.user);
    session.value.tier_info=data.tier_info;
  } catch (error) {
    failed.value = true;
    notify(error.response?.data?.error || 'Không tải được thông tin cá nhân.', { kind: 'error' });
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (saving.value) return;
  saving.value = true;
  try {
    const { data } = await api.patch('/api/auth/me', { ...form.value, fullName: form.value.fullName.trim() });
    applyProfile(data.user);
    notify('Đã cập nhật thông tin cá nhân.', { kind: 'success' });
    await refreshSession().catch(()=>{});
  } catch (error) {
    notify(error.response?.data?.error || 'Không lưu được thông tin cá nhân.', { kind: 'error' });
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
<template>
  <StudioBanner :title="$t('Thông tin cá nhân')" icon="user" :eyebrow="$t('TÀI KHOẢN CỦA BẠN')" :description="$t('Cập nhật hồ sơ và quản lý tài khoản của bạn.')" />
  <div v-if="loading" class="notice" role="status"><span class="spinner" />{{ $t('Đang tải…') }}</div>
  <button v-else-if="failed" type="button" class="btn" @click="load">{{ $t('Tải lại') }}</button>
  <div v-else class="profile-grid">
    <section class="panel"><div class="panel-heading"><h2><UiIcon name="user" />{{ $t('Hồ sơ của tôi') }}</h2></div>
      <div class="profile-hero" :class="'hero-' + tierClass">
        <div class="profile-avatar-hero" :class="avatarTierClass" aria-hidden="true">
          <span>{{ initials }}</span>
          <span v-if="tierClass !== 'free'" class="avatar-tier-spark">✦</span>
        </div>
        <div class="profile-hero-meta">
          <div class="profile-hero-title">
            <strong class="profile-hero-name" :class="tierTextClass">{{ form.fullName || session.user.email }}</strong>
            <span class="pill" :class="tierClass !== 'free' ? tierClass : ''">
              <span class="tier-sparkle-wrap" :class="tierClass !== 'free' ? 'is-' + tierClass : ''">
                <span :class="tierTextClass">{{ tierLabel }}</span>
              </span>
            </span>
          </div>
          <small class="text-muted">{{ session.user.email }}</small>
        </div>
      </div>
      <form class="profile-form" @submit.prevent="save"><fieldset :disabled="saving">
        <div class="field"><label for="profile-name">{{ $t('Họ và tên') }}</label><input id="profile-name" v-model="form.fullName" class="input" required maxlength="200" autocomplete="name" /></div>
        <div class="field"><label for="profile-gender">{{ $t('Giới tính') }}</label><select id="profile-gender" v-model="form.gender" class="input"><option value="male">{{ $t('Nam') }}</option><option value="female">{{ $t('Nữ') }}</option><option value="other">{{ $t('Khác') }}</option></select></div>
        <div class="field"><label for="profile-email">Email</label><input id="profile-email" :value="session.user.email" class="input" readonly type="email" /></div>
      </fieldset><button type="submit" class="btn primary" :disabled="saving||!form.fullName.trim()"><span v-if="saving" class="spinner" /><UiIcon v-else name="check" />{{ $t(saving?'Đang lưu…':'Lưu thay đổi') }}</button></form>
    </section>
    <section class="panel" :class="'tier-panel-' + tierClass">
        <h2>{{ $t('Tài khoản của bạn') }}</h2>
        <div class="profile-plan-wrap">
          <span class="tier-sparkle-wrap" :class="tierClass !== 'free' ? 'is-' + tierClass : ''">
            <span class="profile-plan" :class="tierTextClass">{{ tierLabel }}</span>
          </span>
        </div>
        <p v-if="tier?.subscription_expires_at" class="text-muted">{{ $t('Có hiệu lực đến {0}',[new Date(tier.subscription_expires_at).toLocaleDateString($locale)]) }}</p>
        <p v-else-if="tierClass!=='free'" class="text-muted">{{ $t('Không giới hạn thời hạn') }}</p>
        <button type="button" class="btn primary full profile-upgrade" @click="openUpgrade()"><UiIcon name="spark" />{{ $t('Nâng cấp / Gia hạn gói') }}</button>
        <AccountUsage :show-upgrade="false" />
    </section>
  </div>
  <PaymentHistory v-if="!loading && !failed && session?.user?.role !== 'admin'" />
</template>
<style scoped>
.profile-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(240px,1fr);align-items:start;gap:24px}
.profile-grid + .panel{margin-top:24px}
.profile-hero{display:flex;align-items:center;gap:16px;padding:16px 18px;margin-bottom:22px;border:1px solid var(--line);border-radius:14px;background:var(--surface-raised)}
.profile-hero.hero-gold{border-color:var(--gold-border);background:linear-gradient(135deg,var(--gold-surface),var(--surface-raised) 70%)}
.profile-hero.hero-diamond{border-color:var(--diamond-border);background:linear-gradient(135deg,var(--diamond-surface),var(--surface-raised) 70%)}
.profile-avatar-hero{display:grid;place-items:center;flex-shrink:0;width:56px;height:56px;border-radius:16px;background:var(--accent-soft);border:1.5px solid var(--accent-line);color:var(--accent);font-size:18px;font-weight:750}
.profile-hero-meta{min-width:0;display:grid;gap:4px}
.profile-hero-title{display:flex;align-items:center;flex-wrap:wrap;gap:10px}
.profile-hero-name{font-size:17px;font-weight:750;line-height:1.35;color:var(--ink);overflow-wrap:anywhere}
.profile-hero-meta small{font-size:12px;overflow-wrap:anywhere}
.profile-form fieldset{border:0;padding:0;margin:0 0 24px;display:grid;gap:20px}
.profile-form .input[readonly]{color:var(--muted);background:var(--surface-raised);border-color:var(--line);cursor:default}
.tier-panel-gold{border-color:var(--gold-border);background:linear-gradient(160deg,var(--gold-surface),var(--surface) 48%)}
.tier-panel-diamond{border-color:var(--diamond-border);background:linear-gradient(160deg,var(--diamond-surface),var(--surface) 48%)}
.profile-plan-wrap{margin:10px 0 8px}
.profile-plan{display:inline-block;font-size:32px;font-weight:800;line-height:1.2;letter-spacing:-.5px;color:var(--accent)}
.profile-upgrade{margin:12px 0 22px}
@media(max-width:760px){.profile-grid{grid-template-columns:1fr}}
</style>
