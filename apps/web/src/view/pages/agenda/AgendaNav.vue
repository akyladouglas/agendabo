<template>
  <div class="flex flex-col gap-4">
    <AppTabs
      :model-value="props.view"
      aria-label="Visualização da agenda"
      :options="[
        { value: 'day', label: 'Dia' },
        { value: 'week', label: 'Semana' },
        { value: 'month', label: 'Mês' },
        { value: 'year', label: 'Ano' },
      ]"
      class="max-w-full overflow-x-auto"
      @update:model-value="emit('update:view', $event as AgendaView)"
    />
    <div
      class="flex items-center gap-2"
      data-testid="agenda-nav-actions"
    >
      <AppButton
        variant="ghost"
        size="icon"
        class="aspect-auto w-14"
        aria-label="Período anterior"
        data-testid="nav-prev"
        @click="emit('shift', -1)"
      >
        <ChevronLeft
          class="h-5 w-5"
          aria-hidden="true"
        />
      </AppButton>
      <AppButton
        variant="ghost"
        class="px-6"
        :aria-current="props.isToday ? 'date' : undefined"
        :disabled="props.isToday"
        :title="props.isToday ? 'Você já está vendo hoje' : 'Ir para hoje'"
        data-testid="nav-today"
        @click="emit('today')"
      >
        Hoje
      </AppButton>
      <AppButton
        variant="ghost"
        size="icon"
        class="aspect-auto w-14"
        aria-label="Próximo período"
        data-testid="nav-next"
        @click="emit('shift', 1)"
      >
        <ChevronRight
          class="h-5 w-5"
          aria-hidden="true"
        />
      </AppButton>
    </div>

    <!-- ir-para (A.5): Select de Ano + Select de Mês (só Mês/Ano). AppSelect
         (radix) — o <select> nativo desenha o POPUP no chrome do SO: em tema
         escuro o popup saía claro com texto claro (ilegível, relato do usuário
         2026-10-09). O radix herda o tema e mantém o gatilho estilizado. -->
    <div
      v-if="props.view === 'month' || props.view === 'year'"
      class="flex items-center gap-2"
      data-testid="agenda-jump"
    >
      <label
        class="sr-only"
        :for="`jump-year-${props.view}`"
      >Ir para o ano</label>
      <AppSelect
        :id="`jump-year-${props.view}`"
        :model-value="String(props.year)"
        :options="props.yearOptions"
        class="h-9 w-auto min-w-24"
        test-id="jump-year"
        @update:model-value="emit('jumpYear', Number($event))"
      />
      <div
        v-if="props.view === 'month'"
        class="flex items-center gap-2"
      >
        <label
          class="sr-only"
          :for="`jump-month-${props.view}`"
        >Ir para o mês</label>
        <AppSelect
          :id="`jump-month-${props.view}`"
          :model-value="String(props.monthIndex)"
          :options="props.monthOptions"
          class="h-9 w-auto min-w-32"
          test-id="jump-month"
          @update:model-value="emit('jumpMonth', Number($event))"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Cabeçalho de navegação da Agenda (Fase 7): abas Dia|Semana|Mês|Ano + ‹ hoje → +
 * menu ir-para (A.1–A.5). Burro: eventos para a página; zero estado. O ir-para usa
 * AppSelect (radix) — o <select> nativo desenha o popup no chrome do SO e o popup
 * ficava claro em tema escuro (ilegível).
 */
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import type { AgendaView } from '@/app/composables/useAgendaPage.composable';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppSelect from '@/view/components/ui/select/Select.vue';
import AppTabs from '@/view/components/ui/tabs/Tabs.vue';

const props = defineProps<{
  view: AgendaView;
  year: number;
  monthIndex: number;
  yearOptions: { value: string; label: string }[];
  monthOptions: { value: string; label: string }[];
  /** A âncora JÁ é hoje (R7/a11y: o botão comunica o estado, não só não-faz-nada). */
  isToday?: boolean;
}>();

const emit = defineEmits<{
  'update:view': [AgendaView];
  shift: [-1 | 1];
  today: [];
  jumpYear: [number];
  jumpMonth: [number];
}>();
</script>
