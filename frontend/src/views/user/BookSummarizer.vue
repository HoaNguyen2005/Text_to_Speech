<script setup>
import { ref } from 'vue';
import UiIcon from '@/components/UiIcon.vue';
import api from '@/services/api';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình worker cho pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const fileInput = ref(null);
const sourceName = ref('');
const fullText = ref('');
const summaryResult = ref('');
const resultAudioUrl = ref(null);
const loading = ref(false);
const statusMessage = ref('');
const errorMessage = ref('');
const recommendedVoice = ref('');
const voiceReason = ref('');
const bookGenre = ref('');

const triggerFileUpload = () => {
  if (fileInput.value) fileInput.value.click();
};

const handleFileUpload = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  sourceName.value = file.name;
  summaryResult.value = '';
  resultAudioUrl.value = null;
  recommendedVoice.value = '';
  voiceReason.value = '';
  bookGenre.value = '';

  fullText.value = '';
  errorMessage.value = '';
  statusMessage.value = 'Đang đọc nội dung file...';

  const reader = new FileReader();

  if (file.name.endsWith('.docx')) {
    reader.onload = async (e) => {
      try {
        const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
        fullText.value = result.value;
        statusMessage.value = 'Đã đọc xong! Vui lòng nhấn nút "Tóm tắt & tạo sách nói".';
      } catch (err) {
        errorMessage.value = "Lỗi đọc file Word!";
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (file.name.endsWith('.pdf')) {
    reader.onload = async (e) => {
      try {
        const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
        let text = "";
        // Giới hạn đọc 50 trang đầu để tránh treo trình duyệt
        const maxPages = Math.min(pdf.numPages, 50);
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          text += textContent.items.map(item => item.str).join(' ') + "\n";
        }
        fullText.value = text;
        statusMessage.value = `Đã đọc xong ${maxPages} trang! Vui lòng nhấn nút "Tóm tắt & tạo sách nói".`;
      } catch (err) {
        errorMessage.value = "Lỗi đọc file PDF!";
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = (e) => {
      fullText.value = e.target.result;
      statusMessage.value = 'Đã đọc xong! Vui lòng nhấn nút "Tóm tắt & tạo sách nói".';
    };
    reader.readAsText(file);
  }

  event.target.value = null;
};

const processBook = async () => {
  if (!fullText.value.trim()) {
    errorMessage.value = 'Chưa có nội dung sách. Vui lòng tải file lên trước!';
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  summaryResult.value = '';
  resultAudioUrl.value = null;
  recommendedVoice.value = '';
  voiceReason.value = '';
  bookGenre.value = '';

  try {
    // Bước 1: Gemini tóm tắt sách và chọn giọng đọc phù hợp (giọng global + giọng riêng của user)
    statusMessage.value = 'Bước 1/2: AI đang tóm tắt nội dung sách và phân tích thể loại...';
    const summarizeRes = await api.post('/api/summarize-book', { text: fullText.value });

    const { summary, voice, style, reason, genre } = summarizeRes.data;
    summaryResult.value = summary;
    recommendedVoice.value = voice.name;
    voiceReason.value = reason;
    bookGenre.value = genre;

    // Bước 2: Sinh audio từ kịch bản tóm tắt với giọng đã được chọn
    statusMessage.value = `Bước 2/2: Đang sinh giọng đọc "${voice.name}"...`;
    const generateRes = await api.post('/api/generate-lecture', {
      text: summary,
      teacher_id: voice.voice_id,
      style_id: style
    });

    if (generateRes.data.status === 'success') {
      statusMessage.value = 'Hoàn thành! Đã tạo sách nói thành công.';
      resultAudioUrl.value = generateRes.data.audio_url;
    } else {
      errorMessage.value = 'Có lỗi xảy ra khi sinh giọng đọc.';
    }
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể kết nối đến máy chủ!';
    statusMessage.value = '';
  } finally {
    loading.value = false;
  }
};
</script>


<template>
  <div class="page-heading"><div><p class="eyebrow"><UiIcon name="spark" /> KHÁM PHÁ NỘI DUNG</p><h1>Sách nói AI</h1><p>Tóm tắt những ý chính và biến nội dung sách thành trải nghiệm nghe dễ tiếp cận.</p></div><span class="pill purple"><UiIcon name="spark" />AI hỗ trợ nội dung</span></div>
  <div class="studio-grid">
    <div class="studio-stack">
      <section class="panel" aria-labelledby="book-upload-title">
        <div class="panel-heading"><h2 id="book-upload-title"><UiIcon name="book" />Tài liệu của bạn</h2><span class="pill">TXT · DOCX · PDF</span></div>
        <input type="file" ref="fileInput" @change="handleFileUpload" accept=".txt,.docx,.pdf" hidden />
        <div class="upload-area"><UiIcon name="upload" /><h3>{{ sourceName || 'Bắt đầu từ một cuốn sách' }}</h3><p>Chọn tài liệu từ máy tính. Với PDF, hệ thống đọc tối đa 50 trang đầu.</p><button type="button" class="btn" :disabled="loading" @click="triggerFileUpload"><UiIcon name="plus" />{{ sourceName ? 'Chọn tài liệu khác' : 'Chọn tài liệu' }}</button></div>
      </section>
      <section v-if="fullText" class="panel editor-body">
        <div class="panel-heading"><h2><UiIcon name="document" />Nội dung đã đọc</h2><span class="pill">{{ fullText.length.toLocaleString('vi-VN') }} ký tự</span></div>
        <textarea v-model="fullText" class="editor-textarea" :disabled="loading" aria-label="Nội dung sách đã đọc" />
        <p class="text-muted">Bạn có thể chỉnh lại nội dung trước khi tạo sách nói.</p>
      </section>
      <div v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</div>
      <div v-if="statusMessage && !errorMessage" class="notice" role="status"><span v-if="loading" class="spinner" aria-hidden="true"></span><UiIcon v-else name="check" />{{ statusMessage }}</div>
      <section v-if="resultAudioUrl" class="panel">
        <div class="panel-heading"><h2><UiIcon name="headphones" />Sách nói của bạn</h2><span class="pill green">Đã hoàn thành</span></div>
        <div class="result-meta"><span class="pill purple">{{ recommendedVoice }}</span><span v-if="bookGenre" class="pill">{{ bookGenre }}</span></div>
        <p v-if="voiceReason" class="text-muted">{{ voiceReason }}</p>
        <audio controls :src="resultAudioUrl" class="audio-player" aria-label="Âm thanh sách nói vừa tạo"></audio>
      </section>
      <section v-if="summaryResult" class="panel">
        <div class="panel-heading"><h2><UiIcon name="document" />Bản tóm tắt</h2><span class="pill">Kịch bản giọng đọc</span></div><p class="summary-content">{{ summaryResult }}</p>
      </section>
    </div>
    <aside class="studio-stack">
      <section class="panel">
        <div class="panel-heading"><h2><UiIcon name="spark" />Từ sách đến âm thanh</h2></div>
        <ol class="step-list"><li><span class="step-number">01</span><div><strong>Chọn tài liệu</strong><p>Tải sách hoặc tài liệu bạn muốn nghe lên.</p></div></li><li><span class="step-number">02</span><div><strong>Tóm tắt nội dung</strong><p>AI phân tích thể loại, ý chính và chọn giọng phù hợp.</p></div></li><li><span class="step-number">03</span><div><strong>Lắng nghe &amp; lưu lại</strong><p>Nghe bản tóm tắt và xem lại trong lịch sử.</p></div></li></ol>
        <div class="settings-actions"><button type="button" class="btn primary full" :disabled="loading || !fullText.trim()" @click="processBook"><span v-if="loading" class="spinner" aria-hidden="true"></span><UiIcon v-else name="spark" />{{ loading ? 'Đang xử lý…' : 'Tóm tắt & tạo sách nói' }}</button></div>
      </section>
      <section class="panel helper-panel"><UiIcon name="book" /><h3>Giữ lại điều quan trọng</h3><p>Bản tóm tắt giúp bạn nắm ý chính. Hãy đối chiếu tài liệu gốc khi cần thông tin chi tiết.</p></section>
    </aside>
  </div>
</template>
