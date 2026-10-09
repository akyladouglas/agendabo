<template>
  <SelectRoot
    :model-value="props.modelValue"
    @update:model-value="emit('update:modelValue', String($event))"
  >
    <SelectTrigger
      :id="props.id"
      :data-testid="props.testId"
      :class="
        cn(
          'od-move flex h-11 w-full items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-left text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          props.class,
        )
      "
    >
      <SelectValue :placeholder="props.placeholder" />
      <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper"
        :class="
          'od-move z-50 max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-border bg-card shadow-xl'
        "
      >
        <SelectViewport class="p-1">
          <SelectItem
            v-for="opt in props.options"
            :key="opt.value"
            :value="opt.value"
            class="relative flex min-h-11 cursor-pointer select-none items-center rounded-md py-2 pl-8 pr-3 text-sm text-foreground outline-none data-[highlighted]:bg-muted"
          >
            <!-- radix-vue 1.9: SelectItem sò renderiza o slot `default` (o slot
                 nomeado `indicator` e engolido). O indicador fica dentro do
                 default, posicionado absolute p/ esquerda; o rotulo vai em
                 SelectItemText (o typeahead do select le SO ele — por isso o
                 Check nao pode estar dentro dele). -->
            <SelectItemIndicator class="absolute left-2 inline-flex items-center">
              <Check class="h-4 w-4 text-primary" />
            </SelectItemIndicator>
            <SelectItemText>{{ opt.label }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<script setup lang="ts">
import {
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from 'radix-vue';
import { Check, ChevronDown } from 'lucide-vue-next';
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

/** Select acessível (fuso IANA, hora do resumo, ir-para da agenda). Burro: opções por prop. */
const props = defineProps<{
  modelValue: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  id?: string;
  /** data-testid no gatilho (testes de fluxo; o popper vive em portal). */
  testId?: string;
  class?: HTMLAttributes['class'];
}>();

const emit = defineEmits<{ 'update:modelValue': [string] }>();
</script>
