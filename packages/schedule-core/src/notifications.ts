import type { AppointmentLike, NotificationRule, NotificationTrigger } from './types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Quantos minutos antes do inicio cada regra dispara.
 * `countdown_3_2_1` expande para [3 dias, 2 dias, 1 dia].
 */
export function minutesBeforeFor(rule: NotificationRule): number[] {
  switch (rule.type) {
    case 'none':
      return [];
    case 'before_hours':
      if (!Number.isInteger(rule.hours) || rule.hours <= 0) {
        throw new Error(`before_hours exige hours inteiro positivo, recebido: ${rule.hours}`);
      }
      return [rule.hours * 60];
    case 'before_days':
      if (!Number.isInteger(rule.days) || rule.days <= 0) {
        throw new Error(`before_days exige days inteiro positivo, recebido: ${rule.days}`);
      }
      return [rule.days * 60 * 24];
    case 'countdown_3_2_1':
      return [3 * 24 * 60, 2 * 24 * 60, 1 * 24 * 60];
  }
}

/**
 * Calculo deterministico dos instantes de disparo (1.2).
 *
 * - Entrada: `startsAt` UTC do compromisso + regras. O timezone do usuario ja foi
 *   aplicado por quem converteu a fala ("quinta 14h" -> UTC) na borda (ADR-001);
 *   este calculo e puramente absoluto, entao timezone nao altera o resultado.
 * - Saido ordenada, deduplicada por `firesAt` (ex.: "24h antes" + contagem
 *   regressiva colapsam no mesmo disparo de 1 dia, preservando a primeira regra).
 * - Disparos no passado (`firesAt <= now`) sao descartados — nunca atrasar tudo
 *   so porque um lembrete ja venceu.
 * - `rules = []` ou `[none]` => nenhum disparo.
 */
export function computeTriggers(
  startsAt: Date,
  rules: readonly NotificationRule[],
  options: { now?: Date } = {},
): NotificationTrigger[] {
  const now = options.now ?? new Date();
  const start = startsAt.getTime();
  const out: NotificationTrigger[] = [];
  const seen = new Set<number>();

  for (const rule of rules) {
    for (const minutesBefore of minutesBeforeFor(rule)) {
      const t = start - minutesBefore * MINUTE;
      if (t <= now.getTime()) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push({ firesAt: new Date(t), minutesBefore, ruleType: rule.type });
    }
  }

  return out.sort((a, b) => a.firesAt.getTime() - b.firesAt.getTime());
}

/**
 * Compromissos do dia civil do usuario (2.1): usa o DESLOCAMENTO UTC observado no
 * instante `now` na IANA `tz` (funcao injetavel para teste — dominio puro nao lida
 * com base de dados de tz). Um "dia" pode ter 23/24/25h de UTC; com deslocamento
 * fixo o resultado e identico e suficiente para resumo diario.
 */
export function appointmentsOnUserDay<T extends AppointmentLike>(
  appointments: readonly T[],
  tz: string,
  now: Date,
  offsetProvider: (tz: string, at: Date) => number = () => 0,
): T[] {
  const offset = offsetProvider(tz, now);
  const localNow = new Date(now.getTime() + offset);
  const dayStartUtc = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  );
  const dayStart = dayStartUtc - offset;
  const dayEnd = dayStart + DAY;
  return appointments.filter(
    (a) => a.startsAt.getTime() >= dayStart && a.startsAt.getTime() < dayEnd,
  );
}
