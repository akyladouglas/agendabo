<template>
  <label :class="cn('text-sm font-medium text-foreground', props.class)">
    <slot />
  </label>
</template>

<script setup lang="ts">
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>
