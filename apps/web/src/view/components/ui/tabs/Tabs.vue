<template>
  <TabsRoot
    :model-value="props.modelValue"
    :aria-label="props.ariaLabel"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <!-- TabsIndicator NÃO pode ser filho direto de TabsRoot: o radix-vue faz
         `deactivate()` dele no unmount e quebra (nextSibling null) ao trocar o
         conteúdo externo junto com as tabs. O componente já não renderiza nada
         visível aqui (era `class="hidden"`). -->
    <TabsList
      :class="
        cn(
          'od-move inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 p-1',
          props.class,
        )
      "
    >
      <TabsTrigger
        v-for="opt in props.options"
        :key="opt.value"
        :value="opt.value"
        class="od-move min-h-9 rounded-full px-4 text-sm font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground md:min-h-10"
      >
        {{ opt.label }}
      </TabsTrigger>
    </TabsList>
  </TabsRoot>
</template>

<script setup lang="ts">
import { TabsList, TabsRoot, TabsTrigger } from 'radix-vue';
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

/** Tabs segmentadas (mock: Dia | Semana). Burra: opções vêm por prop. */
const props = withDefaults(
  defineProps<{
    modelValue: string;
    options: { value: string; label: string }[];
    ariaLabel?: string;
    class?: HTMLAttributes['class'];
  }>(),
  { ariaLabel: undefined, class: undefined },
);

const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>
