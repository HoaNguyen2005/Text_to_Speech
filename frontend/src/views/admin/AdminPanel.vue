
<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '@/services/api';
import { session } from '@/services/auth';
import UiIcon from '@/components/UiIcon.vue';
import StudioBanner from '@/components/StudioBanner.vue';
import VoicePicker from '@/components/VoicePicker.vue';
import PaymentHistory from '@/components/PaymentHistory.vue';
import { confirmAction, useFeedback, notify } from '@/composables/useNotifications';

const users = ref([]);
const voices = ref([]);
const loading = ref(true);
const hasLoaded = ref(false);
const busy = ref('');
const errorMessage = useFeedback('error');
const successMessage = useFeedback('success');
const activeTab = ref('users');
const search = ref('');
const voiceSearch = ref('');
const roleFilter = ref('');
const tierFilter=ref(''),grantDays=ref(30);
const showVoiceForm = ref(false);
const voiceFormError = useFeedback('error');
const newVoice = ref({ name: '', gender: 'male',class:'free',description:'' });
let voiceCode;
const voiceLibrary=ref(null),librarySelected=ref('');
function openVoiceLibrary(voice){librarySelected.value=voice.voice_id;voiceLibrary.value?.open();}
const audioFile = ref(null);
const audioInput = ref(null);
const filteredUsers = computed(() => users.value.filter(user =>
  (!roleFilter.value || user.role === roleFilter.value) &&
  (!tierFilter.value || (user.account_class||'free') === tierFilter.value) &&
  [user.fullName, user.email].join(' ').toLocaleLowerCase('vi-VN').includes(search.value.trim().toLocaleLowerCase('vi-VN'))));
const filteredVoices = computed(() => voices.value.filter(voice =>
  [voice.name, voice.voice_id].join(' ').toLocaleLowerCase('vi-VN').includes(voiceSearch.value.trim().toLocaleLowerCase('vi-VN'))));
const activeVoices = computed(() => voices.value.filter(voice => voice.is_active));
const stats = computed(() => [
  { label: 'Tổng tài khoản', value: users.value.length, icon: 'users' },
  { label: 'Đang hoạt động', value: users.value.filter(user => user.status === 'active').length, icon: 'check' },
  { label: 'Quản trị viên', value: users.value.filter(user => user.role === 'admin').length, icon: 'shield' },
  { label: 'Giọng đang dùng', value: activeVoices.value.length, icon: 'mic' }
]);
const initials = name => (name || '?').trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toUpperCase();
const statusLabel = status => ({ active: 'Hoạt động', inactive: 'Tạm khóa', banned: 'Bị cấm' }[status] || status);
const isSelf = user => user._id === session.value?.user?._id;

async function fetchData() {
  loading.value = true;
  try {
    const [usersRes, voicesRes] = await Promise.all([
      api.get('/api/auth/users'),
      api.get('/api/voices', { params: { include_locked: true } })
    ]);
    users.value = usersRes.data;
    voices.value = voicesRes.data;
    hasLoaded.value = true;
    return true;
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể tải dữ liệu quản trị. Vui lòng thử lại.';
    return false;
  } finally { loading.value = false; }
}
async function reload() { errorMessage.value = ''; successMessage.value = ''; if (await fetchData()) notify('Đã làm mới dữ liệu quản trị.', { kind: 'success' }); }
onMounted(fetchData);

async function changeUser(user, field, value) {
  if (user[field] === value && !user.authSyncPending) return;
  if (field === 'role' && !await confirmAction(value === 'admin'
    ? 'Bạn có chắc muốn cấp quyền quản trị viên cho tài khoản này?'
    : 'Bạn có chắc muốn chuyển tài khoản này về người dùng?', { title: 'Thay đổi quyền truy cập', confirmLabel: 'Lưu thay đổi' })) return;
  busy.value = user._id;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await api.put('/api/auth/users/' + user._id + '/' + field, { [field]: value });
    if (await fetchData()) successMessage.value = 'Thông tin tài khoản đã được cập nhật.';
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể cập nhật tài khoản. Vui lòng thử lại.';
    await fetchData();
  } finally { busy.value = ''; }
}
async function onUserChange(user, field, event) {
  const value = event.target.value;
  // Keep the displayed value tied to the saved account until the request completes.
  event.target.value = user[field];
  await changeUser(user, field, value);
}
async function changeTier(user,event){
  const account_class=event.target.value;event.target.value=user.account_class||'free';
  if(!await confirmAction('Thay đổi gói tài khoản này theo thời hạn đã chọn?',{title:'Thay đổi gói tài khoản',confirmLabel:'Lưu thay đổi'}))return;
  busy.value=user._id;
  try{await api.put(`/api/auth/users/${user._id}/account-class`,{account_class,duration_days:grantDays.value});await fetchData();notify('Đã cập nhật gói tài khoản.',{kind:'success'});}
  catch(error){errorMessage.value=error.response?.data?.error||'Không thể cập nhật tài khoản. Vui lòng thử lại.';}finally{busy.value='';}
}
function handleFileUpload(event) { audioFile.value = event.target.files[0] || null; }
async function addVoice() {
  if (busy.value) return;
  errorMessage.value = '';
  successMessage.value = '';
  voiceFormError.value = '';
  if (!newVoice.value.name.trim() || !audioFile.value) {
    voiceFormError.value = 'Vui lòng nhập đầy đủ thông tin và chọn file âm thanh mẫu.';
    return;
  }
  busy.value = 'new-voice';
  const body = new FormData();
  body.append('name', newVoice.value.name.trim());
  body.append('gender', newVoice.value.gender);
  body.append('class',newVoice.value.class);body.append('description',newVoice.value.description);
  body.append('audio_file', audioFile.value);
  try {
    voiceCode ||= `voice_${crypto.randomUUID().replaceAll('-', '')}`;
    body.append('voice_id', voiceCode);
    await api.post('/api/voices', body);
    voiceCode = undefined;
    newVoice.value = { name: '', gender: 'male',class:'free',description:'' };
    audioFile.value = null;
    if (audioInput.value) audioInput.value.value = '';
    showVoiceForm.value = false;
    voiceSearch.value = '';
    if (await fetchData()) successMessage.value = 'Giọng mẫu mới đã được thêm vào thư viện chung.';
  } catch (error) {
    voiceFormError.value = error.response?.data?.error || 'Không thể thêm giọng mẫu. Vui lòng kiểm tra kết nối và thử lại.';
  } finally { busy.value = ''; }
}
async function toggleVoiceLock(voice) {
  if (busy.value) return;
  const lock = voice.is_active;
  if (!await confirmAction({
    key: lock ? 'Khóa giọng “{0}” để người dùng không còn thấy hoặc chọn giọng này?' : 'Mở khóa giọng “{0}” để người dùng có thể chọn lại?',
    params: [voice.name]
  }, {
    title: lock ? 'Khóa giọng đọc' : 'Mở khóa giọng đọc',
    confirmLabel: lock ? 'Khóa' : 'Mở khóa',
    danger: lock
  })) return;
  busy.value = voice._id;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    const { data } = await api.put('/api/voices/' + voice._id, { is_active: !lock });
    voices.value = voices.value.map(row => row._id === voice._id ? data.data : row);
    successMessage.value = lock ? 'Đã khóa giọng đọc.' : 'Đã mở khóa giọng đọc.';
  } catch (error) { errorMessage.value = error.response?.data?.error || 'Không thể đổi trạng thái giọng đọc.'; }
  finally { busy.value = ''; }
}
</script>

<template>
  <StudioBanner :title="$t('Quản lý rõ ràng. Vận hành liền mạch.')" icon="shield" :eyebrow="$t('TRUNG TÂM QUẢN TRỊ')" :description="$t('Theo dõi tài khoản, phân quyền truy cập và xây dựng thư viện giọng đọc cho không gian Text2Speech.')">
    <button type="button" class="btn" :disabled="loading || !!busy" @click="reload"><UiIcon name="refresh" />{{ $t("Làm mới dữ liệu") }}</button>
  </StudioBanner>
  <button v-if="errorMessage && !loading" type="button" class="btn small" @click="reload"><UiIcon name="refresh" />{{ $t('Thử lại') }}</button>
  <div v-if="loading" class="notice" role="status"><span class="spinner" aria-hidden="true"></span>{{ $t("Đang tải dữ liệu quản trị…") }}</div>
  <template v-else-if="hasLoaded">
    <div class="stat-grid"><section v-for="stat in stats" :key="stat.label" class="panel stat-card"><div><p>{{ $t(stat.label) }}</p><strong>{{ stat.value }}</strong></div><span class="stat-icon"><UiIcon :name="stat.icon" /></span></section></div>
    <div class="section-tabs" :aria-label="$t('Danh mục quản trị')">
      <button type="button" :class="{ active: activeTab === 'users' }" :aria-pressed="activeTab === 'users'" @click="activeTab = 'users'"><UiIcon name="users" />{{ $t("Tài khoản") }}<span class="tab-count">{{ users.length }}</span></button>
      <button type="button" :class="{ active: activeTab === 'voices' }" :aria-pressed="activeTab === 'voices'" @click="activeTab = 'voices'"><UiIcon name="mic" />{{ $t("Giọng đọc") }}<span class="tab-count">{{ voices.length }}</span></button>
      <button type="button" :class="{active:activeTab==='payments'}" :aria-pressed="activeTab==='payments'" @click="activeTab='payments'">{{ $t('Giao dịch nạp tiền') }}</button>
    </div>
    <PaymentHistory v-if="activeTab==='payments'" :users="users" admin />
    <section v-if="activeTab === 'users'" class="panel flush" aria-labelledby="users-heading">
      <div class="panel-heading"><div><h2 id="users-heading">{{ $t("Danh sách tài khoản") }}</h2><p>{{ $t("Quyền truy cập và trạng thái hoạt động của người dùng.") }}</p></div><span class="pill">{{ users.length }} {{ $t("tài khoản") }}</span></div>
      <div class="toolbar table-toolbar admin-users-toolbar">
        <div class="field admin-toolbar-search">
          <label for="admin-user-search">{{ $t('Tìm kiếm') }}</label>
          <div class="search-field"><UiIcon name="search" /><input id="admin-user-search" v-model="search" type="search" class="input" :aria-label="$t('Tìm tài khoản')" :placeholder="$t('Tìm tên hoặc email…')" /></div>
        </div>
        <div class="field admin-toolbar-field">
          <label for="admin-role-filter">{{ $t('Vai trò') }}</label>
          <select id="admin-role-filter" v-model="roleFilter" class="input role-filter" :aria-label="$t('Lọc theo vai trò')"><option value="">{{ $t("Tất cả vai trò") }}</option><option value="user">{{ $t("Người dùng") }}</option><option value="admin">{{ $t("Quản trị viên") }}</option></select>
        </div>
        <div class="field admin-toolbar-field">
          <label for="admin-tier-filter">{{ $t('Hạng tài khoản') }}</label>
          <select id="admin-tier-filter" v-model="tierFilter" class="input role-filter" :aria-label="$t('Lọc hạng tài khoản')"><option value="">{{ $t('Tất cả hạng tài khoản') }}</option><option value="free">Free</option><option value="gold">Gold</option><option value="diamond">Diamond</option></select>
        </div>
        <div class="field admin-toolbar-field">
          <label for="admin-grant-days">{{ $t('Thời hạn khi cấp gói') }}</label>
          <select id="admin-grant-days" v-model="grantDays" class="input role-filter" :aria-label="$t('Thời hạn cấp gói')"><option :value="30">{{ $t('Cấp 30 ngày') }}</option><option :value="365">{{ $t('Cấp 365 ngày') }}</option><option :value="null">{{ $t('Cấp vĩnh viễn') }}</option></select>
        </div>
      </div>
      <div v-if="!filteredUsers.length" class="empty-state"><div class="empty-icon"><UiIcon name="users" /></div><h2>{{ $t("Chưa có tài khoản phù hợp") }}</h2><p>{{ $t("Thử đổi từ khóa hoặc bộ lọc vai trò.") }}</p></div>
      <div v-else class="table-scroll" tabindex="0" role="region" :aria-label="$t('Bảng tài khoản — cuộn ngang để xem các cột')">
        <table class="data-table"><thead><tr><th scope="col">{{ $t("Tài khoản") }}</th><th scope="col">{{ $t("Giới tính") }}</th><th scope="col">{{ $t("Vai trò") }}</th><th scope="col">{{ $t("Trạng thái") }}</th><th scope="col">{{ $t("Hạng & Thời hạn") }}</th><th scope="col">{{ $t("Thiết lập") }}</th></tr></thead>
          <tbody><tr v-for="user in filteredUsers" :key="user._id">
            <td><div class="table-person"><span class="table-avatar" :class="(user.account_class === 'gold' || user.account_class === 'diamond') ? `avatar-tier-${user.account_class}` : ''">{{ initials(user.fullName || user.email) }}</span><div><strong :class="(user.account_class === 'gold' || user.account_class === 'diamond') ? `tier-text-${user.account_class}` : ''">{{ user.fullName || $t("Chưa có tên") }} <span v-if="isSelf(user)" class="self-label">{{ $t("Bạn") }}</span></strong><small>{{ user.email }}</small><small v-if="user.authSyncPending" class="pending-label">{{ $t("Chờ đồng bộ · Chọn lại quyền hoặc trạng thái mong muốn") }}</small></div></div></td>
            <td class="text-muted">{{ user.gender === 'male' ? $t("Nam") : user.gender === 'female' ? $t("Nữ") : $t("Khác") }}</td>
            <td><span class="pill" :class="{ purple: user.role === 'admin' }">{{ user.role === 'admin' ? $t("Quản trị viên") : $t("Người dùng") }}</span></td>
            <td><span class="pill" :class="{ green: user.status === 'active', amber: user.status === 'inactive', red: user.status === 'banned' }">{{ $t(statusLabel(user.status)) }}</span></td>
            <td><div class="admin-tier-cell"><select :value="user.account_class||'free'" class="input admin-table-select" :disabled="!!busy" :aria-label="$t('Gói tài khoản')" @change="changeTier(user,$event)"><option value="free">Free</option><option value="gold">Gold</option><option value="diamond">Diamond</option></select><small class="text-muted">{{ user.subscription_expires_at?new Date(user.subscription_expires_at).toLocaleDateString($locale):$t('Không giới hạn thời hạn') }}</small></div></td><td><div class="table-actions">
              <select :value="user.status" class="input" :disabled="!!busy || isSelf(user)" :aria-label="$t('Trạng thái của ')+user.email" @change="onUserChange(user, 'status', $event)"><option value="active">{{ $t("Hoạt động") }}</option><option value="inactive">{{ $t("Tạm khóa") }}</option><option value="banned">{{ $t("Bị cấm") }}</option></select>
              <select :value="user.role" class="input" :disabled="!!busy || isSelf(user)" :aria-label="$t('Vai trò của ')+user.email" @change="onUserChange(user, 'role', $event)"><option value="user">{{ $t("Người dùng") }}</option><option value="admin">{{ $t("Quản trị viên") }}</option></select>
            </div></td>
          </tr></tbody>
        </table>
      </div>
      <div class="table-footer">{{ $t("Hiển thị") }} {{ filteredUsers.length }} / {{ users.length }} {{ $t("tài khoản") }}</div>
    </section>
    <div v-else-if="activeTab==='voices'" class="studio-stack">
      <section v-if="showVoiceForm" class="panel">
        <div class="panel-heading"><div><h2><UiIcon name="mic" />{{ $t("Thêm giọng mẫu chung") }}</h2><p>{{ $t("Giọng mới sẽ xuất hiện trong thư viện của người dùng.") }}</p></div><button type="button" class="btn small" :disabled="!!busy" @click="showVoiceForm = false" :aria-label="$t('Đóng biểu mẫu giọng mẫu')"><UiIcon name="close" /></button></div>
        <form class="inline-form" @submit.prevent="addVoice">
          <div class="field"><label for="voice-name">{{ $t("Tên hiển thị") }}</label><input id="voice-name" v-model="newVoice.name" class="input" :placeholder="$t('VD: Giọng Nam Hà Nội')" maxlength="200" required :disabled="!!busy" /></div>
          <div class="field"><label for="voice-gender">{{ $t("Giới tính giọng đọc") }}</label><select id="voice-gender" v-model="newVoice.gender" class="input" :disabled="!!busy"><option value="male">{{ $t("Nam") }}</option><option value="female">{{ $t("Nữ") }}</option></select></div>
          <div class="field"><label for="voice-class">{{ $t('Phân hạng giọng') }}</label><select id="voice-class" v-model="newVoice.class" class="input" :disabled="!!busy"><option value="free">Free</option><option value="gold">Gold</option><option value="diamond">Diamond</option></select></div>
          <div class="field form-wide"><label for="voice-description">{{ $t('Mô tả') }}</label><textarea id="voice-description" v-model="newVoice.description" class="input" maxlength="500" rows="2" :disabled="!!busy" /></div>
          <div class="field"><label for="voice-audio">{{ $t("File âm thanh mẫu") }}</label><input id="voice-audio" ref="audioInput" class="input" type="file" accept="audio/*" @change="handleFileUpload" required :disabled="!!busy" /></div>
          <div class="form-wide"><button type="submit" class="btn primary" :disabled="!!busy"><span v-if="busy === 'new-voice'" class="spinner" aria-hidden="true"></span><UiIcon v-else name="plus" />{{ busy === 'new-voice' ? $t("Đang thêm giọng…") : $t("Lưu giọng mẫu") }}</button></div>
        </form>
      </section>
      <section class="panel flush" aria-labelledby="voices-heading">
        <div class="panel-heading"><div><h2 id="voices-heading">{{ $t("Thư viện giọng đọc") }}</h2><p>{{ $t("Quản lý giọng mẫu chung và giọng cá nhân của bạn.") }}</p></div><button type="button" class="btn primary" :disabled="!!busy" @click="showVoiceForm = !showVoiceForm"><UiIcon name="plus" />{{ $t("Thêm giọng mẫu") }}</button></div>
        <div class="toolbar table-toolbar"><div class="search-field"><UiIcon name="search" /><input v-model="voiceSearch" type="search" class="input" :aria-label="$t('Tìm giọng đọc')" :placeholder="$t('Tìm tên hoặc mã giọng…')" /></div><span class="text-muted">{{ filteredVoices.length }} {{ $t("giọng đọc") }}</span></div>
        <div v-if="!filteredVoices.length" class="empty-state"><div class="empty-icon"><UiIcon name="mic" /></div><h2>{{ $t("Chưa có giọng đọc phù hợp") }}</h2><p>{{ $t("Thử từ khóa khác hoặc thêm giọng mẫu mới.") }}</p></div>
        <div v-else class="table-scroll" tabindex="0" role="region" :aria-label="$t('Bảng giọng đọc')">
          <table class="data-table">
            <thead>
              <tr>
                <th scope="col">{{ $t('Giọng đọc') }}</th>
                <th scope="col">{{ $t('Mã giọng đọc') }}</th>
                <th scope="col">{{ $t('Phân hạng giọng') }}</th>
                <th scope="col">{{ $t('Mô tả') }}</th>
                <th scope="col">{{ $t('Trạng thái') }}</th>
                <th scope="col" class="voice-actions-column">{{ $t('Thao tác') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="voice in filteredVoices" :key="voice._id">
                <td>
                  <button v-if="voice.is_active" type="button" class="text-button" @click="openVoiceLibrary(voice)"><UiIcon name="mic" />{{ voice.name }}</button>
                  <span v-else>{{ voice.name }}</span>
                </td>
                <td class="voice-code text-muted">{{ voice.voice_id }}</td>
                <td><span class="pill" :class="voice.class && voice.class !== 'free' ? voice.class : ''">{{ ({free:'Free',gold:'Gold',diamond:'Diamond'})[voice.class||'free'] }}</span></td>
                <td class="text-muted">{{ voice.description || '—' }}</td>
                <td><span class="pill" :class="voice.is_active ? 'green' : 'amber'">{{ $t(voice.is_active ? 'Đang dùng' : 'Đã khóa') }}</span></td>
                <td class="voice-actions-column">
                  <div v-if="voice.can_edit" class="admin-voice-actions">
                    <button type="button" class="btn small" :disabled="!!busy" @click="voiceLibrary.edit(voice)">{{ $t('Chỉnh sửa') }}</button>
                    <button type="button" class="btn small" :class="{ danger: voice.is_active }" :disabled="!!busy" @click="toggleVoiceLock(voice)">{{ $t(voice.is_active ? 'Khóa' : 'Mở khóa') }}</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="table-footer">{{ $t("Hiển thị") }} {{ filteredVoices.length }} / {{ voices.length }} {{ $t("giọng đọc") }}</div>
      </section>
    </div>
  </template>
  <VoicePicker ref="voiceLibrary" v-model="librarySelected" :voices="activeVoices" :disabled="!!busy" manage admin hide-trigger @lock="toggleVoiceLock" @refresh="fetchData" />
</template>

<style scoped>
.admin-users-toolbar { display: grid; grid-template-columns: minmax(220px, 1.4fr) repeat(3, minmax(150px, 1fr)); gap: 14px; align-items: end; }
.admin-toolbar-search .search-field { max-width: none; min-width: 0; }
.admin-toolbar-field > label, .admin-toolbar-search > label { font-size: 11px; color: var(--muted); font-weight: 600; }
.admin-users-toolbar .role-filter { width: 100%; max-width: none; font-size: 13px; min-height: 42px; }
.admin-users-toolbar .search-field .input { min-height: 42px; font-size: 13px; }
.admin-users-toolbar .search-field > .ui-icon { top: 13px; }
.admin-tier-cell { display: grid; gap: 6px; min-width: 124px; }
.admin-table-select { min-height: 38px; padding: 6px 28px 6px 10px; font-size: 12px; border-radius: 9px; }
.voice-code { min-width: 12ch; max-width: 26ch; overflow-wrap: anywhere; }
.data-table .voice-actions-column { text-align: center; }
.admin-voice-actions { display: inline-grid; grid-template-columns: repeat(2, 1fr); gap: 8px; white-space: nowrap; }
.admin-feedback { margin-bottom: 18px; }
.role-filter { width: auto; max-width: 200px; font-size: 12px; }
.self-label { margin-left: 5px; color: var(--muted); font-size: 10px; font-weight: 500; }
.table-person .pending-label { color: var(--warning); }
@media (max-width: 950px) { .admin-users-toolbar { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 560px) { .admin-users-toolbar { grid-template-columns: 1fr; } }
</style>
