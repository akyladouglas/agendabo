import type { NotificationRule } from './types';

const MINUTE = 60_000;

/** Dias inteiros de arredondamento na descricao de antecedencia ("amanha"/"em N dias"). */
const NEAR_DAY_TOLERANCE_MINUTES = 30;

/**
 * Rotulos PT-BR deterministicos de lembrete (Fase 3, spec regras 7 e 13).
 * Quem apresenta monta a frase; aqui so o calculo/palavra — dominio puro,
 * `now` sempre injetavel (regra schedule-core nº 2).
 */

/**
 * Antecedencia do gatilho em linguagem natural, dado o instante de disparo (UTC) e
 * o deslocamento do gatilho (`minutesBefore` do `computeTriggers`; o fuso do usuario
 * ja foi aplicado na borda — ADR-002):
 *   - ate 30min ate o disparo  => "daqui a instantes"
 *   - menos de 1h              => "daqui a N minutos"
 *   - menos de 24h             => "daqui a 1 hora" / "daqui a N horas"
 *   - ~1 dia (±30min)          => "amanha"
 *   - dias inteiros (±30min)   => "em N dias"
 *   - dias + horas             => "em N dias e M horas"
 *   - resto (ex.: 36h)         => "em N horas"
 */
export function describeLeadTime(firesAt: Date, now: Date, minutesBefore: number): string {
  const untilFire = Math.round((firesAt.getTime() - now.getTime()) / MINUTE);
  if (untilFire <= 1) return 'daqui a instantes';
  if (untilFire <= 30) return `daqui a ${untilFire} minutos`;
  if (untilFire < 60) return `daqui a ${untilFire} minutos`;
  if (untilFire < 24 * 60) {
    const hours = Math.round(untilFire / 60);
    return hours === 1 ? 'daqui a 1 hora' : `daqui a ${hours} horas`;
  }
  const days = Math.round(minutesBefore / (24 * 60));
  const offsetFromDays = minutesBefore - days * 24 * 60; // > 0 = horas a mais (ex.: 25h => 1d + 1h)
  if (Math.abs(offsetFromDays) <= NEAR_DAY_TOLERANCE_MINUTES) {
    return days === 1 ? 'amanhã' : `em ${days} dias`;
  }  if (days >= 1 && offsetFromDays >= 60) {
    const hours = Math.floor(offsetFromDays / 60);
    return `em ${days} dia${days === 1 ? '' : 's'} e ${hours} hora${hours === 1 ? '' : 's'}`;
  }
  return `em ${Math.floor(untilFire / 60)} horas`;
}

/**
 * Rotulo de UMA regra no resumo final do bot (`⏰ 3 dias antes · 1h antes` — spec
 * regra 1). `none` => null (quem renderiza mostra "sem lembrete").
 */
export function ruleLabelPtBr(rule: NotificationRule): string | null {
  switch (rule.type) {
    case 'none':
      return null;
    case 'before_hours':
      return `${rule.hours}h antes`;
    case 'before_days':
      return `${rule.days} dia${rule.days === 1 ? '' : 's'} antes`;
    case 'countdown_3_2_1':
      return 'contagem 3-2-1';
  }
}

/** Lista de rotulos das regras (ordem preservada; `none` nao gera rotulo). */
export function rulesLabelsPtBr(rules: readonly NotificationRule[]): string[] {
  return rules.map(ruleLabelPtBr).filter((l): l is string => l !== null);
}
