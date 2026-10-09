<template>
  <!-- ≥md: 7 colunas dom..sáb, CADA UMA uma mini-grade de horas (a mesma visão do
       Dia por dia — plano grades-dia-semana-mes, Semana dia×hora) | <md: colunas
       roláveis na horizontal com scroll contido (R.16). -->
  <div class="-mx-1 overflow-x-auto px-1 pb-1 md:block">
    <div
      class="grid grid-cols-1 gap-2 md:grid-flow-col md:grid-cols-[repeat(7,minmax(112px,1fr))]"
      data-testid="week-grid"
    >
      <section
        v-for="day in props.days"
        :key="day.key"
        class="flex min-w-0 flex-col gap-1 md:min-w-[112px] rounded-md"
        :aria-label="`${day.heading.weekday} ${day.heading.label}`"
        :data-testid="`week-day-${day.date}`"
      >
        <!-- cabeçalho do dia: clique → visão Dia (C.10) -->
        <button
          type="button"
          class="od-move rounded-md py-1 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :class="day.heading.isToday ? 'text-primary' : 'text-muted-foreground hover:text-foreground'"
          :aria-label="`${day.heading.isToday ? 'Hoje' : day.heading.weekday} ${day.heading.label}: abrir o dia`"
          @click="emit('dayClick', day.date)"
        >
          <span class="block text-xs font-semibold">
            {{ day.heading.isToday ? 'Hoje' : day.heading.weekday }}
          </span>
          <span
            class="block text-sm text-foreground"
            :data-testid="`week-day-number-${day.date}`"
          >
            {{ day.heading.label }}
          </span>
        </button>

        <!-- mini-grade de horas do dia (a grade inteira é a célula de DROP:
             soltar ⇒ mesmo horário em OUTRO dia — regra `day:` do dropTarget) -->
        <div
          role="grid"
          :aria-label="`Horas de ${day.heading.weekday} ${day.heading.label}`"
          class="relative rounded-md border border-border bg-card"
          :data-cell-key="`day:${day.date}`"
          :data-drop-target="drag && drag.dropKey.value === `day:${day.date}` ? 'true' : 'false'"
          data-testid="week-day-grid"
        >
          <!-- 24 linhas de uma hora cada (alturas IGUAIS ⇒ a régua % da página vale
               para toda a grade; a célula vazia abre a criação NAQUELE dia+hora) -->
          <div
            v-for="hour in HOURS"
            :key="hour"
            role="row"
            :data-testid="`week-cell-${day.date}-${hour}`"
          >
            <button
              type="button"
              class="od-move block h-8 w-full text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              :class="((day.nowCell ?? 24) > Number(hour) ? 'opacity-60' : '') || ''"
              :aria-label="`Criar ${hour}:00 de ${day.heading.weekday} ${day.heading.label}`"
              @click="emit('cellClick', day.date, hour)"
            >
              <span
                v-if="hour === day.rulerHour"
                class="pointer-events-none block border-t border-dashed border-border text-[10px] tabular-nums text-muted-foreground"
                :aria-hidden="true"
              >
                {{ hour }}:00
              </span>
            </button>
          </div>

          <!-- OVERLAY dos blocos posicionados em % (top/height/left/width prontos
               do schedule-core — zero cálculo aqui). Elemento ÚNICO, fundo
               `pointer-events-none`, bloco `pointer-events-auto` (gotcha 10). -->
          <div
            class="pointer-events-none absolute inset-y-0 left-0 right-0"
            :data-testid="`week-blocks-${day.date}`"
          >
            <button
              v-for="block in day.blocks"
              :key="`${block.item.id}-${block.top}`"
              type="button"
              class="od-move pointer-events-auto absolute flex flex-col gap-0.5 overflow-hidden rounded border bg-card p-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :class="[
                block.class,
                drag && drag.draggingId.value === block.item.id ? 'opacity-40' : '',
              ]"
              :style="{
                top: `${block.top}%`,
                height: `${Math.max(block.height, MIN_BLOCK_HEIGHT_PCT)}%`,
                left: `calc(${block.left}% + 1px)`,
                width: `calc(${block.width}% - 2px)`,
              }"
              :title="block.conflictTitle ?? block.item.title"
              :aria-label="block.ariaLabel"
              :data-testid="`week-item-${block.item.id}`"
              :data-conflicted="block.conflictTitle ? 'true' : undefined"
              v-bind="drag ? drag.bind(block.item) : {}"
              @click.stop="emit('itemClick', block.item)"
            >
              <span class="truncate text-[11px] font-medium text-foreground">
                {{ block.item.title }}
              </span>
              <span class="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {{ block.time }}
              </span>
              <AlertTriangle
                v-if="block.review"
                class="h-3 w-3 shrink-0 text-warning"
                aria-label="pendente de revisão"
              />
            </button>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Visão Semana (plano grades-dia-semana-mes, Semana dia×hora): 7 colunas dom..sáb,
 * cada uma uma mini-grade de 24 horas com os blocos posicionados em % pelo
 * `layoutDayTimeline` do schedule-core (regra zero: a view é BURRA — nada de data
 * ou conflito aqui, E.4). A grade do dia inteira é o alvo de drop (`day:dateKey`):
 * soltar um bloco ⇒ MESMO horário em outro dia (translação N×24h). O bloco mantém
 * um piso de altura para título/hora continuarem legíveis quando a hora é estreita.
 * Celula vazia → criar àquele dia+hora; cabeçalho → abrir o Dia (C.10); bloco →
 * abrir o compromisso. <md: as colunas rolam na horizontal (scroll contido, R.16).
 */
import { AlertTriangle } from 'lucide-vue-next';
import type { AppointmentDto } from '@agendabo/contracts';
import type { DragBindApi } from '@/app/composables/useDragAppointment';
import type { DayBlockView } from './DayGrid.vue';

/** Linhas fixas da grade (uma por hora local — 00..23). */
const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

/** Piso de altura do bloco em % da grade (≈30min) p/ o texto caber em hora estreita. */
const MIN_BLOCK_HEIGHT_PCT = 2.1;

export interface WeekDayView {
  /** dateKey local do dia (dom..sáb — ordem de `weekGridRows`). */
  date: string;
  key: string;
  heading: { label: string; isToday: boolean; weekday: string };
  /** Blocos do dia posicionados em % (layoutDayTimeline — a view não calcula). */
  blocks: DayBlockView[];
  /** Hora "HH" da linha-régua (a hora do "agora"; null = nada a marcar). */
  rulerHour: string | null;
  /** Índice da célula-hora que contém o AGORA (linhas antes dele = esmaecidas). */
  nowCell: number | null;
}

const props = defineProps<{
  days: WeekDayView[];
  /** Mecânica de drag da página (bind + primitivos) — ausente = grade sem drag. */
  drag?: DragBindApi<AppointmentDto> | null;
}>();

const emit = defineEmits<{
  dayClick: [dateKey: string];
  /** Célula vazia (dia, hora "HH") → criar NAQUELE dia+hora. */
  cellClick: [dateKey: string, hour: string];
  itemClick: [item: AppointmentDto];
}>();
</script>
