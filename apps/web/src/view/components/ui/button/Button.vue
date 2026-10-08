<template>
  <button
    :type="props.type ?? 'button'"
    :disabled="props.disabled"
    :class="cn(buttonVariants({ variant: props.variant, size: props.size }), $attrs.class as string)"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/app/utils/cn';

/**
 * Botão padrão da web (protótipo OpenDesign): verde cheio, raios md, alvos de toque
 * ≥44px <md (`min-h-11 min-w-11`, spec B15 — por variante, não por remendo).
 * `variant`/`size` entram no cva por `props` (o template não os desembrulha);
 * `inheritAttrs` padrão deixa style/class/listeners caírem no <button> (single root).
 */
interface Props extends /* @vue-ignore */ VariantProps<typeof buttonVariants> {
  disabled?: boolean;
  type?: 'button' | 'submit';
}
const props = defineProps<Props>();

const buttonVariants = cva(
  'od-move inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-transparent text-foreground hover:bg-muted',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-danger text-danger-foreground hover:bg-danger/90',
        /** pill de ação discreta (aprovar/corrigir da fila — mock). */
        soft: 'bg-surface-2 text-foreground border border-border hover:border-primary/50',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-9 min-h-9 px-3 text-xs md:min-h-11',
        lg: 'h-12 px-6 text-base',
        icon: 'h-11 w-11 min-h-11 px-0',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);
</script>
