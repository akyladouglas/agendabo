import { userDayRange, utcToZonedParts, zonedTimeToUtc } from './dates';

const DAY = 24 * 60 * 60_000;

/**
 * Células/linhas/densidade das visões do calendário da web (Fase 7, spec
 * calendario-visoes E.2). Celularidade com mês vizinho, virada de semana e cruzamento
 * de meia-noite É regra de data (regra zero) — mora aqui, pura: zero I/O, `now` e
 * `offsetMinutes` sempre injetados (schedule-core.md). Datas entram como `Date` UTC e
 * saem como `dateKey` local 'YYYY-MM-DD' (mesmo padrão de `dates.ts`, ADR-002).
 */

/** Meio de um intervalo half-open [start, end). */
export interface DateRange {
  start: Date;
  end: Date;
}

/** O que a web tem de cada compromisso e é suficiente para estas regras. */
export interface LocalizedItem {
  startsAt: Date;
  endsAt: Date;
}

/** Uma célula da grade do mês / linha da semana: dia civil + sua meia-noite UTC local. */
export interface CalendarDay {
  /** 'YYYY-MM-DD' do dia civil no fuso offset. */
  date: string;
  /** Meia-noite LOCAL do dia como instantâneo UTC. */
  start: Date;
  /** Meia-noite LOCAL do dia seguinte (half-open). */
  end: Date;
  /** Só em `monthCells`: o dia pertence ao mês da grade (senão: mês vizinho). */
  inMonth?: boolean;
  /** Só quando `now` foi passado: é o dia civil do "hoje" injetado. */
  isToday?: boolean;
}

/** Densidade de um mês na visão Ano: quantidade de DIAS CIVIS com ≥1 compromisso. */
export interface MonthDensity {
  /** 1-12 (mês CALENDAR do período). */
  month: number;
  daysWithAppointments: number;
  /** dateKeys ordenados dos dias com compromisso. */
  dayKeys: string[];
}

/** 'YYYY-MM-DD' do dia civil de um instantâneo UTC no fuso offset. */
function toLocalDateKey(instant: Date, offsetMinutes: number): string {
  const { year, month, day } = utcToZonedParts(instant, offsetMinutes);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function toCalendarDay(instant: Date, offsetMinutes: number): CalendarDay {
  const start = zonedTimeToUtc(utcToZonedParts(instant, offsetMinutes), offsetMinutes);
  return {
    date: toLocalDateKey(instant, offsetMinutes),
    start,
    end: new Date(start.getTime() + DAY),
  };
}

/**
 * 42 células da grade do mês a partir do período de `monthGridRange`: 6 linhas × 7
 * colunas (domingo a sábado), `inMonth=false` nos dias de meses vizinhos (leading/
 * trailing), `isToday` apenas quando `now` é injetado e cai dentro da grade. `dateKey`s
 * únicos e consecutivos por construção (meia-noite local a cada 24h no modelo de offset
 * fixo — limitação E.6 da spec declarada em `monthGridRange`).
 */
export function monthCells(
  gridRange: DateRange,
  offsetMinutes: number,
  now?: Date,
): CalendarDay[] {
  const todayKey = now === undefined ? undefined : toLocalDateKey(now, offsetMinutes);
  // O mês da grade é o do DIA DO MEIO da grade (índice 21): com 42 dias cobrindo um mês
  // de 28..31 dias, o dia 22 da grade está SEMPRE no mês alvo — nunca num leading ou
  // trailing de mês vizinho. Comparar com o mês do `start` estaria errado quando o mês
  // começa na segunda ou depois (o leading do vizinho sairia com inMonth=true).
  const anchorMonth = utcToZonedParts(new Date(gridRange.start.getTime() + 21 * DAY), offsetMinutes);
  const cells: CalendarDay[] = [];
  for (let i = 0; i < 42; i++) {
    const cell = toCalendarDay(new Date(gridRange.start.getTime() + i * DAY), offsetMinutes);
    // `cell.start` é a meia-noite LOCAL do dia como instantâneo UTC; as partes locais dele
    // são exatamente as do dia civil (a meia-noite local é o meio-dia UTC do MESMO dia).
    const parts = utcToZonedParts(cell.start, offsetMinutes);
    cells.push({
      ...cell,
      inMonth: parts.year === anchorMonth.year && parts.month === anchorMonth.month,
      isToday: cell.date === todayKey,
    });
  }
  return cells;
}

/**
 * 7 linhas da semana: DOMINGO a sábado (convenção da grade da spec calendario-visoes
 * D5/Aberto #1 — NÃO a semana civil de `userWeekRange`, que começa na segunda). Para
 * aceitar qualquer range (ex.: o `userWeekRange`/`shiftWeekRange` que a web já usa para
 * a QUERY), a grade é derivada do INÍCIO LOCAL do range alinhado para trás até o domingo
 * mais próximo. Meia-noites locais + `dateKey`s iguais aos dias da query.
 */
export function weekRows(weekRange: DateRange, offsetMinutes: number, now?: Date): CalendarDay[] {
  const firstDay = userDayRange(weekRange.start, offsetMinutes).start;
  const { year, month, day } = utcToZonedParts(firstDay, offsetMinutes);
  const firstDow = new Date(Date.UTC(year, month - 1, day)).getUTCDay(); // 0 = domingo
  const sunday = new Date(firstDay.getTime() - firstDow * DAY);
  const todayKey = now === undefined ? undefined : toLocalDateKey(now, offsetMinutes);
  return Array.from({ length: 7 }, (_, i) => {
    const cell = toCalendarDay(new Date(sunday.getTime() + i * DAY), offsetMinutes);
    return { ...cell, isToday: cell.date === todayKey };
  });
}

/**
 * Agrupa itens pelo dia civil do INÍCIO LOCAL (`startsAt`): o compromisso que cruza a
 * meia-noite pertence ao dia em que COMEÇA (critério da spec, Gherkin 23:50→00:10). Uma
 * linha por dia com item, Map em ordem cronológica, itens ordenados por `startsAt`.
 * Dias sem compromisso não criam chave (o calendário preenche o resto).
 */
export function groupByLocalDay<T extends LocalizedItem>(
  items: readonly T[],
  offsetMinutes: number,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    const key = toLocalDateKey(item.startsAt, offsetMinutes);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(item);
    else byDay.set(key, [item]);
  }
  const sortedDays = [...byDay.keys()].sort();
  const result = new Map<string, T[]>();
  for (const key of sortedDays) {
    result.set(
      key,
      byDay.get(key)!.slice().sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
    );
  }
  return result;
}

/**
 * Densidade da visão Ano: para CADA mês civil coberto por `range` (ex.: `userYearRange`),
 * quantos DIAS CIVIS têm ≥1 compromisso e quais são — dois compromissos no mesmo dia
 * contam 1 (bolinha por dia, não por quantidade; Aberto #2 da spec). Item fora do
 * período não conta; item que cruza a meia-noite conta no dia de início (mesma regra de
 * `groupByLocalDay`). `dayKeys` em ordem cronológica.
 */
export function dayDensity(
  items: readonly LocalizedItem[],
  range: DateRange,
  offsetMinutes: number,
): Map<number, MonthDensity> {
  const from = range.start.getTime();
  const to = range.end.getTime();
  const daysByMonth = new Map<number, Set<string>>();
  const startParts = utcToZonedParts(range.start, offsetMinutes);
  // O range é half-open: `end` é a MEIA-NOITE do dia seguinte ao último dia coberto,
  // então o último mês coberto é o mês de `end - 1ms` (senão um range de ano inteiro,
  // que termina em 01/01 do ano seguinte, perderia dezembro).
  const lastCovered = utcToZonedParts(new Date(range.end.getTime() - 1), offsetMinutes);
  const totalMonths = (lastCovered.year - startParts.year) * 12 + (lastCovered.month - startParts.month) + 1;
  for (let i = 0; i < totalMonths; i++) {
    const month = ((startParts.month - 1 + i) % 12) + 1;
    daysByMonth.set(month, new Set());
  }
  for (const item of items) {
    const t = item.startsAt.getTime();
    if (t < from || t >= to) continue;
    const key = toLocalDateKey(item.startsAt, offsetMinutes);
    const month = Number(key.slice(5, 7));
    daysByMonth.get(month)?.add(key);
  }
  const result = new Map<number, MonthDensity>();
  for (const [month, days] of daysByMonth) {
    const dayKeys = [...days].sort();
    result.set(month, { month, daysWithAppointments: dayKeys.length, dayKeys });
  }
  return result;
}
