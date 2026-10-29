<script setup>
import {onMounted,ref} from 'vue';
import api from '@/services/api';
import {session,manageAccount} from '@/services/auth';
import {notify} from '@/composables/useNotifications';
import StudioBanner from '@/components/StudioBanner.vue';
import UiIcon from '@/components/UiIcon.vue';
const form=ref({fullName:'',gender:'other',profile_version:0}),loading=ref(true),saving=ref(false),failed=ref(false);
async function load(){
  loading.value=true;failed.value=false;
  try{const {data}=await api.get('/api/auth/me');session.value={user:data.user};form.value={fullName:data.user.fullName||'',gender:data.user.gender||'other',profile_version:data.user.profile_version||0};}
  catch(error){failed.value=true;notify(error.response?.data?.error||'Không tải được thông tin cá nhân.',{kind:'error'});}finally{loading.value=false;}
}
async function save(){
  if(saving.value)return;saving.value=true;
  try{const {data}=await api.patch('/api/auth/me',{...form.value,fullName:form.value.fullName.trim()});session.value={user:data.user};form.value={fullName:data.user.fullName,gender:data.user.gender,profile_version:data.user.profile_version};notify('Đã cập nhật thông tin cá nhân.',{kind:'success'});}
  catch(error){notify(error.response?.data?.error||'Không lưu được thông tin cá nhân.',{kind:'error'});}finally{saving.value=false;}
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
    <div class="studio-stack"><section class="panel"><h2>{{ $t('Tài khoản của bạn') }}</h2><span class="profile-plan">{{ ({free:'Free',gold:'Gold',diamond:'Diamond'})[session.user.account_class||'free'] }}</span><p class="text-muted">{{ $t('Gold và Diamond sẽ được bổ sung trong tương lai.') }}</p></section><section class="panel"><h2>{{ $t('Bảo mật tài khoản') }}</h2><p class="text-muted">{{ $t('Quản lý email, mật khẩu và các phiên đăng nhập.') }}</p><button class="btn" type="button" @click="manageAccount"><UiIcon name="shield" />{{ $t('Quản lý tài khoản') }}</button></section></div>
  </div>
</template>
<style scoped>
.profile-grid{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(240px,1fr);gap:24px}.profile-form fieldset{border:0;padding:0;margin:0 0 24px;display:grid;gap:22px}.profile-form .input[readonly]{color:var(--muted);background:var(--surface-raised)}.profile-plan{display:inline-block;font-size:30px;font-weight:750;margin:10px 0;color:var(--accent)}@media(max-width:760px){.profile-grid{grid-template-columns:1fr}}
</style>
