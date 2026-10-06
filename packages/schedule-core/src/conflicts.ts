import type { AppointmentLike, ConflictResult, Interval } from './types';

/**
 * Dois intervalos half-open [a1, a2) e [b1, b2) se sobrepoem sse a1 < b2 && b1 < a2.
 * Encostados (a2 === b1) NAO conflitam.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();
}

function classify(a: Interval, b: Interval): ConflictResult['reason'] {
  if (a.startsAt.getTime() === b.startsAt.getTime()) return 'same_start';
  if (a.startsAt <= b.startsAt && b.endsAt <= a.endsAt) return 'contains';
  if (b.startsAt <= a.startsAt && a.endsAt <= b.endsAt) return 'contained';
  return 'partial_overlap';
}

/**
 * Detecao de conflito (1.1) — regra deterministica, o LLM nunca decide isto (ADR-003).
 *
 * Regras:
 *  - intervalo half-open [startsAt, endsAt): encostado nao choca;
 *  - compromissos totalmente no passado (endsAt <= now) sao ignorados;
 *  - `ignoreId` permite ignorar o proprio compromisso em edicoes;
 *  - `now` e injetavel para teste (default: Date.now).
 */
export function findConflict<T extends AppointmentLike>(
  candidate: Interval,
  existing: readonly T[],
  options: { now?: Date; ignoreId?: string } = {},
): ConflictResult<T> {
  const now = options.now ?? new Date();
  for (const appt of existing) {
    if (options.ignoreId !== undefined && appt.id === options.ignoreId) continue;
    if (appt.endsAt.getTime() <= now.getTime()) continue; // compromisso ja passado
    if (overlaps(candidate, appt)) {
      return { conflict: true, with: appt, reason: classify(candidate, appt) };
    }
  }
  return { conflict: false };
}
