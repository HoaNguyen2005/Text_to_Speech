<script setup>
import { computed } from 'vue';
import { useAccountTier } from '@/composables/useAccountTier';
const props=defineProps({scope:{type:String,default:'all'},showUpgrade:{type:Boolean,default:true}});
const {tier,limits,usage,openUpgrade}=useAccountTier();
const rows=computed(()=>[
  {key:'lectures',label:'Bài giảng hôm nay',value:usage.value.lectures_today||0,max:limits.value.lecturesPerDay},
  {key:'books',label:'Sách nói hôm nay',value:usage.value.books_today||0,max:limits.value.booksPerDay},
  {key:'books',label:'Hàng đợi đang xử lý',value:usage.value.active_book_jobs||0,max:limits.value.maxActiveBookJobs},
  {key:'voices',label:'Giọng riêng',value:usage.value.custom_voices||0,max:limits.value.maxVoices},
].filter(row=>props.scope==='all'||row.key===props.scope));
</script>
<template><section v-if="tier" class="account-usage"><div class="usage-heading"><span class="pill" :class="tier.effective_class !== 'free' ? tier.effective_class : ''"><span :class="tier.effective_class !== 'free' ? `tier-text-${tier.effective_class}` : ''">{{ ({free:'Free',gold:'Gold',diamond:'Diamond'})[tier.effective_class] }}</span></span><button v-if="showUpgrade" type="button" class="text-button" @click="openUpgrade()">{{ $t('Nâng cấp / Gia hạn gói') }}</button></div><div v-for="row in rows" :key="row.label" class="usage-row"><div><span>{{ $t(row.label) }}</span><b>{{ row.value }} / {{ row.max??$t('Không giới hạn') }}</b></div><progress v-if="row.max!=null" :value="Math.min(row.value,row.max)" :max="row.max" :aria-label="$t(row.label)" /></div><small class="text-muted">{{ $t('Hạn mức ngày làm mới lúc 00:00 giờ Việt Nam. Lượt đã nhận xử lý vẫn được tính nếu xóa lịch sử hoặc xử lý lỗi.') }}</small></section></template>
<style scoped>.account-usage{display:grid;gap:15px}.usage-heading,.usage-row>div{display:flex;align-items:center;justify-content:space-between;gap:12px}.usage-row{font-size:12px}.usage-row b{white-space:nowrap}.usage-row progress{display:block;width:100%;height:6px;margin-top:8px;accent-color:var(--accent)}.usage-heading .text-button{font-size:11px}.account-usage>small{font-size:11px;line-height:1.65}</style>
