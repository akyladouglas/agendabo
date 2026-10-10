<template>
  <details class="w-full">
    <summary class="cursor-pointer text-xs text-muted-foreground">
      detalhes
    </summary>
    <pre class="mt-2 overflow-x-auto rounded-md bg-surface-2 p-3 font-mono text-xs text-foreground">{{ pretty }}</pre>
  </details>
</template>

<script setup lang="ts">
/** metadata crua da auditoria em <details> (JSON formatado — nada se perde). */
import { computed } from 'vue';

const props = defineProps<{ metadata: unknown }>();
const pretty = computed(() => JSON.stringify(props.metadata, null, 2));
</script>
