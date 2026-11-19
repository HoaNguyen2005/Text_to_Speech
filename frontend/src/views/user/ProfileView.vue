<script setup>
import { onMounted, ref, watch } from 'vue';
import api from '@/services/api';
import { session, manageAccount, refreshSession } from '@/services/auth';
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
      <form class="profile-form" @submit.prevent="save"><fieldset :disabled="saving">
        <div class="field"><label for="profile-name">{{ $t('Họ và tên') }}</label><input id="profile-name" v-model="form.fullName" class="input" required maxlength="200" autocomplete="name" /></div>
        <div class="field"><label for="profile-gender">{{ $t('Giới tính') }}</label><select id="profile-gender" v-model="form.gender" class="input"><option value="male">{{ $t('Nam') }}</option><option value="female">{{ $t('Nữ') }}</option><option value="other">{{ $t('Khác') }}</option></select></div>
        <div class="field"><label for="profile-email">Email</label><input id="profile-email" :value="session.user.email" class="input" readonly type="email" /></div>
      </fieldset><button type="submit" class="btn primary" :disabled="saving||!form.fullName.trim()"><span v-if="saving" class="spinner" /><UiIcon v-else name="check" />{{ $t(saving?'Đang lưu…':'Lưu thay đổi') }}</button></form>
    </section>
    <div class="studio-stack"><section class="panel"><h2>{{ $t('Tài khoản của bạn') }}</h2><span class="profile-plan">{{ ({free:'Free',gold:'Gold',diamond:'Diamond'})[tier?.effective_class||'free'] }}</span><p v-if="tier?.subscription_expires_at" class="text-muted">{{ $t('Có hiệu lực đến {0}',[new Date(tier.subscription_expires_at).toLocaleDateString($locale)]) }}</p><p v-else-if="tier?.effective_class!=='free'" class="text-muted">{{ $t('Không giới hạn thời hạn') }}</p><button type="button" class="btn primary full profile-upgrade" @click="openUpgrade()"><UiIcon name="spark" />{{ $t('Nâng cấp / Gia hạn gói') }}</button><AccountUsage :show-upgrade="false" /></section><section class="panel"><h2>{{ $t('Bảo mật tài khoản') }}</h2><p class="text-muted">{{ $t('Quản lý email, mật khẩu và các phiên đăng nhập.') }}</p><button class="btn" type="button" @click="manageAccount"><UiIcon name="shield" />{{ $t('Quản lý tài khoản') }}</button></section></div>
  </div>
  <section v-if="tier" class="panel plan-comparison"><h2>{{ $t('So sánh quyền lợi') }}</h2><div class="table-scroll"><table class="data-table"><thead><tr><th>{{ $t('Gói tài khoản') }}</th><th>{{ $t('Bài giảng / ngày') }}</th><th>{{ $t('Ký tự / bài') }}</th><th>{{ $t('Sách / ngày') }}</th><th>{{ $t('Phút / sách') }}</th><th>{{ $t('Giọng riêng') }}</th><th>{{ $t('AI chỉnh sửa / sách') }}</th></tr></thead><tbody><tr v-for="(item,key) in tier.catalog" :key="key"><td>{{ ({free:'Free',gold:'Gold',diamond:'Diamond'})[key] }}</td><td>{{ item.lecturesPerDay }}</td><td>{{ item.lectureChars.toLocaleString($locale) }}</td><td>{{ item.booksPerDay }}</td><td>{{ item.bookMinutes }}</td><td>{{ item.maxVoices }}</td><td>{{ item.maxRevisions??$t('Không giới hạn') }}</td></tr></tbody></table></div><button class="btn primary" type="button" @click="openUpgrade()">{{ $t('Xem bảng giá và nâng cấp') }}</button></section>
  <PaymentHistory v-if="!loading&&!failed" />
</template>
<style scoped>
.profile-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(240px,1fr);gap:24px}.profile-form fieldset{border:0;padding:0;margin:0 0 24px;display:grid;gap:22px}.profile-form .input[readonly]{color:var(--muted);background:var(--surface-raised)}.profile-plan{display:inline-block;font-size:30px;font-weight:750;margin:10px 0;color:var(--accent)}@media(max-width:760px){.profile-grid{grid-template-columns:1fr}}
.profile-upgrade{margin:8px 0 22px}.plan-comparison{margin:24px 0}.plan-comparison>.btn{margin-top:18px}
</style>
