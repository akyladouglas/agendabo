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

/**
 * Intervalo half-open do dia civil de `date` deslocado em `shiftDays` dias
 * (negativo vai pro passado), nas meias-noites LOCAIS do fuso offset. Aritmetica
 * por dias locais — transborda mes/ano; nunca soma 24h cegas (Fase 2, ADR-002).
 */
export function shiftDayRange(
  date: Date,
  offsetMinutes: number,
  shiftDays: number,
): { start: Date; end: Date } {
  return userDayRange(new Date(date.getTime() + shiftDays * DAY), offsetMinutes);
}

/** Intervalo half-open [semana civil atual +7d, +14d) — "semana que vem". */
export function userNextWeekRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const current = userWeekRange(date, offsetMinutes);
  const start = new Date(current.start.getTime() + 7 * DAY);
  return { start, end: new Date(start.getTime() + 7 * DAY) };
}

/**
 * Intervalo half-open da SEMANA CIVIL de `date` deslocada em `shiftWeeks` semanas
 * (negativo volta semanas; 0 = a semana corrente) — navegação ← hoje → da web
 * (Fase 5). Deslocar o dia em 7×N dias locais e re-derivar a semana é equivalente a
 * mover o início da semana em N×7 dias (dias locais com offset fixo — ADR-002), e
 * transborda mês/ano naturalmente (mesma técnica de `shiftDayRange`).
 */
export function shiftWeekRange(
  date: Date,
  offsetMinutes: number,
  shiftWeeks: number,
): { start: Date; end: Date } {
  return userWeekRange(new Date(date.getTime() + shiftWeeks * 7 * DAY), offsetMinutes);
}

/**
 * Intervalo half-open do MES CIVIL que contem `date` no fuso offset:
 * [dia 1 00:00 local, dia 1 00:00 local do mes seguinte) — "este mes".
 */
export function userMonthRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const { year, month } = utcToZonedParts(date, offsetMinutes);
  const start = zonedTimeToUtc({ year, month, day: 1 }, offsetMinutes);
  const end = addLocalMonths(start, offsetMinutes, 1);
  return { start, end };
}

/**
 * Intervalo half-open do MES CIVIL seguinte ao de `date` no fuso offset:
 * [dia 1 00:00 local do proximo mes, dia 1 00:00 local do seguinte) — "mes que vem".
 */
export function userNextMonthRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const start = addLocalMonths(userMonthRange(date, offsetMinutes).start, offsetMinutes, 1);
  return { start, end: addLocalMonths(start, offsetMinutes, 1) };
}

/**
 * Intervalo half-open do ANO CIVIL que contem `date` no fuso offset:
 * [1 jan 00:00 local, 1 jan 00:00 local do ano seguinte) — "este ano".
 */
export function userYearRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const { year } = utcToZonedParts(date, offsetMinutes);
  const start = zonedTimeToUtc({ year, month: 1, day: 1 }, offsetMinutes);
  const end = zonedTimeToUtc({ year: year + 1, month: 1, day: 1 }, offsetMinutes);
  return { start, end };
}

/** "Ano que vem": o `userYearRange` deslocado 12 meses locais (01/01 do ano seguinte). */
export function userNextYearRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const current = userYearRange(date, offsetMinutes);
  return userYearRange(current.end, offsetMinutes);
}

/**
 * Fim de semana civil no fuso offset: [sabado 00:00 local, segunda 00:00 local) do
 * FIM DE SEMANA MAIS PROXIMO a partir do dia civil de `date` — se hoje ja e
 * sabado OU domingo, e o fim de semana corrente. Segunda 00:00 = sabado + 2 dias
 * locais (meia-noite local a cada 24h com offset fixo — ADR-002).
 */
export function userWeekendRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const { year, month, day } = utcToZonedParts(date, offsetMinutes);
  const currentDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const shiftDays = currentDow === 0 ? -1 : (6 - currentDow + 7) % 7; // domingo => sabado anterior
  const saturday = shiftDayRange(date, offsetMinutes, shiftDays);
  return { start: saturday.start, end: new Date(saturday.start.getTime() + 2 * DAY) };
}

/**
 * Período da GRADE DO MÊS (visão Mês da web, Fase 7): 6×7 = 42 dias CIVIS que cobrem
 * o mês civil de `date`, com a primeira linha começando no DOMINGO 00:00 local ≤ dia 1
 * (convenção da grade vigente — spec calendario-visoes D5/Aberto #1). Half-open
 * [domingo inicial, domingo inicial + 42 dias). A grade é sempre de 6 linhas: meses de
 * 5 linhas ganham uma linha extra de mês vizinho (decorativa, esmaecida) — o período da
 * query cobre tudo. Mesma base de dias locais de `userWeekRange` (ADR-002).
 */
export function monthGridRange(date: Date, offsetMinutes: number): { start: Date; end: Date } {
  const month = userMonthRange(date, offsetMinutes);
  // O weekday do DIA 1 local: nunca getUTCDay() do instante UTC (com offset != 0 o dia
  // UTC pode ser outro — gotcha: meia-noite local -03:00 cai no dia anterior em UTC).
  const { year, month: m, day } = utcToZonedParts(month.start, offsetMinutes);
  const firstDow = new Date(Date.UTC(year, m - 1, day)).getUTCDay(); // 0 = domingo
  const start = new Date(month.start.getTime() - firstDow * DAY);
  return { start, end: new Date(start.getTime() + 42 * DAY) };
}

/**
 * Âncora (meia-noite local) do mês civil deslocado em `shiftMonths` meses (negativo volta
 * meses; transborda ano naturalmente — mesma técnica de `shiftDayRange`). Trocar de mês
 * ancora no DIA 1 do mês destino (Aberto #6 da spec calendario-visoes). Para "voltar a
 * Hoje" a web devolve `now` como âncora (estado interno); `shiftMonthRange(now, off, 0)`
 * é o dia 1 do mês corrente.
 */
export function shiftMonthRange(date: Date, offsetMinutes: number, shiftMonths: number): Date {
  const month = userMonthRange(date, offsetMinutes);
  return addLocalMonths(month.start, offsetMinutes, shiftMonths);
}

/**
 * Âncora (meia-noite local) do ano civil deslocado em `shiftYears` anos (negativo volta
 * anos). Como `shiftMonthRange`, ancora no DIA 1 do mês de janeiro do ano destino
 * (01/01 local); "Hoje" = a web devolve `now` como âncora.
 */
export function shiftYearRange(date: Date, offsetMinutes: number, shiftYears: number): Date {
  const year = userYearRange(date, offsetMinutes);
  return addLocalMonths(year.start, offsetMinutes, 12 * shiftYears);
}

/** Meia-noite local (UTC) de `date` deslocada em `months` meses locais (transborda ano). */
function addLocalMonths(midnightUtc: Date, offsetMinutes: number, months: number): Date {
  const { year, month } = utcToZonedParts(midnightUtc, offsetMinutes);
  const probe = Date.UTC(year, month - 1 + months, 1);
  const parts = {
    year: new Date(probe).getUTCFullYear(),
    month: new Date(probe).getUTCMonth() + 1,
    day: 1,
  };
  return zonedTimeToUtc(parts, offsetMinutes);
}