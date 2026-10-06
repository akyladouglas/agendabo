import { Injectable, NotFoundException } from '@nestjs/common';
import {
  appointmentInputSchema,
  appointmentPatchSchema,
  checkConflictInputSchema,
  listAppointmentsQuerySchema,
} from '@agendabo/contracts';
import { findConflict } from '@agendabo/schedule-core';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';

/** Erro de dominio: conflito de horario (1.1). A controller vira 409 com o compromisso que choca. */
export class AppointmentConflictError extends Error {
  constructor(readonly conflictWith: { id: string; title: string; startsAt: Date; endsAt: Date }) {
    super('conflito de horario');
  }
}

/**
 * Regras de lembrete viram instantes de disparo determinísticos via schedule-core
 * (computeTriggers) e sao persistidas no outbox junto com o compromisso.
 */
@Injectable()
export class AppointmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, raw: unknown) {
    const { from, to } = listAppointmentsQuerySchema.parse(raw);
    const items = await this.prisma.appointment.findMany({
      where: { userId, startsAt: { gte: from }, endsAt: { lte: to } },
      orderBy: { startsAt: 'asc' },
      include: { notificationRules: true },
    });
    return { items };
  }

  async checkConflict(userId: string, raw: unknown) {
    const input = checkConflictInputSchema.parse(raw);
    const existing = await this.existingFor(userId, input.ignoreId);
    const result = findConflict(input, existing);
    return { conflict: result.conflict, with: result.with ?? null };
  }

  async create(userId: string, raw: unknown) {
    const input = appointmentInputSchema.parse(raw);
    await this.assertNoConflict(userId, input);
    return this.prisma.appointment.create({
      data: {
        ...input,
        notes: input.notes ?? null,
        userId,
        origin: 'web',
        status: 'confirmed',
        notificationRules: { create: input.notificationRules.map(toRuleCreate) },
      },
      include: { notificationRules: true },
    });
  }

  async update(userId: string, id: string, raw: unknown) {
    const patch = appointmentPatchSchema.parse(raw);
    const current = await this.prisma.appointment.findFirst({ where: { id, userId } });
    if (!current) throw new NotFoundException();

    const startsAt = patch.startsAt ?? current.startsAt;
    const endsAt = patch.endsAt ?? current.endsAt;
    await this.assertNoConflict(userId, { startsAt, endsAt }, id);

    return this.prisma.$transaction(async (tx) => {
      if (patch.notificationRules) {
        await tx.notificationRule.deleteMany({ where: { appointmentId: id } });
        await tx.notificationRule.createMany({
          data: patch.notificationRules.map((r) => ({ appointmentId: id, ...toRuleCreate(r) })),
        });
      }
      return tx.appointment.update({
        where: { id },
        data: {
          ...(patch.title !== undefined && { title: patch.title }),
          ...(patch.notes !== undefined && { notes: patch.notes ?? null }),
          startsAt,
          endsAt,
        },
        include: { notificationRules: true },
      });
    });
  }

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
