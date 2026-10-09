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
      class="flex items-center gap-1"
      data-testid="agenda-nav-actions"
    >
      <AppButton
        variant="ghost"
        size="icon"
        aria-label="Período anterior"
        data-testid="nav-prev"
        @click="emit('shift', -1)"
      >
        <ChevronLeft class="h-5 w-5" />
      </AppButton>
      <AppButton
        variant="ghost"
        class="px-3"
        data-testid="nav-today"
        @click="emit('today')"
      >
        Hoje
      </AppButton>
      <AppButton
        variant="ghost"
        size="icon"
        aria-label="Próximo período"
        data-testid="nav-next"
        @click="emit('shift', 1)"
      >
        <ChevronRight class="h-5 w-5" />
      </AppButton>
    </div>

    <!-- ir-para (A.5): Select de Ano + Select de Mês (só Mês/Ano) -->
    <div
      v-if="props.view === 'month' || props.view === 'year'"
      class="flex items-center gap-2"
      data-testid="agenda-jump"
    >
      <label
        class="sr-only"
        :for="`jump-year-${props.view}`"
      >Ir para o ano</label>
      <select
        :id="`jump-year-${props.view}`"
        class="od-move h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="jump-year"
        :value="String(props.year)"
        @change="emit('jumpYear', Number(($event.target as HTMLSelectElement).value))"
      >
        <option
          v-for="opt in props.yearOptions"
          :key="opt.value"
          :value="opt.value"
        >
          {{ opt.label }}
        </option>
      </select>
      <div
        v-if="props.view === 'month'"
        class="flex items-center gap-2"
      >
        <label
          class="sr-only"
          :for="`jump-month-${props.view}`"
        >Ir para o mês</label>
        <select
          :id="`jump-month-${props.view}`"
          class="od-move h-9 rounded-md border border-border bg-surface px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-testid="jump-month"
          :value="String(props.monthIndex)"
          @change="emit('jumpMonth', Number(($event.target as HTMLSelectElement).value))"
        >
          <option
            v-for="opt in props.monthOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Cabeçalho de navegação da Agenda (Fase 7): abas Dia|Semana|Mês|Ano + ‹ hoje → +
 * menu ir-para (A.1–A.5). Burro: eventos para a página; zero estado. O ir-para usa
 * <select> nativo estilizado (mesma política de D7 do form: nativo na borda; o radix
 * Select exige pointer events que a grade inteira já não usa aqui).
 */
import { ChevronLeft, ChevronRight } from 'lucide-vue-next';
import type { AgendaView } from '@/app/composables/useAgendaPage.composable';
import AppButton from '@/view/components/ui/button/Button.vue';
import AppTabs from '@/view/components/ui/tabs/Tabs.vue';

const props = defineProps<{
  view: AgendaView;
  year: number;
  monthIndex: number;
  yearOptions: { value: string; label: string }[];
  monthOptions: { value: string; label: string }[];
}>();

const emit = defineEmits<{
  'update:view': [AgendaView];
  shift: [-1 | 1];
  today: [];
  jumpYear: [number];
  jumpMonth: [number];
}>();
</script>
