<script setup>
import { ref, computed, onMounted } from 'vue';
import UiIcon from '@/components/UiIcon.vue';
import api from '@/services/api';

const history = ref([]);
const search = ref('');
const filteredHistory = computed(() => history.value.filter(item => [item.text, item.teacher_id, styleNames[item.style_id] || item.style_id].join(' ').toLocaleLowerCase('vi-VN').includes(search.value.trim().toLocaleLowerCase('vi-VN'))));
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

const fetchHistory = async () => {
  loading.value = true;
  errorMessage.value = '';
  try {
    const res = await api.get('/api/history');
    history.value = res.data;
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể tải lịch sử!';
  } finally {
    loading.value = false;
  }
};
onMounted(fetchHistory);
</script>


<template>
  <div class="page-heading"><div><p class="eyebrow"><UiIcon name="history" /> THƯ VIỆN CÁ NHÂN</p><h1>Lịch sử của tôi</h1><p>Những bài giảng và sách nói bạn đã tạo, sẵn sàng để lắng nghe lại.</p></div><router-link to="/" class="btn primary"><UiIcon name="plus" />Tạo bài giảng mới</router-link></div>
  <div v-if="loading" class="notice" role="status"><span class="spinner" aria-hidden="true"></span>Đang tải thư viện của bạn…</div>
  <div v-else-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}<button type="button" class="btn small" @click="fetchHistory">Thử lại</button></div>
  <section v-else-if="!history.length" class="panel empty-state"><div class="empty-icon"><UiIcon name="headphones" /></div><h2>Thư viện đang chờ câu chuyện đầu tiên</h2><p>Tạo bài giảng hoặc sách nói. Các bản âm thanh sẽ xuất hiện ở đây để bạn nghe lại.</p><router-link to="/" class="btn primary">Bắt đầu sáng tạo<UiIcon name="arrow" /></router-link></section>
  <template v-else>
    <div class="toolbar"><div class="search-field"><UiIcon name="search" /><input v-model="search" class="input" type="search" aria-label="Tìm kiếm lịch sử" placeholder="Tìm nội dung, giọng đọc…" /></div><span class="text-muted">{{ filteredHistory.length }} / {{ history.length }} bản ghi gần nhất</span></div>
    <div v-if="!filteredHistory.length" class="panel empty-state"><div class="empty-icon"><UiIcon name="search" /></div><h2>Chưa tìm thấy nội dung phù hợp</h2><p>Thử một từ khóa khác để tìm bài giảng của bạn.</p><button type="button" class="btn" @click="search = ''">Xóa tìm kiếm</button></div>
    <div v-else class="history-list">
      <article v-for="(item, index) in filteredHistory" :key="item._id" class="panel">
        <div class="history-topline"><div class="history-title"><UiIcon name="wave" /><h2>Bản âm thanh {{ String(index + 1).padStart(2, '0') }}</h2></div><span class="history-date"><UiIcon name="clock" />{{ formatDate(item.createdAt) }}</span></div>
        <div class="result-meta"><span class="pill purple"><UiIcon name="mic" />{{ item.teacher_id }}</span><span class="pill">{{ styleNames[item.style_id] || item.style_id }}</span></div>
        <p class="history-text">{{ truncate(item.text) }}</p><audio controls preload="none" :src="item.audio_url" class="audio-player" :aria-label="'Nghe bản âm thanh ' + (index + 1)"></audio>
      </article>
    </div>
  </template>
</template>
