<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import api from '@/services/api';
import UiIcon from './UiIcon.vue';
import SpeechTools from './SpeechTools.vue';
import SummaryDownload from './SummaryDownload.vue';
import { notify, useFeedback, confirmAction } from '@/composables/useNotifications';
import { translate } from '@/composables/useLocale';
import { expressionCues, countCues, stripCues } from '@/services/expressions';
const props = defineProps({ job: { type: Object, required: true }, busy: Boolean, speechTarget: { type: String, default: '' }, simpleControls: Boolean });
const emit = defineEmits(['updated', 'reload', 'duration-issue']);
const texts = ref([]);
const sectionInputs = [], activeSection = ref(0);
const isVieNeu = computed(() => props.job.selected_voice?.provider === 'vieneu');
const cuesEnabled = computed(() => isVieNeu.value && speechOptions.value.experimental_cues === true);
const cueCount = computed(() => texts.value.reduce((sum,text)=>sum+countCues(text),0));
const speechOptions=ref({version:'speech-v1',profile:'auto',normalize:false,dictionary:[],rate_percent:0});
const deliveries=ref([]),speechTools=ref(null);
const instruction = ref('');
const scope = ref(-1);
const working = ref('');
const selfApprove = ref(false);
const error = useFeedback('error', { action: { label: 'Tải lại bản mới', run: () => emit('reload') } });
const feedback = useFeedback('success');
watch(() => [props.job._id, props.job.draft_revision], () => {
  texts.value = props.job.draft.sections.map(section => section.delivery?.markup ?? section.text);
  speechOptions.value=structuredClone(props.job.draft.speech ? {...JSON.parse(JSON.stringify(props.job.draft.speech)),rate_percent:props.job.draft.speech.rate_percent??0} : {version:'speech-v1',profile:'auto',normalize:false,dictionary:[],rate_percent:0});
  // Expressions are paused in the simplified book workflow. Retain old markup
  // positions, but save the disabled setting before preview or full synthesis.
  if (props.simpleControls) delete speechOptions.value.experimental_cues;
  deliveries.value=props.job.draft.sections.map(section=>({profile:section.delivery?.profile||'auto',paragraph_profiles:[...(section.delivery?.paragraph_profiles||[])]}));
  error.value = ''; feedback.value = '';
  selfApprove.value=false;
}, { immediate: true });
const textDirty=computed(()=>texts.value.some((text,i)=>text!==(props.job.draft.sections[i]?.delivery?.markup??props.job.draft.sections[i]?.text)));
const canSelfApprove=computed(()=>props.job.draft.user_edited || textDirty.value);
const previewPending=computed(()=>props.job.draft.preview_request?.status==='processing');
watch(()=>props.job.draft.preview_request?.status,(status,previous)=>{
  if(previous!=='processing')return;
  if(status==='ready')notify('Đoạn nghe thử đã sẵn sàng.',{kind:'success',key:`book-preview-${props.job._id}`});
  if(status==='failed')error.value=props.job.draft.preview_request.error;
});
const dirty = computed(() => texts.value.some((text, i) => text !== (props.job.draft.sections[i]?.delivery?.markup ?? props.job.draft.sections[i]?.text))
 || JSON.stringify(speechOptions.value)!==JSON.stringify(props.job.draft.speech||{version:'speech-v1',profile:'auto',normalize:false,dictionary:[],rate_percent:0})
 || JSON.stringify(deliveries.value)!==JSON.stringify(props.job.draft.sections.map(section=>({profile:section.delivery?.profile||'auto',paragraph_profiles:section.delivery?.paragraph_profiles||[]}))));
const locked = computed(() => props.busy || Boolean(working.value) || previewPending.value);
const units = text => stripCues(text).split(/\s+/u).filter(Boolean).length;
const estimatedSeconds = computed(() => speechTools.value?.estimatedSeconds ?? Math.round((units(props.job.draft.introduction || '') + texts.value.reduce((sum, text) => sum + units(text), 0))
  * 60 / (props.job.draft.reading_rate ? props.job.draft.reading_rate.units_per_minute * (1 + (speechOptions.value.rate_percent ?? 0) / 100) : props.job.draft.units_per_minute || 300) + texts.value.reduce((sum, text) => sum + text.split(/\n\s*\n/u).filter(Boolean).length, 0) * .45));
const durationMismatch = computed(() => Math.abs(estimatedSeconds.value - props.job.target_minutes * 60) > props.job.target_minutes * 60 * .15);
const valid = computed(() => texts.value.every(text => stripCues(text).trim() && text.length <= 16000) && texts.value.reduce((sum, text) => sum + text.length, 0) <= 280000 && (!cuesEnabled.value || cueCount.value <= 20));
function toggleCues(enabled) {
  const { experimental_cues, ...rest } = speechOptions.value;
  speechOptions.value = enabled ? {...rest,experimental_cues:true} : rest;
}
function removeCues() { texts.value=texts.value.map(stripCues);toggleCues(false); }
async function insertCue(tag) {
  if (locked.value || !cuesEnabled.value || cueCount.value>=20) return;
  const index=Math.min(activeSection.value,texts.value.length-1), input=sectionInputs[index];
  const text=texts.value[index], position=input?.selectionEnd ?? text.length;
  const before=text.slice(0,position), after=text.slice(position);
  const inserted=(before&&!/\s$/u.test(before)?' ':'')+tag+(after&&!/^[\s.,!?;:]/u.test(after)?' ':'');
  if (text.length+inserted.length>16000) { notify('Mục này đã đạt giới hạn ký tự.',{kind:'error'});return; }
  texts.value[index]=before+inserted+after;
  await nextTick();input?.focus();input?.setSelectionRange(position+inserted.length,position+inserted.length);
}
const time = value => `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
async function persist() {
  if (!dirty.value && props.job.draft.speech) return props.job;
  const { data } = await api.patch(`/api/book-jobs/${props.job._id}/draft`, { revision: props.job.draft_revision, sections: texts.value,
    speech:speechOptions.value,deliveries:deliveries.value }, { timeout: 20000 });
  emit('updated', data);
  return data;
}
async function run(action) {
  if (locked.value || !valid.value) return;
  working.value = action; error.value = ''; feedback.value = '';
  const requestedSelfApproval=action==='audio' && selfApprove.value && canSelfApprove.value;
  try {
    const job = await persist();
    if (action === 'save') { feedback.value = 'Đã lưu chỉnh sửa.'; return; }
    const body = { revision: job.draft_revision };
    if(action==='audio')body.self_approve=Boolean(requestedSelfApproval && job.draft.user_edited);
    if (['preview','audio'].includes(action)) {
      // Build from the exact saved revision; UI readiness is not an admission gate.
      const {data:plan}=await api.post('/api/speech/plan',{introduction:job.draft.introduction||'',
        sections:job.draft.sections,speech:job.draft.speech||speechOptions.value,style:job.draft.style,
        units_per_minute:job.draft.reading_rate?.units_per_minute||300,provider:job.selected_voice?.provider||'edge'},{timeout:20000});
      if(action==='audio' && plan.estimated_seconds>=3600)throw new Error('Bản tóm tắt dự kiến đạt 1 giờ. Hãy rút gọn trước khi tạo âm thanh.');
      body.speech_plan_hash=plan.hash;
      if (action === 'audio') {
        const mismatch = Math.abs(plan.estimated_seconds - job.target_minutes * 60) > job.target_minutes * 60 * .15;
        const message = mismatch
          ? translate('Mục tiêu {0} phút, nhưng bản hiện tại dự kiến {1}. Bạn vẫn muốn tạo âm thanh với độ dài này?', [job.target_minutes,time(plan.estimated_seconds)])
            + (requestedSelfApproval ? ' ' + translate('Bản này sẽ được ghi là người dùng tự duyệt.') : '')
          : requestedSelfApproval
            ? 'Bạn tự duyệt nội dung đã sửa và muốn tạo âm thanh mà không đối chiếu AI lại? Bản này sẽ được ghi là người dùng tự duyệt.'
            : 'Bạn đã kiểm tra bản tóm tắt và muốn tạo toàn bộ âm thanh bằng giọng đã chọn?';
        if (!await confirmAction(message, { title:'Duyệt và tạo âm thanh', confirmLabel:'Tạo âm thanh' })) return;
        body.accept_duration_mismatch = mismatch;
      }
    }
    if (action === 'revise') { body.instruction = instruction.value.trim(); body.section_index = scope.value < 0 ? null : scope.value; }
    if (action === 'fit') {
      body.instruction = `Căn toàn bộ bản tóm tắt để đọc gần ${job.target_minutes} phút ở tốc độ đã chọn. Bổ sung giải thích các ý chính được nguồn chứng minh khi thiếu độ dài, rút gọn khi quá dài. Giữ đúng nguồn; không bịa, lặp ý hoặc tái hiện chi tiết để đủ thời lượng.`;
      body.section_index = null;
      body.fit_duration = true;
    }
    const { data } = await api.post(`/api/book-jobs/${job._id}/${action==='fit'?'revise':action}`, body, { timeout: 20000 });
    emit('updated', data);
    notify(['revise','fit'].includes(action) ? 'Đã gửi yêu cầu AI chỉnh nội dung.' : action === 'preview' ? (data.draft?.preview_request?.status==='ready'?'Đoạn nghe thử đã sẵn sàng.':'Đang tạo nghe thử riêng, không chờ hàng đợi sách.') : 'Đã duyệt bản tóm tắt và gửi yêu cầu tạo âm thanh.', { kind: 'success' });
  } catch (failure) {
    if (failure.response?.data?.code === 'SOURCE_TOO_SHORT') {
      emit('duration-issue', failure.response.data.duration_issue);
      error.value = 'Nguồn quá ngắn cho thời lượng đã chọn. Hãy chọn lại thời lượng hoặc thêm nội dung nguồn rồi gửi yêu cầu mới.';
    } else error.value = failure.response?.data?.error || (failure.message==='Bản tóm tắt dự kiến đạt 1 giờ. Hãy rút gọn trước khi tạo âm thanh.'?failure.message:'Không lưu được bản tóm tắt. Hãy thử lại.');
  }
  finally { working.value = ''; }
}
const ratePercent=computed(()=>speechOptions.value.rate_percent??0);
defineExpose({ dirty, ratePercent, working });
</script>

<template>
  <section class="draft-editor" aria-labelledby="draft-editor-title">
    <div class="draft-heading">
      <div><h3 id="draft-editor-title">{{ $t('Duyệt bản tóm tắt') }}</h3><p class="text-muted">{{ $t('Đọc lại, chỉnh trực tiếp hoặc yêu cầu AI sửa. Chỉ tạo toàn bộ âm thanh khi bạn duyệt nội dung.') }}</p></div>
      <span class="pill" :class="{ green: job.draft.verified_hash && !textDirty }">{{ job.draft.verification_method==='user' && !textDirty ? $t('Người dùng tự duyệt') : job.draft.verified_hash && !textDirty ? $t('Đã đối chiếu nguồn bằng AI') : $t('Cần đối chiếu sau chỉnh sửa') }}</span>
    </div>
    <SummaryDownload :title="job.title" :metadata="job.book_metadata" :introduction="job.draft.introduction || ''" :sections="job.draft.sections.map((section, i) => ({title: section.title, text: texts[i] ?? section.text}))" />
    <small class="text-muted">{{ $t('File tải xuống gồm nội dung đang chỉnh sửa, kể cả phần chưa lưu.') }}</small>
    <p class="notice">{{ $t('Thời lượng dự kiến: {0}. Bao gồm lời giới thiệu và khoảng nghỉ; thời lượng thực tế có thể khác.', [time(estimatedSeconds)]) }}</p>
    <div v-if="durationMismatch" class="notice draft-duration-warning"><span>{{ $t('Mục tiêu {0} phút · bản hiện tại dự kiến {1}. Căn lại độ dài hoặc chấp nhận thời lượng này khi duyệt.', [job.target_minutes,time(estimatedSeconds)]) }}</span><button type="button" class="btn small" :disabled="locked || !valid" @click="run('fit')"><UiIcon name="clock" />{{ $t('Căn lại thời lượng') }}</button></div>
    <p v-if="job.draft.warning" class="text-muted">{{ $t(job.draft.warning) }}</p>
    <details v-if="job.draft.verification_notes?.length" class="draft-findings" open>
      <summary>{{ $t('Những điểm cần xem lại') }}</summary><ul><li v-for="(note, i) in job.draft.verification_notes" :key="i">{{ note }}</li></ul>
    </details>
    <details class="draft-intro"><summary>{{ $t('Lời giới thiệu được thêm vào âm thanh') }}</summary><p>{{ job.draft.introduction }}</p></details>
    <div v-if="isVieNeu && !simpleControls" class="draft-expressions">
      <label class="expression-toggle"><input type="checkbox" :checked="cuesEnabled" :disabled="locked" @change="toggleCues($event.target.checked)" /><strong>{{ $t('Biểu cảm thử nghiệm') }}</strong><span class="pill">{{ cueCount }}/20</span></label>
      <p>{{ $t('Chọn vị trí trong ô nội dung rồi bấm thẻ. Hiệu quả tùy giọng; hãy nghe thử trước.') }}</p>
      <div class="expression-buttons"><button v-for="cue in expressionCues" :key="cue.tag" type="button" class="btn small" :disabled="locked || !cuesEnabled || cueCount>=20" :aria-label="$t('Chèn thẻ {0}',[$t(cue.label)])" @mousedown.prevent @click="insertCue(cue.tag)">{{ $t(cue.label) }}</button><small>{{ $t('Mục {0}',[Math.min(activeSection,texts.length-1)+1]) }}</small><button v-if="cueCount" type="button" class="text-button" :disabled="locked" @click="removeCues">{{ $t('Gỡ hết thẻ') }}</button></div>
      <small>{{ $t('Tắt tùy chọn để đọc bình thường. Các thẻ được giữ lại nhưng không phát âm; thẻ không xuất hiện trong phụ đề.') }}</small>
    </div>
    <div v-for="(section, i) in job.draft.sections" :key="`${job._id}-${i}`" class="field draft-section">
      <label :for="`draft-section-${i}`">{{ i + 1 }}. {{ section.title }}</label>
      <textarea :id="`draft-section-${i}`" :ref="element=>sectionInputs[i]=element" v-model="texts[i]" class="input draft-text" :disabled="locked" maxlength="16000" :aria-label="$t('Nội dung mục {0}', [i + 1])" @focus="activeSection=i" />
      <small>{{ $t('Phần nguồn tham chiếu: {0}', [(section.source_ids || []).map(id => id + 1).join(', ')]) }}</small>
    </div>
    <Teleport :to="speechTarget || 'body'" :disabled="!speechTarget" defer>
      <SpeechTools ref="speechTools" v-model="speechOptions" v-model:deliveries="deliveries" :compact="!!speechTarget" :speed-only="simpleControls" :sections="texts.map((text,i)=>({text,title:job.draft.sections[i]?.title}))" :introduction="job.draft.introduction || ''" :style="job.draft.style" :provider="job.selected_voice?.provider||'edge'" :units-per-minute="job.draft.reading_rate?.units_per_minute || 300" :busy="locked" :rate-hint="$t('Có thể đổi tốc độ sau khi có bản tóm tắt, trước khi tạo âm thanh.')" auto-review />
    </Teleport>
    <p v-if="dirty" class="text-muted" role="status">{{ $t('Có chỉnh sửa chưa lưu. Các nút AI, nghe thử và tạo âm thanh sẽ lưu nội dung trước khi tiếp tục.') }}</p>
    <div class="draft-actions"><button type="button" class="btn small" :disabled="locked || !dirty || !valid" @click="run('save')">{{ $t('Lưu chỉnh sửa') }}</button></div>
    <fieldset class="draft-ai" :disabled="locked">
      <legend>{{ $t('Nhờ AI chỉnh nội dung') }}</legend>
      <div class="field"><label for="draft-ai-scope">{{ $t('Phạm vi chỉnh sửa') }}</label><select id="draft-ai-scope" v-model.number="scope" class="input"><option :value="-1">{{ $t('Toàn bộ bản tóm tắt') }}</option><option v-for="(section, i) in job.draft.sections" :key="i" :value="i">{{ i + 1 }}. {{ section.title }}</option></select></div>
      <div class="field"><label for="draft-ai-instruction">{{ $t('Bạn muốn thay đổi điều gì?') }}</label><textarea id="draft-ai-instruction" v-model="instruction" class="input draft-instruction" maxlength="2000" :placeholder="$t('Ví dụ: viết dễ hiểu hơn, làm rõ quan hệ giữa các nhân vật, sửa phần chưa đúng với sách…')" /></div>
      <button type="button" class="btn small" :disabled="locked || !valid || instruction.trim().length < 5" @click="run('revise')"><UiIcon name="spark" />{{ $t('Yêu cầu AI chỉnh') }}</button>
    </fieldset>
    <button v-if="error" type="button" class="text-button" :disabled="locked" @click="emit('reload')">{{ $t('Tải lại bản mới') }}</button>
    <p v-if="estimatedSeconds >= 3600" class="notice error">{{ $t('Bản tóm tắt dự kiến đạt 1 giờ. Hãy rút gọn trước khi tạo âm thanh.') }}</p>
    <label v-if="canSelfApprove" class="draft-self-approve"><input v-model="selfApprove" type="checkbox" :disabled="locked" /><span>{{ $t('Tôi tự duyệt nội dung đã sửa, bỏ qua đối chiếu AI lại.') }}<small>{{ $t('Bản này sẽ được ghi là người dùng tự duyệt.') }}</small></span></label>
    <div class="draft-actions">
      <button type="button" class="btn" :disabled="locked || !valid" @click="run('preview')"><UiIcon name="headphones" />{{ $t('Nghe thử tối đa 30 giây') }}</button>
      <button type="button" class="btn primary" :disabled="locked || !valid || estimatedSeconds >= 3600" @click="run('audio')"><UiIcon name="check" />{{ $t('Duyệt và tạo âm thanh') }}</button>
    </div>
    <p v-if="working" class="text-muted" role="status">{{ $t('Đang lưu và gửi yêu cầu…') }}</p>
    <p v-if="previewPending" class="notice" role="status">{{ $t('Đang tạo nghe thử riêng, không chờ hàng đợi sách.') }}</p>
    <p v-else-if="job.draft.preview_request?.status==='failed'" class="text-muted">{{ $t(job.draft.preview_request.error) }}</p>
    <div v-if="job.draft.preview?.audio_url && !dirty" class="draft-preview"><p class="text-muted">{{ $t('Đoạn nghe thử · {0} · đúng giọng đã chọn', [time(Math.round(job.draft.preview.duration_seconds))]) }}</p><audio :key="job.draft.preview.audio_url" controls preload="none" :src="job.draft.preview.audio_url" class="audio-player" :aria-label="$t('Đoạn nghe thử sách nói')" /></div>
    <p class="text-muted draft-footnote">{{ $t('AI đối chiếu với các đoạn nguồn liên quan để hỗ trợ phát hiện sai sót. Bạn vẫn nên đọc lại bản tóm tắt trước khi duyệt.') }}</p>
  </section>
</template>

<style scoped>
.draft-editor { margin-top: 24px; border-top: 1px solid var(--line); padding-top: 24px; }
.draft-heading { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 12px; align-items: start; }
.draft-heading h3 { margin: 0; font-size: 19px; }
.draft-heading p { max-width: 650px; }
.draft-section { margin-top: 24px; }
.draft-text { min-height: 230px; resize: vertical; line-height: 1.85; }
.draft-instruction { min-height: 100px; resize: vertical; }
.draft-ai { margin: 24px 0; padding: 20px; border: 1px solid var(--line); border-radius: 14px; background: var(--surface-raised); }
.draft-ai legend { padding: 0 8px; font-weight: 600; }
.draft-ai .field { margin-bottom: 16px; }
.draft-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 16px; }
.draft-findings { padding: 16px; background: var(--warning-bg); border-radius: 12px; margin: 16px 0; color: var(--warning); }
.draft-findings ul { padding-left: 22px; line-height: 1.7; }
.draft-intro { margin: 16px 0; color: var(--muted); line-height: 1.8; }
.draft-preview { margin-top: 20px; }
.draft-footnote { margin-top: 20px; }
.draft-expressions { padding:16px;border:1px solid var(--accent-line);border-radius:12px;background:var(--accent-soft);margin:20px 0; }
.expression-toggle,.expression-buttons { display:flex;align-items:center;gap:9px;flex-wrap:wrap; }
.expression-toggle input { accent-color:var(--accent); }
.draft-expressions p,.draft-expressions>small { font-size:12px;color:var(--text-body);line-height:1.7; }
.expression-buttons { margin:10px 0; }
.expression-buttons small { color:var(--muted); }
.expression-buttons .text-button { font-size:11px;margin-left:auto; }
.draft-duration-warning { display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;background:var(--warning-bg);color:var(--warning); }
.draft-self-approve { display:flex; align-items:flex-start; gap:10px; margin-top:20px; line-height:1.6; }
.draft-self-approve input { margin-top:6px; accent-color:var(--accent); }
.draft-self-approve small { display:block; color:var(--muted); font-weight:normal; }
@media (max-width: 600px) { .draft-actions > .btn { width: 100%; } .draft-ai { padding: 14px; } }
</style>
