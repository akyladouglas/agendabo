import type { AppointmentDto } from '@agendabo/contracts';

/**
 * Ordenação determinística da agenda: por início, empates por título. Pura —
 * testável com `now`/datas fixas (etapa 12).
 */
export function sortAppointmentsByStart<T extends AppointmentDto>(items: readonly T[]): T[] {
  return [...items].sort(
    (a, b) =>
      a.startsAt.getTime() - b.startsAt.getTime() ||
      a.title.localeCompare(b.title, 'pt-BR'),
  );
}
