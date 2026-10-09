<template>
  <!-- ≥md: 7 colunas com scroll CONTIDO na grade | <md: lista vertical (R.16) -->
  <div class="-mx-1 overflow-x-auto px-1 pb-1 md:block">
    <div
      class="grid grid-cols-1 gap-2 md:grid-flow-col md:grid-cols-[repeat(7,minmax(96px,1fr))]"
      data-testid="week-grid"
    >
      <section
        v-for="day in props.days"
        :key="day.key"
        class="flex min-w-0 flex-col gap-2 md:min-w-[96px] rounded-md"
        :aria-label="`${day.heading.weekday} ${day.heading.label}`"
        :data-testid="`week-day-${day.date}`"
        :data-cell-key="`day:${day.date}`"
        :data-drop-target="drag && drag.dropKey.value === `day:${day.date}` ? 'true' : 'false'"
      >
        <!-- cabeçalho do dia: clique → visão Dia (C.10) ou criação (cabeçalho vazio, D.16) -->
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

        <button
          v-for="card in day.cards"
          :key="card.item.id"
          type="button"
          class="od-move flex min-h-11 w-full flex-col gap-1 rounded-md border bg-card p-2 text-left hover:border-primary/50"
          :class="[card.class, drag && drag.draggingId.value === card.item.id ? 'opacity-40' : '']"
          :title="card.conflictTitle ? `⚠ ${card.conflictTitle}` : undefined"
          :data-testid="`week-item-${card.item.id}`"
          v-bind="drag ? drag.bind(card.item) : {}"
          @click="emit('itemClick', card.item)"
        >
          <span class="text-xs font-semibold tabular-nums text-muted-foreground">
            {{ card.time }}
          </span>
          <span class="line-clamp-2 text-xs font-medium text-foreground">
            {{ card.item.title }}
          </span>
          <span class="flex items-center gap-1">
            <AlertTriangle
              v-if="card.review"
              class="h-3 w-3 text-warning"
              aria-label="pendente de revisão"
            />
            <AppBadge :tone="card.item.origin === 'bot' ? 'info' : 'success'">
              {{ card.item.origin }}
            </AppBadge>
          </span>
        </button>

        <p
          v-if="day.cards.length === 0"
          class="py-2 text-center text-xs text-muted-foreground"
        >
          —
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Visão Semana (Fase 7, C.10): mantém os cards-colunas da Fase 5, agora alinhada à
 * grade de 7 dias dom..sáb (as linhas vêm de `weekRows` via página) e com os itens
 * agrupados por dia civil de INÍCIO (`groupByLocalDay`) — o filtro inline antigo
 * ficava errado p/ compromissos que cruzam a meia-noite. Burra: props prontas.
 */
import { AlertTriangle } from 'lucide-vue-next';
import type { AppointmentDto } from '@agendabo/contracts';
import type { DragBindApi } from '@/app/composables/useDragAppointment';
import AppBadge from '@/view/components/ui/badge/Badge.vue';

export interface WeekCardView {
  item: AppointmentDto;
  /** "HH:mm" inicial no fuso do usuário (formatado na página). */
  time: string;
  review: boolean;
  past: boolean;
  conflictTitle: string | null;
  class: string;
}

export interface WeekDayView {
  /** dateKey local do dia (dom..sáb — ordem de `weekRows`). */
  date: string;
  key: string;
  heading: { label: string; isToday: boolean; weekday: string };
  cards: WeekCardView[];
}

const props = defineProps<{
  days: WeekDayView[];
  /** Mecânica de drag da página (bind + primitivos) — ausente = grade sem drag. */
  drag?: DragBindApi<AppointmentDto> | null;
}>();

const emit = defineEmits<{
  dayClick: [dateKey: string];
  itemClick: [item: AppointmentDto];
}>();
</script>
