<script setup>
import { computed, ref, watch, onBeforeUnmount } from 'vue';
import api from '@/services/api';
import UiIcon from './UiIcon.vue';
import SpeechRateControl from './SpeechRateControl.vue';
const props=defineProps({ sections:{type:Array,required:true}, introduction:{type:String,default:''}, style:{type:String,default:'normal'}, modelValue:{type:Object,required:true}, deliveries:{type:Array,required:true}, busy:Boolean, compact:Boolean, speedOnly:Boolean, autoReview:{type:Boolean,default:true}, rateHint:{type:String,default:''}, unitsPerMinute:{type:Number,default:300}, provider:{type:String,default:'edge'} });
const emit=defineEmits(['update:modelValue','update:deliveries']);
const choices=[['auto','Theo cấu hình chung'],['natural','Tự nhiên'],['teaching','Giảng giải'],['story','Kể chuyện'],['news','Bản tin'],['relaxing','Thư giãn']];
const working=ref(false),result=ref(null),reviewed=ref('');
let reviewTimer, disposed=false;
onBeforeUnmount(()=>{disposed=true;clearTimeout(reviewTimer);});
const paragraphLists=computed(()=>props.sections.map(section=>section.text.split(/\n\s*\n/u).filter(text=>text.trim())));
const payload=computed(()=>({introduction:props.introduction,style:props.style,speech:props.modelValue,units_per_minute:props.unitsPerMinute,provider:props.provider,
 sections:props.sections.map((section,i)=>({...section,delivery:{...(props.deliveries[i]||{}),markup:section.text}}))}));
const signature=computed(()=>JSON.stringify(payload.value));
const ready=computed(()=>Boolean(result.value && reviewed.value===signature.value));
const hash=computed(()=>ready.value?result.value.hash:null);
const estimatedSeconds=computed(()=>ready.value?result.value.estimated_seconds:null);
function option(key,value){emit('update:modelValue',{...props.modelValue,[key]:value});}
function sectionOption(index,key,value){const items=props.sections.map((_,i)=>({...props.deliveries[i]}));items[index][key]=value;emit('update:deliveries',items);}
function paragraphOption(section,index,value){const items=[...(props.deliveries[section]?.paragraph_profiles||[])];while(items.length<=index)items.push('auto');items[index]=value;sectionOption(section,'paragraph_profiles',items);}
function dictionary(index,key,value){const items=(props.modelValue.dictionary||[]).map(item=>({...item}));items[index][key]=value;option('dictionary',items);}
function removeWord(index){option('dictionary',(props.modelValue.dictionary||[]).filter((_,i)=>i!==index));}
watch(()=>paragraphLists.value.map(items=>items.length), (counts,previous)=>{
 if(!previous)return;
 let changed=false;const items=props.sections.map((_,i)=>{const current={...props.deliveries[i]};if(counts[i]!==previous[i]&&current.paragraph_profiles?.length){current.paragraph_profiles=[];changed=true;}return current;});
 if(changed)emit('update:deliveries',items);
});
async function ensurePlan(){
 if(ready.value)return result.value;
 const current=signature.value;
 const {data}=await api.post('/api/speech/plan',JSON.parse(current),{timeout:20000});
 if(disposed||signature.value!==current)throw new Error('Nội dung hoặc tốc độ vừa thay đổi. Hãy thử lại.');
 result.value=data;reviewed.value=current;
 return data;
}
async function review(){
 if(working.value||props.busy)return;
 const current=signature.value;working.value=true;
 try{await ensurePlan();}
 catch{ /* User actions perform an explicit check and report any error. */ }
 finally{working.value=false;if(props.autoReview && !disposed && signature.value!==current)scheduleReview();}
}
function scheduleReview(){
 clearTimeout(reviewTimer);
 const complete=(props.modelValue.dictionary||[]).every(item=>item.word?.trim()&&item.spoken?.trim());
 if(props.autoReview&&!props.busy&&complete)reviewTimer=setTimeout(()=>review(),350);
}
watch([signature,()=>props.busy],scheduleReview,{immediate:true});
defineExpose({ready,hash,estimatedSeconds,ensurePlan});
</script>

<template>
 <section class="speech-tools" :class="{ compact }" :aria-label="$t('Tốc độ và tùy chọn đọc')">
  <SpeechRateControl :model-value="modelValue.rate_percent ?? 0" :disabled="busy" :hint="rateHint" @update:model-value="option('rate_percent',$event)" />
  <details v-if="!speedOnly" class="speech-advanced" :open="!compact"><summary>{{ $t('Tùy chọn đọc') }}</summary>
  <div class="field"><label>{{ $t(compact ? 'Phong cách' : 'Phong cách chung') }}<select class="input" :value="modelValue.profile" :disabled="busy" @change="option('profile',$event.target.value)"><option v-for="[id,label] in choices" :key="id" :value="id">{{ $t(id==='auto'?'Theo phong cách ban đầu':label) }}</option></select></label></div>
  <details class="speech-details"><summary>{{ $t(compact ? 'Chỉnh từng đoạn' : 'Phong cách từng mục và đoạn') }}</summary>
   <p class="text-muted">{{ $t(compact ? 'Dòng trống tách đoạn. Thêm hoặc xóa đoạn sẽ đặt lại phong cách riêng.' : 'Một dòng trống phân chia hai đoạn. Sau khi thêm hoặc xóa đoạn, các lựa chọn riêng của mục đó được đặt lại để tránh áp dụng nhầm.') }}</p>
   <div v-for="(section,i) in sections" :key="i" class="speech-section">
    <label>{{ section.title || $t('Nội dung') }}<select class="input" :value="deliveries[i]?.profile || 'auto'" :disabled="busy" @change="sectionOption(i,'profile',$event.target.value)"><option v-for="[id,label] in choices" :key="id" :value="id">{{ $t(label) }}</option></select></label>
    <div v-for="(paragraph,j) in paragraphLists[i]" :key="j" class="speech-paragraph"><span>{{ $t('Đoạn {0}',[j+1]) }} · {{ paragraph.slice(0,75) }}{{ paragraph.length>75?'…':'' }}</span><select class="input" :value="deliveries[i]?.paragraph_profiles?.[j] || 'auto'" :disabled="busy" :aria-label="$t('Phong cách đoạn {0}',[j+1])" @change="paragraphOption(i,j,$event.target.value)"><option v-for="[id,label] in choices" :key="id" :value="id">{{ $t(label) }}</option></select></div>
   </div>
  </details>
  <label class="speech-check"><input type="checkbox" :checked="modelValue.normalize" :disabled="busy" @change="option('normalize',$event.target.checked)" />{{ $t(compact ? 'Đọc số, ngày, đơn vị' : 'Chuẩn hóa số, ngày tháng và đơn vị khi đọc') }}</label>
  <p v-if="!compact" class="text-muted">{{ $t('Quy ước số ưu tiên tiếng Việt. Kiểm tra bản xem trước, đặc biệt số thập phân, tên riêng và từ viết tắt.') }}</p>
  <details class="speech-details"><summary>{{ $t(compact ? 'Từ điển phát âm' : 'Từ điển cách phát âm') }}</summary><p class="text-muted">{{ $t('Ví dụ: TP.HCM → Thành phố Hồ Chí Minh. Chỉ thay ở bản đọc, giữ nguyên văn bản gốc.') }}</p>
   <div v-for="(item,i) in modelValue.dictionary || []" :key="i" class="speech-dictionary"><input class="input" :value="item.word" maxlength="80" :disabled="busy" :aria-label="$t('Từ gốc')" :placeholder="$t('Từ gốc')" @input="dictionary(i,'word',$event.target.value)" /><span>→</span><input class="input" :value="item.spoken" maxlength="200" :disabled="busy" :aria-label="$t('Cách đọc')" :placeholder="$t('Cách đọc')" @input="dictionary(i,'spoken',$event.target.value)" /><button type="button" class="btn small" :disabled="busy" :aria-label="$t('Xóa mục từ điển')" @click="removeWord(i)"><UiIcon name="close" /></button></div>
   <button type="button" class="text-button" :disabled="busy || (modelValue.dictionary?.length || 0)>=50" @click="option('dictionary',[...(modelValue.dictionary||[]),{word:'',spoken:''}])"><UiIcon name="plus" />{{ $t('Thêm cách phát âm') }}</button>
  </details>
  </details>
  <small v-if="!compact" class="text-muted">{{ $t('File hoàn tất có phụ đề SRT. Mốc đoạn theo âm thanh đo được; mốc câu bên trong đoạn là ước lượng, có thể chỉnh lại khi dựng video.') }}</small>
 </section>
</template>

<style scoped>
.speech-advanced { margin:16px 0; }
.speech-advanced>summary { cursor:pointer;font-weight:600;font-size:12px;color:var(--muted);margin-bottom:14px; }
.speech-tools { border:1px solid var(--line);background:var(--surface-raised);border-radius:14px;padding:20px;margin:20px 0; }
.speech-tools.compact { border:0;border-top:1px solid var(--line);border-radius:0;background:transparent;padding:20px 0 0;margin:20px 0 0;min-width:0; }
.compact .speech-paragraph { grid-template-columns:minmax(0,1fr); }
.compact .speech-dictionary>span { display:none; }
.compact .speech-dictionary { grid-template-columns:minmax(0,1fr) auto; }
.compact .speech-dictionary>.input:first-of-type { grid-column:1; }
.compact .speech-dictionary>.input:nth-of-type(2) { grid-column:1;grid-row:2; }
.compact .speech-dictionary>.btn { grid-column:2;grid-row:1 / 3; }
.compact .input { min-width:0;max-width:100%; }
.compact .speech-section label { overflow-wrap:anywhere; }
.compact .speech-heading { margin-bottom:16px; }
.compact .speech-check { margin-bottom:16px; }
.compact .text-muted { font-size:12px;line-height:1.65; }
.speech-help { margin-top:16px;font-size:12px;line-height:1.7;color:var(--muted); }
.speech-help summary { cursor:pointer;font-weight:600; }
.speech-help p { margin:10px 0 0; }
.speech-heading {display:flex;gap:9px;align-items:center;flex-wrap:wrap}.speech-heading h3{margin:0;font-size:17px}.speech-heading>.ui-icon{color:var(--accent)}
.speech-details{border-top:1px solid var(--line);padding:14px 0}.speech-details summary{cursor:pointer;font-weight:600;font-size:13px}.speech-tools label{font-size:13px}.speech-tools label>.input{display:block;margin-top:7px}.speech-section{padding:14px 0}.speech-paragraph{display:grid;grid-template-columns:minmax(0,1fr) 175px;align-items:center;gap:12px;margin-top:10px}.speech-paragraph>span{font-size:12px;color:var(--muted);overflow-wrap:anywhere}.speech-check{display:flex;gap:10px;align-items:center;margin-top:16px}.speech-dictionary{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr) auto;align-items:center;gap:8px;margin:12px 0}.speech-tools>small{display:block;margin-top:14px;line-height:1.8}
@media(max-width:600px){.speech-tools{padding:14px}.speech-paragraph{grid-template-columns:1fr}.speech-dictionary{grid-template-columns:1fr auto}.speech-dictionary>span{display:none}.speech-dictionary>.input:nth-of-type(2){grid-column:1;grid-row:auto}}
</style>
