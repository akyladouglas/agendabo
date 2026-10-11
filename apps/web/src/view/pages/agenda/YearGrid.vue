<template>
  <!-- ≥md: heatmap uniforme (12 cards, grade 7×6 de células FIXAS) |
       <md: lista vertical de 12 linhas (R.16 / F.9 — preservada) -->
  <div
    class="hidden gap-3 md:grid md:grid-cols-2 lg:grid-cols-3"
    data-testid="year-grid"
  >
    <!-- card = DIV (A6): botão dentro de botão é HTML inválido; o NOME do mês é o
         botão → visão Mês, e cada bolinha com compromisso é botão → visão Dia -->
    <div
      v-for="mini in props.minis"
      :key="mini.month"
      class="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5"
      :aria-label="miniAria(mini)"
      :data-testid="`year-mini-${mini.month}`"
    >
      <button
        type="button"
        class="od-move flex w-full items-baseline justify-between gap-1 rounded-md px-0.5 text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="miniAria(mini)"
        :data-testid="`year-month-${mini.month}`"
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
        <span class="text-[10px] tabular-nums text-muted-foreground">
          {{ mini.daysWithAppointments > 0 ? mini.daysWithAppointments : '—' }}
        </span>
      </button>
      <!-- heatmap: SEMPRE 42 células de tamanho FIXO (7 col × 6 linhas — spec
           visao-ano-heatmap A1). Nada de `aspect-square` fluido: é ele que fazia o
           card crescer com o número de linhas de dias (meses de 6 linhas > 5). -->
      <span class="grid grid-cols-7 gap-0.5">
        <template
          v-for="d in mini.days"
          :key="d.date || `pad-${d.index}`"
        >
          <button
            v-if="d.date && d.hasAppointment"
            type="button"
            class="flex h-2.5 w-2.5 items-center justify-center rounded-full hover:ring-2 hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="`${d.dayNumber} de ${mini.name}: ver o dia`"
            :data-testid="`year-dot-${mini.month}-${d.date}`"
            @click="emit('dayClick', d.date!)"
          >
            <span
              class="h-1.5 w-1.5 rounded-full"
              :class="dotClass(d)"
              :title="dotTitle(d)"
            />
          </button>
          <!-- célula Vazia da grade 7×6: placeholder que NUNCA ganha bolinha (gotcha
               11). Dias sem compromisso só existem no desktop (o mobile lista só as
               bolinhas), daí o testid `year-empty-<date>` ser só daqui; a bolinha
               clicável do desktop é `year-day-<mes>-<date>` (A3/A6) -->
          <span
            v-else
            class="h-2.5 w-2.5"
            :data-testid="d.date ? `year-empty-${d.date}` : undefined"
            :aria-label="d.date ? `${d.dayNumber} de ${mini.name}: sem compromissos` : undefined"
          />
        </template>
      </span>
    </div>
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
      <!-- bolinhas clicáveis → visão Dia do dia (spec C.13 / visao-ano-heatmap B1) -->
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
 * Visão Ano (spec visao-ano-heatmap, refina C.13): 12 mini-meses do ANO CIVIL da
 * âncora como heatmap UNIFORME no desktop — grade 7×6 de células fixas (altura
 * idêntica entre cards), bolinha por DIA tocado com compromisso (densidade e grades
 * vêm do schedule-core, resolvidas pela página). Burra: recebe os 12 mini-meses
 * prontos, zero regra de data (E.4). Clique no nome do mês → visão Mês; clique na
 * bolinha → visão Dia (desktop e mobile). Mobile: lista de 12 linhas (R.16).
 */
export interface YearDayView {
  /** Índice na linha (0..41 — a grade 7×6 é sempre completa). */
  index: number;
  /** dateKey do dia (undefined = célula vazia de leading/trailing da grade). */
  date?: string;
  /** Número do dia do mês (para o label da bolinha clicável). */
  dayNumber?: number;
  hasAppointment: boolean;
  isToday: boolean;
  /** Algum compromisso que toca este dia está em conflito (C.12 → tom danger). */
  hasConflict: boolean;
  /** Dias após a 7ª bolinha do mês: esmaecimento maior (C.13). */
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

function dotClass(d: {
  hasAppointment: boolean;
  isToday: boolean;
  hasConflict: boolean;
  dimmed: boolean;
}): string {
  // bolinha SÓ existe visualmente em dia com compromisso (gotcha 11: o caso
  // `!hasAppointment → bg-transparent` é explícito e obrigatório)
  if (!d.hasAppointment) return 'bg-transparent';
  if (d.isToday) return 'bg-primary ring-2 ring-primary/40';
  if (d.hasConflict) return 'bg-danger/70';
  if (d.dimmed) return 'bg-primary/25';
  return 'bg-primary/70';
}

function dotTitle(d: { hasAppointment: boolean; isToday: boolean; hasConflict: boolean }): string | undefined {
  if (!d.hasAppointment) return undefined;
  return `Dia com compromisso${d.hasConflict ? ' (conflito)' : ''}${d.isToday ? ' (hoje)' : ''}`;
}

function miniAria(mini: YearMiniView): string {
  return `${mini.name}: ${mini.daysWithAppointments} dia${mini.daysWithAppointments === 1 ? '' : 's'} com compromissos`;
}
</script>
