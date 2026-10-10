<template>
  <div
    v-if="totalPages > 1"
    class="flex items-center justify-end gap-2"
  >
    <button
      class="min-h-11 rounded-md border border-border px-3 text-sm disabled:opacity-50"
      :disabled="page === 0"
      aria-label="Página anterior"
      @click="emit('update:page', page - 1)"
    >
      ‹
    </button>
    <span class="text-xs text-muted-foreground">página {{ page + 1 }} de {{ totalPages }}</span>
    <button
      class="min-h-11 rounded-md border border-border px-3 text-sm disabled:opacity-50"
      :disabled="page + 1 >= totalPages"
      aria-label="Próxima página"
      @click="emit('update:page', page + 1)"
    >
      ›
    </button>
  </div>
</template>

<script setup lang="ts">
/** Pager discreto (50/página) — burrinho, só emite a página desejada. */
defineProps<{ page: number; totalPages: number }>();
const emit = defineEmits<{ 'update:page': [page: number] }>();
</script>
