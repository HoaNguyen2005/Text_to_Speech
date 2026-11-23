<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import UiIcon from '@/components/UiIcon.vue';
import StudioBanner from '@/components/StudioBanner.vue';
import SpeechTools from '@/components/SpeechTools.vue';
import SubtitleDownload from '@/components/SubtitleDownload.vue';
import VoicePicker from '@/components/VoicePicker.vue';
import api from '@/services/api';
import {useAccountTier} from '@/composables/useAccountTier';
import AccountUsage from '@/components/AccountUsage.vue';
const {limits,refreshTier,openUpgrade}=useAccountTier();
import * as mammoth from 'mammoth';
import pdfjsLib from '@/services/pdf';
import { useFeedback, notify } from '@/composables/useNotifications';

// Lecture state
const text = ref('');
const sourceName = ref('');
const wordCount = computed(() => text.value.trim() ? text.value.trim().split(/\s+/).length : 0);
const teacherId = ref('');
const ttsProvider=ref('edge');
const availableProviders=ref([
  {provider_id:'edge',name:'Edge-TTS + OpenVoice',is_active:true},
  {provider_id:'vieneu',name:'VieNeu-TTS',is_active:true},
]);
const providersLockedOut=computed(()=>availableProviders.value.length===0);
const styleId = ref('normal');
const speechOptions=ref({version:'speech-v1',profile:'auto',normalize:false,dictionary:[],rate_percent:0});
const deliveries=ref([{profile:'auto',paragraph_profiles:[]}]),speechTools=ref(null);
const previewLoading=ref(false),previewUrl=ref(''),subtitleUrl=ref('');
const resultHistoryId=ref('');
let disposed=false;
let generationConnection;
const speechBusy=computed(()=>loading.value||previewLoading.value);
function clearPreview(){if(previewUrl.value)URL.revokeObjectURL(previewUrl.value);previewUrl.value='';}
watch(()=>JSON.stringify([text.value,teacherId.value,ttsProvider.value,speechOptions.value,deliveries.value]),clearPreview);
onBeforeUnmount(()=>{disposed=true;generationConnection?.abort();clearPreview();});
const loading = ref(false);
const resultAudioUrl = ref(null);
const errorMessage = useFeedback('error');
const generationProgress = ref(null);
const generationError = ref('');
const stageLabels = {
  preparing: 'Đang chuẩn bị cách đọc…',
  synthesizing: 'Đã xử lý {0}/{1} đoạn âm thanh.',
  merging: 'Đang ghép các đoạn âm thanh…',
  saving: 'Đang lưu âm thanh và lịch sử.',
  complete: 'Đã hoàn thành',
};
const generationPercent = computed(() => {
  const progress = generationProgress.value;
  if (progress?.stage === 'synthesizing') return Math.round(5 + 80 * progress.completed / progress.total);
  return { merging: 90, saving: 96, complete: 100 }[progress?.stage] ?? 0;
});

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
    if(Array.isArray(res.data.providers)){
      availableProviders.value=res.data.providers;
      if(availableProviders.value.length && !availableProviders.value.some(p=>p.provider_id===provider)){
        ttsProvider.value=availableProviders.value[0].provider_id;
        return;
      }
    }
    teachers.value = res.data.voices || [];
    if (!chosenTeacher.value)teacherId.value=teachers.value.find(voice=>voice.usable!==false)?.choice_id||'';
    if(!availableProviders.value.length)errorMessage.value='Tất cả bộ tạo giọng đang tạm khóa bởi quản trị viên.';
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
    errorMessage.value = 'Vui lòng nhập nội dung cần đọc!';
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  resultAudioUrl.value = null;
  generationProgress.value = { stage: 'preparing' };
  generationError.value = '';
  generationConnection = new AbortController();

  let unread = 0;
  let finalEvent;
  function readEvents(data) {
    let end;
    while ((end = data.indexOf('\n', unread)) !== -1) {
      const line = data.slice(unread, end);
      if (line.trim()) {
        const event = JSON.parse(line);
        if (event.type === 'progress') generationProgress.value = event.progress;
        else if (event.type === 'result' || event.type === 'error') finalEvent = event;
      }
      unread = end + 1;
    }
  }

  try {
    const planned=await speechTools.value.ensurePlan();
    if (disposed) return;
    const response = await api.post('/api/generate-lecture', {
      text: text.value,
      teacher_id: chosenTeacher.value.voice_id,voice_mode:chosenTeacher.value.voice_mode,
      tts_provider:ttsProvider.value,
      style_id: styleId.value,speech:speechOptions.value,delivery:deliveries.value[0],speech_plan_hash:planned.hash
    }, {
      adapter: 'xhr',
      signal: generationConnection.signal,
      headers: { Accept: 'application/x-ndjson' },
      onDownloadProgress({ event }) {
        const request = event?.target;
        if (disposed || !request?.getResponseHeader('Content-Type')?.startsWith('application/x-ndjson')) return;
        try { readEvents(request.responseText); } catch { /* The final response handles a malformed event. */ }
      },
    });
    if (disposed) return;
    let result = response.data;
    if (response.headers['content-type']?.startsWith('application/x-ndjson')) {
      readEvents(response.data);
      if (finalEvent?.type === 'error') {
        generationError.value = finalEvent.error;
        return;
      }
      result = finalEvent?.result;
    }

    if (result?.status === 'success') {
      resultAudioUrl.value = result.audio_url;
      subtitleUrl.value=result.subtitle_url||'';
      resultHistoryId.value=result.history_id||'';
      generationProgress.value = { stage: 'complete' };
      notify('Bản âm thanh đã được tạo và lưu vào thư viện.', { kind: 'success' });
    } else {
      generationError.value = 'Không nhận được kết quả tạo âm thanh.';
    }
  } catch (error) {
    if (!disposed) generationError.value = error.response?.data?.error || 'Không thể kết nối đến máy chủ!';
  } finally {
    loading.value = false;
    generationConnection = undefined;
    if (!disposed) refreshTier().catch(()=>{});
  }
};
async function previewLecture(){
 if(speechBusy.value||!text.value.trim()||!chosenTeacher.value||loadingVoices.value)return;
 previewLoading.value=true;errorMessage.value='';clearPreview();
 try{const planned=await speechTools.value.ensurePlan();const {data}=await api.post('/api/speech/lecture-preview',{text:text.value,teacher_id:chosenTeacher.value.voice_id,voice_mode:chosenTeacher.value.voice_mode,tts_provider:ttsProvider.value,style_id:styleId.value,
  speech:speechOptions.value,delivery:deliveries.value[0],speech_plan_hash:planned.hash},{responseType:'blob',timeout:20*60*1000});if(!disposed)previewUrl.value=URL.createObjectURL(data);}
 catch(failure){let message=failure.response?.data?.error;if(failure.response?.data instanceof Blob){try{message=JSON.parse(await failure.response.data.text()).error;}catch{}}
 errorMessage.value=message||'Không tạo được đoạn nghe thử. Hãy kiểm tra Engine rồi thử lại.';}
 finally{previewLoading.value=false;refreshTier().catch(()=>{});}
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
  <StudioBanner :title="$t('Từ trang viết, thành lời nói.')" :eyebrow="$t('STUDIO ÂM THANH')" :description="$t('Chuyển văn bản thành giọng nói. Nhập nội dung, chọn giọng đọc và nghe kết quả.')">
    <span class="banner-chip"><UiIcon name="document" />{{ $t("Văn bản · Word · PDF") }}</span><span class="banner-chip"><UiIcon name="mic" />{{ $t("Giọng đọc tiếng Việt") }}</span>
  </StudioBanner>
  <div class="studio-grid">
    <div class="studio-stack">
      <section class="panel editor-body" aria-labelledby="editor-title">
        <div class="panel-heading"><h2 id="editor-title"><UiIcon name="document" />{{ $t("Nội dung cần đọc") }}</h2>
          <button type="button" class="btn small" :disabled="speechBusy" @click="triggerFileUpload"><UiIcon name="upload" />{{ $t("Tải tài liệu") }}</button>
        </div>
        <input type="file" ref="fileInput" @change="handleFileUpload" accept=".txt,.docx,.pdf" hidden />
        <textarea id="script" v-model="text" class="editor-textarea" :disabled="speechBusy" :maxlength="limits.lectureChars" :aria-label="$t('Nội dung cần đọc')" :placeholder="$t('Nhập nội dung bạn muốn chuyển thành giọng nói…\n\nHoặc tải lên tài liệu TXT, Word, PDF để bắt đầu.')" />
        <p class="text-muted">{{ $t('{0} / {1} ký tự',[text.length,limits.lectureChars]) }} <button v-if="text.length>=limits.lectureChars" type="button" class="text-button" @click="openUpgrade()">{{ $t('Nâng cấp gói') }}</button></p>
        <div class="editor-meta"><span><UiIcon name="document" />{{ sourceName || $t("Hỗ trợ TXT, DOCX, PDF") }}</span><span>{{ wordCount.toLocaleString($locale) }} {{ $t("từ ·") }} {{ text.length.toLocaleString($locale) }} {{ $t("ký tự") }}</span></div>
      </section>
      <SpeechTools ref="speechTools" v-model="speechOptions" v-model:deliveries="deliveries" :sections="[{text,title:sourceName}]" :style="styleId" :provider="ttsProvider" :busy="speechBusy" lecture auto-review />
      <div v-if="previewLoading" class="notice" role="status"><span class="spinner" />{{ $t('Đang tạo đoạn nghe thử bằng giọng đã chọn…') }}</div>
      <section v-if="previewUrl" class="panel"><h2>{{ $t('Nghe thử tối đa 30 giây') }}</h2><audio controls :src="previewUrl" class="audio-player" /></section>
      <section v-if="resultAudioUrl" class="panel" aria-labelledby="result-title">
        <div class="panel-heading"><h2 id="result-title"><UiIcon name="headphones" />{{ $t("Bản âm thanh của bạn") }}</h2><span class="pill green">{{ $t("Đã hoàn thành") }}</span></div>
        <audio controls :src="resultAudioUrl" class="audio-player" :aria-label="$t('Bản âm thanh vừa tạo')"></audio>
        <SubtitleDownload v-if="subtitleUrl && resultHistoryId" :endpoint="`/api/history/${resultHistoryId}/subtitles`" />
        <p v-if="subtitleUrl" class="text-muted">{{ $t('Mốc câu trong phụ đề là ước lượng theo đoạn âm thanh đo được.') }}</p>
        <p class="text-muted">{{ $t("Bạn có thể nghe lại bản âm thanh trong") }} <router-link to="/history" class="text-button">{{ $t("Lịch sử của tôi") }}</router-link>.</p>
      </section>
    </div>
    <aside class="studio-stack">
      <section class="panel"><AccountUsage scope="lectures" /></section>
      <section class="panel">
        <div class="panel-heading"><h2><UiIcon name="mic" />{{ $t("Thiết lập giọng đọc") }}</h2></div>
        <div class="settings-fields">
          <div class="field">
            <label for="lecture-tts-provider">{{ $t('Bộ tạo giọng') }}</label>
            <select id="lecture-tts-provider" v-model="ttsProvider" class="input" :disabled="speechBusy || providersLockedOut">
              <option v-if="providersLockedOut" value="" disabled>{{ $t('Tất cả bộ tạo giọng đang tạm khóa') }}</option>
              <option v-for="item in availableProviders" :key="item.provider_id" :value="item.provider_id">{{ item.name }}</option>
            </select>
          </div>
          <div class="field"><label>{{ $t("Giọng đọc") }}</label><VoicePicker ref="voicePicker" v-model="teacherId" :voices="teachers" :provider="ttsProvider" :loading="loadingVoices" :disabled="speechBusy || providersLockedOut" @refresh="fetchVoices" /></div>
        </div>
        <div class="settings-actions"><button type="button" class="btn full" :disabled="speechBusy || loadingVoices || providersLockedOut || !text.trim() || text.length>limits.lectureChars || !chosenTeacher || chosenTeacher.usable===false" @click="previewLecture"><UiIcon name="headphones" />{{ $t('Nghe thử tối đa 30 giây') }}</button><button type="button" class="btn primary full" @click="generateLecture" :disabled="speechBusy || loadingVoices || providersLockedOut || !text.trim() || text.length>limits.lectureChars || !chosenTeacher || chosenTeacher.usable===false"><span v-if="loading" class="spinner" aria-hidden="true"></span><UiIcon v-else name="wave" />{{ loading ? $t("Đang tạo âm thanh…") : $t("Tạo âm thanh") }}</button><p class="settings-hint">{{ $t("Kết quả được lưu trong lịch sử của bạn.") }}</p></div>
        <section v-if="generationProgress" class="lecture-progress" aria-labelledby="lecture-progress-title">
          <div class="lecture-progress-heading">
            <h3 id="lecture-progress-title">{{ $t('Tiến trình tạo âm thanh') }}</h3>
            <strong aria-hidden="true">{{ generationPercent }}%</strong>
          </div>
          <div class="lecture-progress-track" role="progressbar" aria-labelledby="lecture-progress-title" :aria-valuenow="generationPercent" aria-valuemin="0" aria-valuemax="100">
            <span :style="{ transform: `scaleX(${generationPercent / 100})` }" />
          </div>
          <p class="lecture-progress-status" :class="{ failed: generationError }" role="status">
            {{ generationError ? $t(generationError) : $t(stageLabels[generationProgress.stage], [generationProgress.completed, generationProgress.total]) }}
          </p>
        </section>
      </section>
      <section class="panel helper-panel"><UiIcon name="mic" /><h3>{{ $t("Mang âm sắc của riêng bạn") }}</h3><p>{{ $t("Thêm bản ghi âm mẫu để tạo giọng đọc phù hợp với nội dung của bạn.") }}</p><button type="button" class="text-button" :disabled="speechBusy" @click="voicePicker.add()"><UiIcon name="plus" />{{ $t('Thêm giọng mới') }}</button></section>
    </aside>
  </div>
</template>

<style scoped>
.lecture-progress { display: grid; gap: 10px; margin-top: 18px; padding: 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface-raised); }
.lecture-progress-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.lecture-progress-heading h3 { margin: 0; font-size: 14px; }
.lecture-progress-heading strong { color: var(--accent); font-size: 14px; font-variant-numeric: tabular-nums; }
.lecture-progress-track { height: 8px; overflow: hidden; border-radius: 8px; background: var(--accent-soft); }
.lecture-progress-track span { display: block; height: 100%; transform-origin: left; background: var(--accent); border-radius: inherit; transition: transform 220ms ease-out; }
.lecture-progress-status { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.lecture-progress-status.failed { color: var(--danger); }
@media (prefers-reduced-motion: reduce) { .lecture-progress-track span { transition: none; } }
</style>
