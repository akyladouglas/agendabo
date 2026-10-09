import type { DateRange } from './calendar';
import { userDayRange, utcToZonedParts } from './dates';

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


/** Dias consecutivos de 24h em UTC (meia-noite→meia-noite no MODELO de offset). */
export const MS_DAY = 86_400_000;

/** Uma coluna da grade da Semana: dia civil (shape de `CalendarDay`) + suas horas. */
export interface DayHourRow {
  /** 'YYYY-MM-DD' do dia civil no fuso. */
  date: string;
  /** Weekday 0=dom..6=sáb da coluna (a linha sabe o próprio dia da semana). */
  weekday: number;
  /** Meia-noite LOCAL do dia como instantâneo UTC. */
  start: Date;
  /** Meia-noite LOCAL do dia seguinte (half-open). */
  end: Date;
  /** Offset do fuso NO DIA (minutos leste de UTC) — a grade usa o do PRÓPRIO dia. */
  offsetMinutes: number;
  /** Grade de horas do dia (`hourGrid` âncora-no-dia). */
  cells: HourCell[];
}

/** Meia-noite LOCAL (instantâneo UTC) do dia civil que contém `instant`. */
function localMidnightUtc(instant: Date, offsetMinutes: number): Date {
  const naive = instant.getTime() + offsetMinutes * MINUTE_MS;
  return new Date(Math.floor(naive / MS_DAY) * MS_DAY - offsetMinutes * MINUTE_MS);
}

/** Weekday (0 = dom) do DIA CIVIL de um instante, nunca `getUTCDay()` cru. */
function localDow(instant: Date, offsetMinutes: number): number {
  const p = utcToZonedParts(instant, offsetMinutes);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/**
 * Offset do fuso no dia de uma MEIA-NOITE LOCAL EXATA (injeção da web): testa o
 * offset-base e o candidato `base + candidateDiff` (a transição do período,
 * ex.: +30 para −180→−150). Uma meia-noite local exata satisfaz
 * `(mid + offset) % MS_DAY === 0` SOMENTE com o offset do próprio dia: com o
 * offset-base ela fica deslocada de `−step` minutos, e o candidato é a
 * alternativa. Operações em tempo naive (instantâneo deslocado do fuso), nunca
 * `floor`/parts de calendário — meia-noite exata é a EXATA fronteira do dia.
 */
export function offsetOfMidnight(midnight: Date, baseOffset: number, candidateDiff: number): number {
  const naiveBase = midnight.getTime() + baseOffset * MINUTE_MS;
  if (((naiveBase % MS_DAY) + MS_DAY) % MS_DAY === 0) return baseOffset;
  const naiveCand = midnight.getTime() + (baseOffset + candidateDiff) * MINUTE_MS;
  if (((naiveCand % MS_DAY) + MS_DAY) % MS_DAY === 0) return baseOffset + candidateDiff;
  return baseOffset;
}

/**
 * Grade de horas da visão SEMANA (plano grades-dia-semana-mes, coluna por dia):
 * os 7 dias da semana DOMINGO→sábado do DIA DE ÂNCORA, cada linha com a grade de
 * horas âncora-NO-DIA: a célula "00" é a MEIA-NOITE LOCAL DA COLUNA. A âncora é
 * SEMPRE um instante injetado (o dia focado), nunca `range.start`: a query da
 * Semana começa na SEGUNDA 00:00 e, com a range como âncora, a grade "scorreria"
 * um dia para frente em fusos negativos (dom viraria seg). Diferente da visão
 * Dia (range = o próprio dia, offset medido nele), a query pode abrir numa
 * segunda com offset ≠ offset do domingo anterior à transição de DST: a página
 * injeta `midnights(d)` (a meia-noite LOCAL REAL do dia, d = dias desde a
 * âncora; negativo = antes dela) + `dstStepMin` (o passo da transição do período,
 * ex.: +30 para −180→−150). Sem injeção, rede de 24h do `offsetMinutes` do range
 * (fuso sem transição no período). O offset de cada linha é o da PRÓPRIA
 * meia-noite (`offsetOfMidnight`) — E.6/ADR-002: offset único por dia. O
 * `range` vira o FIM da grade: uma grade de dia único ainda mostra a semana
 * inteira (a UI é sempre 7 colunas), mas um range mais curto que a semana não
 * pode renderizar dias além do que a consulta cobre. Pura, `now` injetável
 * (omitido ⇒ nada é passado).
 */
export function weekGridRows(
  range: DateRange,
  offsetMinutes: number,
  now?: Date,
  midnights?: (dayIndexFromAnchor: number) => Date,
  dstStepMin = 0,
  anchorInstant?: Date,
): DayHourRow[] {
  // dia civil da ÂNCORA (nunca getUTCDay() do instantâneo UTC — dia UTC pode ser
  // outro com offset != 0); a grade é a semana dom..sáb DESSE dia
  const anchor = userDayRange(anchorInstant ?? range.start, offsetMinutes).start;
  const anchorDow = localDow(anchor, offsetMinutes);
  const rows: DayHourRow[] = [];
  for (let i = 0; i < 7; i++) {
    const dayIndex = i - anchorDow; // dias desde a âncora (dom da semana < 0)
    const start = midnights
      ? midnights(dayIndex)
      : localMidnightUtc(new Date(anchor.getTime() + dayIndex * MS_DAY), offsetMinutes);
    const dayOffset = offsetOfMidnight(start, offsetMinutes, dstStepMin);
    const end = new Date(start.getTime() + MS_DAY);
    const p = utcToZonedParts(start, dayOffset);
    rows.push({
      offsetMinutes: dayOffset,
      date: `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`,
      weekday: i,
      start,
      end,
      cells: hourGrid({ start, end }, dayOffset, now),
    });
  }
  return rows;
}
