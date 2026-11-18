<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import UiIcon from '@/components/UiIcon.vue';
import StudioBanner from '@/components/StudioBanner.vue';
import SpeechTools from '@/components/SpeechTools.vue';
import SubtitleDownload from '@/components/SubtitleDownload.vue';
import VoicePicker from '@/components/VoicePicker.vue';
import api from '@/services/api';
import * as mammoth from 'mammoth';
import pdfjsLib from '@/services/pdf';
import { useFeedback, notify } from '@/composables/useNotifications';

// Lecture state
const text = ref('');
const sourceName = ref('');
const wordCount = computed(() => text.value.trim() ? text.value.trim().split(/\s+/).length : 0);
const teacherId = ref('');
const ttsProvider=ref('edge');
const styleId = ref('normal');
const speechOptions=ref({version:'speech-v1',profile:'teaching',normalize:false,dictionary:[],rate_percent:0});
const deliveries=ref([{profile:'auto',paragraph_profiles:[]}]),speechTools=ref(null);
const previewLoading=ref(false),previewUrl=ref(''),subtitleUrl=ref('');
const resultHistoryId=ref('');
let disposed=false;
const speechBusy=computed(()=>loading.value||previewLoading.value);
function clearPreview(){if(previewUrl.value)URL.revokeObjectURL(previewUrl.value);previewUrl.value='';}
watch(()=>JSON.stringify([text.value,teacherId.value,ttsProvider.value,speechOptions.value,deliveries.value]),clearPreview);
onBeforeUnmount(()=>{disposed=true;clearPreview();});
const loading = ref(false);
const resultAudioUrl = ref(null);
const errorMessage = useFeedback('error');

const teachers = ref([]);
const loadingVoices=ref(false),voicePicker=ref(null);
const chosenTeacher=computed(()=>teachers.value.find(voice=>voice.choice_id===teacherId.value));
let voiceRequest=0;
watch(ttsProvider,()=>{teacherId.value='';fetchVoices();});


onMounted(async () => {
  fetchVoices();
});

const fetchVoices = async () => {
  const version=++voiceRequest,provider=ttsProvider.value;loadingVoices.value=true;
  try {
    const res = await api.get('/api/book-jobs/voices',{params:{provider}});
    if(disposed||version!==voiceRequest)return;
    teachers.value = res.data.voices;
    if (!chosenTeacher.value)teacherId.value=teachers.value[0]?.choice_id||'';
  } catch (error) {
    if(disposed||version!==voiceRequest)return;
    teachers.value=[];teacherId.value='';
    errorMessage.value = error.response?.data?.error || 'Không thể tải danh sách giọng đọc. Vui lòng thử lại.';
  }finally{if(version===voiceRequest)loadingVoices.value=false;}
};

const generateLecture = async () => {
  if(speechBusy.value)return;
  if(!chosenTeacher.value||loadingVoices.value)return;
  if (!text.value.trim()) {
    errorMessage.value = 'Vui lòng nhập kịch bản bài giảng!';
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  resultAudioUrl.value = null;

  try {
    const planned=await speechTools.value.ensurePlan();
    const response = await api.post('/api/generate-lecture', {
      text: text.value,
      teacher_id: chosenTeacher.value.voice_id,voice_mode:chosenTeacher.value.voice_mode,
      tts_provider:ttsProvider.value,
      style_id: styleId.value,speech:speechOptions.value,delivery:deliveries.value[0],speech_plan_hash:planned.hash
    });

    if (response.data.status === 'success') {
      resultAudioUrl.value = response.data.audio_url;
      subtitleUrl.value=response.data.subtitle_url||'';
      resultHistoryId.value=response.data.history_id||'';
      notify('Bài giảng đã được tạo thành công và lưu vào thư viện.', { kind: 'success' });
    } else {
      errorMessage.value = 'Có lỗi xảy ra từ máy chủ.';
    }
  } catch (error) {
    errorMessage.value = error.response?.data?.error || 'Không thể kết nối đến máy chủ!';
  } finally {
    loading.value = false;
  }
};
async function previewLecture(){
 if(speechBusy.value||!text.value.trim()||!chosenTeacher.value||loadingVoices.value)return;
 previewLoading.value=true;errorMessage.value='';clearPreview();
 try{const planned=await speechTools.value.ensurePlan();const {data}=await api.post('/api/speech/lecture-preview',{text:text.value,teacher_id:chosenTeacher.value.voice_id,voice_mode:chosenTeacher.value.voice_mode,tts_provider:ttsProvider.value,style_id:styleId.value,
  speech:speechOptions.value,delivery:deliveries.value[0],speech_plan_hash:planned.hash},{responseType:'blob',timeout:20*60*1000});if(!disposed)previewUrl.value=URL.createObjectURL(data);}
 catch(failure){let message=failure.response?.data?.error;if(failure.response?.data instanceof Blob){try{message=JSON.parse(await failure.response.data.text()).error;}catch{}}
 errorMessage.value=message||'Không tạo được đoạn nghe thử. Hãy kiểm tra Engine rồi thử lại.';}
 finally{previewLoading.value=false;}
}
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
        notify({ key: 'Đã đọc tài liệu {0}.', params: [file.name] }, { kind: 'success' });
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
        notify({ key: 'Đã đọc tài liệu {0}.', params: [file.name] }, { kind: 'success' });
      } catch (err) {
        errorMessage.value = "Lỗi: Không thể đọc nội dung file PDF này!";
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = (e) => {
      text.value = e.target.result;
      notify({ key: 'Đã đọc tài liệu {0}.', params: [file.name] }, { kind: 'success' });
    };
    reader.readAsText(file);
  }

  event.target.value = null;
};

</script>


<template>
  <StudioBanner :title="$t('Từ trang viết, thành lời nói.')" :eyebrow="$t('STUDIO ÂM THANH')" :description="$t('Tạo bài giảng với âm sắc riêng. Bắt đầu từ nội dung, chọn giọng đọc và lắng nghe kết quả.')">
    <span class="banner-chip"><UiIcon name="document" />{{ $t("Văn bản · Word · PDF") }}</span><span class="banner-chip"><UiIcon name="mic" />{{ $t("Giọng đọc tiếng Việt") }}</span>
  </StudioBanner>
  <div class="studio-grid">
    <div class="studio-stack">
      <section class="panel editor-body" aria-labelledby="editor-title">
        <div class="panel-heading"><h2 id="editor-title"><UiIcon name="document" />{{ $t("Nội dung bài giảng") }}</h2>
          <button type="button" class="btn small" :disabled="speechBusy" @click="triggerFileUpload"><UiIcon name="upload" />{{ $t("Tải tài liệu") }}</button>
        </div>
        <input type="file" ref="fileInput" @change="handleFileUpload" accept=".txt,.docx,.pdf" hidden />
        <textarea id="script" v-model="text" class="editor-textarea" :disabled="speechBusy" maxlength="20000" :aria-label="$t('Nội dung bài giảng')" :placeholder="$t('Nhập nội dung bài giảng của bạn tại đây…\n\nHoặc tải lên tài liệu TXT, Word, PDF để bắt đầu.')" />
        <div class="editor-meta"><span><UiIcon name="document" />{{ sourceName || $t("Hỗ trợ TXT, DOCX, PDF") }}</span><span>{{ wordCount.toLocaleString($locale) }} {{ $t("từ ·") }} {{ text.length.toLocaleString($locale) }} {{ $t("ký tự") }}</span></div>
      </section>
      <SpeechTools ref="speechTools" v-model="speechOptions" v-model:deliveries="deliveries" :sections="[{text,title:sourceName}]" :style="styleId" :provider="ttsProvider" :busy="speechBusy" auto-review />
      <div v-if="previewLoading" class="notice" role="status"><span class="spinner" />{{ $t('Đang tạo đoạn nghe thử bằng giọng đã chọn…') }}</div>
      <section v-if="previewUrl" class="panel"><h2>{{ $t('Nghe thử tối đa 30 giây') }}</h2><audio controls :src="previewUrl" class="audio-player" /></section>
      <div v-if="loading" class="notice" role="status"><span class="spinner" aria-hidden="true"></span>{{ $t("Đang tạo âm thanh. Nội dung dài có thể cần thêm thời gian.") }}</div>
      <section v-if="resultAudioUrl" class="panel" aria-labelledby="result-title">
        <div class="panel-heading"><h2 id="result-title"><UiIcon name="headphones" />{{ $t("Bài giảng của bạn") }}</h2><span class="pill green">{{ $t("Đã hoàn thành") }}</span></div>
        <audio controls :src="resultAudioUrl" class="audio-player" :aria-label="$t('Âm thanh bài giảng vừa tạo')"></audio>
        <SubtitleDownload v-if="subtitleUrl && resultHistoryId" :endpoint="`/api/history/${resultHistoryId}/subtitles`" />
        <p v-if="subtitleUrl" class="text-muted">{{ $t('Mốc câu trong phụ đề là ước lượng theo đoạn âm thanh đo được.') }}</p>
        <p class="text-muted">{{ $t("Bạn có thể nghe lại bài giảng trong") }} <router-link to="/history" class="text-button">{{ $t("Lịch sử của tôi") }}</router-link>.</p>
      </section>
    </div>
    <aside class="studio-stack">
      <section class="panel">
        <div class="panel-heading"><h2><UiIcon name="mic" />{{ $t("Thiết lập giọng đọc") }}</h2></div>
        <div class="settings-fields">
          <div class="field"><label for="lecture-tts-provider">{{ $t('Bộ tạo giọng') }}</label><select id="lecture-tts-provider" v-model="ttsProvider" class="input" :disabled="speechBusy"><option value="vieneu">VieNeu-TTS</option><option value="edge">Edge-TTS + OpenVoice</option></select></div>
          <div class="field"><label>{{ $t("Giọng đọc") }}</label><VoicePicker ref="voicePicker" v-model="teacherId" :voices="teachers" :provider="ttsProvider" :loading="loadingVoices" :disabled="speechBusy" @refresh="fetchVoices" /></div>
        </div>
        <div class="settings-actions"><button type="button" class="btn full" :disabled="speechBusy || loadingVoices || !text.trim() || !chosenTeacher" @click="previewLecture"><UiIcon name="headphones" />{{ $t('Nghe thử tối đa 30 giây') }}</button><button type="button" class="btn primary full" @click="generateLecture" :disabled="speechBusy || loadingVoices || !text.trim() || !chosenTeacher"><span v-if="loading" class="spinner" aria-hidden="true"></span><UiIcon v-else name="wave" />{{ loading ? $t("Đang tạo âm thanh…") : $t("Tạo âm thanh") }}</button><p class="settings-hint">{{ $t("Kết quả được lưu trong lịch sử của bạn.") }}</p></div>
      </section>
      <section class="panel helper-panel"><UiIcon name="mic" /><h3>{{ $t("Mang âm sắc của riêng bạn") }}</h3><p>{{ $t("Thêm bản ghi âm mẫu để tạo giọng đọc phù hợp với nội dung của bạn.") }}</p><button type="button" class="text-button" :disabled="speechBusy" @click="voicePicker.add()"><UiIcon name="plus" />{{ $t('Thêm giọng mới') }}</button></section>
    </aside>
  </div>
</template>
