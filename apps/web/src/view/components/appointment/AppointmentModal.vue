<template>
  <AppDialog
    :open="props.open"
    :title="titles[props.mode]"
    :description="props.mode === 'review' ? 'Ajuste os dados e aprove o compromisso sugerido pelo bot.' : undefined"
    @update:open="emit('update:open', $event)"
  >
    <form
      v-if="form"
      id="appointment-form"
      class="flex flex-col gap-4"
      novalidate
      @submit.prevent="onSave"
    >
      <AppField>
        <AppLabel for="ap-title">
          Título
        </AppLabel>
        <AppInput
          id="ap-title"
          v-model="form.values.title"
          type="text"
          maxlength="200"
          placeholder="Corte de cabelo"
          @input="form.invalidateCheck()"
        />
      </AppField>

      <div class="grid grid-cols-2 gap-3">
        <AppField>
          <AppLabel for="ap-date">
            Data
          </AppLabel>
          <AppInput
            id="ap-date"
            v-model="form.values.date"
            type="date"
            @change="form.invalidateCheck()"
          />
        </AppField>
        <AppField>
          <AppLabel for="ap-time">
            Início
          </AppLabel>
          <AppInput
            id="ap-time"
            v-model="form.values.time"
            type="time"
            @change="form.invalidateCheck()"
          />
        </AppField>
      </div>

      <AppField>
        <AppLabel for="ap-duration">
          Duração (minutos)
        </AppLabel>
        <AppInput
          id="ap-duration"
          v-model.number="form.values.durationMinutes"
          type="number"
          min="5"
          step="5"
          @input="form.invalidateCheck()"
        />
        <p
          v-if="preview"
          class="text-xs text-muted-foreground"
          data-testid="form-range-preview"
        >
          {{ preview }}
        </p>
      </AppField>

      <AppField>
        <AppLabel>
          Regras de lembrete
        </AppLabel>
        <RulesEditor v-model="form.values.rules" />
        <p
          v-if="form.retroactiveCount.value > 0"
          class="text-xs text-warning"
          data-testid="form-retroactive"
        >
          ⏰ {{ form.retroactiveCount.value }}
          lembrete(s) não vão disparar — o horário deles já passou.
        </p>
      </AppField>

      <AppField>
        <AppLabel for="ap-notes">
          Notas
        </AppLabel>
        <AppTextarea
          id="ap-notes"
          v-model="form.values.notes"
          maxlength="2000"
          placeholder="Opcional"
        />
      </AppField>

      <p
        v-if="form.conflictWarning.value"
        class="rounded-md border border-warning/60 bg-warning/10 px-3 py-2 text-sm text-warning"
        role="alert"
        data-testid="form-conflict"
      >
        {{ form.conflictWarning.value }} — dois compromissos nunca ficam sobrepostos; escolha uma
        jogada abaixo ou ajuste o horário.
      </p>

      <!-- Reagendamento Assistido (Etapa 0, fecha C.11): jogadas vêm prontas do
           server (planRelocation) — este template só presentationa. -->
      <div
        v-if="form.relocationLoading.value"
        class="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        role="status"
        data-testid="relocation-loading"
      >
        Procurando como encaixar…
      </div>
      <div
        v-else-if="form.relocationBlocked.value"
        class="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
        data-testid="relocation-blocked"
      >
        Não há como encaixar sem sobreposição. Ajuste o horário para um espaço livre.
      </div>
      <div
        v-else-if="form.relocationOptions.value"
        class="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3"
        role="group"
        aria-label="Reagendamento Assistido"
        data-testid="relocation-section"
      >
        <p class="text-sm font-medium text-foreground">
          Reagendamento Assistido
        </p>
        <AppButton
          v-for="(option, index) in form.relocationOptions.value"
          :key="`${option.kind}-${index}`"
          variant="outline"
          class="justify-start text-left"
          :data-testid="`relocation-${option.kind}`"
          :disabled="form.submitting.value"
          @click="onRelocate(option)"
        >
          {{ relocationLabel(option) }}
        </AppButton>
        <AppButton
          variant="ghost"
          class="justify-start text-muted-foreground"
          data-testid="relocation-cancel"
          @click="form.closeRelocation()"
        >
          Cancelar
        </AppButton>
      </div>

      <p
        v-if="form.invalidMessage.value"
        class="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        {{ form.invalidMessage.value }}
      </p>
      <p
        v-if="form.submitError.value"
        class="rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
        role="alert"
      >
        {{ form.submitError.value }}
      </p>
    </form>

    <template #footer>
      <div class="flex justify-end gap-2">
        <AppButton
          variant="outline"
          @click="emit('update:open', false)"
        >
          Cancelar
        </AppButton>
        <AppButton
          type="submit"
          form="appointment-form"
          :disabled="!form || form.submitting.value || form.relocationBlocked.value"
        >
          {{ props.mode === 'review' ? 'Aprovar' : 'Salvar' }}
        </AppButton>
      </div>
    </template>
  </AppDialog>
</template>

<script setup lang="ts">
/**
 * Modal único de compromisso (D4): criar / editar / corrigir-revisão. É casca —
 * toda a lógica (zod, check-conflict, droppedRules, UTC) mora em
 * `useAppointmentForm`, (re)construído a cada ABERTURA com as props atuais.
 * <md vira bottom-sheet pelo AppDialog.
 */
import { computed, ref, shallowRef, watch } from 'vue';
import { useAppointmentForm, type AppointmentFormMode, type AppointmentPreset } from '@/app/composables/useAppointmentForm.composable';
import type { AppointmentDto, RelocationOptionDto, ReviewAppointmentDto } from '@agendabo/contracts';
import { formatDateTimeInTz, formatDayHeading, formatRangeInTz } from '@/app/utils/tz';
import AppDialog from '@/view/components/ui/dialog/Dialog.vue';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppField from '@/view/components/ui/field/Field.vue';
import AppInput from '@/view/components/ui/input/Input.vue';
import AppLabel from '@/view/components/ui/label/Label.vue';
import AppTextarea from '@/view/components/ui/textarea/Textarea.vue';
import RulesEditor from './RulesEditor.vue';

const props = defineProps<{
  open: boolean;
  mode: AppointmentFormMode;
  appointment?: AppointmentDto | ReviewAppointmentDto;
  /**
   * Preset de criação (clique no calendário): `date` SEMPRE; `hour` "HH:mm" quando
   * a célula tinha hora (grade do Dia, Etapa 1.3). Sem `hour` o form mantém o
   * default 09:00 local (Aberto #5).
   */
  preset?: AppointmentPreset;
  /**
   * Aberto POR UM DROP com conflito (Etapa 2.3): o form já nasce no horário
   * candidato e PEDA as jogadas do server assim que monta — o Reagendamento
   * Assistido (Etapa 0) é a única saída (cancelar = nada muda).
   */
  autoRelocate?: boolean;
}>();

const emit = defineEmits<{
  'update:open': [boolean];
  saved: [];
}>();

const titles: Record<AppointmentFormMode, string> = {
  create: 'Novo compromisso',
  edit: 'Editar compromisso',
  review: 'Corrigir e aprovar',
};

/**
 * Sessão de edição: o form é (re)construído quando o modal ABRE com estas props.
 * `preset` entra no watch: quando o modal já está montado (o `:key` da página
 * igual) e a página só troca a PRESET (célula do calendário → criar), o form
 * antigo sobreviveria com a data/hora da abertura anterior.
 * `shallowRef` de propósito: o objeto do composable NUNCA é aprofundado — os refs
 * internos (`range`, `timezone`…) permanecem refs e o template os desembrulha.
 */
const form = shallowRef<ReturnType<typeof useAppointmentForm> | null>(null);
const session = ref(0);

watch(
  () => props.open,
  (open) => {
    if (open) session.value += 1; // nova sessão p/ o watch abaixo reconstruir o form
  },
);

watch(
  [session, () => props.mode, () => props.appointment, () => props.preset],
  () => {
    form.value = props.open
      ? useAppointmentForm({
          mode: props.mode,
          appointment: props.appointment,
          preset: props.preset,
        })
      : null;
    // drop conflituoso (Etapa 2.3): o form nasceu NO horário candidato; pede as
    // jogadas do server imediatamente (força: é a primeira consulta deste slot)
    if (props.open && props.autoRelocate) void form.value?.openRelocationOptions(true);
  },
  { immediate: true },
);

/** Prévia legível do intervalo no fuso do usuário (só formatação — tz.ts). */
const preview = computed(() => {
  const f = form.value;
  const r = f ? f.range.value : null;
  if (!f || !r) return '';
  const tz = f.timezone.value;
  return `${formatDayHeading(r.startsAt, tz, new Date()).label} · ${formatRangeInTz(r.startsAt, r.endsAt, tz)}`;
});

async function onSave(): Promise<void> {
  if (!form.value) return;
  const { ok } = await form.value.submit();
  if (ok) {
    emit('update:open', false);
    emit('saved');
  }
}

/**
 * Rótulo da jogada (D-W1) — só formatação de horários prontos do server no fuso
 * do usuário (dia completo: a jogada pode cruzar a meia-noite). Zero cálculo.
 */
function relocationLabel(option: RelocationOptionDto): string {
  const f = form.value;
  if (!f) return '';
  const tz = f.timezone.value;
  if (option.kind === 'move-other') {
    return `Mover ${option.other.title} para ${formatDateTimeInTz(option.newStart, tz)}`;
  }
  const verb = props.mode === 'create' ? 'Criar' : 'Salvar';
  return `${verb} ${formatDateTimeInTz(option.newStart, tz)} movendo este para ${formatDateTimeInTz(option.newStart, tz)}`;
}

/** Confirmar a jogada ⇒ `reschedule` na variante certa (a mutation invalida a agenda). */
async function onRelocate(option: RelocationOptionDto): Promise<void> {
  if (!form.value) return;
  const { ok } = await form.value.confirmRelocation(option);
  if (ok) {
    emit('update:open', false);
    emit('saved');
  }
}
</script>
