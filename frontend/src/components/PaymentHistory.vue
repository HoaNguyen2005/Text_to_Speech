<script setup>
import { onMounted, ref } from 'vue';
import api from '@/services/api';
import { openUpgrade, upgradeOpen } from '@/composables/useAccountTier';
import { getLocaleTag } from '@/composables/useLocale';
import { watch } from 'vue';
const props=defineProps({admin:Boolean,users:{type:Array,default:()=>[]}});
const orders=ref([]),cursor=ref(null),loading=ref(false),error=ref('');
const labels={pending:'Đang chờ thanh toán',paid:'Đã thanh toán',expired:'Đơn đã hết hạn',cancelled:'Đã hủy',review_required:'Cần đối soát'};
const reasons={higher_plan_active:'Đang có gói cao hơn',permanent_plan:'Gói vĩnh viễn',cancelled_order:'Đơn đã hủy',late_payment:'Chuyển sau khi hết hạn',insufficient_amount:'Chuyển thiếu tiền',inactive_account:'Tài khoản không hoạt động',invalid_transaction_time:'Thời gian không hợp lệ',manual_review:'Cần kiểm tra thủ công'};
const money=value=>new Intl.NumberFormat(getLocaleTag(),{style:'currency',currency:'VND',maximumFractionDigits:0}).format(value||0);
async function load(more=false){
  if(loading.value)return;loading.value=true;error.value='';
  try{const {data}=await api.get(props.admin?'/api/billing/admin/orders':'/api/billing/orders',{params:more?{before:cursor.value}:{}});orders.value=more?[...orders.value,...data.orders]:data.orders;cursor.value=data.next_cursor;}
  catch(e){error.value=e.response?.data?.error||'Không tải được lịch sử thanh toán.';}finally{loading.value=false;}
}
watch(upgradeOpen,open=>{if(!open)load();});
onMounted(()=>load());
</script>
<template>
  <section class="panel flush"><div class="panel-heading"><h2>{{ $t(admin?'Giao dịch nạp tiền':'Lịch sử thanh toán gói') }}</h2><button class="btn small" type="button" :disabled="loading" @click="load()">{{ $t('Tải lại') }}</button></div>
    <p v-if="error" class="notice" role="alert">{{ $t(error) }}</p><p v-if="loading&&!orders.length" class="notice" role="status">{{ $t('Đang tải…') }}</p><p v-else-if="!orders.length" class="notice">{{ $t('Chưa có giao dịch thanh toán.') }}</p>
    <div v-else class="table-scroll"><table class="data-table"><thead><tr><th>{{ $t('Mã đơn') }}</th><th v-if="admin">{{ $t('Người dùng') }}</th><th>{{ $t('Gói tài khoản') }}</th><th>{{ $t('Số tiền') }}</th><th>{{ $t('Trạng thái') }}</th><th>{{ $t('Thao tác') }}</th></tr></thead><tbody><tr v-for="order in orders" :key="order._id"><td><strong>{{ order.payment_code }}</strong><small class="payment-date">{{ new Date(order.createdAt).toLocaleString($locale) }}</small></td><td v-if="admin">{{ users.find(user=>user._id===order.user_id)?.email||order.user_id }}</td><td>{{ order.plan_class==='gold'?'Gold':'Diamond' }}<small class="payment-date">{{ $t(order.billing_cycle==='yearly'?'1 năm · 365 ngày':'1 tháng · 30 ngày') }}</small></td><td>{{ money(order.amount_vnd) }}<small v-if="order.paid_amount_vnd!=null" class="payment-date">{{ $t('Đã nhận: {0}',[money(order.paid_amount_vnd)]) }}</small></td><td><span class="pill" :class="{green:order.status==='paid',amber:order.status==='review_required'}">{{ $t(labels[order.status]) }}</span><small v-if="admin&&order.review_reason" class="payment-date">{{ $t(reasons[order.review_reason]||order.review_reason) }}</small></td><td><button v-if="!admin" type="button" class="text-button" @click="openUpgrade(order._id)">{{ $t('Xem đơn') }}</button><span v-else>{{ order.bank_reference_code||'—' }}</span></td></tr></tbody></table></div>
    <div v-if="cursor" class="table-footer"><button class="btn small" type="button" :disabled="loading" @click="load(true)">{{ $t('Xem thêm') }}</button></div>
  </section>
</template>
<style scoped>.payment-date{display:block;color:var(--muted);margin-top:6px;font-size:11px}.data-table{min-width:720px}.data-table td{overflow-wrap:anywhere}.data-table td:first-child{min-width:135px}</style>
