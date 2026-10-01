<script setup>
import { ref, onMounted } from 'vue';
import api from '@/services/api';

const users = ref([]);
const voices = ref([]);
const loading = ref(false);

// State thêm giọng mẫu
const newVoice = ref({
  voice_id: '',
  name: '',
  gender: 'male',
});
const audioFile = ref(null);

onMounted(async () => {
  fetchData();
});

const fetchData = async () => {
  loading.value = true;
  try {
    const [usersRes, voicesRes] = await Promise.all([
      api.get('/api/auth/users'),
      api.get('/api/voices')
    ]);
    users.value = usersRes.data;
    voices.value = voicesRes.data;
  } catch (error) {
    console.error("Lỗi khi tải dữ liệu admin:", error);
  } finally {
    loading.value = false;
  }
};

const changeUserStatus = async (userId, newStatus) => {
  try {
    await api.put(`/api/auth/users/${userId}/status`, { status: newStatus });
    fetchData();
  } catch (error) {
    alert("Lỗi cập nhật trạng thái user!");
  }
};

const changeUserRole = async (userId, newRole) => {
  const confirm_msg = newRole === 'admin' 
    ? '⚠️ Bạn có chắc muốn CẦP QUYỀN ADMIN cho tài khoản này không?'
    : 'Bạn có chắc muốn hạ về User thường không?';
  if (!confirm(confirm_msg)) return;
  
  try {
    await api.put(`/api/auth/users/${userId}/role`, { role: newRole });
    fetchData();
  } catch (error) {
    alert("Lỗi cập nhật role!");
  }
};

const handleFileUpload = (event) => {
  audioFile.value = event.target.files[0];
};

const addVoice = async () => {
  if (!newVoice.value.voice_id || !newVoice.value.name || !audioFile.value) {
    alert("Vui lòng nhập đủ thông tin và chọn file âm thanh!");
    return;
  }
  
  const formData = new FormData();
  formData.append('voice_id', newVoice.value.voice_id);
  formData.append('name', newVoice.value.name);
  formData.append('gender', newVoice.value.gender);
  formData.append('audio_file', audioFile.value);

  try {
    await api.post('/api/voices', formData);
    alert("Thêm giọng mẫu thành công!");
    newVoice.value = { voice_id: '', name: '', gender: 'male' };
    audioFile.value = null;
    document.getElementById('voiceFile').value = '';
    fetchData();
  } catch (error) {
    alert(error.response?.data?.error || "Lỗi khi thêm giọng mẫu");
  }
};

const deleteVoice = async (id) => {
  if (confirm("Bạn có chắc muốn ẩn giọng mẫu này không? (Cập nhật trạng thái)")) {
    try {
      await api.put(`/api/voices/${id}`, { is_active: false });
      fetchData();
    } catch (error) {
      alert("Lỗi ẩn giọng mẫu");
    }
  }
};
</script>

<template>
  <div class="admin-container">
    <h2 class="page-title">⚙️ Quản Trị Hệ Thống</h2>

    <div v-if="loading" class="loading">Đang tải dữ liệu...</div>

    <div v-else class="dashboard-grid">
      
      <!-- Bảng Quản Lý Người Dùng -->
      <div class="panel">
        <h3 class="panel-title">👥 Quản Lý Người Dùng</h3>
        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Họ và Tên</th>
                <th>Email</th>
                <th>Giới Tính</th>
                <th>Vai Trò</th>
                <th>Trạng Thái</th>
                <th>Hành Động</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in users" :key="user._id">
                <td>{{ user.fullName }}</td>
                <td>{{ user.email }}</td>
                <td>{{ user.gender === 'male' ? 'Nam' : (user.gender === 'female' ? 'Nữ' : 'Khác') }}</td>
                <!-- Cột Vai Trò -->
                <td>
                  <span :class="['role-badge', user.role]">
                    {{ user.role === 'admin' ? '🛡️ Admin' : '👤 User' }}
                  </span>
                </td>
                <td>
                  <span :class="['status-badge', user.status]">
                    {{ user.status === 'active' ? 'Hoạt động' : (user.status === 'inactive' ? 'Tạm khóa' : 'Bị Cấm') }}
                  </span>
                </td>
                <td class="actions-cell">
                  <!-- Đổi Trạng Thái -->
                  <select 
                    v-model="user.status" 
                    @change="changeUserStatus(user._id, $event.target.value)"
                    class="action-select"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                    <option value="banned">Banned</option>
                  </select>
                  <!-- Đổi Role -->
                  <select 
                    v-model="user.role"
                    @change="changeUserRole(user._id, $event.target.value)"
                    class="action-select role-select"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Bảng Quản Lý Giọng Mẫu -->
      <div class="panel">
        <h3 class="panel-title">🎙️ Quản Lý Giọng Mẫu</h3>
        
        <div class="add-voice-form">
          <h4>Thêm giọng mới</h4>
          <div class="form-row">
            <input v-model="newVoice.voice_id" placeholder="Mã giọng (VD: male_hn)" class="input-field" />
            <input v-model="newVoice.name" placeholder="Tên hiển thị (VD: Nam Hà Nội)" class="input-field" />
            <select v-model="newVoice.gender" class="input-field">
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
            </select>
            <input type="file" id="voiceFile" accept="audio/*" @change="handleFileUpload" class="input-field" style="padding: 0.4rem;" />
            <button @click="addVoice" class="btn-primary">Thêm</button>
          </div>
        </div>

        <div class="table-container">
          <table class="data-table">
            <thead>
              <tr>
                <th>Mã (ID)</th>
                <th>Tên Giọng</th>
                <th>Giới Tính</th>
                <th>Đường dẫn file</th>
                <th>Hành Động</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="voice in voices" :key="voice._id">
                <td>{{ voice.voice_id }}</td>
                <td>{{ voice.name }}</td>
                <td>{{ voice.gender === 'male' ? 'Nam' : 'Nữ' }}</td>
                <td class="text-xs">{{ voice.file_path }}</td>
                <td>
                  <button @click="deleteVoice(voice._id)" class="btn-danger">Ẩn</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  </div>
</template>

<style scoped>
.admin-container {
  padding: 2rem;
  max-width: 1200px;
  margin: 0 auto;
}

.page-title {
  font-size: 2rem;
  font-weight: 800;
  margin-bottom: 2rem;
  color: #111827;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
}

.panel {
  background: white;
  border-radius: 12px;
  padding: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  border: 1px solid #e5e7eb;
}

.panel-title {
  font-size: 1.25rem;
  font-weight: 700;
  margin-bottom: 1.5rem;
  color: #374151;
  border-bottom: 2px solid #f3f4f6;
  padding-bottom: 0.5rem;
}

.table-container {
  overflow-x: auto;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 1rem;
  text-align: left;
  border-bottom: 1px solid #e5e7eb;
  white-space: nowrap; /* Tránh rớt dòng */
}

.data-table th {
  background-color: #f9fafb;
  font-weight: 600;
  color: #4b5563;
}

.data-table tbody tr:hover {
  background-color: #f3f4f6;
}

.status-badge {
  display: inline-block;
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.status-badge.active { background: #dcfce7; color: #166534; }
.status-badge.inactive { background: #fef08a; color: #854d0e; }
.status-badge.banned { background: #fee2e2; color: #991b1b; }

.role-badge {
  display: inline-block;
  padding: 0.35rem 0.85rem;
  border-radius: 9999px;
  font-size: 0.85rem;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}
.role-badge.admin { background: #ede9fe; color: #5b21b6; }
.role-badge.user  { background: #e0f2fe; color: #0369a1; }

.actions-cell {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  flex-wrap: wrap;
}

.role-select {
  border-color: #8b5cf6;
  color: #5b21b6;
}

.action-select {
  padding: 0.35rem;
  border-radius: 6px;
  border: 1px solid #d1d5db;
  font-size: 0.9rem;
}

.add-voice-form {
  background: #f8fafc;
  padding: 1.25rem;
  border-radius: 8px;
  margin-bottom: 1.5rem;
  border: 1px dashed #cbd5e1;
}

.form-row {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.75rem;
  flex-wrap: wrap;
}

.input-field {
  flex: 1;
  min-width: 150px;
  padding: 0.6rem;
  border: 1px solid #d1d5db;
  border-radius: 6px;
}

.btn-primary {
  background: #2563eb;
  color: white;
  border: none;
  padding: 0.6rem 1.25rem;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
}

.btn-primary:hover { background: #1d4ed8; }

.btn-danger {
  background: #ef4444;
  color: white;
  border: none;
  padding: 0.4rem 0.75rem;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.85rem;
}

.btn-danger:hover { background: #dc2626; }

.text-xs {
  font-size: 0.8rem;
  color: #6b7280;
}
</style>
