<script setup>
import {computed,onMounted,ref} from 'vue';
import api from '@/services/api';
import {session} from '@/services/auth';
import {notify} from '@/composables/useNotifications';
import StudioBanner from '@/components/StudioBanner.vue';
import VoicePicker from '@/components/VoicePicker.vue';
const voices=ref([]),loading=ref(false);
const mine=computed(()=>voices.value.filter(v=>!v.is_global&&String(v.user_id)===String(session.value?.user?._id)));
async function load(){loading.value=true;try{const {data}=await api.get('/api/book-jobs/voices',{params:{provider:'edge'}});voices.value=data.voices;}catch(error){notify(error.response?.data?.error||'Không tải được danh sách giọng.',{kind:'error'});}finally{loading.value=false;}}
onMounted(load);
</script>
<template>
  <StudioBanner :title="$t('Giọng của bạn')" icon="mic" :eyebrow="$t('THƯ VIỆN GIỌNG ĐỌC')" :description="$t('Thêm bản ghi âm, nghe mẫu và chỉnh sửa giọng riêng của bạn.')" />
  <section class="panel"><div class="panel-heading"><div><h2>{{ $t('Giọng của bạn') }}</h2><p>{{ $t('Chỉ tài khoản của bạn có thể xem và chỉnh sửa các giọng này.') }}</p></div><span class="pill">{{ mine.length }}</span></div><VoicePicker :voices="voices" :loading="loading" manage initial-group="mine" @refresh="load" /></section>
</template>
