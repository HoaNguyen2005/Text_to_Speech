<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import api from '@/services/api';
import { refreshSession, session } from '@/services/auth';
import { upgradeOpen, requestedOrderId } from '@/composables/useAccountTier';
import { notify } from '@/composables/useNotifications';
import { getLocaleTag } from '@/composables/useLocale';
import UiIcon from './UiIcon.vue';
const dialog=ref(null),catalog=ref(null),order=ref(null),plan=ref('gold'),cycle=ref('monthly'),busy=ref(false),error=ref(''),now=ref(Date.now());
let timer,closed=false,inFlight=false,version=0;
const selected=computed(()=>catalog.value?.plans.find(p=>p.plan_class===plan.value&&p.billing_cycle===cycle.value));
const choices=computed(()=>['gold','diamond'].map(key=>catalog.value?.plans.find(p=>p.plan_class===key&&p.billing_cycle===cycle.value)).filter(Boolean));
const currentPlan=computed(()=>session.value?.tier_info?.effective_class||session.value?.user?.account_class||'free');
function savingFor(key){
  const monthly=catalog.value?.plans.find(p=>p.plan_class===key&&p.billing_cycle==='monthly');
  const yearly=catalog.value?.plans.find(p=>p.plan_class===key&&p.billing_cycle==='yearly');
  if(catalog.value?.demo_prices||!monthly||!yearly||monthly.amount_vnd<=0)return 0;
  return Math.max(0,Math.round((1-yearly.amount_vnd/(monthly.amount_vnd*12))*100));
}
const remaining=computed(()=>Math.max(0,Math.ceil((new Date(order.value?.expires_at)-now.value)/1000)));
const countdown=computed(()=>`${Math.floor(remaining.value/60)}:${String(remaining.value%60).padStart(2,'0')}`);
const money=value=>new Intl.NumberFormat(getLocaleTag(),{style:'currency',currency:'VND',maximumFractionDigits:0}).format(value||0);
function close(){if(!busy.value)upgradeOpen.value=false;}
watch(upgradeOpen,async open=>{
  ++version;clearTimeout(timer);closed=!open;
  if(open){error.value='';order.value=null;catalog.value=null;await nextTick();dialog.value?.showModal();const request=version;
    try{const {data}=await api.get('/api/billing/plans');if(request!==version)return;catalog.value=data;
      if(requestedOrderId.value){const result=await api.get(`/api/billing/orders/${requestedOrderId.value}`);if(request!==version)return;await acceptOrder(result.data);schedule();}
    }catch(e){if(request===version)error.value=e.response?.data?.error||'Không tải được bảng giá.';}
  }else dialog.value?.close();
});
async function acceptOrder(value){
  order.value=value;now.value=Date.now();
  if(value.status==='paid'){
    clearTimeout(timer);
    try{await refreshSession();notify('Đã kích hoạt gói tài khoản của bạn.',{kind:'success'});}
    catch{error.value='Thanh toán đã được ghi nhận. Hãy tải lại hồ sơ để cập nhật gói.';}
  }
}
async function create(){
  if(busy.value)return;busy.value=true;error.value='';
  try{const {data}=await api.post('/api/billing/orders',{plan_class:plan.value,billing_cycle:cycle.value});await acceptOrder(data);schedule();}
  catch(e){error.value=e.response?.data?.error||'Không tạo được đơn thanh toán.';}finally{busy.value=false;}
}
function schedule(){clearTimeout(timer);if(!closed&&order.value?.status==='pending')timer=setTimeout(poll,4000);}
async function poll(){
  now.value=Date.now();
  if(closed||!order.value||order.value.status!=='pending')return;
  if(document.hidden||inFlight){schedule();return;}
  const request=version,id=order.value._id;inFlight=true;
  try{const {data}=await api.get(`/api/billing/orders/${id}`);if(request===version&&id===order.value?._id){error.value='';await acceptOrder(data);}}
  catch(e){if(request===version)error.value=e.response?.data?.error||'Chưa kiểm tra được thanh toán. Hệ thống sẽ thử lại.';}
  finally{inFlight=false;schedule();}
}
async function verify(){
  if(busy.value||inFlight)return;busy.value=true;error.value='';
  try{const {data}=await api.post(`/api/billing/orders/${order.value._id}/verify`);await acceptOrder(data);
    if(data.status==='pending')notify('Chưa ghi nhận thanh toán. Bạn có thể kiểm tra lại sau 30 giây.',{kind:'info'});
  }catch(e){error.value=e.response?.data?.error||'Không kiểm tra được thanh toán.';}finally{busy.value=false;schedule();}
}
async function cancel(){
  if(busy.value||inFlight)return;busy.value=true;error.value='';clearTimeout(timer);
  try{const {data}=await api.post(`/api/billing/orders/${order.value._id}/cancel`);await acceptOrder(data);if(data.status==='cancelled')order.value=null;}
  catch(e){error.value=e.response?.data?.error||'Không hủy được đơn thanh toán.';}finally{busy.value=false;schedule();}
}
async function copy(value){try{await navigator.clipboard.writeText(String(value));notify('Đã sao chép.',{kind:'success'});}catch{error.value='Không sao chép được. Hãy sao chép thông tin thủ công.';}}
function visibility(){if(!document.hidden)poll();}
document.addEventListener('visibilitychange',visibility);
onBeforeUnmount(()=>{closed=true;++version;clearTimeout(timer);document.removeEventListener('visibilitychange',visibility);dialog.value?.close();});
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="upgrade-dialog" aria-labelledby="upgrade-title" aria-describedby="upgrade-description" @cancel.prevent="close" @click="e=>{if(e.target===dialog)close();}">
      <header class="upgrade-header">
        <div class="upgrade-heading">
          <div class="upgrade-brand"><img class="upgrade-brand-icon" src="/favicon.svg" alt="" width="25" height="25" /><span>TEXT2SPEECH <b :class="plan === 'diamond' ? 'tier-text-diamond' : 'tier-text-gold'">VIP</b></span></div>
          <h2 id="upgrade-title">{{ $t(order?'Thanh toán gói tài khoản':'Nâng cấp / Gia hạn gói') }}</h2>
          <p id="upgrade-description">{{ $t(order?'Kiểm tra thông tin và hoàn tất nâng cấp của bạn.':'Chọn gói phù hợp với cách bạn sáng tạo âm thanh.') }}</p>
        </div>
        <button type="button" class="btn upgrade-close" :disabled="busy" :aria-label="$t('Đóng')" @click="close"><UiIcon name="close" /></button>
      </header>

      <div class="upgrade-content">
        <div v-if="error" class="upgrade-notice upgrade-error" role="alert"><UiIcon name="close" /><p>{{ $t(error) }}</p></div>
        <div v-if="!catalog" class="upgrade-loading" role="status"><span class="spinner" /><span>{{ $t('Đang tải…') }}</span></div>
        <template v-else-if="!order">
          <div class="upgrade-toolbar">
            <span class="current-plan">
              {{ $t('Gói hiện tại') }}
              <span class="voice-name-frame" :class="currentPlan !== 'free' ? `is-${currentPlan}` : ''">
                <strong :class="currentPlan !== 'free' ? `tier-text-${currentPlan}` : 'plan-free-pill'">{{ ({free:'Free',gold:'Gold',diamond:'Diamond'})[currentPlan] }}</strong>
              </span>
            </span>
            <fieldset class="billing-switch" :disabled="busy"><legend class="sr-only">{{ $t('Chu kỳ') }}</legend>
              <label :class="{active:cycle==='monthly'}"><input v-model="cycle" class="upgrade-radio" type="radio" name="upgrade-cycle" value="monthly" :aria-label="$t('Hàng tháng')" /><span>{{ $t('Hàng tháng') }}</span></label>
              <label :class="{active:cycle==='yearly'}"><input v-model="cycle" class="upgrade-radio" type="radio" name="upgrade-cycle" value="yearly" :aria-label="$t('Hàng năm')" /><span>{{ $t('Hàng năm') }}</span></label>
            </fieldset>
          </div>
          <p v-if="catalog.demo_prices" class="upgrade-notice upgrade-demo"><UiIcon name="clock" />{{ $t('Giá demo · Vẫn chuyển tiền thật qua ngân hàng.') }}</p>

          <fieldset class="upgrade-plans" :disabled="busy"><legend class="sr-only">{{ $t('Gói tài khoản') }}</legend>
            <label v-for="item in choices" :key="item.plan_class" class="plan-card" :class="[item.plan_class, { selected: plan === item.plan_class }]">
              <input v-model="plan" class="upgrade-radio" type="radio" name="upgrade-plan" :value="item.plan_class" :aria-label="item.plan_class==='gold'?'Gold':'Diamond'" />
              <span class="plan-card-top">
                <span class="plan-icon" :class="`avatar-tier-${item.plan_class}`">
                  <UiIcon :name="item.plan_class==='gold'?'wave':'spark'" />
                  <span class="avatar-tier-spark" aria-hidden="true">✦</span>
                </span>
                <span v-if="currentPlan===item.plan_class" class="plan-tag" :class="item.plan_class">{{ $t('Gói hiện tại') }}</span>
                <span v-else class="plan-tag" :class="item.plan_class">{{ $t(item.plan_class==='gold'?'Sáng tạo mỗi ngày':'Cho nhu cầu chuyên sâu') }}</span>
              </span>
              <span class="plan-name-wrap">
                <span class="voice-name-frame" :class="`is-${item.plan_class}`">
                  <span class="plan-name" :class="`tier-text-${item.plan_class}`">{{ item.plan_class==='gold'?'Gold':'Diamond' }}</span>
                </span>
              </span>
              <span class="plan-description">{{ $t(item.plan_class==='gold'?'Thêm lượt tạo, thêm giọng đọc của riêng bạn.':'Nhiều nội dung hơn, thời lượng dài hơn.') }}</span>
              <span class="plan-price"><strong :class="`tier-text-${item.plan_class}`">{{ money(item.amount_vnd) }}</strong><span>/ {{ $t(cycle==='yearly'?'năm':'tháng') }}</span></span>
              <span class="plan-term"><span>{{ $t('Thanh toán một lần · {0} ngày',[item.duration_days]) }}</span><span v-if="cycle==='yearly'&&savingFor(item.plan_class)>0" class="plan-saving">{{ $t('Tiết kiệm {0}%',[savingFor(item.plan_class)]) }}</span></span>
              <span class="plan-features" role="list">
                <span role="listitem"><UiIcon name="check" /><span>{{ $t('{0} bài giảng mỗi ngày',[item.limits.lecturesPerDay]) }}<small>{{ $t('Tối đa {0} ký tự / bài',[item.limits.lectureChars]) }}</small></span></span>
                <span role="listitem"><UiIcon name="check" /><span>{{ $t('{0} sách nói mỗi ngày',[item.limits.booksPerDay]) }}<small>{{ $t('Tối đa {0} phút / sách',[item.limits.bookMinutes]) }}</small></span></span>
                <span role="listitem"><UiIcon name="check" /><span>{{ $t('{0} giọng đọc riêng',[item.limits.maxVoices]) }}</span></span>
                <span role="listitem"><UiIcon name="check" /><span>{{ item.limits.maxRevisions==null?$t('AI chỉnh sửa không giới hạn'):$t('{0} lượt AI chỉnh sửa / sách',[item.limits.maxRevisions]) }}</span></span>
                <span role="listitem"><UiIcon name="check" /><span>{{ $t('Clone giọng với OpenVoice V2 và VieNeu') }}</span></span>
              </span>
              <span class="plan-selection"><span class="plan-radio-mark"><UiIcon v-if="plan===item.plan_class" name="check" /></span>{{ $t(plan===item.plan_class?'Đã chọn gói này':'Chọn gói này') }}</span>
            </label>
          </fieldset>
          <p class="upgrade-renewal"><UiIcon name="clock" /><span>{{ $t('Gia hạn cùng gói được cộng ngày còn lại. Nâng lên Diamond bắt đầu thời hạn mới; không quy đổi ngày Gold.') }}</span></p>
        </template>

        <template v-else>
          <div class="payment-state" role="status"><div><span class="payment-plan"><span :class="`tier-text-${order.plan_class}`">{{ order.plan_class==='gold'?'Gold':'Diamond' }}</span><span> · {{ $t(order.billing_cycle==='yearly'?'1 năm · 365 ngày':'1 tháng · 30 ngày') }}</span></span><span class="pill" :class="{green:order.status==='paid',amber:order.status==='review_required'}">{{ $t(({pending:'Đang chờ thanh toán',paid:'Đã thanh toán',expired:'Đơn đã hết hạn',cancelled:'Đã hủy',review_required:'Cần đối soát'})[order.status]) }}</span></div><strong>{{ money(order.amount_vnd) }}</strong></div>
          <template v-if="catalog.configured&&order.status==='pending'&&order.bank">
            <div class="qr-layout"><div class="qr-card"><img :src="order.qr_url" :alt="$t('Mã QR thanh toán')" width="240" height="280" referrerpolicy="no-referrer" /><p><UiIcon name="clock" />{{ $t('Mã QR còn hiệu lực: {0}',[countdown]) }}</p></div><div class="transfer-details"><h3>{{ $t('Thông tin chuyển khoản') }}</h3><dl><dt>{{ $t('Ngân hàng') }}</dt><dd>{{ order.bank.bank_code }}</dd><dt>{{ $t('Chủ tài khoản') }}</dt><dd>{{ order.bank.account_name }}</dd><dt>{{ $t('Số tài khoản') }}</dt><dd><button class="text-button" type="button" @click="copy(order.bank.account_number)">{{ order.bank.account_number }} · {{ $t('Sao chép') }}</button></dd><dt>{{ $t('Nội dung chuyển khoản') }}</dt><dd><button class="text-button payment-code" type="button" @click="copy(order.payment_code)">{{ order.payment_code }} · {{ $t('Sao chép') }}</button></dd></dl><p class="text-muted">{{ $t('Chuyển đúng nội dung và số tiền. Chỉ mở khóa sau khi hệ thống xác minh giao dịch ngân hàng.') }}</p></div></div>
            <div class="payment-actions"><button type="button" class="btn primary" :disabled="busy||!catalog.verification_available" @click="verify"><span v-if="busy" class="spinner" />{{ $t('Tôi đã chuyển khoản — Kiểm tra ngay') }}</button><button class="text-button" type="button" :disabled="busy" @click="cancel">{{ $t('Hủy đơn và chọn lại') }}</button></div>
            <p v-if="!catalog.verification_available" class="text-muted">{{ $t('Đang chờ webhook ngân hàng. Nút kiểm tra cần API đối soát SePay.') }}</p>
          </template>
          <div v-else-if="order.status==='paid'" class="payment-success"><span><UiIcon name="check" /></span><h3>{{ $t('Sẵn sàng cho những nội dung mới') }}</h3><p>{{ $t('Đã kích hoạt gói tài khoản của bạn.') }}</p><button class="btn primary" type="button" @click="close">{{ $t('Hoàn tất') }}</button></div>
          <div v-else-if="order.status==='review_required'" class="upgrade-notice"><UiIcon name="clock" /><p>{{ $t('Đã ghi nhận giao dịch cần đối soát. Không chuyển thêm tiền; hãy liên hệ quản trị viên kèm mã đơn.') }} <strong>{{ order.payment_code }}</strong></p></div>
          <template v-else><p class="text-muted">{{ $t('Nếu đã chuyển tiền, hãy kiểm tra lại hoặc liên hệ quản trị viên. Không tạo đơn mới để trả tiền lần nữa.') }}</p><div class="payment-actions"><button type="button" class="btn" :disabled="busy||!catalog.verification_available" @click="verify">{{ $t('Kiểm tra giao dịch cũ') }}</button><button type="button" class="text-button" :disabled="busy" @click="order=null">{{ $t('Chọn gói khác') }}</button></div></template>
        </template>
      </div>

      <footer v-if="catalog&&!order" class="upgrade-footer">
        <div v-if="!catalog.configured" class="upgrade-notice payment-unavailable" role="status"><UiIcon name="clock" /><p>{{ $t('Thanh toán trực tuyến chưa mở. Bạn vẫn có thể xem các gói và quyền lợi.') }}</p></div>
        <div class="upgrade-checkout"><div v-if="selected" class="checkout-total"><span>{{ $t('Tổng thanh toán') }}<b><span :class="`tier-text-${selected.plan_class}`">{{ selected.plan_class==='gold'?'Gold':'Diamond' }}</span> · {{ $t(cycle==='yearly'?'1 năm · 365 ngày':'1 tháng · 30 ngày') }}</b></span><strong>{{ money(selected.amount_vnd) }}</strong></div><button type="button" class="btn primary checkout-button" :disabled="busy||!catalog.configured||!selected" @click="create"><span v-if="busy" class="spinner" /><UiIcon v-else name="arrow" />{{ $t('Thanh toán bằng VietQR') }}</button></div>
      </footer>
    </dialog>
  </Teleport>
</template>
<style scoped>
.upgrade-dialog{font-family:var(--font-ui);font-size:14px;line-height:1.5;box-sizing:border-box;width:min(920px,calc(100vw - 40px));max-height:calc(100dvh - 48px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;margin:auto;padding:0;border:1px solid var(--line-strong);border-radius:24px;background:var(--surface);color:var(--ink);box-shadow:var(--shadow-float)}
.upgrade-dialog::backdrop{background:rgb(9 10 20 / 66%);backdrop-filter:blur(8px)}
.upgrade-header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:28px 32px 22px;border-bottom:1px solid var(--line)}
.upgrade-heading{min-width:0}.upgrade-brand{display:flex;align-items:center;gap:9px;margin-bottom:14px;font-size:10px;font-weight:700;letter-spacing:.14em;color:var(--muted)}.upgrade-brand b{margin-left:3px;color:var(--accent)}.upgrade-brand-icon{display:block;width:25px;height:25px;flex-shrink:0}
.upgrade-heading h2{margin:0;font-size:26px;line-height:1.3;font-weight:720;letter-spacing:-.8px}.upgrade-heading>p{margin:8px 0 0;color:var(--muted);font-size:13px;line-height:1.6}
.upgrade-header .upgrade-close{width:34px;height:34px;min-height:34px;flex-shrink:0;padding:0;border-radius:50%;background:var(--surface-raised);border-color:transparent;color:var(--muted)}.upgrade-close .ui-icon{width:17px;height:17px}
.upgrade-content{padding:24px 32px}.upgrade-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.current-plan{display:flex;gap:9px;align-items:center;color:var(--muted);font-size:12px}.current-plan strong{font-size:12px;font-weight:700;color:var(--ink)}.current-plan .plan-free-pill{padding:4px 9px;background:var(--surface-raised);border:1px solid var(--line);border-radius:7px}
.billing-switch{display:flex;gap:3px;margin:0;padding:4px;border:1px solid var(--line);border-radius:10px;background:var(--surface-raised)}.billing-switch label{position:relative;padding:7px 15px;border-radius:7px;font-size:12px;font-weight:600;color:var(--muted);cursor:pointer;transition:background .18s,color .18s,box-shadow .18s}.billing-switch label.active{background:var(--surface);color:var(--ink);box-shadow:0 1px 4px rgb(0 0 0 / 10%)}
.upgrade-radio{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.billing-switch label:has(.upgrade-radio:focus-visible),.plan-card:has(.upgrade-radio:focus-visible){outline:2px solid var(--focus);outline-offset:3px}
.upgrade-plans{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));align-items:stretch;gap:18px;min-width:0;margin:0;padding:0;border:0}.plan-card{position:relative;display:flex;flex-direction:column;min-width:0;padding:22px;border:1.5px solid var(--line-strong);border-radius:16px;background:var(--surface);cursor:pointer;transition:border-color .18s,box-shadow .18s,background .18s}
.plan-card.gold{border-color:var(--gold-border);background:linear-gradient(155deg,color-mix(in srgb,var(--gold-bg) 55%,var(--surface)),var(--surface) 65%)}
.plan-card.gold:hover,.plan-card.gold.selected{border-color:var(--gold-border);background:linear-gradient(155deg,color-mix(in srgb,var(--gold-bg) 78%,var(--surface)),var(--surface) 78%);box-shadow:0 0 0 1.5px var(--gold-border),0 8px 24px -6px var(--gold-glow)}
.plan-card.diamond{border-color:var(--diamond-border);background:linear-gradient(155deg,color-mix(in srgb,var(--diamond-bg) 55%,var(--surface)),var(--surface) 65%)}
.plan-card.diamond:hover,.plan-card.diamond.selected{border-color:var(--diamond-border);background:linear-gradient(155deg,color-mix(in srgb,var(--diamond-bg) 78%,var(--surface)),var(--surface) 78%);box-shadow:0 0 0 1.5px var(--diamond-border),0 8px 24px -6px var(--diamond-glow)}
.plan-card-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px}.plan-icon{position:relative;overflow:visible;display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--line);border-radius:11px;background:var(--surface-raised);color:var(--muted)}.plan-icon .ui-icon{width:19px;height:19px}.plan-tag{font-size:10.5px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted);text-align:right;background:var(--surface-raised)}.plan-tag.gold{color:var(--gold-ink);background:var(--gold-bg);border-color:var(--gold-border)}.plan-tag.diamond{color:var(--diamond-ink);background:var(--diamond-bg);border-color:var(--diamond-border)}
.plan-name-wrap{display:inline-flex;align-items:center;margin-top:2px}.plan-name{font-size:20px;font-weight:750;line-height:1.3;letter-spacing:-.4px}.plan-description{font-size:13px;line-height:1.65;color:var(--muted);margin-top:8px}.plan-price{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px;margin-top:20px;font-variant-numeric:tabular-nums}.plan-price strong{font-size:32px;font-weight:720;line-height:1.2;letter-spacing:-1.1px}.plan-price>span{font-size:12px;color:var(--muted)}.plan-term{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-height:26px;margin-top:6px;font-size:10px;color:var(--muted)}.plan-saving{display:inline-flex;padding:3px 6px;border-radius:5px;background:var(--success-bg);color:var(--success);font-weight:600}
.plan-features{display:grid;gap:13px;margin-top:20px;padding-top:20px;border-top:1px solid var(--line)}.plan-features>[role=listitem]{display:flex;align-items:flex-start;gap:9px;font-size:13px;line-height:1.6;color:var(--text-body)}.plan-features .ui-icon{width:15px;height:15px;color:var(--accent);margin-top:2px}.plan-card.gold .plan-features .ui-icon{color:var(--gold-ink)}.plan-card.diamond .plan-features .ui-icon{color:var(--diamond-ink)}.plan-features small{display:block;color:var(--muted);font-size:12px;margin-top:1px}.plan-selection{display:flex;align-items:center;gap:8px;margin-top:auto;padding-top:22px;font-size:11px;font-weight:650;color:var(--muted)}.plan-card.gold.selected .plan-selection{color:var(--gold-ink)}.plan-card.diamond.selected .plan-selection{color:var(--diamond-ink)}.plan-radio-mark{width:17px;height:17px;display:grid;place-items:center;border:1.5px solid var(--line-strong);border-radius:50%;background:var(--surface)}.plan-card.gold.selected .plan-radio-mark{border-color:var(--gold-border);background:linear-gradient(135deg,#d97706,#f59e0b);color:#ffffff}.plan-card.diamond.selected .plan-radio-mark{border-color:var(--diamond-border);background:linear-gradient(135deg,#0284c7,#6366f1);color:#ffffff}.plan-radio-mark .ui-icon{width:11px;height:11px}
.upgrade-renewal{display:flex;align-items:flex-start;gap:8px;font-size:11px;line-height:1.7;color:var(--muted);margin:18px 0 0}.upgrade-renewal .ui-icon{width:14px;height:14px;margin-top:2px}
.upgrade-footer{padding:18px 32px 22px;border-top:1px solid var(--line);background:var(--surface-raised)}.upgrade-notice{display:flex;align-items:flex-start;gap:9px;margin:0 0 18px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface-raised);font-size:12px;line-height:1.6;color:var(--muted)}.upgrade-notice .ui-icon{width:16px;height:16px;margin-top:2px}.upgrade-notice p{margin:0}.upgrade-error{color:var(--danger);background:var(--danger-bg);border-color:var(--danger-line)}.upgrade-demo{margin-bottom:18px}.payment-unavailable{padding:0;border:0;background:transparent;margin-bottom:16px;font-size:11px}
.upgrade-checkout{display:flex;justify-content:space-between;align-items:center;gap:20px}.checkout-total{display:flex;align-items:center;gap:24px;min-width:0}.checkout-total>span{font-size:10px;color:var(--muted)}.checkout-total b{display:block;margin-top:3px;font-size:11px;font-weight:550;color:var(--text-body)}.checkout-total>strong{font-size:22px;letter-spacing:-.6px;white-space:nowrap;font-variant-numeric:tabular-nums}.upgrade-checkout .checkout-button{min-height:44px;padding:11px 20px;white-space:nowrap;font-size:12px;border-radius:10px}.checkout-button .ui-icon{width:16px;height:16px}
.upgrade-loading{min-height:180px;display:flex;gap:10px;align-items:center;justify-content:center;color:var(--muted);font-size:13px}.payment-state{display:flex;align-items:center;justify-content:space-between;gap:18px;padding-bottom:22px;margin-bottom:22px;border-bottom:1px solid var(--line)}.payment-state>div{display:grid;gap:10px}.payment-plan{font-size:17px;font-weight:650}.payment-plan>span{font-size:12px;font-weight:400;color:var(--muted)}.payment-state strong{font-size:27px;font-weight:700;letter-spacing:-.7px;white-space:nowrap}
.qr-layout{display:grid;grid-template-columns:270px minmax(0,1fr);gap:28px;align-items:start}.qr-card{padding:14px;border:1px solid var(--line);border-radius:14px;background:var(--surface-raised)}.qr-card img{display:block;width:100%;max-width:240px;height:auto;min-height:240px;object-fit:contain;border-radius:8px;background:white;margin:auto}.qr-card>p{display:flex;align-items:center;justify-content:center;gap:7px;font-size:11px;color:var(--muted);margin:13px 0 0}.qr-card>p .ui-icon{width:14px;height:14px}.transfer-details h3{font-size:15px;font-weight:650;margin:0 0 14px}.transfer-details dl{margin:0}.transfer-details dt{color:var(--muted);font-size:11px;margin-top:14px}.transfer-details dd{margin:4px 0;font-size:13px;font-weight:550;overflow-wrap:anywhere}.transfer-details .text-button{font-size:13px;text-align:left}.transfer-details .payment-code{padding:8px 11px;border:1px solid var(--accent-line);border-radius:8px;background:var(--accent-soft);font-variant-numeric:tabular-nums}.transfer-details>p{font-size:11px;margin-top:18px}.payment-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:24px}.payment-actions>.btn{font-size:12px}.payment-actions>.text-button{font-size:11px}
.payment-success{display:grid;justify-items:center;text-align:center;padding:22px 0 28px;gap:12px}.payment-success>span{display:grid;place-items:center;width:52px;height:52px;border-radius:50%;background:var(--success-bg);color:var(--success)}.payment-success>span .ui-icon{width:24px;height:24px}.payment-success h3{font-size:20px;letter-spacing:-.4px;margin:4px 0 0}.payment-success p{font-size:13px;color:var(--muted);margin:0 0 10px}
@media(max-width:700px){.upgrade-dialog{width:calc(100vw - 24px);max-height:calc(100dvh - 24px);border-radius:20px}.upgrade-header{padding:22px 20px 18px;gap:14px}.upgrade-heading h2{font-size:23px}.upgrade-content{padding:20px}.upgrade-footer{padding:16px 20px 20px}.upgrade-plans{gap:12px}.plan-card{padding:17px}.plan-price strong{font-size:28px}.plan-description{min-height:40px}.plan-card-top{flex-wrap:wrap;gap:8px}.checkout-total{gap:14px}.upgrade-checkout{gap:14px}.upgrade-checkout .checkout-button{padding:11px 13px}.qr-layout{grid-template-columns:230px minmax(0,1fr);gap:18px}}
@media(max-width:520px){.upgrade-heading h2{font-size:21px}.upgrade-heading>p{font-size:12px}.upgrade-brand{font-size:9px;margin-bottom:12px}.upgrade-toolbar{align-items:flex-start;gap:12px;flex-direction:column}.billing-switch{align-self:stretch}.billing-switch label{flex:1;text-align:center}.upgrade-plans{grid-template-columns:1fr}.plan-card{padding:20px}.plan-card-top{flex-wrap:nowrap}.plan-description{min-height:0}.plan-price strong{font-size:31px}.plan-features{gap:11px}.plan-selection{padding-top:18px}.upgrade-renewal{font-size:10px}.upgrade-checkout{align-items:stretch;flex-direction:column;gap:16px}.checkout-total{justify-content:space-between}.checkout-total>strong{font-size:23px}.upgrade-checkout .checkout-button{width:100%}.qr-layout{grid-template-columns:1fr}.qr-card{max-width:280px;width:100%;margin:auto}.payment-state{align-items:flex-start;flex-direction:column}.payment-state strong{font-size:25px}.payment-actions{align-items:stretch;flex-direction:column}.payment-actions>.text-button{justify-content:center}}
@media(prefers-reduced-motion:reduce){.billing-switch label,.plan-card{transition:none}}
</style>
