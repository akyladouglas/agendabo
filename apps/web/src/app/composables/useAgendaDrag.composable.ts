import { ref } from 'vue';
import { toast } from 'vue-sonner';
import {
  dropTargetFromKey,
  dropTargetRange,
  localDateKey,
} from '@agendabo/schedule-core';
import type { AppointmentDto } from '@agendabo/contracts';
import { formatDateTimeInTz, formatDayHeading, formatRangeInTz, measureTzOffset, toLocalTimeString } from '../utils/tz';
import { useDragAppointment, type DragBindApi } from './useDragAppointment';
import { useCheckConflict } from './mutations/useCheckConflict.mutation';
import { useRescheduleMutation } from './mutations/useReschedule.mutation';
import { conflictMessage } from '../utils/conflict';

/**
 * Fluxo do DROP (plano grades-dia-semana-mes, Etapa 2.3): a MECÂNICA é do hook,
 * a REGRA é do schedule-core (`dropTargetFromKey`/`dropTargetRange` — a página só
 * compõe, E.4), a decisão é da API. Ao soltar:
 *   1. célula → novo intervalo (translação, mesma duração — nunca recalculada aqui);
 *   2. `check-conflict` com `ignoreId` = movido;
 *   3. livre → `reschedule` variante move SEM `otherId` (a mutation invalida a
 *      agenda; SEM optimistic update — o bloco só muda quando o cache confirmar);
 *   4. conflito → `onConflict` (a página reabre o Reagendamento Assistido no modal
 *      de edição do item com o NOVO horário — Etapa 0, spec §D);
 *   5. erro → toast; o bloco nunca saiu do lugar.
 */

/**
 * Célula-origem do item na visão atual (a mesma chave `data-cell-key` que o
 * bloco ocupa): Dia = linha da hora local do item; Semana/Mês = célula do dia
 * civil. Composição de primitivos do schedule-core — nenhuma data nasce aqui.
 */
export function dropOriginKey(
  view: 'day' | 'week' | 'month',
  item: AppointmentDto,
  timezone: string,
): string {
  const off = measureTzOffset(timezone, item.startsAt);
  if (view !== 'day') {
    return `day:${localDateKey(item.startsAt, off)}`;
  }
  // linha de hora local N do dia civil do item: o início UTC da linha é
  // meia-noite local do dia + N horas (meia-noite local = Date.UTC(key) − off)
  const key = localDateKey(item.startsAt, off);
  const midnight = Date.parse(`${key}T00:00:00Z`) - off * 60_000;
  const hour = Math.floor((item.startsAt.getTime() - midnight) / 3_600_000);
  const cellStart = new Date(midnight + Math.max(0, Math.min(23, hour)) * 3_600_000);
  return `hour:${cellStart.toISOString()}`;
}

/** Rótulo do destino no preview ("→ hoje 18:00" / "→ qua 14/10") — só formatação.
 *  `days` aceita as células do período (CalendarDay | HourCell — só precisa de
 *  `date`/`start` nos dias; as horas vêm do próprio instante da chave). */
export function dropCellLabel(
  key: string,
  days: readonly { date?: string; start: Date }[],
  timezone: string,
  now: Date,
): string {
  const target = dropTargetFromKey(key);
  if (!target) return '';
  if (target.kind === 'hour') {
    const heading = formatDayHeading(target.cellStartUtc, timezone, now);
    const time = toLocalTimeString(target.cellStartUtc, timezone);
    return `${heading.isToday ? 'hoje' : heading.weekday} ${time}`;
  }
  const day = days.find((d) => d.date === target.dateKey);
  if (!day) return target.dateKey;
  const heading = formatDayHeading(day.start, timezone, now);  return `${heading.isToday ? 'hoje' : heading.weekday} ${heading.label}`;
}

/** O que a página precisa para reabrir o Reagendamento Assistido no modal. */
export interface DropRelocationRequest {
  item: AppointmentDto;
  /** Horário candidato (a translação da regra pura) — o form abre com ELE. */
  startsAt: Date;
  endsAt: Date;
}

export interface UseAgendaDragOptions {
  timezone: () => string;
  now: () => Date;
  /** Células do período (Dia = hourCells | Semana = rows | Mês = cells) — p/ o preview. */
  days: () => readonly { date?: string; start: Date }[];
  /** Célula-origem do item (a página sabe onde o bloco vive — `dropOriginKey`). */
  originOf: (item: AppointmentDto) => string;
  /** Conflito: a página abre o modal do item com `pendingRelocation` preenchido. */
  onConflict?: (req: DropRelocationRequest) => void;
}

export interface UseAgendaDragApi {
  /** O pacote que as grades burras consomem (`v-bind` + primitivos reativos). */
  drag: DragBindApi<AppointmentDto>;
  /** Texto do fantasma enquanto arrasta (título + horário atual do item). */
  ghostText: () => string;
  previewLabel: ReturnType<typeof useDragAppointment>['previewLabel'];
  /** true entre o drop e a resposta da API (a página desabilita re-drop). */
  dropBusy: ReturnType<typeof ref<boolean>>;
  /** Anúncio `aria-live` pós-drop ("Reagendado para ..."). */
  dropAnnouncement: ReturnType<typeof ref<string>>;
  /** Drop com conflito: aguardando a decisão do usuário no modal (ou null). */
  pendingRelocation: ReturnType<typeof ref<DropRelocationRequest | null>>;
}

export function useAgendaDrag(options: UseAgendaDragOptions): UseAgendaDragApi {
  const checkConflict = useCheckConflict();
  const reschedule = useRescheduleMutation();

  const dropBusy = ref(false);
  const dropAnnouncement = ref('');
  const pendingRelocation = ref<DropRelocationRequest | null>(null);

  /** Move sem conflito: variante move pura; toast/aria-live só APÓS confirmar. */
  async function applyMove(item: AppointmentDto, next: { startsAt: Date; endsAt: Date }): Promise<void> {
    await reschedule.mutateAsync({
      mode: 'move',
      movedId: item.id,
      newStart: next.startsAt,
      newEnd: next.endsAt,
    });
    const msg = `Reagendado para ${formatDateTimeInTz(next.startsAt, options.timezone())}`;
    dropAnnouncement.value = msg;
    toast.success(msg);
  }

  const drag = useDragAppointment<AppointmentDto>({
    originOf: options.originOf,
    cellLabel: (key) => dropCellLabel(key, options.days(), options.timezone(), options.now()),
    ghostTextOf: (item) =>
      `${item.title} · ${formatRangeInTz(item.startsAt, item.endsAt, options.timezone())}`,
    onDrop: async (item, cellKey) => {
      const target = dropTargetFromKey(cellKey);
      if (!target) return; // chave desconhecida: drop abortado — nada é escrito
      const off = measureTzOffset(options.timezone(), item.startsAt);
      const next = dropTargetRange(target, item, off);
      dropBusy.value = true;
      try {
        let conflicted = false;
        try {
          const check = await checkConflict.mutateAsync({
            startsAt: next.startsAt,
            endsAt: next.endsAt,
            ignoreId: item.id,
          });
          conflicted = check.conflict;
        } catch {
          // check-conflict falhou: não bloqueamos — o reschedule re-checa no server
          // (padrão do form, spec A.4)
        }
        if (conflicted) {
          pendingRelocation.value = { item, ...next };
          options.onConflict?.(pendingRelocation.value);
          return;
        }
        await applyMove(item, next);
      } catch (err) {
        const conflict = conflictMessage(err, (s, e) => formatRangeInTz(s, e, options.timezone()));
        if (conflict) {
          // corrida entre check e save: o conflito do server vira jogada no modal
          pendingRelocation.value = { item, ...next };
          options.onConflict?.(pendingRelocation.value);
          return;
        }
        // o useRescheduleMutation já toastifica o erro genérico; o bloco NUNCA
        // saiu do lugar (sem optimistic update — a cache é a verdade)
      } finally {
        dropBusy.value = false;
      }
    },
  });

  return {
    drag: drag.viewApi,
    ghostText: () => drag.ghostText(),
    previewLabel: drag.previewLabel,
    dropBusy,
    dropAnnouncement,
    pendingRelocation,
  };
}
