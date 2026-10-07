import { Injectable, NotFoundException } from '@nestjs/common';
import {
  appointmentInputSchema,
  appointmentPatchSchema,
  checkConflictInputSchema,
  listAppointmentsQuerySchema,
} from '@agendabo/contracts';
import { findConflict } from '@agendabo/schedule-core';
import { AppointmentStatus, type NotificationRuleType, Prisma } from '@prisma/client';

/** Alias local do enum Prisma (usado no default de `listOverlapping`). */
type $AppointmentStatus = AppointmentStatus;
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OutboxService } from '../notifications/outbox.service';

/** Erro de dominio: conflito de horario (1.1). A controller vira 409 com o compromisso que choca. */
export class AppointmentConflictError extends Error {
  constructor(readonly conflictWith: { id: string; title: string; startsAt: Date; endsAt: Date }) {
    super('conflito de horario');
  }
}

/**
 * Regras de lembrete viram instantes de disparo determinísticos via schedule-core
 * (computeTriggers no OutboxService) e são materializadas no outbox JUNTO com o
 * compromisso (spec Fase 3, regras 6/9/10). A fila só recebe job pós-commit.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Relógio da borda (testes sobrescrevem — testing.md; regra de domínio recebe `now`). */
  now(): Date {
    return new Date();
  }

  async list(userId: string, raw: unknown) {
    const { from, to } = listAppointmentsQuerySchema.parse(raw);
    const items = await this.prisma.appointment.findMany({
      where: { userId, startsAt: { gte: from }, endsAt: { lte: to } },
      orderBy: { startsAt: 'asc' },
      include: { notificationRules: true },
    });
    return { items };
  }

  /**
   * Compromissos que TOCAM o intervalo [from, to) — intersecção half-open
   * `startsAt < to AND endsAt >= from` (Fase 2, spec #8). Diferente da `list` da web
   * (que usa contenção `startsAt >= from AND endsAt <= to`): um compromisso que
   * começa antes do período ou termina depois dele também aparece. Ordenado por
   * `startsAt`. `cancelled` nunca entra (filtro de status, default confirmado+revisão).
   */
  async listOverlapping(
    userId: string,
    from: Date,
    to: Date,
    statuses: readonly $AppointmentStatus[] = ['confirmed', 'needs_review'],
  ) {
    return this.prisma.appointment.findMany({
      where: {
        userId,
        startsAt: { lt: to },
        endsAt: { gte: from },
        status: { in: [...statuses] },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  async checkConflict(userId: string, raw: unknown) {
    const input = checkConflictInputSchema.parse(raw);
    const existing = await this.existingFor(userId, input.ignoreId);
    const result = findConflict(input, existing);
    return { conflict: result.conflict, with: result.with ?? null };
  }

  /**
   * Criação (web/bot): N regras + linhas do outbox na MESMA transação (spec regra 6);
   * jobs BullMQ entram na fila SÓ depois do commit (Redis nunca dentro de tx).
   * Gatilho no passado = zero linhas (silencioso na web — decisão #1 da spec).
   */
  async create(userId: string, raw: unknown, options: { origin?: 'bot' | 'web' } = {}) {
    const input = appointmentInputSchema.parse(raw);
    await this.assertNoConflict(userId, input);
    const now = this.now();
    const hasRules = input.notificationRules.some((r) => r.type !== 'none');

    const { appointment, outboxIds, triggers } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          ...input,
          notes: input.notes ?? null,
          userId,
          origin: options.origin ?? 'web',
          status: 'confirmed',
          notificationRules: { create: input.notificationRules.map(toRuleCreate) },
        },
        include: { notificationRules: true },
      });
      if (!hasRules) return { appointment: created, outboxIds: [] as string[], triggers: [] };
      const materialized = await this.outbox.materializeInTx(
        tx,
        { id: created.id, userId, startsAt: created.startsAt },
        input.notificationRules.map((r) => ({
          type: r.type,
          value: r.value ?? null,
        })),
        now,
      );
      return { appointment: created, ...materialized };
    });

    await this.outbox.enqueueJobs(
      triggers.map((t, i) => ({ outboxId: outboxIds[i]!, firesAt: t.firesAt })),
      now,
    );
    return appointment;
  }

  /**
   * Edição pela web/API (spec regra 9): quando `startsAt`/`endsAt`/`notificationRules`
   * mudam, as linhas `pending` viram `cancelled` na MESMA transação e novas linhas
   * nascem dos dados novos; jobs antigos na fila viram no-op (regra 12). Edição que
   * não toca em nada disso não mexe no outbox.
   */
  async update(userId: string, id: string, raw: unknown) {
    const patch = appointmentPatchSchema.parse(raw);
    const current = await this.prisma.appointment.findFirst({ where: { id, userId } });
    if (!current) throw new NotFoundException();

    const startsAt = patch.startsAt ?? current.startsAt;
    const endsAt = patch.endsAt ?? current.endsAt;
    await this.assertNoConflict(userId, { startsAt, endsAt }, id);

    const now = this.now();
    const rulesChanged = patch.notificationRules !== undefined;
    const timeChanged =
      startsAt.getTime() !== current.startsAt.getTime() ||
      endsAt.getTime() !== current.endsAt.getTime();
    const reschedule = timeChanged || rulesChanged;
    const nextRules: readonly { type: NotificationRuleType; value: number | null }[] = rulesChanged
      ? patch.notificationRules!.map((r) => ({
          type: r.type as NotificationRuleType,
          value: r.value ?? null,
        }))
      : (await this.prisma.notificationRule.findMany({ where: { appointmentId: id } })).map(
          (r) => ({ type: r.type, value: r.value }),
        );

    const { appointment, outboxIds, triggers } = await this.prisma.$transaction(async (tx) => {
      if (rulesChanged) {
        await tx.notificationRule.deleteMany({ where: { appointmentId: id } });
        await tx.notificationRule.createMany({
          data: patch.notificationRules!.map((r) => ({ appointmentId: id, ...toRuleCreate(r) })),
        });
      }
      let newIds: string[] = [];
      let newTriggers: { firesAt: Date }[] = [];
      if (reschedule) {
        // cancela as pendências antigas na MESMA transação (spec regra 9)
        await this.outbox.invalidateForAppointment(tx, id);
        // re-materializa SOMENTE quando o instante ou as regras mudaram (mexer só no
        // título/notas/fim não recria gatilhos — os `firesAt` continuariam válidos)
        if (startsAt.getTime() !== current.startsAt.getTime() || rulesChanged) {
          const materialized = await this.outbox.materializeInTx(
            tx,
            { id, userId, startsAt },
            nextRules.map((r) => ({ type: r.type, value: r.value })),
            now,
          );
          newIds = materialized.outboxIds;
          newTriggers = materialized.triggers;
        }
      }
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
          startsAt,
          endsAt,
        },
        include: { notificationRules: true },
      });
      return { appointment: updated, outboxIds: newIds, triggers: newTriggers };
    });

    if (reschedule) {
      // Jobs antigos ficam na fila: são no-op garantidos pela linha `cancelled`
      // (regra 12) — não há trabalho de fila aqui.
      await this.outbox.enqueueJobs(
        triggers.map((t, i) => ({ outboxId: outboxIds[i]!, firesAt: t.firesAt })),
        now,
      );
    }
    return appointment;
  }

  /**
   * Remoção (spec regra 10): o cascade do Prisma apaga as linhas de outbox; jobs
   * remanescentes na fila viram no-op porque a linha não existe mais (regra 12).
   */
  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.appointment.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException();
  }

  /** Carga dos compromissos futuros do usuario para a checagem deterministica. */
  private async existingFor(userId: string, ignoreId?: string) {
    const rows = await this.prisma.appointment.findMany({
      where: { userId, status: 'confirmed', endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
    return rows.filter((r) => r.id !== ignoreId);
  }

  private async assertNoConflict(
    userId: string,
    candidate: { startsAt: Date; endsAt: Date },
    ignoreId?: string,
  ): Promise<void> {
    const existing = await this.existingFor(userId, ignoreId);
    const result = findConflict(candidate, existing);
    if (result.conflict && result.with) {
      throw new AppointmentConflictError(result.with);
    }
  }
}

type RuleType = 'none' | 'before_hours' | 'before_days' | 'countdown_3_2_1';

function toRuleCreate(rule: {
  type: string;
  value?: number;
}): Prisma.NotificationRuleCreateWithoutAppointmentInput {
  return { type: rule.type as RuleType, value: rule.value ?? null };
}
