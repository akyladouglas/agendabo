import { Injectable, NotFoundException } from '@nestjs/common';
import { findConflict, type AppointmentLike } from '@agendabo/schedule-core';
import { reviewConfirmInputSchema } from '@agendabo/contracts';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { OutboxService } from '../notifications/outbox.service';
import { AppointmentConflictError } from './appointments.service';

/**
 * Fila `needs_review` (Fase 4, spec E15/E16): o que o bot não entendeu com confiança
 * chega aqui para correção humana. Confirmar volta o compromisso ao fluxo normal e
 * MATERIALIZA os lembretes na MESMA transação (regra 6 da Fase 3 — needs_review nasce
 * com zero outbox; a fila é a única porta de entrada das notificações desse caminho).
 * Descartar APAGA (decisão #2 do plano Fase 4): o cascade do Prisma derruba o outbox.
 */
@Injectable()
export class ReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** GET /review: rascunhos do usuário, mais antigos primeiro (`startsAt asc`). */
  async list(userId: string) {
    const items = await this.prisma.appointment.findMany({
      where: { userId, status: 'needs_review' },
      orderBy: { startsAt: 'asc' },
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        notes: true,
        status: true,
        origin: true,
        createdAt: true,
        rawText: true,
        reviewReason: true,
      },
    });
    return { items };
  }

  /**
   * POST /review/:id/confirm: o usuário corrigiu título/quando no site. Conflito é a
   * mesma regra determinística do resto do produto (schedule-core, ADR-003): conflito ⇒
   * 409 (traduzido no controller) e NADA é escrito. Sem conflito ⇒ status `confirmed`,
   * `rawText`/`reviewReason` voltam a null e os gatilhos nascem na MESMA transação;
   * jobs BullMQ só depois do commit (Redis nunca dentro de tx).
   */
  async confirm(userId: string, id: string, raw: unknown) {
    const current = await this.prisma.appointment.findFirst({
      where: { id, userId, status: 'needs_review' },
    });
    if (!current) throw new NotFoundException();

    const input = reviewConfirmInputSchema.parse(raw);

    // conflito contra os confirmed futuros (o próprio id fica fora — é needs_review,
    // mas ignoreId protege o invariante se o status um dia fluir por outro caminho).
    const existing = await this.existingConfirmed(userId, id);
    const result = findConflict({ startsAt: input.startsAt, endsAt: input.endsAt }, existing);
    if (result.conflict && result.with) throw new AppointmentConflictError(result.with);

    const now = new Date();
    const { appointment, outboxIds, triggers } = await this.prisma.$transaction(async (tx) => {
      const rules = await tx.notificationRule.findMany({ where: { appointmentId: id } });
      const materialized = await this.outbox.materializeInTx(
        tx,
        { id, userId, startsAt: input.startsAt },
        rules.map((r) => ({ type: r.type, value: r.value })),
        now,
      );
      const updated = await tx.appointment.update({
        where: { id },
        data: {
          title: input.title,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          status: 'confirmed',
          rawText: null,
          reviewReason: null,
        },
        include: { notificationRules: true },
      });
      return {
        appointment: updated,
        outboxIds: materialized.outboxIds,
        triggers: materialized.triggers,
      };
    });

    if (triggers.length > 0) {
      await this.outbox.enqueueJobs(
        triggers.map((t, i) => ({ outboxId: outboxIds[i]!, firesAt: t.firesAt })),
        now,
      );
    }
    return appointment;
  }

  /** POST /review/:id/dismiss: apaga o rascunho (cascade limpa o outbox — regra 12). */
  async dismiss(userId: string, id: string) {
    const { count } = await this.prisma.appointment.deleteMany({ where: { id, userId } });
    if (count === 0) throw new NotFoundException();
    return { dismissed: true } as const;
  }

  /** Carga da checagem: confirmed futuros do usuário, sem o próprio id. */
  private async existingConfirmed(userId: string, ignoreId: string): Promise<AppointmentLike[]> {
    // ADR-0015/D6: `needs_review` conta como obstáculo (a fila mostra ⚠️ e o item
    // pode ser confirmado a qualquer momento — ignorá-lo criaria sobreposição
    // latente proibida pela invariante).
    const rows = await this.prisma.appointment.findMany({
      where: { userId, status: { in: ['confirmed', 'needs_review'] }, endsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
      select: { id: true, title: true, startsAt: true, endsAt: true },
    });
    return rows.filter((r) => r.id !== ignoreId);
  }
}
