<script setup>
defineProps({
  metadata: { type: Object, default: null },
  fallbackTitle: { type: String, default: '' },
});
</script>

<template>
  <section class="book-attribution" :aria-label="$t('Thông tin nguồn sách')">
    <span class="pill purple">{{ $t("Bản tóm tắt do AI hỗ trợ") }}</span>
    <dl>
      <div><dt>{{ $t("Sách / tài liệu") }}</dt><dd>{{ metadata?.title || fallbackTitle || $t("Chưa cung cấp") }}</dd></div>
      <div><dt>{{ $t("Tác giả") }}</dt><dd>{{ metadata?.author || $t("Chưa cung cấp") }}</dd></div>
      <div><dt>{{ $t("Nguồn") }}</dt><dd>{{ metadata?.source || $t("Chưa cung cấp") }}</dd></div>
    </dl>
    <p>{{ $t("Thông tin nguồn do người tạo cung cấp. Hãy đối chiếu tác phẩm gốc khi cần thông tin chi tiết.") }}</p>
  </section>
</template>
