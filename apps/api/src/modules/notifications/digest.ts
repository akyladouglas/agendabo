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

/** Seção compartilhada do digest (spec compartilhamento E.23, decisão D8): os
 *  `confirmed` de UM dono já filtrados no dia civil do CONVIDADO por quem chama;
 *  o formato reusa o `formatTimeRange` com o offsetMinutes do convidado. */
export interface DigestSharedSection {
  ownerName: string;
  items: DigestAppointment[];
}

/**
 * Cabeçalho da seção compartilhada ("🤝 Agenda de Fulano:") — pura, para o dispatch
 * e o teste usarem a MESMA string que o corpo monta (zero divergência).
 */
export function digestSharedHeaderPtBr(ownerName: string): string {
  return `🤝 Agenda de ${ownerName}:`;
}

/**
 * Mensagem do resumo diário (decisões #5 e #6 da spec): compromissos do dia civil
 * do usuário (`appointmentsOnUserDay` — filtrado acontece ANTES, aqui só formata),
 * seção de lembretes que vencem hoje (firesAt no dia civil, de compromisso de
 * qualquer data) e o "dia livre" quando não há nada.
 *
 * `sharedSections` (E.23): uma seção "🤝 Agenda de ‹dono›:" por agenda compartilhada
 * recebida ativa, com os horários no fuso LOCAL DO CONVIDADO (o mesmo `offsetMinutes`
 * do input). AUSENTE/vazia = corpo byte a byte como hoje (zero regressão); com seções,
 * o dia é livre apenas quando também não há nenhuma seção com itens.
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
  /** Seções por agenda compartilhada recebida ativa (E.23; ausente = corpo de hoje). */
  sharedSections?: DigestSharedSection[];
}): string {
  const { now, offsetMinutes, today, dueReminders } = input;
  const shared = (input.sharedSections ?? []).filter((s) => s.items.length > 0);
  if (today.length === 0 && dueReminders.length === 0 && shared.length === 0) {
    return input.diaLivreText;
  }

  const day = userDayRange(now, offsetMinutes);
  const lines: string[] = [];
  if (input.greeting) lines.push(input.greeting, '');
  lines.push(input.header, '');
  for (const a of today) {
    lines.push(
      `• ${dmy(a.startsAt, offsetMinutes)} ${formatTimeRange(a.startsAt, a.endsAt, offsetMinutes)} — ${a.title}`,
    );
  }
  // seções compartilhadas (E.23): depois dos itens próprios, na ordem recebida;
  // horário no fuso do convidado (offsetMinutes do input — ADR-002).
  for (const section of shared) {
    if (lines[lines.length - 1] !== '') lines.push('');
    lines.push(`🤝 Agenda de ${section.ownerName}:`);
    for (const a of section.items) {
      lines.push(
        `• ${dmy(a.startsAt, offsetMinutes)} ${formatTimeRange(a.startsAt, a.endsAt, offsetMinutes)} — ${a.title}`,
      );
    }
  }
  if (dueReminders.length > 0) {
    if (lines[lines.length - 1] !== '') lines.push('');
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
