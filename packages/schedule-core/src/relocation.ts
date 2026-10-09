import { overlaps } from './conflicts';
import type { AppointmentLike, Interval } from './types';

/**
 * Reagendamento Assistido (Fase 8, Etapa 0 — ADR-0015): conflito nunca é fim de
 * linha nem override. A regra oferece UMA jogada por vez — mover o existente OU
 * o movido para o primeiro slot livre (duração preservada) — e cada jogada só
 * vale se não esbarrar em terceiros. Sem jogada ⇒ a superfície não salva.
 *
 * Âncora de busca das duas jogadas: o **início da própria peça que se move**
 * (meia-lua que gira no lugar): o buraco que ela deixa ao sair é a primeira
 * casa elegível; a peça nunca "some" do calendário — o que está parado bloqueia.
 *
 * Regra zero: pura, sem I/O, `now` injetável (default Date.now, como
 * findConflict), nunca lança para fluxo normal — tudo discriminado no retorno.
 */

export type RelocationOption<T extends AppointmentLike = AppointmentLike> =
  | { kind: 'move-other'; other: T; newStart: Date; newEnd: Date }
  | { kind: 'move-self'; newStart: Date; newEnd: Date };

export type RelocationPlan<T extends AppointmentLike = AppointmentLike> =
  | { kind: 'ok' }
  | { kind: 'blocked'; reason: 'self-conflict' }
  | { kind: 'options'; options: RelocationOption<T>[] };

/**
 * Primeiro intervalo `[earliest, earliest+durationMs)` que não sobrepõe nenhum
 * dos `blockers` (half-open — encostado vale). Varredura determinística e
 * finita: o slot só anda para o fim de um bloqueio que o toca, e os bloqueios
 * são finitos. null se não couber (duração inválida nunca vira jogada).
 */
export function firstFreeSlot(
  earliest: Date,
  durationMs: number,
  blockers: readonly Interval[],
): Interval | null {
  if (durationMs <= 0) return null;
  let start = earliest.getTime();
  for (;;) {
    const candidate: Interval = { startsAt: new Date(start), endsAt: new Date(start + durationMs) };
    const touched = blockers.filter((b) => overlaps(candidate, b));
    if (touched.length === 0) return candidate;
    start = Math.max(...touched.map((b) => b.endsAt.getTime()));
  }
}

/**
 * Plan de uma jogada (spec §B). `candidate` = intervalo NOVO do compromisso que
 * o usuário quer criar/mover no destino; `movedId` ausente = criação. Ignora o
 * próprio movido e itens totalmente passados (mesma semântica de findConflict).
 *
 * - destino livre ⇒ `ok`;
 * - sobreposto a 2+ ⇒ `blocked: self-conflict` (não existe jogada de um lance);
 * - exatamente 1 conflito ⇒ opções `move-other` (obstáculo pousa no primeiro
 *   vão livre a partir do início DELE, duração dele, bloqueios = terceiros +
 *   candidate) e `move-self` (candidate pousa no primeiro vão livre a partir do
 *   início dele, duração dele, bloqueios = terceiros + obstáculo), nesta ordem,
 *   filtradas pelas que de fato MOVEM a peça (pousar no mesmo lugar não é
 *   jogada) e não esbarram em terceiros; as duas falhando ⇒ `options: []`.
 */
export function planRelocation<T extends AppointmentLike>(
  candidate: Interval,
  existing: readonly T[],
  options: { now?: Date; movedId?: string } = {},
): RelocationPlan<T> {
  const now = options.now ?? new Date();
  const others = existing.filter((appt) => {
    if (options.movedId !== undefined && appt.id === options.movedId) return false;
    return appt.endsAt.getTime() > now.getTime();
  });

  const conflicts = others.filter((appt) => overlaps(candidate, appt));
  if (conflicts.length === 0) return { kind: 'ok' };
  if (conflicts.length > 1) return { kind: 'blocked', reason: 'self-conflict' };

  const obstacle = conflicts[0]!;
  const rest = others.filter((appt) => appt.id !== obstacle.id);
  const results: RelocationOption<T>[] = [];

  const otherDuration = obstacle.endsAt.getTime() - obstacle.startsAt.getTime();
  const pushed = firstFreeSlot(obstacle.startsAt, otherDuration, [candidate, ...rest]);
  if (pushed && pushed.startsAt.getTime() !== obstacle.startsAt.getTime()) {
    results.push({
      kind: 'move-other',
      other: obstacle,
      newStart: pushed.startsAt,
      newEnd: pushed.endsAt,
    });
  }

  const selfDuration = candidate.endsAt.getTime() - candidate.startsAt.getTime();
  const moved = firstFreeSlot(candidate.startsAt, selfDuration, [obstacle, ...rest]);
  if (moved && moved.startsAt.getTime() !== candidate.startsAt.getTime()) {
    results.push({ kind: 'move-self', newStart: moved.startsAt, newEnd: moved.endsAt });
  }

  return { kind: 'options', options: results };
}
