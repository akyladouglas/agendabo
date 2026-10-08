<template>
  <span
    :class="
      cn(
        'inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium',
        tones[props.tone],
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

/**
 * Badge pill (mock): `pendente de revisão` = warning outline; chip de origem
 * `via bot`/`via web` = info/success sutil. Componente BURRO — quem decide o tom
 * é a página, a partir do status/origem do DTO.
 */
const props = withDefaults(
  defineProps<{ class?: HTMLAttributes['class']; tone?: 'warning' | 'info' | 'success' | 'danger' | 'muted' }>(),
  { tone: 'muted', class: undefined },
);

const tones: Record<string, string> = {
  warning: 'border-warning/60 text-warning bg-warning/10',
  info: 'border-info/40 text-info bg-info/10',
  success: 'border-primary/50 text-primary bg-primary/10',
  danger: 'border-danger/60 text-danger bg-danger/10',
  muted: 'border-border text-muted-foreground bg-transparent',
};
</script>
