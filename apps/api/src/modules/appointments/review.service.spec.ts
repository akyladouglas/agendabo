import { NotFoundException } from '@nestjs/common';
import { AppointmentsService, AppointmentConflictError } from './appointments.service';
import { ReviewService } from './review.service';

/**
 * Fila needs_review (Fase 4, spec E15/E16): confirmar ⇒ confirmed + outbox na MESMA
 * transação (regra 6); conflito ⇒ 409-erro e NADA é escrito; descartar ⇒ apaga.
 * Mock na fronteira Prisma/Outbox (testing.md) — valida as chamadas, não o SQL.
 */

const NOW = new Date('2026-10-06T10:00:00Z');

function needsReviewRow(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    userId: 'u1',
    title: 'Consulta dentista',
    startsAt: new Date('2026-10-09T18:00:00Z'),
    endsAt: new Date('2026-10-09T19:00:00Z'),
    notes: null,
    status: 'needs_review',
    origin: 'bot',
    createdAt: NOW,
    rawText: 'consulta semana que vem ai',
    reviewReason: 'confianca_baixa',
    ...over,
  };
}

function make() {
  const findFirst = jest.fn().mockResolvedValue(needsReviewRow());
  const findMany = jest.fn().mockResolvedValue([]);
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const update = jest.fn().mockImplementation((args: { where: { id: string } }) =>
    Promise.resolve({
      ...needsReviewRow(),
      status: 'confirmed',
      rawText: null,
      reviewReason: null,
      ...args,
    }),
  );
  const notificationRuleFindMany = jest
    .fn()
    .mockResolvedValue([{ id: 'n1', type: 'before_hours', value: 2 }]);
  const tx = {
    appointment: { update },
    notificationRule: { findMany: notificationRuleFindMany },
  };
  const $transaction = jest
    .fn()
    .mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
  const prisma = {
    appointment: { findFirst, findMany, deleteMany },
    $transaction,
  };
  const materializeInTx = jest.fn().mockResolvedValue({
    outboxIds: ['o1'],
    triggers: [{ firesAt: new Date('2026-10-09T16:00:00Z'), ruleType: 'before_hours' }],
  });
  const enqueueJobs = jest.fn().mockResolvedValue(undefined);
  const outbox = { materializeInTx, enqueueJobs };
  const svc = new ReviewService(prisma as never, outbox as never);
  return {
    svc,
    prisma,
    findFirst,
    findMany,
    deleteMany,
    update,
    $transaction,
    tx,
    materializeInTx,
    enqueueJobs,
    notificationRuleFindMany,
  };
}

const CONFIRM_BODY = {
  title: 'Consulta no dentista',
  startsAt: '2026-10-09T15:00:00.000Z',
  endsAt: '2026-10-09T16:00:00.000Z',
};

describe('ReviewService (fila needs_review — Fase 4)', () => {
  it('list: só needs_review do usuário, startsAt asc, com rawText/reviewReason', async () => {
    const m = make();
    m.findMany.mockResolvedValue([needsReviewRow()]);

    const out = await m.svc.list('u1');

    expect(m.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', status: 'needs_review' },
        orderBy: { startsAt: 'asc' },
      }),
    );
    expect(out.items[0]).toEqual(
      expect.objectContaining({
        id: 'r1',
        rawText: 'consulta semana que vem ai',
        reviewReason: 'confianca_baixa',
      }),
    );
  });

  it('confirm feliz: confirmed + rawText/reviewReason nulos e outbox na MESMA transação', async () => {
    const m = make();

    const appt = await m.svc.confirm('u1', 'r1', CONFIRM_BODY);

    // materialização acontece DENTRO da tx (tx === primeiro arg de materializeInTx)
    expect(m.materializeInTx).toHaveBeenCalledTimes(1);
    expect(m.$transaction).toHaveBeenCalledTimes(1);
    expect(m.materializeInTx.mock.calls[0]![0]).toBe(m.tx);
    expect(m.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({
          title: 'Consulta no dentista',
          status: 'confirmed',
          rawText: null,
          reviewReason: null,
        }),
      }),
    );
    expect(appt).toEqual(expect.objectContaining({ status: 'confirmed', rawText: null }));
  });

  it('confirm: jobs BullMQ só DEPOIS do commit da transação (Redis nunca dentro de tx)', async () => {
    const m = make();
    const order: string[] = [];
    m.$transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => {
      order.push('tx');
      return fn(m.tx);
    });
    m.enqueueJobs.mockImplementation(async () => {
      order.push('enqueue');
    });

    await m.svc.confirm('u1', 'r1', CONFIRM_BODY);

    expect(order).toEqual(['tx', 'enqueue']);
    expect(m.enqueueJobs).toHaveBeenCalledWith(
      [{ outboxId: 'o1', firesAt: new Date('2026-10-09T16:00:00Z') }],
      expect.any(Date),
    );
  });

  it('confirm sem regras: nenhuma escrita de outbox e nenhum job enfileirado', async () => {
    const m = make();
    m.notificationRuleFindMany.mockResolvedValue([]);
    m.materializeInTx.mockResolvedValue({ outboxIds: [], triggers: [] });

    await m.svc.confirm('u1', 'r1', CONFIRM_BODY);

    expect(m.enqueueJobs).not.toHaveBeenCalled();
  });

  it('confirm com conflito (spec E16): AppointmentConflictError e NENHUMA escrita', async () => {
    const m = make();
    const other = {
      id: 'a9',
      title: 'Reunião de time',
      startsAt: new Date('2026-10-09T15:30:00Z'),
      endsAt: new Date('2026-10-09T16:30:00Z'),
    };
    m.findMany.mockResolvedValue([other]); // confirmed futuro sobreposto

    await expect(m.svc.confirm('u1', 'r1', CONFIRM_BODY)).rejects.toBeInstanceOf(
      AppointmentConflictError,
    );

    expect(m.$transaction).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(m.enqueueJobs).not.toHaveBeenCalled();
  });

  it('confirm em id que não é needs_review (ou de outra pessoa): NotFound e nada é escrito', async () => {
    const m = make();
    m.findFirst.mockResolvedValue(null); // filtro { id, userId, status: needs_review }

    await expect(m.svc.confirm('u1', 'r1', CONFIRM_BODY)).rejects.toBeInstanceOf(NotFoundException);
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it('confirm com body inválido (endsAt <= startsAt): zod rejeita ANTES de qualquer escrita', async () => {
    const m = make();
    await expect(
      m.svc.confirm('u1', 'r1', { ...CONFIRM_BODY, endsAt: CONFIRM_BODY.startsAt }),
    ).rejects.toThrow();
    expect(m.$transaction).not.toHaveBeenCalled();
  });

  it('dismiss: apaga (cascade limpa o outbox — regra 12); count 0 => NotFound', async () => {
    const m = make();

    await expect(m.svc.dismiss('u1', 'r1')).resolves.toEqual({ dismissed: true });
    expect(m.deleteMany).toHaveBeenCalledWith({ where: { id: 'r1', userId: 'u1' } });

    m.deleteMany.mockResolvedValue({ count: 0 });
    await expect(m.svc.dismiss('u1', 'zzz')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a lista da web (AppointmentsService.list) continua intacta: needs_review NÃO some por aqui', async () => {
    // regressão: ReviewService não pode tocar nos filtros da listagem geral
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new AppointmentsService(
      { appointment: { findMany } } as never,
      {
        materializeInTx: jest.fn(),
      } as never,
    );
    await svc.list('u1', {
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-31T00:00:00.000Z',
    });
    const where = findMany.mock.calls[0]![0]!.where as Record<string, unknown>;
    expect(where.status).toBeUndefined(); // sem filtro de status — todo o resto igual
  });
});
