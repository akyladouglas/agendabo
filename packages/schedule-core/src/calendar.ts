import { monthGridRange, userDayRange, userMonthRange, utcToZonedParts, zonedTimeToUtc } from './dates';

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

/**
 * Dia civil TOCADO por um item + o recorte do item nele (multi-dia nas visões —
 * spec multi-dia-nas-visoes F.1). `start`/`end` são os meios half-open [start, end):
 * no dia de início `start === startsAt`; num dia à frente, `start ===` meia-noite
 * local (clamp). `continuesBefore`/`continuesAfter` dizem que o item veio/vai para
 * OUTRO dia (a UI desenha "…↦ título" / "título ↤…").
 */
export interface DaySlice<T extends LocalizedItem = LocalizedItem> {
  /** O COMPROMISSO ORIGINAL (intacto — o clique/aria/drag usam o intervalo integral). */
  item: T;
  /** Início do RECORTE no dia (meia-noite local quando o item já tinha começado). */
  startsAt: Date;
  /** Fim do RECORTE no dia (meia-noite local quando o item continua no próximo). */
  endsAt: Date;
  /** O item já tinha começado antes deste recorte (nasce em dia anterior). */
  continuesBefore: boolean;
  /** O item continua depois deste recorte (termina em dia posterior). */
  continuesAfter: boolean;
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
 * date-keys locais TOCADOS por um item, em ordem cronológica (multi-dia — spec
 * multi-dia-nas-visoes F.1). Half-open em tudo: `startsAt < fimDoDia && endsAt >
 * inícioDoDia`; item terminando EXATAMENTE na meia-noite NÃO toca o dia seguinte,
 * item começando EXATAMENTE na meia-noite toca só o novo dia; item degenerado
 * [x, x) não toca dia nenhum. Meia-noites locais no MODELO de offset único (ADR-002
 * /limitação E.6 da mãe): `floor` naive + passo de 24h exatas — o mesmo da grade.
 */
export function localDaysTouched<T extends LocalizedItem>(item: T, offsetMinutes: number): string[] {
  const from = item.startsAt.getTime();
  const to = item.endsAt.getTime();
  if (!(from < to)) return [];
  const offMs = offsetMinutes * 60_000;
  const keys: string[] = [];
  // meia-noite LOCAL do dia de início como instantâneo UTC (piso naive em dias)
  let dayStart = Math.floor((from + offMs) / DAY) * DAY - offMs;
  while (dayStart < to) {
    const parts = utcToZonedParts(new Date(dayStart), offsetMinutes);
    keys.push(
      `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    );
    dayStart += DAY;
  }
  return keys;
}

/**
 * Recorte half-open de um item a um range [range.start, range.end) — `null` quando o
 * item não TOCA o range (meia-noite = `end` de UM dia e `start` do anterior: só
 * `end === range.start` não toca; `end === range.end` TOCA: o item continua depois).
 * É o corte por dia da Semana/Dia (decisão M3) e a primitiva de `sliceTimelineItems`.
 * Os flags comparam os INSTANTÊES do item, não o bucket de dia: um item que morre
 * exatamente na meia-noite seguinte continua no dia posterior ⇒ `continuesAfter`.
 */
export function sliceItemToRange<T extends LocalizedItem>(
  item: T,
  range: DateRange,
): DaySlice<T> | null {
  const from = range.start.getTime();
  const to = range.end.getTime();
  if (!(from < to)) return null;
  const rawStart = item.startsAt.getTime();
  const rawEnd = item.endsAt.getTime();
  // toca = intersecção NÃO-VAZIA com o range half-open (meia-noite é `end` de UM dia e
  // `start` do anterior): só `rawEnd === from` não toca (e não desenha nada: o recorte
  // seria degenerado [x,x)). Item TERMINANDO exatamente em `to` (meia-noite) TOCA o dia:
  // ele viveu até a fronteira — mas NÃO continua depois dela (half-open: nada existe em
  // [to, to); "reunião 09:00→00:00" é um bloco do dia, não uma travessia).
  const touches = rawStart < to && rawEnd > from;
  if (!touches) return null;
  const start = Math.max(rawStart, from);
  const end = Math.min(rawEnd, to);
  // recorte vazio não existe como slice (dia degenerado [x,x) encosta mas não desenha nada)
  if (!(start < end)) return null;
  return {
    item,
    startsAt: new Date(start),
    endsAt: new Date(end),
    // "veio de outro dia" = o recorte COMEÇA depois do início do item
    continuesBefore: start > rawStart,
    // "continua no próximo dia" = o item tem vida DEPOIS do recorte
    continuesAfter: rawEnd > end,
  };
}

/**
 * Corte por dia PARA O LAYOUT da grade (Semana/Dia): cada item que toca `range` vira
 * UM slice com o recorte do dia + flags; itens que não tocam saem fora. O `item` é o
 * ORIGINAL (o layout posiciona pelo slice, a UI abre move e rotula pelo original).
 * Ordem estável: `start` do slice, depois duração menor, depois `id` (mesma ordem do
 * `layoutDayTimeline` — saída determinística independente da ordem de entrada).
 */
export function sliceTimelineItems<T extends LocalizedItem>(
  items: readonly T[],
  range: DateRange,
): DaySlice<T>[] {
  const dur = (s: DaySlice<T>) => s.endsAt.getTime() - s.startsAt.getTime();
  return items
    .map((item) => ({ item, slice: sliceItemToRange(item, range) }))
    .filter((x): x is { item: T; slice: DaySlice<T> } => x.slice !== null)
    .map((x) => x.slice)
    .sort(
      // mesma ordem do layoutDayTimeline: posição, depois duração MENOR primeiro, id
      (a, b) =>
        a.startsAt.getTime() - b.startsAt.getTime() || dur(b) - dur(a) || cmpId(a.item, b.item),
    );
}

/** Ordem canônica por `id` quando existe (senão ordem estável 0). */
function cmpId(a: LocalizedItem, b: LocalizedItem): number {
  const ai = (a as { id?: string }).id ?? '';
  const bi = (b as { id?: string }).id ?? '';
  return ai < bi ? -1 : ai > bi ? 1 : 0;
}

/**
 * Agrupa itens pelos DIAS CIVIS QUE ELES TOCAM (multi-dia — substitui o agrupamento
 * por dia de início da Fase 7): o compromisso 10/10 23:00 → 12/10 17:00 aparece em
 * 10, 11 E 12 (chips do Mês, colunas da Semana, densidade do Ano). Um item por bucket
 * é o MESMO objeto. Map com dateKeys em ordem cronológica; itens ordenados por
 * `startsAt` dentro do dia. Dias sem compromisso não criam chave.
 */
export function groupByLocalDayTouched<T extends LocalizedItem>(
  items: readonly T[],
  offsetMinutes: number,
): Map<string, T[]> {
  const byDay = new Map<string, T[]>();
  for (const item of items) {
    for (const key of localDaysTouched(item, offsetMinutes)) {
      const bucket = byDay.get(key);
      if (bucket) bucket.push(item);
      else byDay.set(key, [item]);
    }
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
 * contam 1 (bolinha por dia, não por quantidade; Aberto #2 da spec). item multi-dia
 * marca TODOS os dias que TOCA dentro do período (coerência com os chips do Mês —
 * spec multi-dia-nas-visoes E.8); item inteiramente fora do período não conta.
 * `dayKeys` em ordem cronológica.
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
    // dias tocados DENTRO do período: item que nasce antes do range (ex.: réveillon
    // multi-dia) conta os dias que toca aqui dentro — `localDaysTouched` é half-open,
    // o dia que só "encosta" em `range.end` (meia-noite em ponto) é excluído
    if (!(item.startsAt.getTime() < to && item.endsAt.getTime() > from)) continue;
    for (const key of localDaysTouched(item, offsetMinutes)) {
      const month = Number(key.slice(5, 7));
      daysByMonth.get(month)?.add(key);
    }
  }
  const result = new Map<number, MonthDensity>();
  for (const [month, days] of daysByMonth) {
    const dayKeys = [...days].sort();
    result.set(month, { month, daysWithAppointments: dayKeys.length, dayKeys });
  }
  return result;
}

/** Um mês do heatmap da visão Ano: grade 7×6 fixa (42 células) do mês calendário. */
export interface YearHeatMonth {
  /** 1-12 (mês CALENDARIO da grade). */
  month: number;
  /** 42 células (6 linhas × 7 colunas, domingo a sábado), `inMonth`/`isToday` resolvidos. */
  cells: CalendarDay[];
}

/**
 * Heatmap da visão Ano (spec visao-ano-heatmap D1): as 12 grades 7×6 FIXAS do ano
 * civil de `yearRange` (ex.: `userYearRange`), cada uma com o leading alinhado no
 * DOMINGO 00:00 local ≤ dia 1 e o mês da grade definido pelo DIA DO MEIO (índice 21)
 * — exatamente a técnica de `monthGridRange` + `monthCells`. 6 linhas sempre: meses
 * de 5 linhas ganham a 6ª linha de espaçadores (`inMonth: false`), o que dá a TODOS
 * os cards a mesma altura (decisão humana D-1 — o layout fixo é da web, a grade é
 * daqui). Dias tocados fora do ano exibido nunca entram (não há célula deles).
 * Pura: `now`/`offsetMinutes` injetados (modelo de offset único por período —
 * ADR-002/limitação E.6 da mãe), zero I/O.
 */
export function yearHeatmap(
  yearRange: DateRange,
  offsetMinutes: number,
  now?: Date,
): YearHeatMonth[] {
  const firstOfMonth = userMonthRange(yearRange.start, offsetMinutes).start;
  return Array.from({ length: 12 }, (_, i) => {
    // 1º dia local do mês i (passo de 24h sobre dias locais de offset fixo); o probe
    // Date.UTC transborda mês/ano naturalmente (mesma técnica de `addLocalMonths`)
    const parts = utcToZonedParts(firstOfMonth, offsetMinutes);
    const probe = Date.UTC(parts.year, parts.month - 1 + i, 1);
    const monthStart = zonedTimeToUtc(
      {
        year: new Date(probe).getUTCFullYear(),
        month: new Date(probe).getUTCMonth() + 1,
        day: 1,
      },
      offsetMinutes,
    );
    const grid = monthGridRange(monthStart, offsetMinutes);
    return { month: i + 1, cells: monthCells(grid, offsetMinutes, now) };
  });
}
