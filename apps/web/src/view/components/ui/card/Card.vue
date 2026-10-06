<script setup lang="ts">
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>

<template>
  <div :class="cn('rounded-(--radius) border border-border bg-card p-6 text-card-foreground shadow-sm', props.class)">
    <slot />
  </div>
</template>
