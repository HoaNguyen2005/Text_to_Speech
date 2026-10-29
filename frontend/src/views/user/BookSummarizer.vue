<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { onBeforeRouteLeave } from 'vue-router';
import UiIcon from '@/components/UiIcon.vue';
import StudioBanner from '@/components/StudioBanner.vue';
import { getLocaleTag } from '@/composables/useLocale';
import { confirmAction, useFeedback, notify } from '@/composables/useNotifications';
import BookAttribution from '@/components/BookAttribution.vue';
import BookDraftEditor from '@/components/BookDraftEditor.vue';
import SpeechRateControl from '@/components/SpeechRateControl.vue';
import VoicePicker from '@/components/VoicePicker.vue';
import SubtitleDownload from '@/components/SubtitleDownload.vue';
import SummaryDownload from '@/components/SummaryDownload.vue';
import api from '@/services/api';
import * as mammoth from 'mammoth';
import pdfjsLib from '@/services/pdf';

const MAX_CHARS = 1000000;
const fileInput = ref(null);
const sourceName = ref('');
const bookTitle = ref('');
const bookAuthor = ref('');
const sourceCitation = ref('');
const fullText = ref('');
const targetMinutes = ref(10);
const ratePercent = ref(0);
const durationInput = ref(null), sourceInput = ref(null), sourceDurationIssue = ref(null);
const validDuration = computed(() => Number.isInteger(targetMinutes.value) && targetMinutes.value >= 1 && targetMinutes.value <= 59);
const ttsProvider = ref('edge');
const selectedVoiceId = ref('');
const voiceChoices = ref({ standard: [], clone: [] });
const loadingVoices = ref(false);
const voiceError = useFeedback('error');
const availableVoices = computed(() => voiceChoices.value.voices || []);
const chosenVoice = computed(() => availableVoices.value.find((voice) => voice.choice_id === selectedVoiceId.value));
const voiceMode=computed(()=>chosenVoice.value?.voice_mode||'standard');
watch(ttsProvider, () => { selectedVoiceId.value = ''; fetchVoiceChoices(); });
const reading = ref(false);
const submitting = ref(false);
const creating = ref(false);
const sourcePanel = ref(null);
const statusMessage = useFeedback('success');
const errorMessage = useFeedback('error');
const fileError = useFeedback('error');
const fileStatus = ref('');
watch([reading, fileStatus], ([isReading, message]) => {
  if (!isReading && message) notify(message, { kind: 'success', key: 'book-file-read' });
});
const connectionMessage = useFeedback('error', { key: 'book-connection', action: { label: 'Kết nối lại', run: () => poll() } });
const jobs = ref([]);
const selected = ref(null);
const workerOnline = ref(null);
const draftEditor = ref(null);
const workspace = computed(() => Boolean(selected.value) || creating.value);
const navigationLocked = computed(() => reading.value || submitting.value || Boolean(draftEditor.value?.working));
watch([fullText, targetMinutes, ttsProvider, selectedVoiceId, () => draftEditor.value?.ratePercent ?? ratePercent.value], () => { sourceDurationIssue.value = null; });
async function focusDuration() {
  await nextTick();
  durationInput.value?.scrollIntoView({ behavior:'smooth', block:'center' });
  durationInput.value?.focus();
  durationInput.value?.select();
}
async function focusSource() {
  await nextTick();
  sourceInput.value?.scrollIntoView({ behavior:'smooth', block:'center' });
  sourceInput.value?.focus();
}
function useSuggestedDuration() {
  const minutes = sourceDurationIssue.value?.max_minutes;
  if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 59) targetMinutes.value = minutes;
  focusDuration();
}
function handleDraftDurationIssue(issue) {
  sourceDurationIssue.value = issue;
}
async function startNewSummary(minutes = 10) {
  if (navigationLocked.value) return;
  if (draftEditor.value?.dirty && !await confirmAction('Bạn có chỉnh sửa chưa lưu. Chuyển yêu cầu sẽ bỏ các chỉnh sửa này.', { title:'Bỏ chỉnh sửa chưa lưu?', confirmLabel:'Bỏ chỉnh sửa', danger:true })) return;
  if (disposed || navigationLocked.value) return;
  ++selectionVersion;
  selected.value = null;
  sourceName.value = ''; bookTitle.value = ''; bookAuthor.value = ''; sourceCitation.value = ''; fullText.value = '';
  targetMinutes.value = Number.isInteger(minutes) && minutes >= 1 && minutes <= 59 ? minutes : 10;
  ratePercent.value = 0; selectedVoiceId.value = ''; ttsProvider.value = 'edge';
  requestId = null; requestSignature = null;
  sourceDurationIssue.value = null; fileStatus.value = ''; fileError.value = ''; errorMessage.value = ''; statusMessage.value = '';
  await nextTick();
  sourcePanel.value?.scrollIntoView({behavior:'smooth',block:'start'});
}
let timer;
let clockTimer;
const clockNow = ref(Date.now());
let disposed = false;
let selectionVersion = 0;
let requestId;
let requestSignature;
let polling = false;
const removedIds = new Set();
const busy = computed(() => reading.value || submitting.value);
const active = (job) => ['queued', 'processing'].includes(job?.status);
const statuses = { queued: 'Đang chờ', processing: 'Đang xử lý', review: 'Chờ duyệt nội dung', completed: 'Hoàn thành', failed: 'Cần thử lại', cancelled: 'Đã hủy' };
const statusLabel = job => job.status === 'queued' && job.next_attempt_at ? 'Chờ Gemini thử lại' : statuses[job.status];
const retrySeconds = computed(() => Math.max(0, Math.ceil((new Date(selected.value?.next_attempt_at).getTime() - clockNow.value) / 1000)) || 0);
const steps = [
  { phases: ['analysis'], label: 'Phân tích nguồn' },
  { phases: ['outline', 'calibration'], label: 'Dàn ý & giọng đọc' },
  { phases: ['script', 'verification', 'review'], label: 'Viết & duyệt nội dung' },
  { phases: ['preview'], label: 'Nghe thử' },
  { phases: ['audio'], label: 'Tạo từng đoạn âm thanh' },
  { phases: ['merge', 'publishing', 'completed'], label: 'Ghép & lưu kết quả' },
];
const phaseIndex = computed(() => steps.findIndex((step) => step.phases.includes(selected.value?.progress?.phase === 'retry_wait' ? selected.value?.retry_state?.resume_phase : selected.value?.progress?.phase)));
const formatDuration = (seconds) => `${Math.floor(Math.round(seconds) / 60)}:${String(Math.round(seconds) % 60).padStart(2, '0')}`;
const formatDate = (value) => new Date(value).toLocaleString(getLocaleTag(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

async function fetchVoiceChoices() {
  if (loadingVoices.value) return;
  loadingVoices.value = true;
  voiceError.value = '';
  try {
    const { data } = await api.get('/api/book-jobs/voices', { params:{provider:ttsProvider.value}, timeout: 20000 });
    if (disposed) return;
    voiceChoices.value = data;
    if (!chosenVoice.value) selectedVoiceId.value = '';
  } catch (error) {
    voiceError.value = error.response?.data?.error || 'Chưa tải được danh sách giọng. Hãy thử tải lại.';
  } finally { loadingVoices.value = false; }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || busy.value || workspace.value) return;
  errorMessage.value = '';
  fileError.value = '';
  fileStatus.value = '';
  if (file.size > 30 * 1024 * 1024) { fileError.value = { key: '{0} vượt 30 MB. Hãy chia thành các tập nhỏ hơn.', params: [file.name] }; return; }
  reading.value = true;
  fileStatus.value = { key: 'Đang đọc {0}…', params: [file.name] };
  try {
    let text;
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'docx') text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
    else if (extension === 'pdf') {
      const loadingTask = pdfjsLib.getDocument({ data: await file.arrayBuffer() });
      try {
        const pdf = await loadingTask.promise;
        if (pdf.numPages > 1000) throw new Error('PDF vượt 1.000 trang. Hãy chia thành các tập trước khi tải lên.');
        const pages = [];
        let total = 0;
        for (let i = 1; i <= pdf.numPages; i++) {
          if (disposed) return;
          fileStatus.value = { key: 'Đọc {0} · trang {1}/{2}', params: [file.name, i, pdf.numPages] };
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map((item) => item.str + (item.hasEOL ? '\n' : ' ')).join('');
          total += pageText.length + 2;
          if (total > MAX_CHARS) throw new Error('PDF vượt 1.000.000 ký tự. Hãy chia thành các tập; hệ thống không tự cắt bỏ trang.');
          pages.push(pageText);
          page.cleanup();
        }
        text = pages.join('\n\n');
      } finally {
        // PDF.js 6 exposes destroy() on the loading task, not PDFDocumentProxy.
        // Cleanup must not discard extracted text or hide the original read error.
        await loadingTask.destroy().catch(() => {
          console.warn('[PDF] Chưa dọn xong tài nguyên đọc tài liệu.');
        });
      }
    } else if (extension === 'txt' || extension === 'md') text = await file.text();
    else throw new Error('Chỉ hỗ trợ TXT, MD, DOCX và PDF.');
    if (text.length > MAX_CHARS) throw new Error('Tài liệu vượt 1.000.000 ký tự. Hãy chia thành các tập nhỏ hơn.');
    if (text.trim().length < 500) throw new Error('Tài liệu có quá ít văn bản. Với PDF scan, hãy chuyển thành văn bản bằng OCR trước.');
    if (sourceName.value) {
      bookTitle.value = '';
      bookAuthor.value = '';
      sourceCitation.value = '';
    }
    if (!bookTitle.value.trim()) bookTitle.value = file.name.replace(/\.[^.]+$/, '').slice(0, 200);
    fullText.value = text;
    sourceName.value = file.name;
    fileStatus.value = { key: 'Đã đọc {0} · {1} ký tự. Nội dung nằm trong ô bên dưới.', params: [file.name, text.length] };
  } catch (error) {
    let reason = error.message || 'Không đọc được tài liệu. Hãy thử xuất lại file thành TXT hoặc DOCX.';
    if (error.name === 'PasswordException') reason = 'PDF được bảo vệ bằng mật khẩu. Hãy mở khóa hoặc xuất một bản không có mật khẩu trước.';
    if (error.name === 'InvalidPDFException') reason = 'File PDF không hợp lệ hoặc bị hỏng. Hãy mở file trên máy và xuất lại thành PDF hoặc TXT.';
    fileError.value = { key: 'Không đọc được {0}: {1}{2}', params: [file.name, { key: reason }, { key: fullText.value ? ' Nội dung trước đó vẫn được giữ nguyên.' : '' }] };
    fileStatus.value = '';
  } finally { reading.value = false; }
}

async function selectJob(job) {
  if (removedIds.has(job._id)) return;
  if (job._id !== selected.value?._id && draftEditor.value?.dirty && !await confirmAction('Bạn có chỉnh sửa chưa lưu. Chuyển yêu cầu sẽ bỏ các chỉnh sửa này.', { title: 'Bỏ chỉnh sửa chưa lưu?', confirmLabel: 'Bỏ chỉnh sửa', danger: true })) return;
  if (disposed || removedIds.has(job._id)) return;
  const version = ++selectionVersion;
  selected.value = job;
  try {
    const response = await api.get(`/api/book-jobs/${job._id}`, { timeout: 20000 });
    if (!disposed && version === selectionVersion && !removedIds.has(job._id)) selected.value = response.data;
  } catch (error) {
    if (disposed || version !== selectionVersion || removedIds.has(job._id)) return;
    if (error.response?.status === 404) {
      removedIds.add(job._id); jobs.value = jobs.value.filter((item) => item._id !== job._id);
      selected.value = null; ++selectionVersion;
    } else connectionMessage.value = error.response?.data?.error || 'Chưa tải được chi tiết yêu cầu.';
  }
}
async function refreshJobs() {
  const response = await api.get('/api/book-jobs', { timeout: 20000 });
  if (disposed) return;
  jobs.value = response.data.jobs.filter((job) => !removedIds.has(job._id));
  workerOnline.value = response.data.worker_online;
  connectionMessage.value = '';
  // Poll updates the list but never leaves the new-summary form on its own.
  if (!selected.value) return;
  if (active(selected.value) || !jobs.value.some((job) => job._id === selected.value._id)) {
    const fresh = jobs.value.find((job) => job._id === selected.value._id);
    if (fresh && !['completed', 'review'].includes(fresh.status)) selected.value = fresh;
    else await selectJob(fresh || selected.value);
  } else if (selected.value.status==='review' && selected.value.draft?.preview_request?.status==='processing') {
    const id=selected.value._id,version=selectionVersion;
    const {data}=await api.get(`/api/book-jobs/${id}`,{timeout:20000});
    if(!disposed && version===selectionVersion && selected.value?._id===id && !removedIds.has(id))selected.value=data;
  }
}
async function poll() {
  if (disposed || polling) return;
  clearTimeout(timer);
  polling = true;
  try { await refreshJobs(); }
  catch (error) {
    connectionMessage.value = error.response?.data?.error || 'Mất kết nối. Tiến độ đã lưu; yêu cầu vẫn xử lý khi worker hoạt động.';
    if ([401, 403].includes(error.response?.status)) return;
  } finally { polling = false; }
  if (!disposed) timer = setTimeout(poll, 5000);
}
async function processBook() {
  if (disposed || busy.value || workspace.value) return;
  if (!validDuration.value) {
    errorMessage.value = 'Thời lượng phải là số phút nguyên từ 1 đến 59 (dưới 1 giờ).'; return;
  }
  if (!chosenVoice.value || loadingVoices.value || voiceError.value) {
    errorMessage.value = 'Vui lòng tải danh sách và chọn giọng đọc cụ thể trước khi tạo sách nói.'; return;
  }
  if (!bookTitle.value.trim()) {
    errorMessage.value = 'Vui lòng nhập tên sách hoặc tài liệu để ghi nguồn cho bản tóm tắt.'; return;
  }
  if (fullText.value.trim().length < 500 || fullText.value.length > MAX_CHARS) {
    errorMessage.value = 'Nội dung cần từ 500 đến 1.000.000 ký tự.'; return;
  }
  submitting.value = true;
  creating.value = true;
  errorMessage.value = '';
  // A network retry of the same submission reuses the id; a successful new request gets a new id.
  const metadata = { title: bookTitle.value.trim(), author: bookAuthor.value.trim(), source: sourceCitation.value.trim() };
  const requestedRate = ratePercent.value;
  const signature = [fullText.value, sourceName.value, targetMinutes.value, voiceMode.value, ttsProvider.value, selectedVoiceId.value, requestedRate, JSON.stringify(metadata)].join('\0');
  if (!requestId || requestSignature !== signature) { requestId = crypto.randomUUID(); requestSignature = signature; }
  try {
    const response = await api.post('/api/book-jobs', { text: fullText.value, title: metadata.title, book_metadata: metadata,
      speech:{version:'speech-v1',profile:'auto',normalize:false,dictionary:[],rate_percent:requestedRate},
      target_minutes: targetMinutes.value, voice_mode: voiceMode.value, tts_provider:ttsProvider.value, voice_id: chosenVoice.value.voice_id, request_id: requestId }, { timeout: 20000 });
    ++selectionVersion;
    selected.value = response.data;
    ratePercent.value = requestedRate;
    requestId = null;
    statusMessage.value = 'Đã gửi yêu cầu tạo bản tóm tắt. Hệ thống sẽ chờ bạn duyệt trước khi tạo âm thanh.';
    await refreshJobs();
  } catch (error) {
    const failure = error.response?.data;
    if (failure?.code === 'SOURCE_TOO_SHORT' && failure.duration_issue) {
      sourceDurationIssue.value = failure.duration_issue;
      const issue = sourceDurationIssue.value;
      notify(issue.max_minutes
        ? { key:'Nguồn quá ngắn so với {0} phút đã chọn. Hãy chọn tối đa khoảng {1} phút hoặc thêm nội dung nguồn.', params:[issue.target_minutes,issue.max_minutes] }
        : 'Nguồn quá ngắn để tạo bản tóm tắt từ 1 phút. Hãy thêm nội dung nguồn trước khi tiếp tục.', {
        kind:'error', key:'book-source-duration', title:'Thời lượng chưa phù hợp',
        action:issue.max_minutes ? {label:'Chọn lại thời lượng',run:focusDuration} : {label:'Bổ sung nội dung',run:focusSource},
      });
    } else errorMessage.value = failure?.error || 'Chưa gửi được yêu cầu. Hãy thử lại.';
  }
  finally { submitting.value = false; creating.value = false; }
}
async function jobAction(action) {
  if (!selected.value || submitting.value) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    const response = await api.post(`/api/book-jobs/${selected.value._id}/${action}`, { revision: selected.value.draft_revision }, { timeout: 20000 });
    ++selectionVersion;
    selected.value = response.data;
    notify(action === 'retry' ? 'Đã gửi yêu cầu tiếp tục từ phần đã lưu.' : 'Đã mở lại bản tóm tắt để chỉnh sửa.', { kind: 'success' });
    await refreshJobs();
  } catch (error) { errorMessage.value = error.response?.data?.error || 'Không thực hiện được thao tác.'; }
  finally { submitting.value = false; }
}
async function removeJob() {
  if (!selected.value || submitting.value) return;
  const id = selected.value._id;
  if (!await confirmAction('Hủy tạo file và xóa yêu cầu này? Bản nháp, chỉnh sửa chưa lưu và file tạm của yêu cầu sẽ bị xóa.', { title: 'Hủy và xóa yêu cầu?', confirmLabel: 'Hủy và xóa', danger: true })) return;
  if (disposed || submitting.value || selected.value?._id !== id) return;
  submitting.value = true;
  errorMessage.value = '';
  try {
    const { data } = await api.delete(`/api/book-jobs/${id}`, { timeout: 20000 });
    removedIds.add(id); ++selectionVersion;
    jobs.value = jobs.value.filter((job) => job._id !== id);
    if (selected.value?._id === id) selected.value = null;
    statusMessage.value = data.pending_cleanup
      ? 'Đã xóa khỏi yêu cầu gần đây. Worker sẽ dừng sau bước đang chạy và dọn dữ liệu tạm khi hoạt động.'
      : 'Đã xóa yêu cầu.';
    await refreshJobs().catch(() => { connectionMessage.value = 'Chưa tải lại được danh sách. Yêu cầu đã được xóa.'; });
  } catch (error) { errorMessage.value = error.response?.data?.error || 'Chưa hủy được yêu cầu. Hãy thử lại.'; }
  finally { submitting.value = false; }
}
function updateReviewedJob(job) {
  if (selected.value?._id !== job._id) return;
  ++selectionVersion;
  selected.value = job;
  refreshJobs().catch(() => {});
}
function protectDraft(event) {
  if (!draftEditor.value?.dirty) return;
  event.preventDefault(); event.returnValue = '';
}
onBeforeRouteLeave(() => !draftEditor.value?.dirty || confirmAction('Bạn có chỉnh sửa chưa lưu. Chuyển yêu cầu sẽ bỏ các chỉnh sửa này.', { title: 'Bỏ chỉnh sửa chưa lưu?', confirmLabel: 'Bỏ chỉnh sửa', danger: true }));
watch(() => [selected.value?._id, selected.value?.status, selected.value?.error, selected.value?.draft?.preview?.audio_url, selected.value?.work_action], ([id, status, error, preview, action], previous) => {
  if (!id) return;
  if (status === 'failed' && error && (previous?.[0] !== id || previous?.[1] !== status || previous?.[2] !== error)) notify(error, { kind: 'error', key: `book-failed-${id}` });
  if (previous?.[0] !== id) return;
  if (previous[1] !== status && status === 'completed') notify('Sách nói đã được tạo thành công và lưu vào thư viện.', { kind: 'success', key: `book-completed-${id}` });
  if (previous[1] !== status && status === 'review') notify(action === 'preview' || (preview && preview !== previous[3]) ? 'Đoạn nghe thử đã sẵn sàng.' : 'Bản tóm tắt đã sẵn sàng để bạn xem và duyệt.', { kind: 'success', key: `book-review-${id}` });
});
onMounted(() => { poll(); fetchVoiceChoices(); clockTimer = setInterval(() => { clockNow.value = Date.now(); }, 1000); window.addEventListener('beforeunload', protectDraft); });
onBeforeUnmount(() => { disposed = true; ++selectionVersion; clearTimeout(timer); clearInterval(clockTimer); window.removeEventListener('beforeunload', protectDraft); });
</script>

<template>
  <StudioBanner :title="$t(workspace ? 'Hoàn thiện bản tóm tắt.' : 'Tri thức, theo nhịp của bạn.')" icon="book" :eyebrow="$t('SÁCH NÓI AI')" :description="$t(workspace ? 'Theo dõi tiến độ, duyệt nội dung và nghe thử trước khi tạo âm thanh.' : 'Biến ý chính từ tài liệu thành trải nghiệm nghe. Chọn giọng đọc và khoảng thời gian phù hợp với bạn.')">
    <span v-if="!workspace" class="banner-chip"><UiIcon name="clock" />{{ $t("Tùy chọn 1–59 phút") }}</span><span v-if="!workspace" class="banner-chip"><UiIcon name="spark" />{{ $t("Tóm tắt bằng AI") }}</span>
  </StudioBanner>
  <div class="studio-grid">
    <div class="studio-stack">
      <section v-if="!workspace" ref="sourcePanel" class="panel" aria-labelledby="book-upload-title">
        <div class="panel-heading"><h2 id="book-upload-title"><UiIcon name="book" />{{ $t("Tài liệu của bạn") }}</h2><span class="pill">TXT · MD · DOCX · PDF</span></div>
        <input type="file" ref="fileInput" @change="handleFileUpload" accept=".txt,.md,.docx,.pdf" :disabled="busy" hidden />
        <div class="upload-area"><UiIcon name="upload" /><h3>{{ sourceName || $t("Bắt đầu từ một cuốn sách") }}</h3><p>{{ $t("Đọc toàn bộ nội dung, tối đa 30 MB và 1 triệu ký tự. PDF scan cần chuyển thành văn bản trước.") }}</p><button type="button" class="btn" :disabled="busy" @click="fileInput?.click()"><UiIcon name="plus" />{{ sourceName ? $t("Chọn tài liệu khác") : $t("Chọn tài liệu") }}</button></div>
        <div v-if="reading && fileStatus" class="notice book-file-feedback" role="status"><span class="spinner" aria-hidden="true"></span>{{ $t(fileStatus) }}</div>
        <div class="book-metadata-form">
          <div class="field"><label for="book-title">{{ $t("Tên sách / tài liệu") }} <span aria-hidden="true">*</span></label><input id="book-title" v-model="bookTitle" class="input" maxlength="200" required :disabled="busy" :placeholder="$t('Nhập đúng tên tác phẩm')" /></div>
          <div class="field"><label for="book-author">{{ $t("Tác giả") }}</label><input id="book-author" v-model="bookAuthor" class="input" maxlength="200" :disabled="busy" :placeholder="$t('Tên tác giả hoặc tổ chức biên soạn')" /></div>
          <div class="field book-source-citation"><label for="book-citation">{{ $t("Nguồn tài liệu") }}</label><input id="book-citation" v-model="sourceCitation" class="input" maxlength="500" :disabled="busy" :placeholder="$t('Nhà xuất bản, phiên bản, năm xuất bản hoặc đường dẫn nguồn')" /></div>
        </div>
        <p class="text-muted">{{ $t("Kiểm tra lại tên sách gợi ý từ tên file. Tác giả và nguồn chưa biết có thể để trống; hệ thống sẽ ghi “Chưa cung cấp”, không tự suy đoán.") }}</p>
        <div class="field book-text-field"><label for="book-source">{{ $t("Hoặc dán nội dung sách") }}</label><textarea id="book-source" ref="sourceInput" v-model="fullText" class="editor-textarea" :disabled="busy" :placeholder="$t('Dán nội dung hoặc chỉnh sửa tài liệu đã đọc…')" /><p class="text-muted">{{ fullText.length.toLocaleString($locale) }} {{ $t("/ 1.000.000 ký tự · Nội dung nguồn càng đầy đủ, bản tóm tắt càng có giá trị.") }}</p></div>
      </section>
      <button v-if="connectionMessage" class="btn small" type="button" @click="poll"><UiIcon name="refresh" />{{ $t("Kết nối lại") }}</button>
      <section v-if="creating && !selected" class="panel book-submitting" aria-live="polite"><span class="spinner" aria-hidden="true"></span><h2>{{ $t('Đang gửi yêu cầu…') }}</h2><p class="text-muted">{{ $t('Đang chuẩn bị không gian duyệt bản tóm tắt.') }}</p></section>
      <section v-if="selected" class="panel" aria-labelledby="book-progress-title">
        <div class="panel-heading"><h2 id="book-progress-title"><UiIcon name="spark" />{{ selected.title }}</h2><span class="pill" :class="{ green: selected.status === 'completed', purple: active(selected) }">{{ $t(statusLabel(selected)) }}</span></div>
        <div class="result-meta"><span class="pill">{{ $t("Mục tiêu") }} {{ selected.target_minutes }} {{ $t("phút") }}</span><span v-if="selected.selected_voice?.origin" class="pill">{{ $t(selected.selected_voice.origin==='user'?'Giọng của bạn':'Giọng hệ thống') }}</span><span class="text-muted">{{ formatDate(selected.createdAt) }}</span></div>
        <p v-if="selected.selected_voice?.name || selected.result?.voice" class="text-muted">{{ $t("Giọng sử dụng:") }} <strong>{{ selected.selected_voice?.name || selected.result.voice }}</strong></p>
        <BookAttribution :metadata="selected.result?.book_metadata || selected.book_metadata" :fallback-title="selected.title" />
        <p v-if="selected.result?.verification_method==='user'" class="text-muted">{{ $t('Người dùng tự duyệt') }}</p>
        <template v-if="active(selected)">
          <div class="book-progress" role="progressbar" :aria-valuenow="selected.progress.percent" aria-valuemin="0" aria-valuemax="100" :aria-label="$t(selected.progress.message)"><span :style="{ width: selected.progress.percent + '%' }"></span></div>
          <div class="book-progress-caption"><strong>{{ selected.progress.percent }}%</strong><span>{{ $t(selected.progress.message) }}</span></div>
          <div v-if="selected.status === 'queued' && selected.next_attempt_at" class="notice" role="status">
            <UiIcon name="clock" /><div><strong>{{ retrySeconds > 0 ? $t('Tự tiếp tục sau khoảng {0} giây', [retrySeconds]) : $t('Đã đến giờ thử lại, đang chờ worker tiếp tục.') }}</strong>
              <p>{{ $t('Thời điểm thử lại: {0}', [formatDate(selected.next_attempt_at)]) }}</p><p>{{ $t('Tiến độ đã lưu. Bạn không cần bấm thử lại hoặc giữ trang này mở.') }}</p></div>
          </div>
          <ol class="book-stages"><li v-for="(step, i) in steps" :key="step.label" :class="{ done: phaseIndex > i, current: phaseIndex === i }"><span>{{ phaseIndex > i ? '✓' : i + 1 }}</span>{{ $t(step.label) }}</li></ol>
          <p class="text-muted">{{ $t("Tiến độ được lưu theo từng phần. Tải lại hoặc rời trang không hủy yêu cầu.") }}</p>
          <p v-if="selected.cancel_requested" class="notice">{{ $t("Đang chờ bước hiện tại kết thúc để hủy.") }}</p>
        </template>
        <BookDraftEditor v-if="selected.status === 'review' && selected.draft?.sections" ref="draftEditor" :key="selected._id" :job="selected" :busy="submitting" simple-controls speech-target="#book-speech-settings" @updated="updateReviewedJob" @reload="selectJob(selected)" @duration-issue="handleDraftDurationIssue" />
        <div v-if="selected.status === 'review' && sourceDurationIssue" class="notice book-source-duration"><span>{{ $t('Nguồn quá ngắn cho thời lượng đã chọn. Hãy chọn lại thời lượng hoặc thêm nội dung nguồn rồi gửi yêu cầu mới.') }}</span><button type="button" class="btn small" :disabled="navigationLocked" @click="startNewSummary(sourceDurationIssue.max_minutes)">{{ $t('Tạo tóm tắt mới') }}</button></div>
        <p v-if="selected.status === 'review'" class="text-muted">{{ $t('Bản nháp được lưu trên máy chủ. Bạn có thể rời trang và quay lại để duyệt.') }}</p>
        <template v-if="selected.status === 'failed'">
          <button type="button" class="text-button" @click="notify(selected.error, { kind: 'error' })">{{ $t('Xem thông báo lỗi') }}</button>
          <template v-if="selected.source_duration_issue"><p class="notice error">{{ $t('Nguồn quá ngắn cho thời lượng đã chọn. Hãy chọn lại thời lượng hoặc thêm nội dung nguồn rồi gửi yêu cầu mới.') }}</p><button type="button" class="btn" :disabled="navigationLocked" @click="startNewSummary(selected.source_duration_issue.max_minutes)">{{ $t('Tạo tóm tắt mới') }}</button></template>
          <template v-else><p v-if="selected.retry_state?.provider === 'gemini'" class="text-muted">{{ $t('Mã lỗi: {0} · HTTP: {1} · Bước: {2}', [selected.retry_state.code, selected.retry_state.http_status || '—', selected.retry_state.provider_stage]) }}</p><p class="text-muted">{{ $t("Các phần đã xử lý được giữ lại. Thử lại sẽ tiếp tục từ điểm đã lưu.") }}</p><div class="result-meta"><button type="button" class="btn primary" :disabled="submitting" @click="jobAction('retry')"><UiIcon name="refresh" />{{ $t("Tiếp tục từ phần lỗi") }}</button><button v-if="selected.workflow_version === 'review-v1' && selected.draft" type="button" class="btn" :disabled="submitting" @click="jobAction('review')">{{ $t('Quay lại chỉnh bản tóm tắt') }}</button></div></template>
        </template>
        <p v-if="selected.status === 'cancelled'" class="text-muted">{{ $t("Yêu cầu đã hủy. Bạn có thể gửi yêu cầu mới với thời lượng khác.") }}</p>
        <div v-if="selected.status !== 'completed' && selected.progress?.phase !== 'publishing'" class="book-discard-action">
          <button type="button" class="btn small danger" :disabled="submitting" @click="removeJob"><UiIcon name="close" />{{ ['failed', 'cancelled'].includes(selected.status) ? $t('Xóa yêu cầu') : $t('Hủy và xóa yêu cầu') }}</button>
          <small class="text-muted">{{ $t('Xóa khỏi danh sách gần đây và dọn bản nháp, file tạm. Không thể tiếp tục yêu cầu sau khi xóa.') }}</small>
        </div>
        <template v-if="selected.result">
          <div class="book-result-time"><UiIcon name="headphones" /><div><strong>{{ formatDuration(selected.result.duration_seconds) }}</strong><span>{{ $t("Thời lượng thực tế · mục tiêu") }} {{ selected.target_minutes }} {{ $t("phút") }}</span></div></div>
          <div class="result-meta"><span class="pill purple">{{ selected.result.voice }}</span><span class="pill">{{ selected.result.genre }}</span></div>
          <p class="text-muted">{{ selected.result.reason }}</p><p v-if="selected.result.warning" class="notice">{{ $t(selected.result.warning) }}</p>
          <audio controls preload="none" :src="selected.result.audio_url" class="audio-player" :aria-label="$t('Sách nói đã tạo')"></audio>
          <SubtitleDownload v-if="selected.result.subtitle_url" :endpoint="`/api/book-jobs/${selected._id}/subtitles`" />
          <p v-if="selected.result.subtitle_url" class="text-muted">{{ $t('Mốc câu trong phụ đề là ước lượng theo đoạn âm thanh đo được.') }}</p>
          <router-link to="/history" class="btn small book-history-link">{{ $t("Mở trong thư viện") }}<UiIcon name="arrow" /></router-link>
          <details class="book-script"><summary>{{ $t("Xem kịch bản sách nói") }}</summary><p class="summary-content">{{ selected.result.summary }}</p></details>
          <SummaryDownload v-if="selected.result.summary" :title="selected.title" :metadata="selected.result.book_metadata || selected.book_metadata" :text="selected.result.summary" />
        </template>
      </section>
    </div>
    <aside class="studio-stack">
      <section v-if="!workspace" class="panel">
        <div class="panel-heading"><h2><UiIcon name="clock" />{{ $t("Thời lượng") }}</h2></div>
        <fieldset class="book-duration"><legend class="sr-only">{{ $t("Thời lượng mục tiêu") }}</legend><label v-for="minutes in [10, 20, 30]" :key="minutes" :class="{ chosen: targetMinutes === minutes }"><input v-model="targetMinutes" type="radio" name="duration" :value="minutes" :disabled="busy" /><strong>{{ minutes }}</strong><span>{{ $t("phút") }}</span></label></fieldset>
        <div class="field book-custom-duration">
          <label for="book-custom-minutes">{{ $t("Tùy chọn (phút)") }}</label>
        <input id="book-custom-minutes" ref="durationInput" v-model.number="targetMinutes" type="number" min="1" max="59" step="1" inputmode="numeric" class="input" :disabled="busy" :aria-invalid="!validDuration || Boolean(sourceDurationIssue)" aria-describedby="book-duration-help" />
          <small id="book-duration-help" :class="{ 'duration-error': !validDuration }" :role="!validDuration ? 'alert' : undefined">{{ validDuration ? $t("1–59 phút · Thời lượng ước tính") : $t("Vui lòng nhập số nguyên từ 1 đến 59. Không nhận 0, 60 hoặc số lẻ.") }}</small>
        </div>
        <div v-if="sourceDurationIssue" class="book-source-duration" role="alert"><small>{{ sourceDurationIssue.max_minutes ? $t('Nguồn hiện tại gợi ý tối đa khoảng {0} phút.',[sourceDurationIssue.max_minutes]) : $t('Hãy bổ sung nội dung nguồn để tạo bản tóm tắt từ 1 phút.') }}</small><small>{{ $t('Sau khi điều chỉnh, bấm Tạo bản tóm tắt để gửi yêu cầu mới.') }}</small><button v-if="sourceDurationIssue.max_minutes" type="button" class="btn small" :disabled="busy" @click="useSuggestedDuration">{{ $t('Chọn {0} phút',[sourceDurationIssue.max_minutes]) }}</button><button v-else type="button" class="btn small" :disabled="busy" @click="focusSource">{{ $t('Bổ sung nội dung') }}</button></div>
        <div class="book-voice-settings">
          <div class="field"><label for="book-tts-provider">{{ $t('Bộ tạo giọng') }}</label><select id="book-tts-provider" v-model="ttsProvider" class="input" :disabled="busy || loadingVoices"><option value="vieneu">VieNeu-TTS</option><option value="edge">Edge-TTS + OpenVoice</option></select></div>
          <div class="field book-voice-choice">
            <label>{{ $t('Chọn giọng đọc') }} <span aria-hidden="true">*</span></label>
            <VoicePicker v-model="selectedVoiceId" :voices="availableVoices" :provider="ttsProvider" :loading="loadingVoices" :disabled="busy||!!voiceError" @refresh="fetchVoiceChoices" />
            <p v-if="voiceError" class="text-muted">{{ $t('Chưa tải được danh sách giọng. Hãy thử tải lại.') }}</p>
            <small v-else-if="!loadingVoices && !availableVoices.length">{{ $t("Chưa có giọng mẫu được phép dùng. Hãy thêm giọng hoặc chọn loại giọng tiêu chuẩn.") }}</small>
            <button type="button" class="text-button book-refresh-voices" :disabled="busy || loadingVoices" :aria-label="$t('Tải lại danh sách giọng')" @click="fetchVoiceChoices"><UiIcon name="refresh" />{{ $t("Tải lại") }}</button>
          </div>
        </div>
        <SpeechRateControl v-model="ratePercent" :disabled="busy" :hint="$t('Có thể đổi tốc độ sau khi có bản tóm tắt, trước khi tạo âm thanh.')" class="book-new-rate" />
        <details class="book-settings-help"><summary>{{ $t('Lưu ý khi tạo') }}</summary><p>{{ $t('Xem lại bản tóm tắt trước khi tạo âm thanh. Nguồn ngắn có thể cho thời lượng ngắn hơn.') }}</p><p>{{ $t('Để đổi giọng đã gửi, hãy tạo yêu cầu mới.') }}</p></details>
        <div class="settings-actions"><button type="button" class="btn primary full" :disabled="busy || !validDuration || !chosenVoice || loadingVoices || !!voiceError || !fullText.trim()" @click="processBook"><span v-if="submitting" class="spinner" aria-hidden="true"></span><UiIcon v-else name="spark" />{{ submitting ? $t("Đang gửi…") : $t('Tạo bản tóm tắt') }}</button></div>
        <p v-if="workerOnline === false" class="notice">{{ $t("Worker đang tắt. Yêu cầu sẽ chờ xử lý.") }}</p>

      </section>
      <section v-else class="panel book-review-settings" aria-labelledby="book-review-settings-title">
        <div class="panel-heading"><h2 id="book-review-settings-title"><UiIcon name="headphones" />{{ $t('Duyệt & âm thanh') }}</h2></div>
        <div class="book-locked-config">
          <strong>{{ selected?.title || bookTitle }}</strong>
          <span>{{ selected?.target_minutes || targetMinutes }} {{ $t('phút') }} · {{ (selected?.selected_voice?.provider || ttsProvider) === 'vieneu' ? 'VieNeu-TTS' : 'Edge + OpenVoice' }}</span>
          <span>{{ selected?.selected_voice?.name || chosenVoice?.name }}</span>
        </div>
        <div id="book-speech-settings" />
        <p v-if="selected?.status === 'review'" class="book-review-hint">{{ $t('Chỉnh nội dung, nghe thử rồi duyệt tạo âm thanh.') }}</p>
        <p v-else-if="creating || active(selected)" class="book-review-hint" role="status">{{ $t('Đang xử lý. Bạn có thể chỉnh tốc độ khi bản tóm tắt sẵn sàng.') }}</p>
        <div class="settings-actions"><button type="button" class="btn full" :disabled="navigationLocked" @click="startNewSummary()"><UiIcon name="plus" />{{ $t('Tạo tóm tắt mới') }}</button><small>{{ $t('Yêu cầu hiện tại vẫn được lưu trong danh sách gần đây.') }}</small></div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2><UiIcon name="history" />{{ $t("Yêu cầu gần đây") }}</h2><span class="pill">{{ jobs.length }}</span></div>
        <p v-if="!jobs.length" class="text-muted">{{ $t("Các yêu cầu sẽ xuất hiện ở đây để bạn theo dõi và mở lại.") }}</p>
        <div v-else class="book-job-list"><button v-for="job in jobs" :key="job._id" type="button" class="book-job" :disabled="navigationLocked" :class="{ selected: selected?._id === job._id }" @click="selectJob(job)"><span><strong>{{ job.title }}</strong><small>{{ job.target_minutes }} {{ $t("phút ·") }} {{ formatDate(job.createdAt) }}</small></span><span class="pill" :class="{ green: job.status === 'completed' }">{{ $t(statusLabel(job)) }}</span></button></div>
      </section>
      <details class="panel book-settings-help"><summary>{{ $t('Về bản tóm tắt AI') }}</summary><p>{{ $t('AI diễn đạt lại ý chính. Hãy đối chiếu nguồn; ghi nguồn không thay thế quyền sử dụng.') }}</p></details>
    </aside>
  </div>
</template>

<style scoped>
.book-file-feedback { margin-top: 16px; overflow-wrap: anywhere; }
.book-submitting { text-align:center;padding:48px 24px; }
.book-submitting h2 { font-size:19px; }
.book-locked-config { display:grid;gap:7px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-raised);font-size:12px;line-height:1.6;overflow-wrap:anywhere; }
.book-locked-config strong { font-size:14px; }
.book-locked-config span { color:var(--muted); }
.book-review-hint,.book-review-settings .settings-actions>small { display:block;color:var(--muted);font-size:12px;line-height:1.7; }
.book-review-hint { margin:16px 0 0; }
.book-review-settings .settings-actions>small { margin-top:10px; }
.book-custom-duration { display:grid;grid-template-columns:minmax(0,1fr) 92px;align-items:center;gap:6px 12px;margin-bottom:20px; }
.book-custom-duration label { margin:0;font-size:12px; }
.book-custom-duration .input { min-height:38px;padding:7px 10px; }
.book-custom-duration small { grid-column:1 / -1;font-size:11px; }
.book-new-rate { margin:20px 0; }
.book-source-duration { display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:12px;margin:-8px 0 18px;border:1px solid var(--danger-line);border-radius:10px;background:var(--danger-bg);color:var(--danger);line-height:1.6; }
.book-custom-duration .duration-error { color: var(--danger); }
.book-voice-settings { display:grid;gap:20px; }
.book-voice-choice { margin-top:0; }
.book-discard-action { display: flex; align-items: flex-start; flex-direction: column; gap: 10px; margin-top: 20px; }
.book-refresh-voices { font-size:12px; }
.book-settings-help { color:var(--muted);font-size:12px;line-height:1.7; }
.book-settings-help summary { cursor:pointer;font-weight:600; }
.book-settings-help p { margin:10px 0 0; }
</style>
