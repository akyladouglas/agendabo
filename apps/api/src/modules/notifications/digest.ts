/**
 * Camada PURA do resumo diário (2.1) — SEM Nest, sem I/O: a linha do outbox e o
 * relógio/offset entram prontos, a mensagem PT-BR sai pronta (escape fica com quem
 * envia). Os cálculos de "dia civil" são dos helpers de `dates.ts` (schedule-core).
 */

import { utcToZonedParts, userDayRange } from '@agendabo/schedule-core';

export interface DigestAppointment {
  title: string;
  startsAt: Date;
  endsAt: Date;
}

export interface DigestDueReminder {
  title: string;
  startsAt: Date;
}

/**
 * Saudação com o nome (Fase 5, decisão 7): "Bom dia, Ana" quando existir;
 * sem nome mantém o texto vigente ("Bom dia!"). Fuso aplicado por quem chama
 * (a saudação é montada na borda, onde o offset já é medido).
 */
export function greetingPtBr(now: Date, offsetMinutes: number, name: string | null): string {
  const { hour } = utcToZonedParts(now, offsetMinutes);
  const word = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  return name ? `${word}, ${name}!` : `${word}!`;
}

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const pad = (n: number) => String(n).padStart(2, '0');

const dmy = (d: Date, offsetMinutes: number): string => {
  const p = utcToZonedParts(d, offsetMinutes);
  return `${pad(p.day)}/${pad(p.month)}`;
};

/**
 * "HH:mm–HH:mm" ou "dia dd/mm HH:mm" (quando o fim vaza o dia) — formato da
 * Fase 2 (`formatAppointmentLines`), reaproveitado no resumo.
 */
export function formatTimeRange(startsAt: Date, endsAt: Date, offsetMinutes: number): string {
  const s = utcToZonedParts(startsAt, offsetMinutes);
  const e = utcToZonedParts(endsAt, offsetMinutes);
  const sameDay = s.year === e.year && s.month === e.month && s.day === e.day;
  if (sameDay) return `${pad(s.hour)}:${pad(s.minute)}–${pad(e.hour)}:${pad(e.minute)}`;
  const ew = WEEKDAYS[new Date(Date.UTC(e.year, e.month - 1, e.day)).getUTCDay()] ?? '';
  return `${pad(s.hour)}:${pad(s.minute)}–${ew} ${pad(e.day)}/${pad(e.month)} ${pad(e.hour)}:${pad(e.minute)}`;
}

/** Cabeçalho com a data local do resumo: "📋 Resumo de quinta, 08/10". */
export function digestHeaderPtBr(now: Date, offsetMinutes: number): string {
  const p = utcToZonedParts(now, offsetMinutes);
  const weekday = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
  ][new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
  return `📋 Resumo de ${weekday}, ${pad(p.day)}/${pad(p.month)}`;
}

/**
 * Mensagem do resumo diário (decisões #5 e #6 da spec): compromissos do dia civil
 * do usuário (`appointmentsOnUserDay` — filtrado acontece ANTES, aqui só formata),
 * seção de lembretes que vencem hoje (firesAt no dia civil, de compromisso de
 * qualquer data) e o "dia livre" quando não há nada.
 *
 * Retorna `null` quando `digestDueToday` vieram pré-filtrados? Não: quem chama filtra
 * com `userDayRange`; aqui o dia vazio dos DOIS listas => `diaLivreText`.
 */
export function buildDigestBody(input: {
  now: Date;
  offsetMinutes: number;
  today: DigestAppointment[];
  dueReminders: DigestDueReminder[];
  header: string;
  dueHeader: string;
  diaLivreText: string;
  /** Saudação opcional antes do cabeçalho ("Bom dia, Ana!" — decisão 7, Fase 5). */
  greeting?: string;
}): string {
  const { now, offsetMinutes, today, dueReminders } = input;
  if (today.length === 0 && dueReminders.length === 0) return input.diaLivreText;

  const day = userDayRange(now, offsetMinutes);
  const lines: string[] = [];
  if (input.greeting) lines.push(input.greeting, '');
  lines.push(input.header, '');
  for (const a of today) {
    lines.push(
      `• ${dmy(a.startsAt, offsetMinutes)} ${formatTimeRange(a.startsAt, a.endsAt, offsetMinutes)} — ${a.title}`,
    );
  }
  if (dueReminders.length > 0) {
    if (today.length > 0) lines.push('');
    lines.push(input.dueHeader);
    for (const r of dueReminders) {
      const firesToday =
        r.startsAt.getTime() >= day.start.getTime() && r.startsAt.getTime() < day.end.getTime();
      const when = firesToday ? 'hoje' : dmy(r.startsAt, offsetMinutes);
      lines.push(`⏰ Lembrete hoje — "${r.title}" (compromisso ${when})`);
    }
  }
  return lines.join('\n');
}
