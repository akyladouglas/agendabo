import { computed, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
  dayDensity,
  groupByLocalDay,
  hourGrid,
  layoutDayTimeline,
  monthCells,
  monthGridRange,
  shiftDayRange,
  shiftMonthRange,
  shiftWeekRange,
  shiftYearRange,
  userMonthRange,
  userYearRange,
  weekRows,
  utcToZonedParts,
  type CalendarDay,
  type DateRange,
  type HourCell,
  type MonthDensity,
  type TimelineBlock,
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
  /** Células da grade do Mês M (visão Ano) e do M+1 (a da âncora — hoje correto). */
  yearMonthCells: ComputedRef<CalendarDay[][]>;
  /** 7 linhas da semana (dom..sáb, semana da âncora). */
  rows: ComputedRef<CalendarDay[]>;
  /** dateKey → compromissos do dia (E.2 — vale para o período da query atual). */
  byDay: ComputedRef<Map<string, AppointmentDto[]>>;
  /** Grade de horas da visão Dia (célula por hora local coberta pelo range — 1.1). */
  hourCells: ComputedRef<HourCell[]>;
  /** Blocos da visão Dia posicionados em % (layoutDayTimeline sobre `items`). */
  dayBlocks: ComputedRef<TimelineBlock<AppointmentDto>[]>;
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
    const noon = new Date(`${todayKey}T12:00:00Z`);
    const off = measureTzOffset(timezone.value, noon);
    return new Date(Date.parse(`${todayKey}T00:00:00Z`) - off * 60_000);
  }

  function setAnchorDate(dateKey: string): Date {
    const noon = new Date(`${dateKey}T12:00:00Z`);
    const off = measureTzOffset(timezone.value, noon);
    anchor.value = new Date(Date.parse(`${dateKey}T00:00:00Z`) - off * 60_000);
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
  const rows = computed(() => weekRows(range.value, offset.value, now.value));
  const byDay = computed(() => groupByLocalDay(items.value, offset.value));

  /**
   * Offset do fuso no RANGE: meia-noite LOCAL do início do período (o MESMO offset
   * que `buildMonth`/`monthGridRange` derivam — ADR-002, modelo de offset único por
   * período, limitação E.6). A grade de horas usa exatamente este valor; `offset`
   * (medido na âncora) coincide com ele quando a âncora é meia-noite local.
   */
  const rangeOffsetMin = computed(() => measureTzOffset(timezone.value, range.value.start));
  /**
   * Grade de horas da visão Dia (plano grades-dia-semana-mes 1.1/1.3): regra 100%
   * schedule-core (`hourGrid` + `layoutDayTimeline`) — a página só compõe (E.4).
   */
  const hourCells = computed(() => hourGrid(range.value, rangeOffsetMin.value, now.value));
  const dayBlocks = computed(() =>
    layoutDayTimeline(items.value, range.value, rangeOffsetMin.value, now.value),
  );

  /** Visão Ano: grade do mês da ÂNCORA + a do mês seguinte (âncora em trailing →
   * hoje na grade certa, que é o mês M+1). Dias do MEIO determinam o mês da grade. */
  const yearMonthCells = computed<CalendarDay[][]>(() => {
    const mGrid = monthGridRange(displayedMonthStart.value, offset.value);
    const nextMonth = new Date(userMonthRange(displayedMonthStart.value, offset.value).end.getTime() + 1);
    const m1Grid = monthGridRange(nextMonth, offset.value);
    const same = mGrid.start.getTime() === m1Grid.start.getTime();
    return [monthCells(mGrid, offset.value, now.value), ...(same ? [] : [monthCells(m1Grid, offset.value, now.value)])];
  });
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
    yearMonthCells,
    rows,
    byDay,
    hourCells,
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





