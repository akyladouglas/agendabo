<template>
  <div
    role="status"
    aria-label="Carregando"
    :class="cn('animate-pulse-soft rounded-md bg-surface-2', props.class)"
  />
</template>

<script setup lang="ts">
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

/** Skeleton de lista (D6): 3 pulsos de 1.4s; respeita prefers-reduced-motion. */
const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>
