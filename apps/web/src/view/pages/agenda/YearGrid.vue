<template>
  <!-- ≥lg: 3×4 | ≥md: 2×6 | <md: lista vertical de 12 linhas (R.16 / F.9) -->
  <div
    class="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-3"
    data-testid="year-grid"
  >
    <button
      v-for="mini in props.minis"
      :key="mini.month"
      type="button"
      class="od-move flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5 text-left hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :aria-label="miniAria(mini)"
      :data-testid="`year-mini-${mini.month}`"
      @click="emit('monthClick', mini.month)"
    >
      <span
        class="text-sm font-semibold"
        :class="mini.isCurrent ? 'text-primary' : 'text-foreground'"
      >
        {{ mini.name }}
        <span
          v-if="mini.isCurrent"
          class="sr-only"
        >(mês atual)</span>
      </span>
      <!-- mini-calendário: 7 colunas, bolinha = dia com compromisso (dayDensity) -->
      <span class="grid grid-cols-7 gap-0.5">
        <span
          v-for="d in mini.days"
          :key="d.date || `pad-${d.index}`"
          class="flex aspect-square items-center justify-center"
          :data-testid="d.date ? `year-dot-${d.date}` : undefined"
        >
          <span
            v-if="d.date"
            class="h-1.5 w-1.5 rounded-full"
            :class="dotClass(d)"
            :title="d.hasAppointment ? `Dia com compromisso${d.isToday ? ' (hoje)' : ''}` : undefined"
          />
        </span>
      </span>
    </button>
  </div>

  <!-- mobile: 12 linhas (clique na linha → Mês; clique na bolinha → Dia daquele dia) -->
  <ul
    class="flex flex-col gap-1 md:hidden"
    data-testid="year-list"
  >
    <li
      v-for="mini in props.minis"
      :key="mini.month"
      class="flex items-center gap-2 rounded-lg border border-border bg-card p-2"
    >
      <button
        type="button"
        class="od-move flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="miniAria(mini)"
        :data-testid="`year-row-${mini.month}`"
        @click="emit('monthClick', mini.month)"
      >
        <span
          class="text-sm font-semibold"
          :class="mini.isCurrent ? 'text-primary' : 'text-foreground'"
        >{{ mini.name }}</span>
        <span class="flex flex-wrap items-center justify-end gap-0.5">
          <span
            v-for="d in mini.days.filter((x) => x.date && x.hasAppointment).slice(0, 7)"
            :key="d.date"
            class="h-1.5 w-1.5 rounded-full"
            :class="dotClass(d)"
          />
          <span
            v-if="mini.daysWithAppointments > 7"
            class="text-[10px] text-muted-foreground"
          >+{{ mini.daysWithAppointments - 7 }}</span>
        </span>
      </button>
      <!-- bolinhas clicáveis → visão Dia do dia (spec C.13) -->
      <span class="flex flex-wrap items-center gap-1 pr-1">
        <button
          v-for="d in mini.days.filter((x) => x.date && x.hasAppointment).slice(0, 7)"
          :key="`b-${d.date}`"
          type="button"
          class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-muted"
          :aria-label="`${d.dayNumber} de ${mini.name}: ver o dia`"
          :data-testid="`year-day-${d.date}`"
          @click="emit('dayClick', d.date!)"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="dotClass(d)"
          />
        </button>
      </span>
    </li>
  </ul>
</template>

<script setup lang="ts">
/**
 * Visão Ano (Fase 7, spec C.13): 12 mini-meses com bolinhas por DIA com compromisso
 * (densidade vem de `dayDensity` do schedule-core, resolvida pela página). Burra:
 * recebe os 12 mini-meses prontos, zero regra de data (E.4). Clique no mini-mês →
 * visão Mês; no mobile a bolinha leva à visão Dia daquele dia.
 */
export interface YearDayView {
  /** Índice na linha (0..41 p/ preencher a grade 7 colunas). */
  index: number;
  /** dateKey do dia (undefined = célula vazia de leading/trailing). */
  date?: string;
  /** Número do dia do mês (para o label da bolinha clicável). */
  dayNumber?: number;
  hasAppointment: boolean;
  isToday: boolean;
  /** Dias após o 7º compromisso: esmaecimento maior (C.13). */
  dimmed: boolean;
}

export interface YearMiniView {
  /** 1-12 (mês calendário — chave da densidade do schedule-core). */
  month: number;
  name: string;
  /** Mês que contém a âncora (destaque). */
  isCurrent: boolean;
  daysWithAppointments: number;
  days: YearDayView[];
}

const props = defineProps<{ minis: YearMiniView[]; year: number }>();

const emit = defineEmits<{
  monthClick: [month: number];
  dayClick: [dateKey: string];
}>();

function dotClass(d: { hasAppointment: boolean; isToday: boolean; dimmed: boolean }): string {
  // bolinha SÓ existe visualmente em dia com compromisso (dayDensity) — dia sem
  // nada é um espaçador invisível da grade 7 colunas (spec C.13)
  if (!d.hasAppointment) return 'bg-transparent';
  if (d.isToday) return 'bg-primary ring-2 ring-primary/40';
  if (d.dimmed) return 'bg-primary/25';
  return 'bg-primary/70';
}

function miniAria(mini: YearMiniView): string {
  return `${mini.name}: ${mini.daysWithAppointments} dia${mini.daysWithAppointments === 1 ? '' : 's'} com compromissos`;
}
</script>
