import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { computeTriggers, type NotificationRule } from '@agendabo/schedule-core';
import type { NotificationRuleType, Prisma } from '@prisma/client';
import { NOTIFICATIONS_QUEUE } from './notifications.queue';

/** Payload mínimo do job: SÓ o id da linha — a linha do outbox é a fonte de verdade (D4). */
export interface DispatchJobData {
  outboxId: string;
}

/** Shape mínimo da fila BullMQ (mock plano nos testes — testing.md). */
export interface DispatchQueueLike {
  add(name: string, data: DispatchJobData, opts: { delay: number }): Promise<unknown>;
  getJobs?(states: string[], start?: number, end?: number): Promise<{ remove(): Promise<void> }[]>;
}

/** Compromisso na forma que o computeTriggers consome (regras no formato do domínio). */
export interface AppointmentWithRules {
  id: string;
  userId: string;
  startsAt: Date;
  notificationRules: readonly { type: NotificationRuleType; value: number | null }[];
}

/** O que a materialização devolve: ids p/ enfileirar pós-commit + gatilhos (aviso de retroativo). */
export interface MaterializedTriggers {
  outboxIds: string[];
  triggers: { firesAt: Date; ruleType: NotificationRuleType }[];
  /**
   * Regras não-`none` cujos gatilhos caíram no passado e foram descartados
   * (Fase 5 — decisão 3: web avisa o gatilho retroativo com estes tipos).
   */
  droppedRuleTypes: NotificationRuleType[];
}

/**
 * Materialização do outbox (Fase 3, spec regras 6–10): computeTriggers (schedule-core)
 * decide QUANDO; este service cria as linhas `pending` e enfileira um job BullMQ
 * `{ outboxId }` delayado por linha. Nada de cálculo de disparo aqui (regra schedule-core).
 *
 * Ordem sagrada (plano etapa 3): as linhas nascem na MESMA transação do caller
 * (`materializeInTx(tx, ...)`); o enqueue é SEMPRE pós-commit (`enqueueJobs`) — Redis
 * nunca participa de transação Prisma. Job perdido (Redis caiu pós-commit) não perde
 * linha: `sweepPending` re-enfileira o que ficou para trás (backfill do sweeper).
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(@InjectQueue(NOTIFICATIONS_QUEUE) private readonly queue: DispatchQueueLike) {}

  /**
   * Regras de lembrete -> gatilhos (computeTriggers com `now` injetado) -> linhas
   * `pending` (kind reminder) dentro da MESMA transação do caller. Regras
   * `none`/todas no passado => zero linhas (spec regra 7 / Gherkin regra 4).
   * NÃO enfileira: quem chama chama `enqueueJobs` depois do commit.
   *
   * `droppedRuleTypes` (Fase 5, decisão 3 da spec web): regras cujos gatilhos cairam
   * NO PASSSADO e foram descartados pelo `computeTriggers`. A materialização continua
   * sendo só daqui (zero regra duplicada na web) — a UI só mostra o aviso.
   */
  async materializeInTx(
    tx: Prisma.TransactionClient,
    appointment: Pick<AppointmentWithRules, 'id' | 'userId' | 'startsAt'>,
    rules: readonly { type: NotificationRuleType; value: number | null }[],
    now: Date,
  ): Promise<MaterializedTriggers> {
    const coreRules = rules.map(toCoreRule);
    const triggers = computeTriggers(appointment.startsAt, coreRules, { now });
    const fired = new Set(triggers.map((t) => t.ruleType));
    const droppedRuleTypes = [
      ...new Set(
        coreRules
          .filter((r) => r.type !== 'none' && !fired.has(r.type))
          .map((r) => r.type as NotificationRuleType),
      ),
    ];
    if (triggers.length === 0) return { outboxIds: [], triggers: [], droppedRuleTypes };

    const created = await tx.notificationOutbox.createManyAndReturn({
      data: triggers.map((t) => ({
        kind: 'reminder' as const,
        userId: appointment.userId,
        appointmentId: appointment.id,
        firesAt: t.firesAt,
        ruleType: t.ruleType,
      })),
    });
    return {
      outboxIds: created.map((row) => row.id),
      triggers: triggers.map((t) => ({ firesAt: t.firesAt, ruleType: t.ruleType })),
      droppedRuleTypes,
    };
  }

  /**
   * Enfileiramento PÓS-commit (delay BullMQ até firesAt; `now` injetável, testing.md).
   * Falha é logada, nunca trava o create: a linha `pending` fica no banco como fonte
   * de verdade e o sweeper tenta de novo.
   */
  async enqueueJobs(
    entries: { outboxId: string; firesAt: Date }[],
    now: Date = new Date(),
  ): Promise<void> {
    for (const { outboxId, firesAt } of entries) {
      try {
        await this.queue.add(
          'dispatch',
          { outboxId },
          {
            delay: Math.max(0, firesAt.getTime() - now.getTime()),
          },
        );
      } catch (err) {
        this.logger.error(
          `outbox ${outboxId}: falha ao enfileirar job p/ ${firesAt.toISOString()}: ${String(err)}`,
        );
      }
    }
  }

  /**
   * Backfill do sweeper (rodado junto do cron do digest): jobs que se perderam
   * (Redis caído pós-commit) voltam à fila. `pending` com `firesAt > now + 60s`
   * re-enfileira com delay; `pending` já vencido é DEIXADO quieto — se o job tivesse
   * sido perdido de verdade, o atraso é exatamente o caso `atraso_excedido` da
   * regra 14, e o consumer decidiria; re-enfileirar em loop só martelaria o worker.
   */
  async sweepPending(
    tx: Prisma.TransactionClient,
    now: Date,
    limit = 500,
  ): Promise<{ swept: number }> {
    const pending = await tx.notificationOutbox.findMany({
      where: {
        status: 'pending',
        kind: 'reminder',
        firesAt: { gt: new Date(now.getTime() + 60_000) },
      },
      select: { id: true, firesAt: true },
      orderBy: { firesAt: 'asc' },
      take: limit,
    });
    await this.enqueueJobs(
      pending.map((p) => ({ outboxId: p.id, firesAt: p.firesAt })),
      now,
    );
    return { swept: pending.length };
  }

  /**
   * Regras 9/10/11: linhas `pending` do compromisso viram `cancelled` na MESMA
   * transação da edição/remoção. Jobs antigos na fila viram no-op (regra 12 — o
   * worker só envia com `pending→sent` condicional); a fila nem precisa ser tocada.
   */
  async invalidateForAppointment(
    tx: Prisma.TransactionClient,
    appointmentId: string,
  ): Promise<number> {
    const { count } = await tx.notificationOutbox.updateMany({
      where: { appointmentId, status: 'pending' },
      data: { status: 'cancelled' },
    });
    return count;
  }
}

/** Linha Prisma (type/value) -> regra do domínio schedule-core. */
export function toCoreRule(rule: {
  type: NotificationRuleType;
  value: number | null;
}): NotificationRule {
  switch (rule.type) {
    case 'none':
      return { type: 'none' };
    case 'before_hours':
      return { type: 'before_hours', hours: rule.value ?? 0 };
    case 'before_days':
      return { type: 'before_days', days: rule.value ?? 0 };
    case 'countdown_3_2_1':
      return { type: 'countdown_3_2_1' };
  }
}
