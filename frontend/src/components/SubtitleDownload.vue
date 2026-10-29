<script setup>
import {ref} from 'vue';
import api from '@/services/api';
import UiIcon from './UiIcon.vue';
import {useFeedback} from '@/composables/useNotifications';
const props=defineProps({endpoint:{type:String,required:true}});
const busy=ref(false),error=useFeedback('error');
async function download(){
 if(busy.value)return;busy.value=true;error.value='';
 try{const {data}=await api.get(props.endpoint,{responseType:'blob',timeout:40000});const url=URL.createObjectURL(data),link=document.createElement('a');link.href=url;link.download='text2speech.srt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
 catch(failure){let message;try{message=JSON.parse(await failure.response.data.text()).error;}catch{}error.value=message||'Chưa tải được phụ đề. Hãy thử lại.';}
 finally{busy.value=false;}
}
</script>
<template><button type="button" class="btn small" :disabled="busy" @click="download"><span v-if="busy" class="spinner" /><UiIcon v-else name="document" />{{ $t('Tải phụ đề SRT') }}</button></template>
