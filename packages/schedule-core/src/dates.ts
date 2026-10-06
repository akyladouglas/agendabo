const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Instante UTC a partir de partes do CALENDARIO LOCAL + deslocamento fixo (minutos leste de UTC). */
export function zonedTimeToUtc(parts: DateLikeParts, offsetMinutes: number): Date {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day ?? 1,
    parts.hour ?? 0,
    parts.minute ?? 0,
    parts.second ?? 0,
  );
  return new Date(utcGuess - offsetMinutes * MINUTE);
}

export interface DateLikeParts {
  year: number;
  /** 1-12 */
  month: number;
  day?: number;
  hour?: number;
  minute?: number;
  second?: number;
}

/** Partes do calendario LOCAL para um instante UTC + deslocamento fixo. */
export function utcToZonedParts(date: Date, offsetMinutes: number): Required<DateLikeParts> {
  const local = new Date(date.getTime() + offsetMinutes * MINUTE);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    second: local.getUTCSeconds(),
  };
}

/** "07:00" no dia civil do usuario => instante UTC (resumo diario, 2.1). */
export function localTimeOfDayToUtcUtcDay(
  date: Date,
  offsetMinutes: number,
  timeOfDay: string,
): Date {
  const { year, month, day } = utcToZonedParts(date, offsetMinutes);
  const [h, m] = timeOfDay.split(':').map(Number) as [number, number];
  return zonedTimeToUtc({ year, month, day, hour: h, minute: m }, offsetMinutes);
}

/** Intervalo half-open [dia, dia+1) do dia civil que contem `date` no fuso offset. */
export function userDayRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const { year, month, day } = utcToZonedParts(date, offsetMinutes);
  const start = zonedTimeToUtc({ year, month, day }, offsetMinutes);
  return { start, end: new Date(start.getTime() + DAY) };
}

/** Semana civil comecando na segunda 00:00 local que contem `date`. */
export function userWeekRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const { start: dayStart } = userDayRange(date, offsetMinutes);
  const localWeekday = utcToZonedParts(dayStart, offsetMinutes);
  const jsWeekday = new Date(
    Date.UTC(localWeekday.year, localWeekday.month - 1, localWeekday.day),
  ).getUTCDay();
  const daysSinceMonday = (jsWeekday + 6) % 7;
  const start = new Date(dayStart.getTime() - daysSinceMonday * DAY);
  return { start, end: new Date(start.getTime() + 7 * DAY) };
}

/** Validacao de datas de entrada vindas de qualquer borda (form, LLM, bot). */
export function isValidDate(d: Date): boolean {
  return d instanceof Date && !Number.isNaN(d.getTime());
}
