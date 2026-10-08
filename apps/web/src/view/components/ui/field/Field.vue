<template>
  <div
    :class="
      cn(
        'flex min-h-11 flex-col gap-1.5',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

const props = defineProps<{ class?: HTMLAttributes['class'] }>();
</script>
