/**
 * Tipos minimos do dominio. `schedule-core` e deliberadamente independente de
 * Prisma/contracts: quem consome mapeia suas entidades para estas formas.
 */

/** Intervalo half-open [startsAt, endsAt). */
export interface Interval {
  startsAt: Date;
  endsAt: Date;
}

export interface AppointmentLike extends Interval {
  id: string;
  title: string;
}

/** Descritor de aviso de conflito (mensagem fica a cargo de quem apresenta). */
export type ConflictReason = 'same_start' | 'partial_overlap' | 'contains' | 'contained';

export interface ConflictResult<T = AppointmentLike> {
  conflict: boolean;
  /** Primeiro compromisso que choca (ordem do array recebido). */
  with?: T;
  reason?: ConflictReason;
}

/** Regras de lembrete (formato espelhado em @agendabo/contracts). */
export type NotificationRule =
  | { type: 'none' }
  | { type: 'before_hours'; hours: number }
  | { type: 'before_days'; days: number }
  | { type: 'countdown_3_2_1' };

export interface NotificationTrigger {
  /** Instante UTC de disparo. */
  firesAt: Date;
  /** Minutos antes do inicio que este disparo representa. */
  minutesBefore: number;
  /** Regra que gerou o disparo (dedupe preserva a primeira). */
  ruleType: NotificationRule['type'];
}
