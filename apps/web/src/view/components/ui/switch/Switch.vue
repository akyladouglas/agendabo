<template>
  <SwitchRoot
    :id="props.id"
    :checked="props.modelValue"
    :disabled="props.disabled"
    :class="
      cn(
        // visual compacto; o alvo de toque (>=44px) vem do padding vertical no
        // wrapper da pagina, nao da pinta do controle
        'od-move relative inline-flex h-7 w-[46px] shrink-0 items-center rounded-full border border-border bg-surface-2 px-1 data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:pointer-events-none disabled:opacity-50',
        props.class,
      )
    "
    @update:checked="emit('update:modelValue', Boolean($event))"
  >
    <SwitchThumb
      class="od-move block h-5 w-5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-[18px]"
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
