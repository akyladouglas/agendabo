<template>
  <div class="flex flex-col gap-2">
    <div
      v-if="props.modelValue.length"
      class="flex flex-wrap gap-1.5"
      data-testid="rules-chips"
    >
      <span
        v-for="(rule, i) in props.modelValue"
        :key="`${rule.type}-${i}`"
        class="contents"
      >
        <AppBadge tone="info">
          {{ label(rule) }}
          <button
            type="button"
            class="ml-1 flex h-5 w-5 items-center justify-center rounded-full hover:bg-info/20"
            :aria-label="`Remover lembrete ${label(rule)}`"
            @click="remove(i)"
          >
            <X class="h-3 w-3" />
          </button>
        </AppBadge>
      </span>
    </div>
    <p
      v-else
      class="text-xs text-muted-foreground"
    >
      Sem lembretes.
    </p>

    <div
      v-if="(props.modelValue.length < (props.max ?? MAX_DEFAULT))"
      class="flex flex-wrap items-center gap-2"
    >
      <select
        v-model="draftType"
        class="h-11 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
        aria-label="Tipo de lembrete"
      >
        <option value="before_hours">
          horas antes
        </option>
        <option value="before_days">
          dias antes
        </option>
        <option value="countdown_3_2_1">
          contagem 3-2-1
        </option>
        <option value="none">
          sem lembrete
        </option>
      </select>
      <input
        v-if="needsValue()"
        v-model.number="draftValue"
        type="number"
        min="1"
        max="365"
        class="h-11 w-20 rounded-md border border-border bg-surface px-2 text-sm text-foreground"
        :aria-label="unit()"
      >
      <AppButton
        variant="soft"
        size="sm"
        :disabled="draftType !== 'none' && !draftValue"
        @click="add"
      >
        <Plus
          class="h-4 w-4"
          aria-hidden="true"
        />
        Adicionar
      </AppButton>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Editor declarativo de regras de lembrete (spec A.4): lista de chips dentro de
 * `notificationRuleInputSchema[]` (máx. 10). Burro: recebe/emite as regras; a
 * validação zod é do form. Rótulos vêm do protótipo (a label de domínio
 * `ruleLabelPtBr` recebe a forma do schedule-core, não o formato de input).
 */
import { ref } from 'vue';
import { Plus, X } from 'lucide-vue-next';
import type { NotificationRuleInput } from '@agendabo/contracts';
import AppBadge from '@/view/components/ui/badge/Badge.vue';
import AppButton from '@/view/components/ui/button/Button.vue';

const props = defineProps<{ modelValue: NotificationRuleInput[]; max?: number }>();
const emit = defineEmits<{ 'update:modelValue': [NotificationRuleInput[]] }>();

const MAX_DEFAULT = 10;

const draftType = ref<NotificationRuleInput['type']>('before_hours');
const draftValue = ref<number | null>(24);

const needsValue = () => draftType.value === 'before_hours' || draftType.value === 'before_days';

const unit = () => (draftType.value === 'before_hours' ? 'hora(s) antes' : 'dia(s) antes');

function label(rule: NotificationRuleInput): string {
  switch (rule.type) {
    case 'none':
      return 'sem lembrete';
    case 'before_hours':
      return `${rule.value}h antes`;
    case 'before_days':
      return `${rule.value} dia(s) antes`;
    case 'countdown_3_2_1':
      return 'contagem 3-2-1';
  }
}

function add(): void {
  const max = props.max ?? MAX_DEFAULT;
  if (props.modelValue.length >= max) return;
  if (draftType.value === 'none') {
    emit('update:modelValue', [{ type: 'none' }]);
    return;
  }
  const value = draftValue.value;
  if (needsValue() && (!value || value < 1)) return;
  const rule: NotificationRuleInput = needsValue()
    ? { type: draftType.value, value: value ?? undefined }
    : { type: draftType.value };
  const withoutNone = props.modelValue.filter((r) => r.type !== 'none');
  emit('update:modelValue', [...withoutNone, rule]);
}

function remove(index: number): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
}
</script>
