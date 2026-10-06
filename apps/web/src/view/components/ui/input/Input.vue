<script setup lang="ts">
import { useForwardProps } from 'radix-vue';
import { computed, type HTMLAttributes } from 'vue';
import { cn } from '@/app/utils/cn';

const props = defineProps<{ class?: HTMLAttributes['class']; type?: string }>();
const delegated = computed(() => ({ type: props.type ?? 'text' }));
const forwarded = useForwardProps(delegated);
</script>

<template>
  <input
    v-bind="forwarded"
    :class="
      cn(
        'flex h-9 w-full rounded-(--radius) border border-border bg-card px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50',
        props.class,
      )
    "
  >
</template>
