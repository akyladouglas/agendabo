<template>
  <!-- grade 6×7 semântica (a11y F.11): linha = role="row", célula = role="gridcell" -->
  <div
    role="grid"
    :aria-label="`Mês de ${props.monthName}`"
    data-testid="month-grid"
  >
    <!-- cabeçalho dom..sáb (mesma convenção das células — weekRows/monthCells) -->
    <div
      role="row"
      class="grid grid-cols-7 border-b border-border text-center text-xs font-semibold text-muted-foreground"
    >
      <div
        v-for="d in WEEKDAY_LABELS"
        :key="d.short"
        role="columnheader"
        :aria-label="d.full"
        class="py-1.5"
      >
        <span aria-hidden="true">{{ d.short }}</span>
      </div>
    </div>

    <div
      v-for="(week, wi) in weeks"
      :key="wi"
      role="row"
      class="grid grid-cols-7"
    >
      <div
        v-for="cell in week"
        :key="cell.date"
        role="gridcell"
        :aria-label="cellAria(cell)"
        :aria-selected="cell.date === props.anchorKey || undefined"
        class="od-move min-h-24 min-w-0 border-b border-r border-border p-1 md:min-h-36"
        :class="cell.class"
        :data-cell-key="`day:${cell.date}`"
        :data-drop-target="drag && drag.dropKey.value === `day:${cell.date}` ? 'true' : 'false'"
      >
        <button
          type="button"
          class="flex h-full w-full flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="cellAria(cell)"
          :data-testid="`cell-${cell.date}`"
          @click="emit('dayClick', cell)"
        >
          <!-- número do dia SEMPRE visível (grade-drag spec: a data nunca some,
               nem no mobile) -->
          <span
            class="self-center rounded-full px-1.5 text-xs font-semibold tabular-nums md:self-start"
            :class="dayNumberClass(cell)"
            :data-testid="`daynum-${cell.date}`"
          >
            {{ dayNumber(cell.date) }}
          </span>

          <!-- desktop: até 3 chips + "+N" (B.7) -->
          <span class="hidden min-w-0 flex-col gap-0.5 md:flex">
            <span
              v-for="chip in cell.chips"
              :key="chip.item.id"
              class="od-move flex min-h-5 w-full min-w-0 items-center gap-1 truncate rounded border px-1 text-[11px] leading-4"
              :class="[chip.class, drag && drag.draggingId.value === chip.item.id ? 'opacity-40' : '']"
              v-bind="drag ? drag.bind(chip.item) : {}"
            >
              <AlertTriangle
                v-if="chip.review"
                class="h-3 w-3 shrink-0 text-warning"
                aria-label="pendente de revisão"
              />
              <span class="shrink-0 tabular-nums text-muted-foreground">{{ chip.time }}</span>
              <span
                class="truncate font-medium text-foreground"
                :title="chip.conflictTitle ? `⚠ ${chip.conflictTitle}` : chip.item.title"
              >{{ chip.item.title }}</span>
              <button
                type="button"
                class="ml-auto -my-1 -mr-1 flex min-h-11 items-center px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground md:min-h-0"
                :aria-label="`Abrir detalhes de ${chip.item.title}`"
                :data-testid="`chip-open-${chip.item.id}`"
                @pointerdown.stop
                @click.stop="emit('itemClick', chip.item)"
              >
                Abrir
              </button>
            </span>
            <button
              v-if="cell.overflow > 0"
              type="button"
              class="self-start rounded px-1 text-[11px] font-medium text-primary hover:underline"
              :data-testid="`cell-${cell.date}-more`"
              @click.stop="emit('dayClick', cell)"
            >
              ver {{ cell.overflow }}
            </button>
          </span>

          <!-- mobile: só bolinhas (Aberto #3 aprovado — o número já está acima) -->
          <span class="flex flex-wrap items-center gap-0.5 md:hidden">
            <span
              v-for="(dot, di) in cell.dots.slice(0, 7)"
              :key="di"
              class="h-1.5 w-1.5 rounded-full"
              :class="dotClass(dot)"
              :data-dot="dot.kind"
            />
            <span
              v-if="cell.dots.length > 7"
              class="text-[9px] text-muted-foreground"
            >+{{ cell.dots.length - 7 }}</span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Grade do Mês (Fase 7, spec B/F.9): BURRA — recebe as 42 células prontas com os
 * itens/chips já resolvidos pela página; ZERO regra de data ou conflito aqui (E.4).
 * Desktop: 7 colunas com chips; mobile: bolinhas. Clique na célula → Dia/criação
 * (decidido pela página); clique no chip → detalhes. Altura mínima por célula
 * (`min-h-24`/`md:min-h-36`) para a grade respirar mesmo vazia; com mais itens
 * que os 3 chips, a linha cresce junto (célula elástica).
 */
import { computed } from 'vue';
import { AlertTriangle } from 'lucide-vue-next';
import type { AppointmentDto } from '@agendabo/contracts';
import type { CalendarDay } from '@agendabo/schedule-core';
import type { DragBindApi } from '@/app/composables/useDragAppointment';

export interface MonthChip {
  item: AppointmentDto;
  /** "HH:mm" (ou "↦ HH:mm"/"HH:mm ↤" quando cruza a meia-noite — B.9, formato na página). */
  time: string;
  review: boolean;
  /** Rótulo de conflito (schedule-core `firstConflictLabel`) — borda --danger + title. */
  conflictTitle: string | null;
  /** Classes utilitárias resolvidas pela página (borda de conflito) — componente burro. */
  class: string;
}

export interface MonthCellView {
  day: CalendarDay;
  date: string;
  chips: MonthChip[];
  overflow: number;
  dots: { id: string; kind: 'conflict' | 'review' | 'normal' }[];
  hasConflict: boolean;
  class: string;
}

const props = defineProps<{
  /** 42 células prontas (composable → página resolve itens/chips por dateKey). */
  cells: MonthCellView[];
  monthName: string;
  /** dateKey da âncora (aria-selected; o "hoje" vem do CalendarDay.isToday). */
  anchorKey: string;
  /** Mecânica de drag da página (bind + primitivos) — ausente = grade sem drag. */
  drag?: DragBindApi<AppointmentDto> | null;
}>();

const emit = defineEmits<{
  dayClick: [cell: MonthCellView];
  itemClick: [item: AppointmentDto];
}>();

const WEEKDAY_LABELS = [
  { short: 'dom', full: 'domingo' },
  { short: 'seg', full: 'segunda-feira' },
  { short: 'ter', full: 'terça-feira' },
  { short: 'qua', full: 'quarta-feira' },
  { short: 'qui', full: 'quinta-feira' },
  { short: 'sex', full: 'sexta-feira' },
  { short: 'sáb', full: 'sábado' },
];

const weeks = computed(() => {
  const out: MonthCellView[][] = [];
  for (let i = 0; i < props.cells.length; i += 7) out.push(props.cells.slice(i, i + 7));
  return out;
});

function dayNumber(dateKey: string): number {
  return Number(dateKey.slice(8, 10));
}

function dayNumberClass(cell: MonthCellView): string {
  if (cell.day.isToday) return 'bg-primary font-bold text-primary-foreground';
  if (!cell.day.inMonth) return 'text-muted-foreground/50';
  return 'text-foreground';
}

function dotClass(dot: { kind: string }): string {
  if (dot.kind === 'conflict') return 'bg-danger';
  if (dot.kind === 'review') return 'bg-warning';
  return 'bg-primary/70';
}

function cellAria(cell: MonthCellView): string {
  const parts = [`${dayNumber(cell.date)} de ${props.monthName}`];
  if (cell.day.isToday) parts.push('hoje');
  const total = cell.chips.length + cell.overflow;
  parts.push(`${total} compromisso${total === 1 ? '' : 's'}`);
  if (cell.hasConflict) parts.push('com conflito');
  return parts.join(', ');
}
</script>
