<script setup>
import { ref, onMounted } from 'vue';
import api from '@/services/api';

const history = ref([]);
const loading = ref(true);
const errorMessage = ref('');

const styleNames = {
  news: 'Bản tin',
  story: 'Tiểu thuyết',
  novel: 'Tiểu thuyết',
  normal: 'Bình thường'
};

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

const truncate = (t) => (t && t.length > 180 ? t.slice(0, 180) + '…' : t);

onMounted(async () => {
  try {
    const res = await api.get('/api/history');
    history.value = res.data;
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể tải lịch sử!';
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="history-page">
    <h2 class="page-title">Lịch Sử</h2>

    <div v-if="loading" class="loading">Đang tải dữ liệu...</div>
    <div v-else-if="errorMessage" class="error-box">{{ errorMessage }}</div>
    <div v-else-if="history.length === 0" class="empty">
      Bạn chưa tạo bài giảng nào. Hãy vào <router-link to="/">Tạo Bài Giảng</router-link> để bắt đầu!
    </div>

    <div v-else class="history-list">
      <div v-for="item in history" :key="item._id" class="history-card">
        <div class="card-header">
          <span class="card-date">{{ formatDate(item.createdAt) }}</span>
          <span class="card-meta">🎙️ {{ item.teacher_id }} · {{ styleNames[item.style_id] || item.style_id }}</span>
        </div>
        <p class="card-text">{{ truncate(item.text) }}</p>
        <audio controls :src="item.audio_url" class="card-audio"></audio>
      </div>
    </div>
  </div>
</template>

<style scoped>
.history-page {
  width: 100%;
}

.page-title {
  font-size: 1.6rem;
  font-weight: 700;
  margin: 0 0 1.5rem 0;
  letter-spacing: -0.02em;
}

.loading,
.empty {
  text-align: center;
  color: #6b7280;
  padding: 3rem 0;
}

.empty a {
  color: #2563eb;
  font-weight: 600;
}

.history-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.history-card {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1rem 1.25rem;
}

.card-header {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.card-date {
  font-weight: 600;
  color: #111827;
  font-size: 0.9rem;
}

.card-meta {
  color: #6b7280;
  font-size: 0.85rem;
}

.card-text {
  color: #374151;
  font-size: 0.92rem;
  line-height: 1.55;
  margin: 0 0 0.75rem 0;
  white-space: pre-line;
}

.card-audio {
  width: 100%;
  height: 40px;
}
</style>
