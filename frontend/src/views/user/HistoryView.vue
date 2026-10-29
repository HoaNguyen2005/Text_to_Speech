<script setup>
import { ref, computed, onMounted } from 'vue';
import UiIcon from '@/components/UiIcon.vue';
import StudioBanner from '@/components/StudioBanner.vue';
import { getLocaleTag, translate } from '@/composables/useLocale';
import BookAttribution from '@/components/BookAttribution.vue';
import SubtitleDownload from '@/components/SubtitleDownload.vue';
import SummaryDownload from '@/components/SummaryDownload.vue';
import api from '@/services/api';
import { useFeedback } from '@/composables/useNotifications';

const history = ref([]);
const search = ref('');
const filteredHistory = computed(() => history.value.filter(item => [item.title, item.book_metadata?.title, item.book_metadata?.author, item.book_metadata?.source, item.text, item.teacher_id, styleNames[item.style_id] || item.style_id, translate(styleNames[item.style_id] || item.style_id)].join(' ').toLocaleLowerCase('vi-VN').includes(search.value.trim().toLocaleLowerCase('vi-VN'))));
const loading = ref(true);
const errorMessage = useFeedback('error', { action: { label: 'Thử lại', run: () => fetchHistory() } });

const styleNames = {
  news: 'Bản tin',
  story: 'Tiểu thuyết',
  novel: 'Tiểu thuyết',
  normal: 'Bình thường'
  ,natural:'Tự nhiên',teaching:'Giảng giải',relaxing:'Thư giãn',auto:'Theo phong cách ban đầu'
};

const formatDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleString(getLocaleTag(), {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

const truncate = (t) => (t && t.length > 180 ? t.slice(0, 180) + '…' : t);
const durationLabel = (seconds) => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;

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
  <StudioBanner :title="$t('Những nội dung đáng nghe lại.')" icon="headphones" :eyebrow="$t('THƯ VIỆN CÁ NHÂN')" :description="$t('Bài giảng và sách nói của bạn, được lưu trong một không gian để tiếp tục lắng nghe bất cứ lúc nào.')">
    <router-link to="/" class="btn primary"><UiIcon name="plus" />{{ $t("Tạo bài giảng mới") }}</router-link>
  </StudioBanner>
  <div v-if="loading" class="notice" role="status"><span class="spinner" aria-hidden="true"></span>{{ $t("Đang tải thư viện của bạn…") }}</div>
  <div v-else-if="errorMessage"><button type="button" class="btn small" @click="fetchHistory"><UiIcon name="refresh" />{{ $t("Thử lại") }}</button></div>
  <section v-else-if="!history.length" class="panel empty-state"><div class="empty-icon"><UiIcon name="headphones" /></div><h2>{{ $t("Thư viện đang chờ câu chuyện đầu tiên") }}</h2><p>{{ $t("Tạo bài giảng hoặc sách nói. Các bản âm thanh sẽ xuất hiện ở đây để bạn nghe lại.") }}</p><router-link to="/" class="btn primary">{{ $t("Bắt đầu sáng tạo") }}<UiIcon name="arrow" /></router-link></section>
  <template v-else>
    <div class="toolbar"><div class="search-field"><UiIcon name="search" /><input v-model="search" class="input" type="search" :aria-label="$t('Tìm kiếm lịch sử')" :placeholder="$t('Tìm nội dung, giọng đọc…')" /></div><span class="text-muted">{{ filteredHistory.length }} / {{ history.length }} {{ $t("bản ghi gần nhất") }}</span></div>
    <div v-if="!filteredHistory.length" class="panel empty-state"><div class="empty-icon"><UiIcon name="search" /></div><h2>{{ $t("Chưa tìm thấy nội dung phù hợp") }}</h2><p>{{ $t("Thử một từ khóa khác để tìm bài giảng của bạn.") }}</p><button type="button" class="btn" @click="search = ''">{{ $t("Xóa tìm kiếm") }}</button></div>
    <div v-else class="history-list">
      <article v-for="(item, index) in filteredHistory" :key="item._id" class="panel">
        <div class="history-topline"><div class="history-title"><UiIcon name="wave" /><h2>{{ item.title || $t("Bản âm thanh {0}", [String(index + 1).padStart(2, '0')]) }}</h2></div><span class="history-date"><UiIcon name="clock" />{{ formatDate(item.createdAt) }}</span></div>
        <div class="result-meta"><span class="pill purple"><UiIcon name="mic" />{{ item.teacher_id }}</span><span class="pill">{{ $t(styleNames[item.style_id] || item.style_id) }}</span><span v-if="item.duration_seconds" class="pill"><UiIcon name="clock" />{{ durationLabel(item.duration_seconds) }}<template v-if="item.target_minutes"> {{ $t("· mục tiêu") }} {{ item.target_minutes }} {{ $t("phút") }}</template></span><span v-if="item.speech_config?.voice_origin" class="pill">{{ $t(item.speech_config.voice_origin==='user'?'Giọng của bạn':'Giọng hệ thống') }}</span></div>
        <BookAttribution v-if="item.book_job_id || item.ai_assisted" :metadata="item.book_metadata" :fallback-title="item.title" />
        <p v-if="item.speech_config?.verification_method==='user'" class="text-muted">{{ $t('Người dùng tự duyệt') }}</p>
        <p class="history-text">{{ truncate(item.text) }}</p><audio controls preload="none" :src="item.audio_url" class="audio-player" :aria-label="$t('Nghe bản âm thanh ')+(index+1)"></audio>
        <SubtitleDownload v-if="item.subtitle_url" :endpoint="`/api/history/${item._id}/subtitles`" />
        <SummaryDownload v-if="(item.book_job_id || item.ai_assisted) && item.text" :title="item.title" :metadata="item.book_metadata" :text="item.text" />
        <p v-if="item.subtitle_url" class="text-muted">{{ $t('Mốc câu trong phụ đề là ước lượng theo đoạn âm thanh đo được.') }}</p>
      </article>
    </div>
  </template>
</template>
