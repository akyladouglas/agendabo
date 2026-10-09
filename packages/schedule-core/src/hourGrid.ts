import type { DateRange } from './calendar';
import { utcToZonedParts } from './dates';

/** Constantes de tempo (locais ao módulo — nomes únicos: o dev server às vezes
 *  serve o módulo transformado sem o head e colisões globais viram quebra difícil). */
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

/**
 * Grade de horas da visão Dia (plano grades-dia-semana-mes, Etapa 1.1). Uma célula
 * por HORA LOCAL coberta pela `dayRange` UTC (a range de um dia civil no fuso do
 * usuário — `userDayRange`/`shiftDayRange`). Regra de data (regra zero): pura,
 * `now` injetável (omitido ⇒ nada é passado), half-open — `now` no EXATO limite de
 * fim da célula não a torna passada. As horas são expressas como instantes UTC +
 * `hourUtc` "HH" da HORA LOCAL (meia-noite local em −03:00 = célula "00" às 03:00Z);
 * a formatação pt-BR fica na borda web (ADR-002).
 */
export interface HourCell {
  /** Hora local da célula, "00".."23" (testid `day-slot-HH` da web). */
  hourUtc: string;
  /** Rótulo da linha da grade: "HH:mm" (zero-padding, sem Intl). */
  label: string;
  /** Início da hora (instante UTC). */
  start: Date;
  /** Fim da hora (instante UTC, half-open). */
  end: Date;
  /** Só quando `now` é injetado: o agora já passou do FIM desta célula. */
  isPast: boolean;
}

export function hourGrid(dayRange: DateRange, offsetMinutes: number, now?: Date): HourCell[] {
  const cells: HourCell[] = [];
  let t = dayRange.start.getTime();
  while (t < dayRange.end.getTime()) {
    // avanço ao PRÓXIMO limite de hora LOCAL (não += HOUR_MS cego): com offset de
    // minutos não-inteiros (ex.: +05:45) as horas locais não caem nas horas UTC
    const naive = t + offsetMinutes * MINUTE_MS;
    const nextLocalHour = (Math.floor(naive / HOUR_MS) + 1) * HOUR_MS;
    const end = new Date(Math.min(nextLocalHour - offsetMinutes * MINUTE_MS, dayRange.end.getTime()));
    const parts = utcToZonedParts(new Date(t), offsetMinutes);
    const label = String(parts.hour).padStart(2, '0');
    cells.push({
      hourUtc: label,
      label: `${label}:00`,
      start: new Date(t),
      end,
      isPast: now !== undefined && now >= end,
    });
    t = end.getTime();
  }
  return cells;
}
