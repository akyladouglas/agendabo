import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
  dayDensity,
  groupByLocalDayTouched,
  hourGrid,
  layoutDayTimeline,
  sliceTimelineItems,
  MS_DAY,
  monthCells,
  monthGridRange,
  shiftDayRange,
  shiftMonthRange,
  shiftWeekRange,
  shiftYearRange,
  userDayRange,
  userMonthRange,
  userYearRange,
  weekGridRows,
  yearHeatmap,
  utcToZonedParts,
  type CalendarDay,
  type DateRange,
  type DayHourRow,
  type DaySlice,
  type HourCell,
  type MonthDensity,
  type TimelineBlock,
  type TimelineItem,
  type YearHeatMonth,
} from '@agendabo/schedule-core';
import type { AppointmentDto } from '@agendabo/contracts';
import { useAuthStore } from '../store/authStore';
import { useAppointmentsQuery } from './queries/useAppointments.query';
import { sortAppointmentsByStart } from '../utils/sorting';
import { monthName, measureTzOffset } from '../utils/tz';

/**
 * Estado e derivados da página Agenda (Fase 7, spec calendario-visoes E.5): a página
 * ORQUESTA, este composable segura `{view, anchor}` (estado interno — D6, nada na URL)
 * e deriva período/células/linhas/densidade CHAMANDO o schedule-core. Zero regra de
 * data aqui também — só composição (vue.md #6/#7).
 */

export type SliceTimelineItem = TimelineItem & DaySlice<AppointmentDto>;

/**
 * Bloco posicionado cujo `item` é um slice de dia (Semana/Dia com recorte multi-dia):
 * o layout é do slice, o clique/drag/aria-label são do `slice.item` (intervalo
 * integral). Usado pelo composable e pela página como tipo dos `TimelineBlock`.
 */
export type SliceTimelineBlock = Omit<TimelineBlock<TimelineItem>, 'item'> & {
  item: DaySlice<AppointmentDto>;
};

export type AgendaView = 'day' | 'week' | 'month' | 'year';

const VIEW_ORDER: AgendaView[] = ['day', 'week', 'month', 'year'];
const VIEW_STORAGE_KEY = 'agenda:view';
const ANCHOR_STORAGE_KEY = 'agenda:anchor';
const DAY = 86_400_000;

/** Persistência da ESCOLHA de view em localStorage (nada de dado do usuário — D6). */
function storedView(): AgendaView | null {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEW_ORDER.includes(raw as AgendaView) ? (raw as AgendaView) : null;
  } catch {
    return null; // SSR/teste sem storage
  }
}

function storeView(view: AgendaView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    /* sem storage: só não persiste */
  }
}

/** Âncora (dia focado) como dateKey — só apresentação, nunca dado do usuário. */
function storedAnchorKey(): string | null {
  try {
    const raw = localStorage.getItem(ANCHOR_STORAGE_KEY);
    return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function storeAnchorKey(dateKey: string): void {
  try {
    localStorage.setItem(ANCHOR_STORAGE_KEY, dateKey);
  } catch {
    /* sem storage: só não persiste */
  }
}

/**
 * B.13/D3: <md abre no Dia, ≥md na Semana (SSR/teste-safe). Mês nunca é padrão.
 */
export function defaultAgendaView(): AgendaView {
  return typeof window !== 'undefined' && window.matchMedia?.('(min-width: 768px)').matches
    ? 'week'
    : 'day';
}

export interface UseAgendaPage {
  view: Ref<AgendaView>;
  /** Dia focado (instante). Trocar de visão MANTÉM a âncora (A.2). */
  anchor: Ref<Date>;
  /** Instantâneo de "agora" da borda (re-tirado a cada minuto; esmaecer passados). */
  now: Ref<Date>;
  timezone: ComputedRef<string>;
  /** Período da QUERY: Dia/Semana civis; Mês = grade de 42 dias; Ano = ano civil. */
  range: ComputedRef<DateRange>;
  from: ComputedRef<string>;
  to: ComputedRef<string>;
  appointmentsQuery: ReturnType<typeof useAppointmentsQuery>;
  items: ComputedRef<AppointmentDto[]>;
  /** Mês M exibido na grade/menu (≠ mês da âncora quando a âncora é trailing de M). */
  monthIndex: ComputedRef<number>;
  /** Ano exibido no menu/heading (ano do mês M). */
  year: ComputedRef<number>;
  monthLabel: ComputedRef<{ name: string; short: string }>;
  /** 42 células da grade do Mês (B.6/B.8). */
  cells: ComputedRef<CalendarDay[]>;
  /** Heatmap da visão Ano: 12 grades 7×6 fixas do ano civil da âncora (spec visao-ano-heatmap). */
  yearHeat: ComputedRef<YearHeatMonth[]>;
  /** 7 linhas da semana (dom..sáb, semana da âncora). */
  rows: ComputedRef<DayHourRow[]>;
  /**
   * dateKey → compromissos que TOCAM o dia (multi-dia: o item entra em TODOS os dias
   * que toca — spec multi-dia-nas-visoes F.1/D5; vale para o período da query atual).
   */
  byDay: ComputedRef<Map<string, AppointmentDto[]>>;
  /**
   * Semana: dateKey da coluna → SLICES do recorte local do dia (`sliceItemToRange`).
   * A página dá o range [meia-noite local, próxima) de cada coluna; aqui só corta
   * (borda) — o recorte é schedule-core. Itens que não tocam a coluna ficam fora.
   */
  slicesByRowDate: ComputedRef<Map<string, DaySlice<AppointmentDto>[]>>;
  /** Grade de horas da visão Dia (célula por hora local coberta pelo range — 1.1). */
  hourCells: ComputedRef<HourCell[]>;
  /**
   * Dia: SLICES do recorte dos itens ao range do dia (`sliceTimelineItems`) — o
   * layout posiciona pelo recorte, as flags de continuação vêm daqui (D4).
   */
  daySlices: ComputedRef<DaySlice<AppointmentDto>[]>;
  /** Blocos da visão Dia posicionados em % (layoutDayTimeline sobre os slices). */
  dayBlocks: ComputedRef<SliceTimelineBlock[]>;
  /** Offset do fuso no RANGE (meia-noite local do dia focado) — a grade deriva daqui. */
  rangeOffsetMin: ComputedRef<number>;
  /** Visão Ano: densidade por mês do ano da âncora; dia de hoje (dateKey local). */
  density: ComputedRef<Map<number, MonthDensity>>;
  todayKey: ComputedRef<string>;
  setView(view: AgendaView): void;
  /** ← hoje →: Dia ±1 dia, Semana ±7 dias, Mês ±1 mês (âncora no dia 1), Ano ±1 ano (01/01). */
  shift(direction: -1 | 1): void;
  goToday(): void;
  /** Move a âncora para o dia civil (dateKey) — usado pelos cliques das grades. */
  setDate(dateKey: string): Date;
  /** Menu ir-para: âncora no dia 1 do mês destino (Aberto #6). */
  goToMonth(month: number): void;
  /** Menu ir-para: âncora em 01/01 do ano destino. */
  goToYear(year: number): void;
  /** Clique num mini-mês da visão Ano → visão Mês daquele mês. */
  openMonth(month: number): void;
}

export function useAgendaPage(): UseAgendaPage {
  const auth = useAuthStore();
  const timezone = computed(() => auth.user?.timezone ?? 'UTC');

  const anchor = ref(setAnchorDate0());
  const view = ref<AgendaView>(storedView() ?? defaultAgendaView());
  watch(view, (v) => storeView(v));

  const offset = computed(() => measureTzOffset(timezone.value, anchor.value));

  /** Parts locais via schedule-core (`utcToZonedParts`) — sem Intl aqui. */
  function localParts(instant: Date): { year: number; month: number; day: number } {
    return utcToZonedParts(instant, measureTzOffset(timezone.value, instant));
  }
  /** "YYYY-MM-DD" do dia civil (comparação com dateKeys do schedule-core). */
  function dateKeyOf(instant: Date): string {
    const { year, month, day } = localParts(instant);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  /** Mês/ano CALENDÁRIO do dia civil de `instant` (menus/heading). */
  function calendarOf(instant: Date): { month: number; year: number } {
    const { year, month } = localParts(instant);
    return { month, year };
  }

  /**
   * Âncora SEMPRE a meia-noite LOCAL do dia focado, derivada do dateKey civil no
   * offset medido ao MEIO-DIA local (meio-dia nunca é madrugada de DST — mesma
   * técnica de `localDateTimeToUtc` da borda). Aritmética cega de `Date` é proibida.
   */
  /** "YYYY-MM-DD" cru (antes do `anchor`; o mesmo cálculo de `dateKeyOf`). */
  function dateKeyOfRaw(instant: Date): string {
    const { year, month, day } = utcToZonedParts(instant, measureTzOffset(timezone.value, instant));
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /** âncora nasce MEIA-NOITE LOCAL do dia persistido (se válido) ou de hoje. */
  function setAnchorDate0(): Date {
    const todayKey = storedAnchorKey() ?? dateKeyOfRaw(new Date());
    return midnightOfDateKey(todayKey);
  }

  /**
   * Âncora como meia-noite local DO PRÓPRIO dia (offset medido ao MEIO-DIA LOCAL
   * — nunca é madrugada de DST): `utcNoonProxy = dateKeyT12:00Z − offset` é um
   * proxy do meio-dia local (mesmo dia civil quando |offset| < 12h). Medir o
   * offset no "noon UTC" cru do dateKey NÃO serve: em fusos negativos meio-dia UTC
   * ainda é o dia ANTERIOR de manhã. `utcToZonedParts(meia-noite, off)` reproduz o
   * dateKey por construção — a meia-noite deslocada pelo MESMO offset cai na
   * fronteira exata do dia — mesmo quando o offset do dia ≠ offset do início da
   * query (DST).
   */
  function midnightOfDateKey(dateKey: string): Date {
    const naiveNoon = Date.parse(`${dateKey}T12:00:00Z`); // "meio-dia" naive (fuso 0)
    const off = measureTzOffset(timezone.value, new Date(naiveNoon));
    const utcNoonProxy = new Date(naiveNoon - off * 60_000); // meio-dia local aproximado
    const offNoon = measureTzOffset(timezone.value, utcNoonProxy);
    return new Date(Date.parse(`${dateKey}T00:00:00Z`) - offNoon * 60_000);
  }

  function setAnchorDate(dateKey: string): Date {
    anchor.value = midnightOfDateKey(dateKey);
    storeAnchorKey(dateKey);
    return anchor.value;
  }

  /** Instantâneo de "agora" da borda (esmaecer passados A.3 + "hoje" nas grades). */
  const now = ref(new Date());
  let tick: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    tick = setInterval(() => (now.value = new Date()), 60_000);
  });
  onUnmounted(() => clearInterval(tick));

  /**
   * Âncora como meia-noite LOCAL do dia focado (idempotente — a âncora vive
   * normalizada). `utcToZonedParts` do schedule-core define "local naive" =
   * t + off·60s; o piso em dias naive converte de volta somando off·60s
   * (meia-noite local 00:00 naive = instante 03:00Z com off−180).
   */
  const anchorMidnight = computed(() => {
    const off = measureTzOffset(timezone.value, anchor.value);
    const naive = anchor.value.getTime() + off * 60_000;
    return new Date(Math.floor(naive / DAY) * DAY - off * 60_000);
  });
  /**
   * Grade efetiva da visão Mês (spec D5/B.8): é a grade do mês da âncora; a não ser
   * que a âncora caia no TRAILING — dias do mês seguinte na ÚLTIMA linha da grade de
   * M (ex.: 01/11 na grade de outubro) — então a grade exibida é a de M (mês−1) e a
   * âncora continua visível e destacada (A.2). Critério EXATO (em dias civis): o dia
   * da grade de `monthGridRange` com o MESMO dateKey da âncora tem índice ≥ 35 (linha
   * 6). Índices baixos na 1ª linha são leading do mês anterior — lá o MÊS da grade é
   * o da âncora e nada muda. `monthGridRange` opera em dias locais de 24h (offset
   * fixo — ADR-002), então index = (mid − start)/DAY bate com a célula da grade.
   */
  const grid = computed<DateRange>(() => {
    const mid = anchorMidnight.value;
    const own = monthGridRange(mid, offset.value);
    const dayIndex = Math.round((mid.getTime() - own.start.getTime()) / DAY);
    if (dayIndex >= 35) {
      // âncora é trailing da grade do mês anterior: a grade exibida é a do mês um
      // mês antes da âncora (`shiftMonthRange` — nunca "start − 1 dia")
      const oneMonthBeforeAnchor = shiftMonthRange(mid, offset.value, -1);
      return monthGridRange(oneMonthBeforeAnchor, offset.value);
    }
    return own;
  });
  /**
   * Mês EXIBIDO (heading, menus, pulo, ‹ ›): deriva da ÂNCORA, nunca da grade.
   * O Mês exibe o mês da âncora; se a âncora caiu no TRAILING da grade de M
   * (última linha — dias do mês M+1), o mês exibido é o da grade (M do mês−1).
   * O Ano exibe o mês/ano da âncora (as 12 mini-grades são do ano da âncora;
   * a grade de dezembro nunca é trailing em offset fixo). A grade efetiva pode
   * COMEÇAR no mês anterior (dia 1 não é domingo) — isso é apresentação; nunca
   * inferir o mês exibido pelo início da grade (bug histórico, ver gotcha).
   */
  const displayedMonthStart = computed(() => {
    const mid = anchorMidnight.value;
    const own = userMonthRange(mid, offset.value);
    if (view.value === 'month') {
      const dayIndex = Math.round((mid.getTime() - own.start.getTime()) / DAY);
      if (dayIndex >= 35) return startOfGridMonth(grid.value, offset.value);
    }
    return own.start;
  });
  /** Início do mês calendário da grade (dia do meio — 22º dia, definição `monthCells`). */
  function startOfGridMonth(g: DateRange, off: number): Date {
    const mid = new Date(g.start.getTime() + 21 * DAY);
    return userMonthRange(mid, off).start;
  }
  /** M CALENDÁRIO do mês exibido (heading/menus). */
  const monthIndex = computed(() => calendarOf(displayedMonthStart.value).month);
  const year = computed(() => calendarOf(displayedMonthStart.value).year);
  const monthLabel = computed(() => ({
    name: monthName(displayedMonthStart.value, timezone.value, 'long'),
    short: monthName(displayedMonthStart.value, timezone.value, 'short'),
  }));

  /** Período da query por visão (D.14): UMA query `qk.appointments(from,to)`. */
  const range = computed<DateRange>(() => {
    switch (view.value) {
      case 'day':
        return shiftDayRange(anchor.value, offset.value, 0);
      case 'week':
        return shiftWeekRange(anchor.value, offset.value, 0);
      case 'month':
        return grid.value;
      case 'year':
        return userYearRange(anchor.value, offset.value);
      default: {
        // vista exaustiva: `view` é o union dos 4 acima — isto é só o return
        // que o eslint (vue/return-in-computed) exige; inacessível por tipo.
        return shiftDayRange(anchor.value, offset.value, 0);
      }
    }
  });

  const from = computed(() => range.value.start.toISOString());
  const to = computed(() => range.value.end.toISOString());
  const appointmentsQuery = useAppointmentsQuery(from, to);

  const items = computed(() => sortAppointmentsByStart(appointmentsQuery.data.value?.items ?? []));

  const cells = computed(() => monthCells(grid.value, offset.value, now.value));
  /**
   * dateKey → itens que TOCAM o dia (multi-dia — D5). Alimenta os chips do Mês e a
   * densidade das bolinhas; o Dia usa `items` inteiro (a carga já é por intersecção).
   */
  const byDay = computed(() => groupByLocalDayTouched(items.value, offset.value));

  /**
   * Offset do fuso no RANGE: meia-noite LOCAL do início do período (o MESMO offset
   * que `buildMonth`/`monthGridRange` derivam — ADR-002, modelo de offset único por
   * período, limitação E.6). A grade de horas usa exatamente este valor; `offset`
   * (medido na âncora) coincide com ele quando a âncora é meia-noite local.
   */
  const rangeOffsetMin = computed(() => measureTzOffset(timezone.value, range.value.start));
  /**
   * 7 linhas dom..sáb COM grade de horas por dia (visão Semana do plano
   * grades-dia-semana-mes). A página injeta a meia-noite LOCAL REAL de cada dia
   * (`measureTzOffset` por dia — a grade abre no DOMINGO e a query começa na
   * segunda: com o offset do início da query, o domingo de transição de DST
   * nasceria com a meia-noite errada) e o passo da transição do período
   * (`rangeOffsetMin` vs o offset na ÂNCORA — modelo de offset único por
   * período, E.6/ADR-002). A ÂNCORA da grade é sempre `anchor` (o dia focado),
   * nunca `range.start`: a query da Semana começa na segunda 00:00 e isso
   * "scorreria" a âncora para o dia anterior em fusos negativos.
   */
  const rows = computed<DayHourRow[]>(() => {
    const tz = timezone.value;
    const anchorMid = midnightOfDateKey(dateKeyOf(anchor.value));
    return weekGridRows(
      range.value,
      rangeOffsetMin.value,
      now.value,
      (d) => {
        const day = new Date(anchorMid.getTime() + d * MS_DAY);
        return userDayRange(day, measureTzOffset(tz, day)).start;
      },
      rangeOffsetMin.value - measureTzOffset(tz, anchor.value),
      anchor.value,
    );
  });
  /**
   * Semana (D7): dateKey da coluna → SLICES do recorte dos itens ao dia da coluna.
   * Cada coluna recebe os itens que a TOCAM como recorte local ([meia-noite local,
   * próxima) da coluna — `sliceItemToRange`), NÃO o bucket de dia de início. O
   * `item` do slice é o ORIGINAL — clique/drag/aria usam o intervalo integral.
   * A meia-noite local de cada linha vem do próprio `row.start`/`row.end`
   * (meia-noites locais reais — mesma fonte da grade de horas da linha).
   */
  const slicesByRowDate = computed<Map<string, DaySlice<AppointmentDto>[]>>(() => {
    const out = new Map<string, DaySlice<AppointmentDto>[]>();
    for (const row of rows.value) {
      out.set(row.date, sliceTimelineItems(items.value, { start: row.start, end: row.end }));
    }
    return out;
  });
  /**
   * Grade de horas da visão Dia (plano grades-dia-semana-mes 1.1/1.3): regra 100%
   * schedule-core (`hourGrid` + `layoutDayTimeline`) — a página só compõe (E.4).
   */
  const hourCells = computed(() => hourGrid(range.value, rangeOffsetMin.value, now.value));
  /**
   * Visão Dia (D4): os itens do período são RECORTADOS ao range do dia antes do
   * layout — o bloco mostra a faixa local do dia (23:00→24:00 no dia de início)
   * com as flags `continuesBefore`/`continuesAfter` (spec multi-dia-nas-visoes B.3).
   */
  const daySlices = computed(() => sliceTimelineItems(items.value, range.value));
  const dayBlocks = computed<SliceTimelineBlock[]>(() =>
    layoutDayTimeline(
      daySlices.value.map<SliceTimelineItem>((slice) => ({ ...slice, id: slice.item.id })),
      range.value,
      rangeOffsetMin.value,
      now.value,
    ).map((b) => ({ ...b, item: b.item as DaySlice<AppointmentDto> })),
  );

  /**
   * Visão Ano (spec visao-ano-heatmap): as 12 grades 7×6 fixas do ANO CIVIL da âncora
   * (`yearHeatmap` do schedule-core). O offset é medido no INÍCIO do range do ano —
   * modelo de offset único por período (ADR-002/E.6), o mesmo que a `density` usa para
   * os dias; `range` da visão Ano é exatamente `userYearRange`, então query e heat
   * cobrem o mesmo período (12 meses com dados — nunca só o mês da âncora).
   */
  const yearHeat = computed<YearHeatMonth[]>(() =>
    yearHeatmap(range.value, rangeOffsetMin.value, now.value),
  );
  const density = computed(() => dayDensity(items.value, range.value, offset.value));
  /** "Hoje" relativo ao AGORA real da borda (as grades comparam dateKey === hoje). */
  const todayKey = computed(() => dateKeyOf(now.value));

  function setView(v: AgendaView): void {
    view.value = v; // âncora preservada (A.2)
  }

  function shift(direction: -1 | 1): void {
    switch (view.value) {
      case 'day':
        setAnchorDate(dateKeyOf(shiftDayRange(anchor.value, offset.value, direction).start));
        break;
      case 'week':
        setAnchorDate(dateKeyOf(shiftWeekRange(anchor.value, offset.value, direction).start));
        break;
      case 'month': {
        // do dia 1 do mês EXIBIDO (derivado da âncora, não da grade): ±1 mês,
        // âncora no dia 1 do destino (Aberto #6)
        const shifted = shiftMonthRange(displayedMonthStart.value, offset.value, direction);
        setAnchorDate(dateKeyOf(shifted));
        break;
      }
      case 'year': {
        // ±1 ano no eixo do mês exibido; âncora em 01/01 do destino
        const shifted = shiftYearRange(displayedMonthStart.value, offset.value, direction);
        setAnchorDate(dateKeyOf(shifted));
        break;
      }
    }
  }

  function goToday(): void {
    setAnchorDate(dateKeyOf(new Date()));
    now.value = new Date();
  }

  function goToMonth(month: number): void {
    // a partir do mês EXIBIDO; ancora no dia 1 do destino (Aberto #6)
    const cur = calendarOf(displayedMonthStart.value);
    setAnchorDate(
      dateKeyOf(shiftMonthRange(displayedMonthStart.value, offset.value, month - cur.month)),
    );
  }

  function goToYear(targetYear: number): void {
    // ano EXIBIDO (heading): ±N anos a partir do mês exibido; âncora em 01/01
    const base = displayedMonthStart.value;
    const cur = calendarOf(base);
    setAnchorDate(dateKeyOf(shiftYearRange(base, offset.value, targetYear - cur.year)));
  }

  function openMonth(month: number): void {
    goToMonth(month);
    view.value = 'month';
  }

  /** API da página: move a âncora para o dia civil `dateKey` (cliques nas grades). */
  function setDate(dateKey: string): Date {
    return setAnchorDate(dateKey);
  }

  return {
    view,
    anchor,
    now,
    timezone,
    range,
    from,
    to,
    appointmentsQuery,
    items,
    monthIndex,
    year,
    monthLabel,
    cells,
    yearHeat,
    rows,
    byDay,
    slicesByRowDate,
    hourCells,
    daySlices,
    dayBlocks,
    rangeOffsetMin,
    density,
    todayKey,
    setView,
    shift,
    goToday,
    setDate,
    goToMonth,
    goToYear,
    openMonth,
  };
}





