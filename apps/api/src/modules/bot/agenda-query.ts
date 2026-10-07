import {
  shiftDayRange,
  userDayRange,
  userMonthRange,
  userNextMonthRange,
  userNextWeekRange,
  userNextYearRange,
  userWeekRange,
  userWeekendRange,
  userYearRange,
  utcToZonedParts,
  isValidDate,
  zonedTimeToUtc,
} from '@agendabo/schedule-core';

/**
 * Camada pura do fluxo de consulta de agenda (Fase 2) — SEM Nest: resolução de
 * período (símbolo → intervalo UTC via schedule-core) e formatação da resposta.
 * O orquestrador com bordas (LLM + banco + Telegram) é o AgendaQueryService.
 */

/** Símbolos relativos que o contrato llm devolve (espelha o enum do contracts). */
export type SimboloConsulta =
  | 'hoje'
  | 'amanha'
  | 'depois_de_amanha'
  | 'esta_semana'
  | 'semana_que_vem'
  | 'este_mes'
  | 'mes_que_vem'
  | 'este_ano'
  | 'ano_que_vem'
  | 'fim_de_semana';

export interface AppointmentRow {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
}

/**
 * Resolve o símbolo relativo no fuso do usuário (regra #7 da spec — 100%
 * schedule-core, meia-noite local nas bordas, meio-aberto).
 */
export function resolveSimboloRange(
  simbolo: SimboloConsulta,
  now: Date,
  offsetMinutes: number,
): { start: Date; end: Date } {
  switch (simbolo) {
    case 'hoje':
      return userDayRange(now, offsetMinutes); // decisão #6: dia civil inteiro
    case 'amanha':
      return shiftDayRange(now, offsetMinutes, 1);
    case 'depois_de_amanha':
      return shiftDayRange(now, offsetMinutes, 2);
    case 'esta_semana':
      return userWeekRange(now, offsetMinutes);
    case 'semana_que_vem':
      return userNextWeekRange(now, offsetMinutes);
    case 'este_mes':
      return userMonthRange(now, offsetMinutes);
    case 'mes_que_vem':
      return userNextMonthRange(now, offsetMinutes);
    case 'este_ano':
      return userYearRange(now, offsetMinutes);
    case 'ano_que_vem':
      return userNextYearRange(now, offsetMinutes);
    case 'fim_de_semana':
      return userWeekendRange(now, offsetMinutes);
  }
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * datas explícitas do LLM (calendário LOCAL do usuário, sem horário) → intervalo UTC
 * meia-noite local, meio-aberto (spec #6/#7). `to` é tratado como inclusivo-dia:
 * "de 10 a 12" chega do contrato como from 10 / to 13 (fim exclusivo); se o modelo
 * mandar to inclusivo (12), a borda ainda é meia-noite local do `to` + 1 dia.
 */
export function resolveIntervaloRange(
  intervalo: { from: string; to: string },
  offsetMinutes: number,
): { start: Date; end: Date } | null {
  if (!DATE_ONLY.test(intervalo.from) || !DATE_ONLY.test(intervalo.to)) return null;
  const [fy = 0, fm = 0, fd = 0] = intervalo.from.split('-').map(Number);
  const [ty = 0, tm = 0, td = 0] = intervalo.to.split('-').map(Number);
  const start = zonedTimeToUtc({ year: fy, month: fm, day: fd }, offsetMinutes);
  const end = zonedTimeToUtc({ year: ty, month: tm, day: td }, offsetMinutes);
  if (!isValidDate(start) || !isValidDate(end) || end.getTime() <= start.getTime()) return null;
  return { start, end };
}

/** Rótulo do período p/ o cabeçalho (spec #9): dia único, ou "entre X e Y". */
export function formatPeriodoLabel(
  range: { start: Date; end: Date },
  offsetMinutes: number,
): string {
  const dmy = (d: Date) => {
    const p = utcToZonedParts(d, offsetMinutes);
    return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`;
  };
  // fim exclusivo: o último dia incluído é `end` menos 1 dia
  const lastIncluded = new Date(range.end.getTime() - 60_000);
  const singleDay = range.end.getTime() - range.start.getTime() <= 24 * 60 * 60_000;
  if (singleDay) return `em ${dmy(range.start)}`;
  return `entre ${dmy(range.start)} e ${dmy(lastIncluded)}`;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Linhas da lista agrupadas por dia (spec #9): cabeçalho de dia + uma linha por
 * compromisso `dia da semana dd/mm — HH:mm–HH:mm — título`. O título é a única parte
 * dinâmica (escape é responsabilidade de quem renderiza via BOT_MESSAGES+escapeHtml;
 * aqui entregamos dados formatados no tz, sem HTML).
 */
export function formatAppointmentLines(
  rows: AppointmentRow[],
  offsetMinutes: number,
  markerNeedsReview: string,
): string[] {
  const lines: string[] = [];
  let lastDayKey = '';
  for (const row of rows) {
    const s = utcToZonedParts(row.startsAt, offsetMinutes);
    const e = utcToZonedParts(row.endsAt, offsetMinutes);
    const dayKey = `${s.year}-${s.month}-${s.day}`;
    if (dayKey !== lastDayKey) {
      const weekday = WEEKDAYS[new Date(Date.UTC(s.year, s.month - 1, s.day)).getUTCDay()] ?? '';
      lines.push(`${weekday} ${pad(s.day)}/${pad(s.month)}`);
      lastDayKey = dayKey;
    }
    const sameDay = s.year === e.year && s.month === e.month && s.day === e.day;
    const time = sameDay
      ? `${pad(s.hour)}:${pad(s.minute)}–${pad(e.hour)}:${pad(e.minute)}`
      : `${pad(s.hour)}:${pad(s.minute)}–${weekday(e) + ' ' + pad(e.day)}/${pad(e.month)} ${pad(e.hour)}:${pad(e.minute)}`;
    const marker = row.status === 'needs_review' ? ` (${markerNeedsReview})` : '';
    lines.push(`${time} — ${row.title}${marker}`);
  }
  return lines;
}

function weekday(p: { year: number; month: number; day: number }): string {
  return WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()] ?? '';
}
