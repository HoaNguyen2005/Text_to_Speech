import { computed, ref } from 'vue';
import { session, refreshSession } from '@/services/auth';
export const upgradeOpen = ref(false);
export const requestedOrderId = ref(null);
export const openUpgrade = (id=null) => { requestedOrderId.value=id; upgradeOpen.value = true; };
export function useAccountTier() {
  const tier = computed(() => session.value?.tier_info);
  return { tier, limits:computed(()=>tier.value?.limits||{lectureChars:5000,bookChars:150000,bookMinutes:15,maxRevisions:2}),
    usage:computed(()=>tier.value?.usage||{}),refreshTier:refreshSession,openUpgrade };
}
