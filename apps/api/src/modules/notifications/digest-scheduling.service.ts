import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import {
  localTimeOfDayToUtcUtcDay,
  utcToZonedParts,
  zonedTimeToUtc,
} from '@agendabo/schedule-core';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OutboxService } from './outbox.service';
import { realTzOffset, type OffsetProvider } from './dispatch.service';

/** Hora local "HH:mm" do campo `User.resumoDiarioHora` (defesa: default 07:00). */
export function parseHourOfDay(value: string): { hour: number; minute: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!m) return { hour: 7, minute: 0 };
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * Varredura por minuto: o "minuto alvo" é o `resumoDiarioHora` do usuário, com uma
 * tolerância de +N min p/ sweeps atrasados (API reiniciada no meio da varredura).
 * O `firesAt` carimba o DIA CIVIL do usuário => a única parcial deduplica tudo.
 */
export const DIGEST_WINDOW_MINUTES = 5;

/**
 * Agendador do resumo diário (2.1, spec regras 15/16): cron FINO — um @Cron por minuto
 * que só materializa linhas digest e ENFILEIRA jobs (default-architecture nº 9). A
 * hora comparada é a LOCAL de cada usuário via offset medido na borda + `dates.ts`
 * (ADR-002; nunca a hora do servidor). Roda no processo do bot (`dev:bot`), junto do
 * gateway — a API HTTP não croniza nada; o worker (`dev:worker`) só consome.
 *
 * `now` injetável e `offsetProvider` sobrescritável p/ teste (testing.md).
 */
@Injectable()
export class DigestSchedulingService {
  private readonly logger = new Logger(DigestSchedulingService.name);

  /** Sobrescrito nos testes (testing.md — sem Intl real). */
  offsetProvider: OffsetProvider = realTzOffset;

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * A cada minuto: usuários com hora local ∈ janela do `resumoDiarioHora` ganham a
   * linha digest (idempotente) + job. Backfill: re-enfileira `pending` órfãos
   * (Redis caiu pós-commit) na mesma varredura — um só cron para o outbox inteiro.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async sweep(): Promise<void> {
    const now = new Date();
    try {
      const { jobs } = await this.materializeDueDigests(now);
      await this.outbox.enqueueJobs(jobs, now);
    } catch (err) {
      this.logger.error(`digest sweep: ${String(err)}`);
    }
    await this.outbox
      .sweepPending(this.prisma, now)
      .catch((err: unknown) => this.logger.error(`outbox sweep: ${String(err)}`));
  }

  /**
   * Materialização do digest (exposta p/ teste): para cada usuário com conta
   * confirmada, se a hora local está na janela do `resumoDiarioHora` (minuto alvo
   * já chegou e não passou da tolerância), cria a linha digest (a única parcial
   * P2002 = "já materializado hoje" => job já enfileirado no sweep anterior) e
   * devolve os novos jobs p/ enfileirar com delay até o `firesAt`.
   */
  async materializeDueDigests(
    now: Date,
  ): Promise<{ materialized: number; jobs: { outboxId: string; firesAt: Date }[] }> {
    const users = await this.prisma.user.findMany({
      where: { emailConfirmedAt: { not: null }, telegramId: { not: null } },
      select: { id: true, timezone: true, resumoDiarioHora: true },
    });

    const jobs: { outboxId: string; firesAt: Date }[] = [];
    for (const user of users) {
      const offset = this.offsetProvider(user.timezone, now);
      const { hour, minute } = parseHourOfDay(user.resumoDiarioHora);
      const localNow = utcToZonedParts(now, offset);
      const targetToday = zonedTimeToUtc({ ...localNow, hour, minute }, offset);
      const firesAt = localTimeOfDayToUtcUtcDay(now, offset, user.resumoDiarioHora);
      const elapsedFromTarget = (now.getTime() - targetToday.getTime()) / 60_000;
      // >= -0.5: o minuto alvo chegou (rounding do sweep); <= janela: ainda serve.
      const stillInsideWindow =
        elapsedFromTarget >= -0.5 && elapsedFromTarget <= DIGEST_WINDOW_MINUTES;
      if (!stillInsideWindow) continue;

      // `firesAt` = instante UTC do horário local escolhido no dia civil de agora
      // (mesmo valor p/ o mesmo dia). INSERT puro: a única parcial pode lançar P2002,
      // que É o caminho normal da idempotência (spec 16) — nunca upsert/update.
      try {
        const line = await this.prisma.notificationOutbox.create({
          data: { kind: 'daily_digest', userId: user.id, firesAt },
          select: { id: true, firesAt: true },
        });
        jobs.push({ outboxId: line.id, firesAt: line.firesAt });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002') {
          this.logger.debug(`digest de ${user.id} já materializado p/ este dia (idempotente)`);
          continue;
        }
        throw err;
      }
    }
    return { materialized: jobs.length, jobs };
  }
}
