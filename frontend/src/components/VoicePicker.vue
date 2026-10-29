<script setup>
import {computed,nextTick,onBeforeUnmount,ref,watch} from 'vue';
import api from '@/services/api';
import {session} from '@/services/auth';
import {notify,confirmAction} from '@/composables/useNotifications';
import UiIcon from './UiIcon.vue';
import VoiceEditorDialog from './VoiceEditorDialog.vue';
const props=defineProps({modelValue:String,voices:{type:Array,default:()=>[]},disabled:Boolean,loading:Boolean,provider:{type:String,default:'edge'},manage:Boolean,hideTrigger:Boolean,initialGroup:{type:String,default:'system'}});
const emit=defineEmits(['update:modelValue','refresh']);
const opened=ref(false),dialog=ref(null),search=ref(''),tab=ref(props.initialGroup),tier=ref('all'),playing=ref(''),preparing=ref(''),editOpen=ref(false),editing=ref(null),hiding=ref('');
let audio,objectUrl,abort,sequence=0;
let nextTab;
const keyOf=voice=>voice.choice_id||voice.voice_id;
const originOf=voice=>voice.origin||(!voice._id||voice.is_global?'system':'user');
const chosen=computed(()=>props.voices.find(v=>keyOf(v)===props.modelValue));
const hasOwnVoices=computed(()=>props.voices.some(voice=>originOf(voice)==='user'));
const systemCount=computed(()=>props.voices.filter(voice=>originOf(voice)==='system').length);
const ownCount=computed(()=>props.voices.filter(voice=>originOf(voice)==='user').length);
const filtered=computed(()=>props.voices.filter(v=>originOf(v)===(tab.value==='mine'?'user':'system')&&(tier.value==='all'||(v.class||'free')===tier.value)&&[v.name,v.voice_id,v.description].join(' ').toLocaleLowerCase('vi').includes(search.value.trim().toLocaleLowerCase('vi'))));
const initials=name=>(name||'').trim().split(/\s+/u).slice(-2).map(w=>w[0]).join('').toUpperCase();
function stop(){sequence++;abort?.abort();abort=null;if(audio){audio.pause();audio.src='';audio=null;}if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;playing.value='';preparing.value='';}
watch(opened,async open=>{await nextTick();if(open){tab.value=nextTab||(chosen.value?(originOf(chosen.value)==='user'?'mine':'system'):props.initialGroup);nextTab=undefined;dialog.value?.showModal();}else{stop();dialog.value?.close();}});
watch(()=>[props.provider,props.voices],()=>{stop();});
function choose(voice){if(props.disabled)return;emit('update:modelValue',keyOf(voice));opened.value=false;}
async function play(voice){
  if(playing.value===keyOf(voice)||preparing.value===keyOf(voice)){stop();return;}
  stop();const current=sequence;preparing.value=keyOf(voice);abort=new AbortController();
  try{
    const endpoint=voice._id?`/api/voices/${voice._id}/preview`:`/api/voices/presets/${voice.provider||props.provider}/${voice.voice_id}/preview`;
    const {data}=await api.get(endpoint,{responseType:'blob',timeout:20*60*1000,signal:abort.signal});
    if(current!==sequence)return;objectUrl=URL.createObjectURL(data);audio=new Audio(objectUrl);
    audio.onended=()=>{if(current===sequence)stop();};audio.ontimeupdate=()=>{if(current===sequence&&audio?.currentTime>=30)stop();};
    audio.onerror=()=>{if(current===sequence){stop();notify('Không phát được giọng nghe mẫu.',{kind:'error'});}};
    await audio.play();if(current===sequence)playing.value=keyOf(voice);
  }catch(error){
    if(current!==sequence||error.code==='ERR_CANCELED')return;
    let message=error.response?.data?.error;
    if(error.response?.data instanceof Blob){try{message=JSON.parse(await error.response.data.text()).error;}catch{}}
    stop();notify(message||'Không phát được giọng nghe mẫu.',{kind:'error'});
  }finally{if(current===sequence)preparing.value='';}
}
async function hide(voice){
  stop();if(!await confirmAction({key:'Ẩn giọng mẫu “{0}” khỏi danh sách sử dụng?',params:[voice.name]},{title:'Ẩn giọng mẫu',confirmLabel:'Ẩn giọng',danger:true}))return;
  hiding.value=voice.voice_id;
  try{await api.delete(`/api/voices/${voice._id}`);if(props.modelValue===keyOf(voice))emit('update:modelValue','');emit('refresh');notify('Đã ẩn giọng mẫu khỏi danh sách sử dụng.',{kind:'success'});}
  catch(error){notify(error.response?.data?.error||'Không thể ẩn giọng mẫu.',{kind:'error'});}finally{hiding.value='';}
}
function edit(voice){stop();editing.value=voice;editOpen.value=true;}
function saved(voice){if(voice){tab.value=voice.is_global?'system':'mine';search.value='';tier.value='all';if(!editing.value&&!opened.value){nextTab=tab.value;opened.value=true;}}emit('refresh');}
defineExpose({open:()=>{opened.value=true;},edit,add:()=>edit(null)});
onBeforeUnmount(()=>{stop();dialog.value?.close();});
</script>
<template>
  <button v-if="!hideTrigger" type="button" class="voice-picker-trigger" :disabled="disabled||loading" aria-haspopup="dialog" @click="opened=true">
    <span class="voice-avatar"><UiIcon name="wave" /></span><span class="voice-trigger-name">{{ loading?$t('Đang tải danh sách giọng…'):chosen?.name||$t(manage?'Mở thư viện giọng':'Chọn giọng đọc') }}</span><UiIcon name="chevron" />
  </button>
  <Teleport to="body"><dialog ref="dialog" class="voice-picker-dialog" aria-labelledby="voice-picker-heading" @cancel.prevent="opened=false" @click="event=>{if(event.target===dialog)opened=false;}">
    <header class="voice-picker-header"><h2 id="voice-picker-heading">{{ $t(manage?'Thư viện giọng đọc':'Chọn giọng đọc') }}</h2><button type="button" class="btn small voice-picker-close" :aria-label="$t('Đóng')" @click="opened=false"><UiIcon name="close" /></button></header>
    <div class="voice-picker-toolbar"><div class="voice-picker-tabs"><button type="button" :class="{active:tab==='system'}" :aria-pressed="tab==='system'" @click="tab='system'"><UiIcon name="wave" />{{ $t('Giọng hệ thống') }}<span class="voice-tab-count">{{ systemCount }}</span></button><button type="button" :class="{active:tab==='mine'}" :aria-pressed="tab==='mine'" @click="tab='mine'"><UiIcon name="mic" />{{ $t('Giọng của bạn') }}<span class="voice-tab-count">{{ ownCount }}</span></button></div><button v-if="session" type="button" class="btn primary small voice-picker-add" :disabled="disabled" @click="edit(null)"><UiIcon name="plus" />{{ $t('Thêm giọng mới') }}</button></div>
    <div class="voice-picker-filters"><div class="search-field"><UiIcon name="search" /><input v-model="search" class="input" type="search" :aria-label="$t('Tìm giọng đọc')" :placeholder="$t('Tìm tên giọng đọc…')" /></div><select v-model="tier" class="input" :aria-label="$t('Phân hạng giọng')"><option value="all">{{ $t('Tất cả phân hạng') }}</option><option value="free">Free</option><option value="gold">Gold</option><option value="diamond">Diamond</option></select></div>
    <div class="voice-picker-grid"><article v-for="voice in filtered" :key="keyOf(voice)" class="voice-choice-card" :class="{selected:keyOf(voice)===modelValue}">
      <div class="voice-choice-heading"><span class="voice-avatar" aria-hidden="true">{{ initials(voice.name) }}</span><div class="voice-choice-info"><h3 :title="voice.name">{{ voice.name }}</h3><p class="voice-description" :title="voice.description">{{ voice.description||$t('Nghe mẫu để chọn giọng phù hợp.') }}</p></div><span v-if="keyOf(voice)===modelValue" class="voice-selected-mark" :title="$t('Đã chọn')"><UiIcon name="check" /></span></div>
      <div class="voice-choice-actions"><span class="voice-class" :class="voice.class||'free'">{{ ({free:'Free',gold:'Gold',diamond:'Diamond'})[voice.class||'free'] }}</span><div class="voice-choice-controls"><button type="button" class="btn small voice-play" :class="{playing:playing===keyOf(voice)||preparing===keyOf(voice)}" :aria-label="playing===keyOf(voice)||preparing===keyOf(voice)?$t('Dừng')+' · '+voice.name:$t('Nghe mẫu {0}',[voice.name])" :title="$t(playing===keyOf(voice)||preparing===keyOf(voice)?'Dừng':'Nghe mẫu')" :aria-pressed="playing===keyOf(voice)||preparing===keyOf(voice)" @click="play(voice)"><span v-if="preparing===keyOf(voice)" class="spinner" /><UiIcon v-else :name="playing===keyOf(voice)?'pause':'play'" /></button><button v-if="!manage" type="button" class="btn small voice-select" :class="{primary:keyOf(voice)===modelValue}" :aria-pressed="keyOf(voice)===modelValue" :disabled="disabled" @click="choose(voice)">{{ $t(keyOf(voice)===modelValue?'Đã chọn':'Chọn') }}</button></div></div>
      <div v-if="voice.can_edit" class="voice-manage-actions"><button type="button" class="text-button" @click="edit(voice)"><UiIcon name="edit" />{{ $t('Chỉnh sửa') }}</button><button type="button" class="text-button" :disabled="hiding===voice.voice_id" @click="hide(voice)">{{ $t('Ẩn giọng') }}</button></div>
    </article><p v-if="!filtered.length" class="voice-empty">{{ $t(loading?'Đang tải danh sách giọng…':tab==='mine'&&!hasOwnVoices&&!search&&tier==='all'?'Bạn chưa có giọng riêng. Bấm Thêm giọng mới để bắt đầu.':'Không tìm thấy giọng đọc phù hợp.') }}</p></div>
    <footer class="voice-picker-footer"><small>{{ $t('Nghe bản mẫu tối đa 30 giây.') }}</small><button type="button" class="text-button" :disabled="loading" @click="emit('refresh')"><UiIcon name="refresh" />{{ $t('Tải lại') }}</button></footer>
  </dialog></Teleport>
  <VoiceEditorDialog v-model:open="editOpen" :voice="editing" @saved="saved" />
</template>
<style>
.voice-picker-trigger{display:flex;align-items:center;gap:12px;width:100%;min-height:64px;padding:11px 14px;border:1px solid var(--line-strong);border-radius:14px;background:var(--surface-raised);color:var(--ink);text-align:left;font:inherit;cursor:pointer}
.voice-picker-trigger:hover{border-color:var(--accent)}
.voice-trigger-name{font-weight:600;flex:1;min-width:0;overflow-wrap:anywhere}
.voice-avatar{width:38px;height:38px;flex-shrink:0;border-radius:50%;display:grid;place-items:center;background:var(--accent-soft);color:var(--accent);font-size:11px;font-weight:750}
.voice-picker-trigger>.ui-icon{width:17px;color:var(--muted)}
.voice-picker-trigger:disabled{opacity:.6;cursor:not-allowed}
.voice-picker-dialog{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;box-sizing:border-box;overflow:hidden;padding:0;width:min(1120px,calc(100vw - 48px));max-height:calc(100dvh - 48px);border:1px solid var(--line);border-radius:24px;background:var(--surface);color:var(--ink);margin:auto;box-shadow:var(--shadow-float)}
.voice-picker-dialog[open]{display:flex;flex-direction:column}
.voice-picker-dialog::backdrop{background:rgb(9 26 27 / 48%);backdrop-filter:blur(5px)}
.voice-picker-dialog>.voice-picker-header,.voice-picker-dialog>.voice-picker-toolbar,.voice-picker-dialog>.voice-picker-filters,.voice-picker-dialog>.voice-picker-footer{flex-shrink:0}
.voice-picker-header{display:flex;justify-content:space-between;align-items:center;padding:20px 24px 14px;gap:16px}
.voice-picker-header h2{margin:0;font:700 20px/1.35 'Inter',sans-serif;letter-spacing:-.5px}
.voice-picker-dialog .voice-picker-close{width:32px;height:32px;padding:0;border-color:transparent;border-radius:50%;background:var(--surface-raised);color:var(--muted)}
.voice-picker-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 24px 14px}
.voice-picker-tabs{display:flex;gap:3px;padding:4px;background:var(--surface-raised);border-radius:24px;min-width:0}
.voice-picker-tabs button{display:flex;align-items:center;justify-content:center;gap:7px;min-height:36px;padding:7px 12px;border:0;border-radius:20px;background:transparent;color:var(--muted);font:600 12px/1.4 'Inter',sans-serif;cursor:pointer}
.voice-picker-tabs button>.ui-icon{width:15px;height:15px;color:var(--accent);flex-shrink:0}
.voice-picker-tabs button.active{background:var(--surface);color:var(--ink);box-shadow:0 2px 6px rgb(10 30 25 / 7%)}
.voice-tab-count{font-size:10px;font-variant-numeric:tabular-nums;color:var(--muted);background:var(--canvas);border-radius:10px;min-width:18px;padding:2px 4px;box-sizing:border-box}
.voice-picker-dialog .voice-picker-add{border-radius:20px;padding:8px 13px;white-space:nowrap}
.voice-picker-filters{display:grid;grid-template-columns:minmax(0,1fr) 172px;gap:10px;padding:0 24px 18px;border-bottom:1px solid var(--line)}
.voice-picker-filters .search-field{max-width:none;min-width:0}
.voice-picker-filters .input{min-height:40px;height:40px;border-radius:24px;font-size:12px;padding-top:9px;padding-bottom:9px}
.voice-picker-filters .search-field>.ui-icon{top:12px;width:15px;height:15px}
.voice-picker-filters select.input{padding-left:14px;background-color:var(--surface)}
.voice-picker-dialog>.voice-picker-grid{flex:1;min-height:160px;overscroll-behavior:contain}
.voice-picker-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-content:start;align-items:start;gap:14px;padding:20px 24px;background:var(--surface-raised);max-height:55dvh;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent;scrollbar-gutter:stable}
.voice-choice-card{min-width:0;box-sizing:border-box;border:1px solid var(--line);border-radius:16px;background:var(--surface);padding:16px;display:flex;flex-direction:column;transition:border-color .15s,box-shadow .15s}
.voice-choice-card:hover{border-color:var(--line-strong);box-shadow:0 3px 10px rgb(10 30 25 / 6%)}
.voice-choice-card.selected{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent),0 3px 10px rgb(10 30 25 / 6%)}
.voice-choice-heading{display:flex;align-items:flex-start;gap:10px;min-height:74px}
.voice-choice-info{min-width:0;flex:1}
.voice-choice-heading h3{margin:0 0 4px;font-size:13px;font-weight:700;line-height:1.4;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.voice-description{font-size:11px;line-height:1.55;color:var(--muted);margin:0;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.voice-selected-mark{display:grid;place-items:center;width:18px;height:18px;flex-shrink:0;border-radius:50%;background:var(--accent-soft);color:var(--accent)}
.voice-selected-mark>.ui-icon{width:12px;height:12px}
.voice-class{font-size:10px;font-weight:650;padding:4px 9px;border-radius:12px;display:inline-block;background:var(--surface-raised);color:var(--muted);line-height:1.3}
.voice-class.gold{color:var(--warning);background:var(--warning-bg)}
.voice-class.diamond{color:var(--accent);background:var(--accent-soft)}
.voice-choice-actions{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:10px;padding-top:12px;border-top:1px solid var(--line)}
.voice-choice-controls{display:flex;align-items:center;gap:8px}
.voice-picker-dialog .voice-play{width:32px;height:32px;min-height:32px;padding:0;border-radius:50%;border-color:var(--line);background:var(--surface-raised)}
.voice-picker-dialog .voice-play.playing{background:var(--accent-soft);border-color:var(--accent-line);color:var(--accent)}
.voice-picker-dialog .voice-play>.ui-icon{width:14px;height:14px}
.voice-picker-dialog .voice-play .spinner{width:13px;height:13px}
.voice-picker-dialog .voice-select{border-radius:20px;min-width:66px;min-height:32px;font-size:11px;padding:7px 12px}
.voice-manage-actions{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px}
.voice-manage-actions .text-button{font-size:10px;min-height:28px}
.voice-manage-actions .ui-icon{width:12px;height:12px}
.voice-picker-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 24px;color:var(--muted);border-top:1px solid var(--line)}
.voice-picker-footer small,.voice-picker-footer .text-button{font-size:11px}
.voice-picker-footer .ui-icon{width:13px;height:13px}
.voice-empty{grid-column:1/-1;align-self:center;text-align:center;margin:auto;padding:32px 12px;color:var(--muted);font-size:13px;line-height:1.7}
.voice-picker-dialog button:focus-visible,.voice-picker-trigger:focus-visible{outline:2px solid var(--focus);outline-offset:3px}
@media(max-width:900px){.voice-picker-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:600px){
  .voice-picker-dialog{width:calc(100vw - 20px);max-height:calc(100dvh - 20px);border-radius:20px}
  .voice-picker-header{padding:16px 16px 12px}
  .voice-picker-header h2{font-size:18px}
  .voice-picker-toolbar{padding:0 16px 12px;flex-wrap:wrap;gap:10px}
  .voice-picker-tabs{flex:1}
  .voice-picker-tabs button{flex:1;padding:7px 10px;font-size:11px}
  .voice-picker-tabs button>.ui-icon{width:13px;height:13px}
  .voice-picker-filters{padding:0 16px 14px;grid-template-columns:minmax(0,1fr) 136px;gap:8px}
  .voice-picker-grid{grid-template-columns:1fr;padding:14px 16px;gap:12px;max-height:52dvh}
  .voice-choice-card{padding:14px}
  .voice-choice-heading{min-height:60px}
  .voice-picker-footer{padding:10px 16px}
}
@media(prefers-reduced-motion:reduce){.voice-choice-card{transition:none}}
</style>
