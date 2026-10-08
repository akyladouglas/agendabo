<template>
  <DropdownMenuRoot>
    <DropdownMenuTrigger
      :aria-label="props.ariaLabel ?? 'Mais ações'"
      :class="
        cn(
          'od-move flex h-11 w-11 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground',
          props.class,
        )
      "
    >
      <MoreHorizontal class="h-5 w-5" />
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      class="od-move z-50 min-w-44 rounded-lg border border-border bg-card p-1 shadow-xl"
    >
      <DropdownMenuItem
        v-for="item in props.items"
        :key="item.key"
        :class="
          cn(
            'flex min-h-11 cursor-pointer select-none items-center rounded-md px-3 text-sm outline-none data-[highlighted]:bg-muted',
            item.danger && 'text-danger',
          )
        "
        @select="emit('pick', item.key)"
      >
        {{ item.label }}
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenuRoot>
</template>

<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
} from 'radix-vue';
import { MoreHorizontal } from 'lucide-vue-next';
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

/** Dropdown "⋯" (ações da fila que apertam no mobile — spec B14). Burro. */
const props = defineProps<{
  items: { key: string; label: string; danger?: boolean }[];
  ariaLabel?: string;
  class?: HTMLAttributes['class'];
}>();

const emit = defineEmits<{ pick: [string] }>();
</script>
