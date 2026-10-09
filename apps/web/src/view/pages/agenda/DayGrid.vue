<template>
  <!-- R8/a11y (review 2026-10-09): sem `role="grid"` — o keyboard interaction model
       do grid não é implementado (setas/uma-entrada); a grade é uma lista de
       botões com aria-label completo (registrado no plano, R8). -->
  <div
    :aria-label="`Horas de ${props.dayLabel}`"
    data-testid="day-grid"
    class="relative rounded-lg border border-border bg-card"
  >
    <!-- LINHAS da grade: uma por hora local coberta pelo range (burra — as horas
         vêm prontas do schedule-core via useAgendaPage). Cada linha é o alvo de
         clique "criar às HH:00" (Etapa 2 vai reposicionar aqui). -->
    <div
      v-for="slot in props.slots"
      :key="slot.key"
      class="relative flex h-12 border-b border-border last:border-b-0"
      :class="slot.isPast ? 'opacity-60' : ''"
      :data-cell-key="`hour:${slot.key}`"
      :data-drop-target="drag && drag.dropKey.value === `hour:${slot.key}` ? 'true' : 'false'"
    >
      <div
        :data-testid="`day-slot-${slot.hour}`"
        class="flex min-h-11 w-full items-start gap-2 p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <button
          type="button"
          class="od-move flex min-h-10 w-full items-start gap-2 rounded-md px-1 text-left hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          :aria-label="`Criar compromisso às ${slot.hour}:00 de ${props.dayLabel}`"
          :data-testid="`day-slot-button-${slot.hour}`"
          @click="emit('slotClick', slot)"
        >
          <span
            class="w-12 shrink-0 pt-0.5 text-xs font-semibold tabular-nums text-muted-foreground"
            aria-hidden="true"
          >
            {{ slot.hour }}:00
          </span>
        </button>
      </div>
    </div>

    <!-- OVERLAY dos blocos posicionados em % (top/height/left/width vêm prontos
         do schedule-core via composable — zero cálculo aqui). Elemento ÚNICO com
         `pointer-events-none` no fundo e `pointer-events-auto` no bloco: a grade
         continua clicável nas áreas vazias (não viola gotcha 10 — sem fragmentos
         irmãos). -->
    <div
      class="pointer-events-none absolute inset-y-0 left-12 right-1"
      data-testid="day-blocks"
    >
      <button
        v-for="block in props.blocks"
        :key="`${block.item.id}-${block.top}`"
        type="button"
        class="od-move pointer-events-auto absolute flex flex-col gap-0.5 overflow-hidden rounded-md border bg-card p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :class="[
          block.class,
          drag && drag.draggingId.value === block.item.id ? 'opacity-40' : '',
        ]"
        :style="{
          top: `${block.top}%`,
          height: `${block.height}%`,
          left: `calc(${block.left}% + 2px)`,
          width: `calc(${block.width}% - 4px)`,
        }"
        :title="block.conflictTitle ?? block.item.title"
        :aria-label="block.ariaLabel"
        :data-testid="`day-block-${block.item.id}`"
        :data-conflicted="block.conflictTitle ? 'true' : undefined"
        v-bind="drag ? drag.bind(block.item) : {}"
        @click.stop="emit('blockClick', block.item)"
      >
        <span class="truncate text-xs font-medium text-foreground">
          {{ block.item.title }}
        </span>
        <span class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {{ block.time }}
        </span>
        <AlertTriangle
          v-if="block.review"
          class="h-3 w-3 shrink-0 text-warning"
          role="img"
          aria-label="pendente de revisão"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Grade da Visão Dia (plano grades-dia-semana-mes, Etapa 1.3 + 2.3): BURRA — recebe as
 * linhas de hora (`hourGrid`) e os blocos posicionados em % (`layoutDayTimeline`)
 * já resolvidos pela página/composable; ZERO regra de data/conflito aqui (E.4).
 * A grade é um ELEMENTO único (linhas próprias + overlay absoluto, sem fragmentos
 * irmãos — gotcha 10); o EmptyState fica fora dela, na página.
 * Célula vazia → criar NAQUELE dia+hora; bloco → abrir o compromisso. A lista do
 * dia continua ABAIXO (a grade é o panorama; a lista é onde as notas se leem).
 * Drag (Etapa 2): a página injeta o hook (`drag`) — a view só aplica `v-bind`
 * no bloco e pinta `data-drop-target` na linha a partir de `dropKey` (primitivo).
 */
import { AlertTriangle } from 'lucide-vue-next';
import type { AppointmentDto } from '@agendabo/contracts';
import type { DragBindApi } from '@/app/composables/useDragAppointment';

export interface DaySlotView {
  /** Hora local da linha, "00".."23" (testid `day-slot-HH`). */
  hour: string;
  /** Rótulo da hora ("HH:mm", do schedule-core). */
  label: string;
  /** Rótulo acessível da célula (hora local no fuso do usuário). */
  ariaLabel: string;
  /** Chave estável da linha (instante da célula — única mesmo em DST weird). */
  key: string;
  /** Linha esmaecida (o agora já passou daquela hora). */
  isPast: boolean;
}

export interface DayBlockView {
  item: AppointmentDto;
  /** Posições em % vindas do `layoutDayTimeline` (a web não calcula). */
  top: number;
  height: number;
  left: number;
  width: number;
  /** "HH:mm–HH:mm" no fuso do usuário (formatado na página). */
  time: string;
  review: boolean;
  /** Rótulo de conflito (schedule-core) — borda --danger + title. */
  conflictTitle: string | null;
  ariaLabel: string;
  class: string;
}

const props = defineProps<{
  /** Linhas de hora prontas (composable → schedule-core `hourGrid`). */
  slots: DaySlotView[];
  /** Blocos posicionados em % (composable → schedule-core `layoutDayTimeline`). */
  blocks: DayBlockView[];
  /** "Hoje · 8 out" etc. — só para aria-labels (formatado na página). */
  dayLabel: string;
  /** Mecânica de drag da página (bind + primitivos) — ausente = grade sem drag. */
  drag?: DragBindApi<AppointmentDto> | null;
}>();

const emit = defineEmits<{
  slotClick: [slot: DaySlotView];
  blockClick: [item: AppointmentDto];
}>();
</script>
