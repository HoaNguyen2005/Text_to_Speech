<script setup>
import { ref } from 'vue';
import api from '@/services/api';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình worker cho pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const fileInput = ref(null);
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
  
  fullText.value = '';
  errorMessage.value = '';
  statusMessage.value = 'Đang đọc nội dung file...';
  
  const reader = new FileReader();
  
  if (file.name.endsWith('.docx')) {
    reader.onload = async (e) => {
      try {
        const result = await mammoth.extractRawText({ arrayBuffer: e.target.result });
        fullText.value = result.value;
        statusMessage.value = 'Đã đọc xong! Vui lòng nhấn nút "Tóm tắt & Tạo Audio".';
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
        statusMessage.value = `Đã đọc xong ${maxPages} trang! Vui lòng nhấn nút "Tóm tắt & Tạo Audio".`;
      } catch (err) {
        errorMessage.value = "Lỗi đọc file PDF!";
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = (e) => {
      fullText.value = e.target.result;
      statusMessage.value = 'Đã đọc xong! Vui lòng nhấn nút "Tóm tắt & Tạo Audio".';
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
  <div class="book-container">
    <div class="hero-section">
      <h1 class="hero-title">Tóm tắt & Sách Nói AI</h1>
      <p class="hero-subtitle">Tải sách lên, LLM sẽ tóm tắt nội dung và tự động chọn giọng đọc phù hợp nhất.</p>
    </div>

    <div class="workspace-panel">
      <!-- Upload Section -->
      <div class="upload-section">
        <input type="file" ref="fileInput" @change="handleFileUpload" accept=".txt,.docx,.pdf" style="display: none" />
        <button class="upload-btn" @click="triggerFileUpload">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
          </svg>
          Tải Quyển Sách Lên (PDF, Word, TXT)
        </button>
        <span class="status-text" :class="{'error': errorMessage}">{{ errorMessage || statusMessage }}</span>
      </div>

      <!-- Action Section -->
      <div class="action-section" v-if="fullText">
        <button 
          class="generate-btn" 
          :class="{ 'is-loading': loading }" 
          @click="processBook" 
          :disabled="loading"
        >
          <span v-if="!loading">🧠 Bắt đầu Tóm Tắt & Tạo Audio</span>
          <span v-else class="spinner"></span>
        </button>
      </div>

      <!-- Result Section -->
      <div class="result-panel" v-if="summaryResult || loading">
        <div class="audio-player" v-if="resultAudioUrl">
          <div class="voice-badge">
            Giọng được AI lựa chọn: <b>{{ recommendedVoice }}</b>
            <span v-if="bookGenre"> · Thể loại: {{ bookGenre }}</span>
          </div>
          <div class="voice-reason" v-if="voiceReason">{{ voiceReason }}</div>
          <audio controls :src="resultAudioUrl" class="custom-audio"></audio>
        </div>

        <div class="summary-box" v-if="summaryResult">
          <h3>Bản Tóm Tắt (Kịch bản Audio)</h3>
          <p class="summary-content">{{ summaryResult }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.book-container {
  animation: fadeIn 0.4s ease;
}

.hero-title {
  font-size: 2.8rem;
  font-weight: 700;
  margin: 0 0 1rem 0;
  color: #111827;
}

.hero-subtitle {
  font-size: 1.15rem;
  color: #4b5563;
  margin-bottom: 2rem;
}

.workspace-panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 2rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
}

.upload-section {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  padding: 3rem 2rem;
  border: 2px dashed #d1d5db;
  border-radius: 12px;
  background: #f9fafb;
}

.upload-btn {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: #ffffff;
  border: 1px solid #d1d5db;
  color: #111827;
  font-size: 1.1rem;
  font-weight: 600;
  padding: 0.75rem 2rem;
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
}

.upload-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.status-text {
  font-size: 0.95rem;
  color: #4b5563;
  font-weight: 500;
}
.status-text.error {
  color: #dc2626;
}

.action-section {
  margin-top: 1.5rem;
  display: flex;
  justify-content: center;
}

.generate-btn {
  background: #2563eb;
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 1rem 2.5rem;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);
}

.generate-btn:hover:not(:disabled) {
  background: #1d4ed8;
}

.generate-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.result-panel {
  margin-top: 2.5rem;
  padding-top: 2rem;
  border-top: 1px solid #e5e7eb;
}

.audio-player {
  margin-bottom: 2rem;
  background: #f3f4f6;
  padding: 1.5rem;
  border-radius: 12px;
}

.voice-badge {
  display: inline-block;
  background: #dbeafe;
  color: #1e40af;
  padding: 0.4rem 1rem;
  border-radius: 9999px;
  font-size: 0.9rem;
  margin-bottom: 1rem;
}

.voice-reason {
  background: #fef9c3;
  color: #854d0e;
  padding: 0.6rem 1rem;
  border-radius: 10px;
  font-size: 0.9rem;
  line-height: 1.5;
  margin-bottom: 1rem;
  text-align: left;
}

.custom-audio {
  width: 100%;
  height: 54px;
  border-radius: 27px;
}

.summary-box {
  background: #fdfdfd;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 1.5rem;
}

.summary-box h3 {
  margin-top: 0;
  margin-bottom: 1rem;
  color: #111827;
}

.summary-content {
  font-size: 1.05rem;
  line-height: 1.7;
  color: #374151;
  white-space: pre-wrap;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
