<script setup>
import { ref, onMounted } from 'vue';
import api from '@/services/api';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình worker cho pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

// Lecture state
const text = ref('');
const teacherId = ref('male');
const styleId = ref('news');
const loading = ref(false);
const resultAudioUrl = ref(null);
const errorMessage = ref('');

const teachers = ref([]);

// Thêm giọng mới
const showAddVoice = ref(false);
const newVoice = ref({ voice_id: '', name: '', gender: 'male' });
const audioFile = ref(null);

onMounted(async () => {
  fetchVoices();
});

const fetchVoices = async () => {
  try {
    const res = await api.get('/api/voices');
    teachers.value = res.data;
    if (teachers.value.length > 0 && !teachers.value.find(t => t.voice_id === teacherId.value)) {
      teacherId.value = teachers.value[0].voice_id;
    }
  } catch (error) {
    console.error("Lỗi khi tải giọng mẫu:", error);
  }
};

const styles = [
  { id: 'news', name: 'Bảng tin thời sự (Trang trọng)' },
  { id: 'story', name: 'Đọc tiểu thuyết (Truyền cảm)' },
  { id: 'normal', name: 'Bình thường (Mặc định)' }
];



const generateLecture = async () => {
  if (!text.value.trim()) {
    errorMessage.value = 'Vui lòng nhập kịch bản bài giảng!';
    return;
  }
  
  loading.value = true;
  errorMessage.value = '';
  resultAudioUrl.value = null;

  try {
    const response = await api.post('/api/generate-lecture', {
      text: text.value,
      teacher_id: teacherId.value,
      style_id: styleId.value
    });

    if (response.data.status === 'success') {
      resultAudioUrl.value = response.data.audio_url;
    } else {
      errorMessage.value = 'Có lỗi xảy ra từ máy chủ.';
    }
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể kết nối đến máy chủ!';
  } finally {
    loading.value = false;
  }
};

const fileInput = ref(null);

const triggerFileUpload = () => {
  if (fileInput.value) {
    fileInput.value.click();
  }
};

const handleFileUpload = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  
  if (file.name.endsWith('.docx')) {
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
        text.value = result.value;
      } catch (err) {
        errorMessage.value = "Lỗi: Không thể đọc nội dung file Word này!";
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (file.name.endsWith('.pdf')) {
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = "";
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items.map(item => item.str).join(' ');
          fullText += pageText + "\n";
        }
        text.value = fullText;
      } catch (err) {
        errorMessage.value = "Lỗi: Không thể đọc nội dung file PDF này!";
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = (e) => {
      text.value = e.target.result;
    };
    reader.readAsText(file);
  }
  
  event.target.value = null;
};

const handleAudioUpload = (event) => {
  audioFile.value = event.target.files[0];
};

const addUserVoice = async () => {
  if (!newVoice.value.voice_id || !newVoice.value.name || !audioFile.value) {
    alert("Vui lòng nhập đủ thông tin và chọn file âm thanh mẫu!");
    return;
  }
  
  const formData = new FormData();
  formData.append('voice_id', newVoice.value.voice_id);
  formData.append('name', newVoice.value.name);
  formData.append('gender', newVoice.value.gender);
  formData.append('audio_file', audioFile.value);

  try {
    await api.post('/api/voices', formData);
    alert("Đã thêm giọng của bạn thành công!");
    newVoice.value = { voice_id: '', name: '', gender: 'male' };
    audioFile.value = null;
    showAddVoice.value = false;
    fetchVoices();
  } catch (error) {
    alert(error.response?.data?.error || "Lỗi khi tải lên");
  }
};
</script>

<template>
      <div class="hero-section">
        <h1 class="hero-title">Trình tạo giọng nói AI</h1>
        <p class="hero-subtitle">AI hỗ trợ biến văn bản thành bài giảng chuyên nghiệp, chân thực.</p>
      </div>

      <div class="workspace-panel">
        <div class="form-group textarea-group">
          <input type="file" ref="fileInput" @change="handleFileUpload" accept=".txt,.docx,.pdf" style="display: none" />
          <textarea 
            id="script" 
            v-model="text" 
            placeholder="Nhập kịch bản bài giảng vào đây..." 
            rows="6"
            class="sleek-textarea"
          ></textarea>
        </div>

        <div class="controls-row">
          <div class="control-group">
            <div class="control-item">
              <select id="teacher" v-model="teacherId" class="sleek-select">
                <option v-for="teacher in teachers" :key="teacher.voice_id" :value="teacher.voice_id">
                  {{ teacher.name }} ({{ teacher.gender === 'male' ? 'Nam' : 'Nữ' }})
                </option>
              </select>
            </div>

            <div class="control-item">
              <select id="style" v-model="styleId" class="sleek-select">
                <option v-for="style in styles" :key="style.id" :value="style.id">
                  {{ style.name }}
                </option>
              </select>
            </div>
          </div>
          
          <div class="action-buttons">
            <button class="upload-btn" @click="triggerFileUpload" title="Tải lên file văn bản (.txt), Word (.docx), hoặc PDF (.pdf)">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
              </svg>
              Tải file lên
            </button>

            <button 
              class="generate-btn" 
              :class="{ 'is-loading': loading }" 
              @click="generateLecture" 
              :disabled="loading"
            >
              <span v-if="!loading">Tạo Âm Thanh</span>
              <span v-else class="spinner"></span>
            </button>
          </div>
          </div>

        <div style="margin-top: 0.75rem; display: flex; justify-content: flex-end;">
          <button @click="showAddVoice = !showAddVoice" class="upload-btn">
            + Thêm giọng đọc của riêng bạn
          </button>
        </div>

        <!-- Form thêm giọng -->
        <div v-if="showAddVoice" class="add-voice-panel">
          <h4>Thêm giọng mẫu (Chỉ mình bạn thấy)</h4>
          <div class="form-row">
            <input v-model="newVoice.voice_id" placeholder="Mã (VD: my_voice_1)" class="sleek-input" />
            <input v-model="newVoice.name" placeholder="Tên hiển thị" class="sleek-input" />
            <select v-model="newVoice.gender" class="sleek-select">
              <option value="male">Nam</option>
              <option value="female">Nữ</option>
            </select>
            <input type="file" accept="audio/*" @change="handleAudioUpload" class="sleek-input" style="padding:0.4rem;" />
            <button @click="addUserVoice" class="generate-btn">Tải Lên</button>
          </div>
        </div>

        <div class="error-box" v-if="errorMessage">
          {{ errorMessage }}
        </div>

        <div class="result-panel" v-if="resultAudioUrl">
          <audio controls :src="resultAudioUrl" class="custom-audio"></audio>
        </div>
      </div>
</template>

<style scoped>
* {
  box-sizing: border-box;
}

:global(body) {
  margin: 0;
  padding: 0;
  background-color: #f7f7f8;
}

.app-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background-color: #f7f7f8;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: #111827;
}

.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem 2rem;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.nav-logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 800;
  font-size: 1.25rem;
  letter-spacing: -0.02em;
}

.bars {
  font-weight: 900;
  letter-spacing: -1px;
}

.nav-auth {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.user-email {
  font-size: 0.9rem;
  color: #6b7280;
  font-weight: 500;
}

.logout-btn {
  background: #111827;
  color: #ffffff;
  border: none;
  padding: 0.5rem 1rem;
  border-radius: 9999px;
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
  transition: opacity 0.2s;
}

.logout-btn:hover {
  opacity: 0.8;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4rem 1rem;
  width: 100%;
  max-width: 900px;
  margin: 0 auto;
}

.hero-section {
  text-align: center;
  margin-bottom: 3rem;
  width: 100%;
}

.hero-title {
  font-size: 3.2rem;
  font-weight: 700;
  line-height: 1.1;
  margin: 0 0 1rem 0;
  letter-spacing: -0.04em;
  color: #111827;
}

.hero-subtitle {
  font-size: 1.25rem;
  color: #4b5563;
  margin: 0;
  line-height: 1.5;
}

.workspace-panel {
  width: 100%;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03);
}

.form-group {
  margin-bottom: 1rem;
}

.textarea-group {
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.2s ease;
}

.textarea-group:focus-within {
  border-color: #111827;
  box-shadow: 0 0 0 1px #111827;
}

.sleek-textarea {
  width: 100%;
  background: transparent;
  border: none;
  font-size: 1.1rem;
  line-height: 1.6;
  color: #111827;
  resize: vertical;
  min-height: 150px;
  padding: 1rem;
  font-family: inherit;
}

.sleek-textarea:focus {
  outline: none;
}

.sleek-textarea::placeholder {
  color: #9ca3af;
  font-weight: 400;
}

.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 1rem;
  border-top: 1px solid #f3f4f6;
  flex-wrap: wrap;
}

.control-group {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
}

.action-buttons {
  display: flex;
  gap: 1rem;
  align-items: center;
  margin-left: auto;
}

.upload-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #ffffff;
  border: 1px solid #d1d5db;
  color: #374151;
  font-size: 0.95rem;
  font-weight: 500;
  padding: 0.65rem 1.25rem;
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.2s;
}

.upload-btn:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}

.control-item {
  display: flex;
  align-items: center;
}

.sleek-select {
  appearance: none;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 9999px;
  padding: 0.5rem 2.5rem 0.5rem 1rem;
  font-size: 0.9rem;
  font-weight: 500;
  color: #374151;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b7280'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  background-size: 1rem;
  transition: all 0.2s;
}

.sleek-select:hover {
  border-color: #d1d5db;
  background-color: #f3f4f6;
}

.sleek-select:focus {
  outline: none;
  border-color: #111827;
}

.generate-btn {
  background: #111827;
  color: white;
  border: none;
  border-radius: 9999px;
  padding: 0.75rem 1.75rem;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s ease;
  display: flex;
  justify-content: center;
  align-items: center;
}

.generate-btn:hover:not(:disabled) {
  background: #374151;
}

.generate-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.btn-text {
  background: none;
  border: none;
  color: #3b82f6;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.9rem;
  padding: 0.25rem 0;
}
.btn-text:hover {
  text-decoration: underline;
}

.add-voice-panel {
  background: #f8fafc;
  padding: 1.25rem;
  border-radius: 12px;
  margin-top: 1rem;
  border: 1px dashed #cbd5e1;
}

.add-voice-panel h4 {
  margin: 0 0 0.75rem 0;
  color: #475569;
  font-size: 1rem;
}

.form-row {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.sleek-input {
  flex: 1;
  min-width: 140px;
  padding: 0.6rem 1rem;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background-color: #fff;
  color: #1e293b;
  font-size: 0.9rem;
}
.sleek-input:focus {
  outline: none;
  border-color: #3b82f6;
}

.result-panel {
  margin-top: 1.5rem;
  padding-top: 1.5rem;
  border-top: 1px solid #f3f4f6;
  animation: fadeIn 0.4s ease;
}

.custom-audio {
  width: 100%;
  height: 48px;
  border-radius: 24px;
}

.custom-audio::-webkit-media-controls-panel {
  background-color: #f3f4f6;
}

.error-box {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  padding: 1rem;
  border-radius: 12px;
  margin-top: 1.5rem;
  font-weight: 500;
  font-size: 0.95rem;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(5px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (max-width: 768px) {
  .hero-title {
    font-size: 2.5rem;
  }
  .controls-row {
    flex-direction: column;
    align-items: stretch;
  }
  .control-group {
    flex-direction: column;
    align-items: stretch;
  }
  .action-buttons {
    flex-direction: column;
    align-items: stretch;
    width: 100%;
  }
  .generate-btn {
    width: 100%;
  }
  .upload-btn {
    width: 100%;
    justify-content: center;
  }
  .top-nav {
    flex-direction: column;
    gap: 1rem;
  }
}
</style>