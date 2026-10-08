<template>
  <DialogRoot
    :open="props.open"
    @update:open="emit('update:open', $event)"
  >
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in" />
      <DialogContent
        :class="
          cn(
            'fixed z-50 flex flex-col border border-border bg-card text-card-foreground shadow-xl focus:outline-none',
            // mobile: bottom-sheet
            'inset-x-0 bottom-0 max-h-[94dvh] rounded-t-2xl',
            // tablet/desktop: centralado, máx 560px, raio 16
            'md:inset-x-auto md:left-1/2 md:top-1/2 md:max-h-[88dvh] md:w-full md:max-w-[560px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
            props.class,
          )
        "
      >
        <div class="flex flex-row items-center gap-2 border-b border-border px-4 py-3 md:px-6">
          <DialogTitle class="title-modal flex-1 font-heading">
            {{ props.title }}
          </DialogTitle>
          <DialogClose
            class="od-move -mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Fechar"
          >
            <X class="h-5 w-5" />
          </DialogClose>
        </div>
        <DialogDescription
          v-if="props.description"
          class="sr-only"
        >
          {{ props.description }}
        </DialogDescription>
        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
          <slot />
        </div>
        <div
          v-if="$slots.footer"
          class="sticky bottom-0 border-t border-border bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6"
        >
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'radix-vue';
import { X } from 'lucide-vue-next';
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

/**
 * Dialog compartilhado (D4): <md é bottom-sheet (painel de borda a borda na base,
 * máx 94dvh, rolável, footer fixo via slot `footer`); ≥md é dialog centralado
 * max-w-lg com raio lg (mock). Foco preso/Esc: radix entrega (spec 18/a11y).
 */
const props = defineProps<{
  open?: boolean;
  title: string;
  description?: string;
  class?: HTMLAttributes['class'];
}>();

const emit = defineEmits<{ 'update:open': [boolean] }>();
</script>
