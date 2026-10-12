import type { AppointmentDto } from '@agendabo/contracts';

/**
 * Ordenação determinística da agenda: por início, empates por título. Pura —
 * testável com `now`/datas fixas (etapa 12).
 *
 * Genérica no DTO: vale para o compromisso PRÓPRIO (`AppointmentDto`) e para o
 * EMPRESTADO (`SharedAppointmentDto`, spec C.17) — a ordenação só enxerga
 * `startsAt`/`title`, campos comuns dos dois schemas dos contracts.
 */
export function sortAppointmentsByStart<T extends Pick<AppointmentDto, 'startsAt' | 'title'>>(
  items: readonly T[],
): T[] {
  return [...items].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.title.localeCompare(b.title, 'pt-BR'),
  );
}
