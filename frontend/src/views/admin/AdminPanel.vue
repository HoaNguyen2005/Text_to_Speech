
<script setup>
import { ref, computed, onMounted } from 'vue';
import api from '@/services/api';
import { session } from '@/services/auth';
import UiIcon from '@/components/UiIcon.vue';

const users = ref([]);
const voices = ref([]);
const loading = ref(true);
const hasLoaded = ref(false);
const busy = ref('');
const errorMessage = ref('');
const successMessage = ref('');
const activeTab = ref('users');
const search = ref('');
const voiceSearch = ref('');
const roleFilter = ref('');
const showVoiceForm = ref(false);
const newVoice = ref({ voice_id: '', name: '', gender: 'male' });
const audioFile = ref(null);
const audioInput = ref(null);
const filteredUsers = computed(() => users.value.filter(user =>
  (!roleFilter.value || user.role === roleFilter.value) &&
  [user.fullName, user.email].join(' ').toLocaleLowerCase('vi-VN').includes(search.value.trim().toLocaleLowerCase('vi-VN'))));
const filteredVoices = computed(() => voices.value.filter(voice =>
  [voice.name, voice.voice_id].join(' ').toLocaleLowerCase('vi-VN').includes(voiceSearch.value.trim().toLocaleLowerCase('vi-VN'))));
const stats = computed(() => [
  { label: 'Tổng tài khoản', value: users.value.length, icon: 'users' },
  { label: 'Đang hoạt động', value: users.value.filter(user => user.status === 'active').length, icon: 'check' },
  { label: 'Quản trị viên', value: users.value.filter(user => user.role === 'admin').length, icon: 'shield' },
  { label: 'Giọng đang dùng', value: voices.value.length, icon: 'mic' }
]);
const initials = name => (name || '?').trim().split(/\s+/).slice(-2).map(word => word[0]).join('').toUpperCase();
const statusLabel = status => ({ active: 'Hoạt động', inactive: 'Tạm khóa', banned: 'Bị cấm' }[status] || status);
const isSelf = user => user._id === session.value?.user?._id;

async function fetchData() {
  loading.value = true;
  try {
    const [usersRes, voicesRes] = await Promise.all([api.get('/api/auth/users'), api.get('/api/voices')]);
    users.value = usersRes.data;
    voices.value = voicesRes.data;
    hasLoaded.value = true;
    return true;
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể tải dữ liệu quản trị. Vui lòng thử lại.';
    return false;
  } finally { loading.value = false; }
}
async function reload() { errorMessage.value = ''; successMessage.value = ''; await fetchData(); }
onMounted(fetchData);

async function changeUser(user, field, value) {
  if (user[field] === value && !user.authSyncPending) return;
  if (field === 'role' && !window.confirm(value === 'admin'
    ? 'Bạn có chắc muốn cấp quyền quản trị viên cho tài khoản này?'
    : 'Bạn có chắc muốn chuyển tài khoản này về người dùng?')) return;
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
function handleFileUpload(event) { audioFile.value = event.target.files[0] || null; }
async function addVoice() {
  errorMessage.value = '';
  successMessage.value = '';
  if (!newVoice.value.voice_id.trim() || !newVoice.value.name.trim() || !audioFile.value) {
    errorMessage.value = 'Vui lòng nhập đầy đủ thông tin và chọn file âm thanh mẫu.';
    return;
  }
  busy.value = 'new-voice';
  const body = new FormData();
  body.append('voice_id', newVoice.value.voice_id.trim());
  body.append('name', newVoice.value.name.trim());
  body.append('gender', newVoice.value.gender);
  body.append('audio_file', audioFile.value);
  try {
    await api.post('/api/voices', body);
    newVoice.value = { voice_id: '', name: '', gender: 'male' };
    audioFile.value = null;
    if (audioInput.value) audioInput.value.value = '';
    showVoiceForm.value = false;
    if (await fetchData()) successMessage.value = 'Giọng mẫu mới đã được thêm vào thư viện chung.';
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể thêm giọng mẫu.';
  } finally { busy.value = ''; }
}
async function hideVoice(voice) {
  if (!window.confirm('Ẩn giọng mẫu “' + voice.name + '” khỏi danh sách sử dụng?')) return;
  busy.value = voice._id;
  errorMessage.value = '';
  successMessage.value = '';
  try {
    await api.put('/api/voices/' + voice._id, { is_active: false });
    if (await fetchData()) successMessage.value = 'Đã ẩn giọng mẫu khỏi danh sách sử dụng.';
  } catch (error) { errorMessage.value = error.response?.data?.error || 'Không thể ẩn giọng mẫu.'; }
  finally { busy.value = ''; }
}
</script>

<template>
  <div class="page-heading">
    <div><p class="eyebrow"><UiIcon name="shield" /> QUẢN TRỊ HỆ THỐNG</p><h1>Tổng quan quản trị</h1><p>Quản lý tài khoản và thư viện giọng đọc trong một không gian.</p></div>
    <button type="button" class="btn" :disabled="loading || !!busy" @click="reload"><UiIcon name="refresh" />Làm mới dữ liệu</button>
  </div>
  <div v-if="errorMessage" class="notice error admin-feedback" role="alert">{{ errorMessage }}</div>
  <div v-if="successMessage" class="notice success admin-feedback" role="status"><UiIcon name="check" />{{ successMessage }}</div>
  <div v-if="loading" class="notice" role="status"><span class="spinner" aria-hidden="true"></span>Đang tải dữ liệu quản trị…</div>
  <template v-else-if="hasLoaded">
    <div class="stat-grid"><section v-for="stat in stats" :key="stat.label" class="panel stat-card"><div><p>{{ stat.label }}</p><strong>{{ stat.value }}</strong></div><span class="stat-icon"><UiIcon :name="stat.icon" /></span></section></div>
    <div class="section-tabs" aria-label="Danh mục quản trị">
      <button type="button" :class="{ active: activeTab === 'users' }" :aria-pressed="activeTab === 'users'" @click="activeTab = 'users'"><UiIcon name="users" />Tài khoản<span class="tab-count">{{ users.length }}</span></button>
      <button type="button" :class="{ active: activeTab === 'voices' }" :aria-pressed="activeTab === 'voices'" @click="activeTab = 'voices'"><UiIcon name="mic" />Giọng đọc<span class="tab-count">{{ voices.length }}</span></button>
    </div>
    <section v-if="activeTab === 'users'" class="panel flush" aria-labelledby="users-heading">
      <div class="panel-heading"><div><h2 id="users-heading">Danh sách tài khoản</h2><p>Quyền truy cập và trạng thái hoạt động của người dùng.</p></div><span class="pill">{{ users.length }} tài khoản</span></div>
      <div class="toolbar table-toolbar">
        <div class="search-field"><UiIcon name="search" /><input v-model="search" type="search" class="input" aria-label="Tìm tài khoản" placeholder="Tìm tên hoặc email…" /></div>
        <select v-model="roleFilter" class="input role-filter" aria-label="Lọc theo vai trò"><option value="">Tất cả vai trò</option><option value="user">Người dùng</option><option value="admin">Quản trị viên</option></select>
      </div>
      <div v-if="!filteredUsers.length" class="empty-state"><div class="empty-icon"><UiIcon name="users" /></div><h2>Chưa có tài khoản phù hợp</h2><p>Thử đổi từ khóa hoặc bộ lọc vai trò.</p></div>
      <div v-else class="table-scroll" tabindex="0" role="region" aria-label="Bảng tài khoản — cuộn ngang để xem các cột">
        <table class="data-table"><thead><tr><th scope="col">Tài khoản</th><th scope="col">Giới tính</th><th scope="col">Vai trò</th><th scope="col">Trạng thái</th><th scope="col">Thiết lập</th></tr></thead>
          <tbody><tr v-for="user in filteredUsers" :key="user._id">
            <td><div class="table-person"><span class="table-avatar">{{ initials(user.fullName || user.email) }}</span><div><strong>{{ user.fullName || 'Chưa có tên' }} <span v-if="isSelf(user)" class="self-label">Bạn</span></strong><small>{{ user.email }}</small><small v-if="user.authSyncPending" class="pending-label">Chờ đồng bộ · Chọn lại quyền hoặc trạng thái mong muốn</small></div></div></td>
            <td class="text-muted">{{ user.gender === 'male' ? 'Nam' : user.gender === 'female' ? 'Nữ' : 'Khác' }}</td>
            <td><span class="pill" :class="{ purple: user.role === 'admin' }">{{ user.role === 'admin' ? 'Quản trị viên' : 'Người dùng' }}</span></td>
            <td><span class="pill" :class="{ green: user.status === 'active', amber: user.status === 'inactive', red: user.status === 'banned' }">{{ statusLabel(user.status) }}</span></td>
            <td><div class="table-actions">
              <select :value="user.status" class="input" :disabled="!!busy || isSelf(user)" :aria-label="'Trạng thái của ' + user.email" @change="onUserChange(user, 'status', $event)"><option value="active">Hoạt động</option><option value="inactive">Tạm khóa</option><option value="banned">Bị cấm</option></select>
              <select :value="user.role" class="input" :disabled="!!busy || isSelf(user)" :aria-label="'Vai trò của ' + user.email" @change="onUserChange(user, 'role', $event)"><option value="user">Người dùng</option><option value="admin">Quản trị viên</option></select>
            </div></td>
          </tr></tbody>
        </table>
      </div>
      <div class="table-footer">Hiển thị {{ filteredUsers.length }} / {{ users.length }} tài khoản</div>
    </section>
    <div v-else class="studio-stack">
      <section v-if="showVoiceForm" class="panel">
        <div class="panel-heading"><div><h2><UiIcon name="mic" />Thêm giọng mẫu chung</h2><p>Giọng mới sẽ xuất hiện trong thư viện của người dùng.</p></div><button type="button" class="btn small" :disabled="!!busy" @click="showVoiceForm = false" aria-label="Đóng biểu mẫu giọng mẫu"><UiIcon name="close" /></button></div>
        <form class="inline-form" @submit.prevent="addVoice">
          <div class="field"><label for="voice-code">Mã giọng đọc</label><input id="voice-code" v-model="newVoice.voice_id" class="input" placeholder="VD: male_hn" pattern="[a-zA-Z0-9_-]{1,80}" required :disabled="!!busy" /></div>
          <div class="field"><label for="voice-name">Tên hiển thị</label><input id="voice-name" v-model="newVoice.name" class="input" placeholder="VD: Giọng Nam Hà Nội" required :disabled="!!busy" /></div>
          <div class="field"><label for="voice-gender">Giới tính giọng đọc</label><select id="voice-gender" v-model="newVoice.gender" class="input" :disabled="!!busy"><option value="male">Nam</option><option value="female">Nữ</option></select></div>
          <div class="field"><label for="voice-audio">File âm thanh mẫu</label><input id="voice-audio" ref="audioInput" class="input" type="file" accept="audio/*" @change="handleFileUpload" required :disabled="!!busy" /></div>
          <div class="form-wide"><button type="submit" class="btn primary" :disabled="!!busy"><span v-if="busy === 'new-voice'" class="spinner" aria-hidden="true"></span><UiIcon v-else name="plus" />{{ busy === 'new-voice' ? 'Đang thêm giọng…' : 'Lưu giọng mẫu' }}</button></div>
        </form>
      </section>
      <section class="panel flush" aria-labelledby="voices-heading">
        <div class="panel-heading"><div><h2 id="voices-heading">Thư viện giọng đọc</h2><p>Giọng mẫu chung và giọng cá nhân đang được sử dụng.</p></div><button type="button" class="btn primary" :disabled="!!busy" @click="showVoiceForm = !showVoiceForm"><UiIcon name="plus" />Thêm giọng mẫu</button></div>
        <div class="toolbar table-toolbar"><div class="search-field"><UiIcon name="search" /><input v-model="voiceSearch" type="search" class="input" aria-label="Tìm giọng đọc" placeholder="Tìm tên hoặc mã giọng…" /></div><span class="text-muted">{{ filteredVoices.length }} giọng đọc</span></div>
        <div v-if="!filteredVoices.length" class="empty-state"><div class="empty-icon"><UiIcon name="mic" /></div><h2>Chưa có giọng đọc phù hợp</h2><p>Thử từ khóa khác hoặc thêm giọng mẫu mới.</p></div>
        <div v-else class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Giọng đọc</th><th scope="col">Giới tính</th><th scope="col">Phạm vi</th><th scope="col">Trạng thái</th><th scope="col">Thao tác</th></tr></thead><tbody><tr v-for="voice in filteredVoices" :key="voice._id"><td><div class="voice-name"><UiIcon name="mic" /><div><strong>{{ voice.name }}</strong><small>{{ voice.voice_id }}</small></div></div></td><td class="text-muted">{{ voice.gender === 'male' ? 'Nam' : 'Nữ' }}</td><td><span class="pill" :class="{ purple: voice.is_global }">{{ voice.is_global ? 'Dùng chung' : 'Cá nhân' }}</span></td><td><span class="pill green">Đang dùng</span></td><td><button type="button" class="btn small danger" :disabled="!!busy" @click="hideVoice(voice)">Ẩn giọng</button></td></tr></tbody></table></div>
        <div class="table-footer">Hiển thị {{ filteredVoices.length }} / {{ voices.length }} giọng đang dùng</div>
      </section>
    </div>
  </template>
</template>

<style scoped>
.admin-feedback { margin-bottom: 18px; }
.role-filter { width: auto; max-width: 200px; font-size: 12px; }
.self-label { margin-left: 5px; color: #8a819f; font-size: 10px; font-weight: 500; }
.table-person .pending-label { color: #996520; }
</style>
