<template>
  <SwitchRoot
    :id="props.id"
    :model-value="props.modelValue"
    :disabled="props.disabled"
    :class="
      cn(
        'od-move relative inline-flex h-11 w-[60px] shrink-0 items-center rounded-full border border-border bg-surface-2 px-1 data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:pointer-events-none disabled:opacity-50',
        props.class,
      )
    "
    @update:model-value="emit('update:modelValue', Boolean($event))"
  >
    <SwitchThumb
      class="od-move block h-8 w-8 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-5"
    />
  </SwitchRoot>
</template>

<script setup lang="ts">
import { SwitchRoot, SwitchThumb } from 'radix-vue';
import { cn } from '@/app/utils/cn';
import type { HTMLAttributes } from 'vue';

/** Switch acessível (perfil: ligar/desligar o resumo). Alvo ≥44px de altura. */
const props = defineProps<{
  modelValue: boolean;
  disabled?: boolean;
  id?: string;
  class?: HTMLAttributes['class'];
}>();

const emit = defineEmits<{ 'update:modelValue': [boolean] }>();
</script>
