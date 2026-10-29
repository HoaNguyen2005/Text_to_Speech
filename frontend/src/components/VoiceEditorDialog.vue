<script setup>
import {nextTick,onBeforeUnmount,ref,watch} from 'vue';
import api from '@/services/api';
import {session} from '@/services/auth';
import {notify} from '@/composables/useNotifications';
import UiIcon from './UiIcon.vue';
const props=defineProps({open:Boolean,voice:{type:Object,default:null}});
const emit=defineEmits(['update:open','saved']);
const dialog=ref(null),saving=ref(false),form=ref({}),file=ref(null),message=ref(''),uploadKey=ref(0);
const isAdmin=()=>session.value?.user?.role==='admin';
let voiceCode='';
watch(()=>props.open,async open=>{
  await nextTick();
  if(open){form.value={name:props.voice?.name||'',gender:props.voice?.gender||'male',description:props.voice?.description||'',class:props.voice?.class||'free'};file.value=null;uploadKey.value++;voiceCode=`voice_${crypto.randomUUID().replaceAll('-','')}`;message.value='';dialog.value?.showModal();}
  else dialog.value?.close();
});
function close(){if(!saving.value)emit('update:open',false);}
async function save(){
  if(saving.value)return;saving.value=true;message.value='';
  try{
    const body={name:form.value.name.trim(),gender:form.value.gender,description:form.value.description.trim()};
    if(isAdmin())body.class=form.value.class;
    let saved;
    if(props.voice){saved=(await api.put(`/api/voices/${props.voice._id}`,body)).data.data;}
    else{
      if(!file.value)throw new Error('Vui lòng chọn file âm thanh mẫu.');
      const data=new FormData();Object.entries(body).forEach(([key,value])=>data.append(key,value));
      data.append('voice_id',voiceCode);data.append('audio_file',file.value);
      saved=(await api.post('/api/voices',data,{timeout:120000})).data.data;
    }
    notify(props.voice?'Đã cập nhật thông tin giọng đọc.':'Đã thêm giọng đọc.',{kind:'success'});emit('saved',saved);emit('update:open',false);
  }catch(error){message.value=error.response?.data?.error||error.message||'Không lưu được giọng đọc.';}
  finally{saving.value=false;}
}
onBeforeUnmount(()=>dialog.value?.close());
</script>
<template>
  <Teleport to="body"><dialog ref="dialog" class="voice-editor-dialog" aria-labelledby="voice-edit-title" @cancel.prevent="close" @click="event=>{if(event.target===dialog)close();}">
    <form class="voice-edit-form" @submit.prevent="save">
      <header><h2 id="voice-edit-title">{{ $t(voice?'Chỉnh sửa giọng đọc':'Thêm giọng đọc') }}</h2><button type="button" class="btn small" :disabled="saving" :aria-label="$t('Đóng')" @click="close"><UiIcon name="close" /></button></header>
      <fieldset :disabled="saving">
        <div class="field"><label for="voice-edit-name">{{ $t('Tên hiển thị') }}</label><input id="voice-edit-name" v-model="form.name" class="input" maxlength="200" required autofocus /></div>
        <div class="field"><label for="voice-edit-gender">{{ $t('Giới tính giọng đọc') }}</label><select id="voice-edit-gender" v-model="form.gender" class="input"><option value="male">{{ $t('Nam') }}</option><option value="female">{{ $t('Nữ') }}</option></select></div>
        <div v-if="isAdmin()" class="field"><label for="voice-edit-class">{{ $t('Phân hạng giọng') }}</label><select id="voice-edit-class" v-model="form.class" class="input"><option value="free">Free</option><option value="gold">Gold</option><option value="diamond">Diamond</option></select></div>
        <div class="field"><label for="voice-edit-description">{{ $t('Mô tả') }}</label><textarea id="voice-edit-description" v-model="form.description" class="input" rows="3" maxlength="500" /></div>
        <div v-if="!voice" class="field"><label for="voice-edit-file">{{ $t('File âm thanh mẫu') }}</label><input id="voice-edit-file" :key="uploadKey" class="input" type="file" accept=".wav,.mp3,.m4a,.flac,.ogg,.webm" required @change="file=$event.target.files[0]||null" /><small>{{ $t('Tối đa 50 MB. Bản ghi rõ tiếng, ít tiếng ồn.') }}</small></div>
      </fieldset>
      <p v-if="message" class="notice error" role="alert">{{ $t(message) }}</p>
      <footer><button type="button" class="btn" :disabled="saving" @click="close">{{ $t('Hủy') }}</button><button type="submit" class="btn primary" :disabled="saving"><span v-if="saving" class="spinner" />{{ $t(saving?'Đang lưu…':'Lưu thay đổi') }}</button></footer>
    </form>
  </dialog></Teleport>
</template>
<style>
.voice-editor-dialog{font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
.voice-editor-dialog{padding:0;border:1px solid var(--line);border-radius:22px;background:var(--surface);color:var(--ink);width:min(540px,calc(100vw - 32px));max-height:calc(100dvh - 40px);margin:auto;box-shadow:var(--shadow-float)}
.voice-editor-dialog::backdrop{background:rgb(9 26 27 / 55%);backdrop-filter:blur(5px)}
.voice-edit-form{padding:26px}.voice-edit-form header,.voice-edit-form footer{display:flex;align-items:center;justify-content:space-between;gap:12px}.voice-edit-form h2{margin:0;font-size:21px}.voice-edit-form fieldset{border:0;padding:0;margin:24px 0;display:grid;gap:18px}.voice-edit-form footer{justify-content:flex-end;border-top:1px solid var(--line);padding-top:20px}.voice-edit-form textarea{resize:vertical}
</style>
