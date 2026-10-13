<script setup>
import { ref, computed, onMounted } from 'vue';
import UiIcon from '@/components/UiIcon.vue';
import api from '@/services/api';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Cấu hình worker cho pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

// Lecture state
const text = ref('');
const sourceName = ref('');
const voiceSaving = ref(false);
const voiceError = ref('');
const voiceSuccess = ref('');
const wordCount = computed(() => text.value.trim() ? text.value.trim().split(/\s+/).length : 0);
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
    errorMessage.value = error.response?.data?.error || 'Không thể tải danh sách giọng đọc. Vui lòng thử lại.';
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
  sourceName.value = file.name;
  errorMessage.value = '';

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
  voiceError.value = '';
  voiceSuccess.value = '';
  if (!newVoice.value.voice_id || !newVoice.value.name || !audioFile.value) {
    voiceError.value = 'Vui lòng nhập đủ thông tin và chọn file âm thanh mẫu.';
    return;
  }

  const formData = new FormData();
  formData.append('voice_id', newVoice.value.voice_id);
  formData.append('name', newVoice.value.name);
  formData.append('gender', newVoice.value.gender);
  formData.append('audio_file', audioFile.value);

  voiceSaving.value = true;
  try {
    await api.post('/api/voices', formData);
    voiceSuccess.value = 'Giọng đọc riêng đã được thêm vào danh sách.';
    newVoice.value = { voice_id: '', name: '', gender: 'male' };
    audioFile.value = null;
    showAddVoice.value = false;
    fetchVoices();
  } catch (error) {
    voiceError.value = error.response?.data?.error || 'Không thể tải giọng đọc lên.';
  } finally { voiceSaving.value = false; }
};
</script>


<template>
  <div class="page-heading">
    <div><p class="eyebrow"><UiIcon name="wave" /> STUDIO ÂM THANH</p><h1>Tạo bài giảng</h1><p>Đưa nội dung của bạn vào cuộc sống với giọng đọc và phong cách phù hợp.</p></div>
    <span class="pill purple"><UiIcon name="headphones" />Giọng đọc tiếng Việt</span>
  </div>
  <div class="studio-grid">
    <div class="studio-stack">
      <section class="panel editor-body" aria-labelledby="editor-title">
        <div class="panel-heading"><h2 id="editor-title"><UiIcon name="document" />Nội dung bài giảng</h2>
          <button type="button" class="btn small" :disabled="loading" @click="triggerFileUpload"><UiIcon name="upload" />Tải tài liệu</button>
        </div>
        <input type="file" ref="fileInput" @change="handleFileUpload" accept=".txt,.docx,.pdf" hidden />
        <textarea id="script" v-model="text" class="editor-textarea" :disabled="loading" aria-label="Nội dung bài giảng" placeholder="Nhập nội dung bài giảng của bạn tại đây…&#10;&#10;Hoặc tải lên tài liệu TXT, Word, PDF để bắt đầu." />
        <div class="editor-meta"><span><UiIcon name="document" />{{ sourceName || 'Hỗ trợ TXT, DOCX, PDF' }}</span><span>{{ wordCount.toLocaleString('vi-VN') }} từ · {{ text.length.toLocaleString('vi-VN') }} ký tự</span></div>
      </section>
      <div v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</div>
      <div v-if="loading" class="notice" role="status"><span class="spinner" aria-hidden="true"></span>Đang tạo âm thanh. Nội dung dài có thể cần thêm thời gian.</div>
      <div v-if="voiceSuccess" class="notice success" role="status"><UiIcon name="check" />{{ voiceSuccess }}</div>
      <section v-if="resultAudioUrl" class="panel" aria-labelledby="result-title">
        <div class="panel-heading"><h2 id="result-title"><UiIcon name="headphones" />Bài giảng của bạn</h2><span class="pill green">Đã hoàn thành</span></div>
        <audio controls :src="resultAudioUrl" class="audio-player" aria-label="Âm thanh bài giảng vừa tạo"></audio>
        <p class="text-muted">Bạn có thể nghe lại bài giảng trong <router-link to="/history" class="text-button">Lịch sử của tôi</router-link>.</p>
      </section>
      <section v-if="showAddVoice" class="panel" aria-labelledby="private-voice-title">
        <div class="panel-heading"><div><h2 id="private-voice-title"><UiIcon name="mic" />Thêm giọng đọc riêng</h2><p>Giọng mẫu này chỉ xuất hiện trong tài khoản của bạn.</p></div><button type="button" class="btn small" :disabled="voiceSaving" @click="showAddVoice = false" aria-label="Đóng biểu mẫu giọng đọc"><UiIcon name="close" /></button></div>
        <form class="inline-form" @submit.prevent="addUserVoice">
          <div class="field"><label for="private-voice-code">Mã giọng đọc</label><input id="private-voice-code" v-model="newVoice.voice_id" class="input" placeholder="VD: my_voice_1" required pattern="[a-zA-Z0-9_-]{1,80}" :disabled="voiceSaving" /></div>
          <div class="field"><label for="private-voice-name">Tên hiển thị</label><input id="private-voice-name" v-model="newVoice.name" class="input" placeholder="VD: Giọng đọc của tôi" required :disabled="voiceSaving" /></div>
          <div class="field"><label for="private-voice-gender">Giới tính giọng đọc</label><select id="private-voice-gender" v-model="newVoice.gender" class="input" :disabled="voiceSaving"><option value="male">Nam</option><option value="female">Nữ</option></select></div>
          <div class="field"><label for="private-voice-audio">File âm thanh mẫu</label><input id="private-voice-audio" type="file" accept="audio/*" @change="handleAudioUpload" class="input" required :disabled="voiceSaving" /></div>
          <div v-if="voiceError" class="notice error form-wide" role="alert">{{ voiceError }}</div>
          <div class="form-wide"><button type="submit" class="btn primary" :disabled="voiceSaving"><span v-if="voiceSaving" class="spinner" aria-hidden="true"></span><UiIcon v-else name="upload" />{{ voiceSaving ? 'Đang tải giọng…' : 'Lưu giọng đọc' }}</button></div>
        </form>
      </section>
    </div>
    <aside class="studio-stack">
      <section class="panel">
        <div class="panel-heading"><h2><UiIcon name="mic" />Thiết lập giọng đọc</h2></div>
        <div class="settings-fields">
          <div class="field"><label for="teacher">Giọng đọc</label><select id="teacher" v-model="teacherId" class="input" :disabled="loading || !teachers.length"><option v-if="!teachers.length" value="male">Chưa có giọng đọc</option><option v-for="teacher in teachers" :key="teacher.voice_id" :value="teacher.voice_id">{{ teacher.name }} ({{ teacher.gender === 'male' ? 'Nam' : 'Nữ' }})</option></select><small>Chọn giọng mẫu chung hoặc giọng riêng của bạn.</small></div>
          <div class="field"><label for="style">Phong cách đọc</label><select id="style" v-model="styleId" class="input" :disabled="loading"><option v-for="style in styles" :key="style.id" :value="style.id">{{ style.name }}</option></select></div>
        </div>
        <div class="settings-actions"><button type="button" class="btn primary full" @click="generateLecture" :disabled="loading || !text.trim() || !teachers.length"><span v-if="loading" class="spinner" aria-hidden="true"></span><UiIcon v-else name="wave" />{{ loading ? 'Đang tạo âm thanh…' : 'Tạo âm thanh' }}</button><p class="settings-hint">Kết quả được lưu trong lịch sử của bạn.</p></div>
      </section>
      <section class="panel helper-panel"><UiIcon name="mic" /><h3>Mang âm sắc của riêng bạn</h3><p>Thêm bản ghi âm mẫu để tạo giọng đọc phù hợp với nội dung của bạn.</p><button type="button" class="text-button" :disabled="voiceSaving" @click="showAddVoice = !showAddVoice"><UiIcon name="plus" />{{ showAddVoice ? 'Đóng biểu mẫu' : 'Thêm giọng đọc riêng' }}</button></section>
    </aside>
  </div>
</template>
