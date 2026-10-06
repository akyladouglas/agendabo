<script setup lang="ts">
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/app/utils/cn';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-(--radius) text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-border bg-transparent hover:bg-muted',
        ghost: 'hover:bg-muted',
        destructive: 'bg-destructive text-white hover:bg-destructive/90',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-10 px-6',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

interface Props extends /* @vue-ignore */ VariantProps<typeof buttonVariants> {
  disabled?: boolean;
  type?: 'button' | 'submit';
}
defineProps<Props>();
</script>

<template>
  <button
    :type="type ?? 'button'"
    :disabled="disabled"
    :class="cn(buttonVariants({ variant, size }), $attrs.class)"
  >
    <slot />
  </button>
</template>
