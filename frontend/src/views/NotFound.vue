<script setup>
import UiIcon from '@/components/UiIcon.vue';
</script>

<template>
  <section class="panel empty-state">
    <div class="empty-icon"><UiIcon name="document" /></div>
    <p class="eyebrow" style="justify-content: center;">404</p>
    <h1>{{ $t("Không tìm thấy trang") }}</h1>
    <p>{{ $t("Trang bạn đang tìm có thể đã chuyển địa chỉ. Hãy trở về không gian làm việc để tiếp tục.") }}</p>
    <router-link to="/" class="btn primary">{{ $t("Về trang chủ") }}<UiIcon name="arrow" /></router-link>
  </section>
</template>
