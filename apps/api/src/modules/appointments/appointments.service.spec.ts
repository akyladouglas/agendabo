import { AppointmentStatus, Prisma } from '@prisma/client';
import { AppointmentsService } from './appointments.service';

/**
 * listOverlapping (Fase 2, spec #8): o bot lista por INTERSECÇÃO half-open, não por
 * contenção. multi-dia (spec web/multi-dia-nas-visoes §B.1): a `list` da web passou a
 * ser a MESMA semântica ("um item que toca o período aparece"). O teste valida o WHERE
 * que vai ao Prisma (mock na fronteira — testing.md), não o SQL.
 */

function make() {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { appointment: { findMany } };
  const outbox = {
    materializeInTx: jest.fn().mockResolvedValue({ outboxIds: [], triggers: [] }),
    enqueueJobs: jest.fn().mockResolvedValue(undefined),
    invalidateForAppointment: jest.fn().mockResolvedValue(0),
  };
  const svc = new AppointmentsService(prisma as never, outbox as never, undefined as never, undefined as never);
  return { svc, findMany };
}

type StatusList = readonly AppointmentStatus[];

describe('AppointmentsService.listOverlapping', () => {
  const from = new Date('2026-10-05T03:00:00Z'); // seg 00:00 local (-03:00)
  const to = new Date('2026-10-12T03:00:00Z'); // seg seguinte 00:00 local

  it('usa intersecção half-open (startsAt < to AND endsAt >= from), nunca contenção', async () => {
    const { svc, findMany } = make();

    await svc.listOverlapping('u1', from, to);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          startsAt: { lt: to }, // e NAO gte from (contenção) nem lte to
          endsAt: { gte: from }, // e NAO lte to (contenção)
          status: { in: ['confirmed', 'needs_review'] },
        },
        orderBy: { startsAt: 'asc' },
      }),
    );
    // contenção da web (gte/lte) não pode aparecer no where do bot
    const where = findMany.mock.calls[0][0]!.where as Record<string, unknown>;
    expect((where.startsAt as Record<string, unknown>).gte).toBeUndefined();
    expect((where.endsAt as Record<string, unknown>).lte).toBeUndefined();
  });

  it('meio-aberto na borda: as condições do where garantem endsAt >= from e startsAt < to', async () => {
    const { svc, findMany } = make();
    findMany.mockResolvedValue([
      { id: 'a1', title: 'Cruzando a meia-noite', startsAt: from, endsAt: to, status: 'confirmed' },
    ]);

    const rows = await svc.listOverlapping('u1', from, to);

    expect(rows).toHaveLength(1);
    // a fronteira half-open vive inteira no where: quem termina em `from` (endsAt == from)
    // ainda entra (>=) e quem começa em `to` (startsAt == to) fica fora (<).
    const args = findMany.mock.calls[0][0]!;
    expect(args.where).toEqual({
      userId: 'u1',
      startsAt: { lt: to },
      endsAt: { gte: from },
      status: { in: ['confirmed', 'needs_review'] },
    });
  });

  it('statuses customizados substituem o default (cancelled nunca é passado por aqui)', async () => {
    const { svc, findMany } = make();
    const statuses: StatusList = ['needs_review'];

    await svc.listOverlapping('u1', from, to, statuses);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['needs_review'] } }),
      }),
    );
  });

  // multi-dia (spec web/multi-dia-nas-visoes §B.1 / M1): a `list` da web abandonou a
  // contenção e passou a ser a MESMA interseção meia-aberta do bot.
  it('a `list` da web espelha listOverlapping: interseção half-open, nunca contenção', async () => {
    const { svc, findMany } = make();

    await svc.list('u1', { from: from.toISOString(), to: to.toISOString() });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'u1',
          startsAt: { lt: to },
          endsAt: { gte: from },
        },
      }),
    );
    // contenção antiga não pode voltar: nada de gte em startsAt / lte em endsAt
    const where = findMany.mock.calls[0][0]!.where as Record<string, unknown>;
    expect((where.startsAt as Record<string, unknown>).gte).toBeUndefined();
    expect((where.endsAt as Record<string, unknown>).lte).toBeUndefined();
  });

  it('list sem filtro de status: sem status no WHERE, interseção meia-aberta se mantém', async () => {
    const { svc, findMany } = make();

    await svc.list('u1', {
      from: from.toISOString(),
      to: to.toISOString(),
    });

    const where = findMany.mock.calls[0][0]!.where as Record<string, unknown>;
    expect(where.status).toBeUndefined();
    expect(where.startsAt).toEqual({ lt: to });
    expect(where.endsAt).toEqual({ gte: from });
  });

  it('list: rows que tocam pelos dois lados voltam; encostados ficam fora (simula o banco com o WHERE)', async () => {
    const { svc, findMany } = make();
    const db = [
      { id: 'esq', startsAt: new Date('2026-10-04T20:00:00Z'), endsAt: new Date('2026-10-05T06:00:00Z') }, // toca pela esquerda (pré-now multi-dia)
      { id: 'dir', startsAt: new Date('2026-10-12T01:00:00Z'), endsAt: new Date('2026-10-13T02:00:00Z') }, // toca pela direita (termina depois do `to`)
      { id: 'contido', startsAt: new Date('2026-10-08T12:00:00Z'), endsAt: new Date('2026-10-08T13:00:00Z') }, // contido: sempre voltou
      { id: 'encostado_fim', startsAt: to, endsAt: new Date('2026-10-12T04:00:00Z') }, // startsAt == to → FORA (lt)
      { id: 'encostado_ini', startsAt: new Date('2026-10-04T00:00:00Z'), endsAt: from }, // endsAt == from → DENTRO (gte — borda espelhada de listOverlapping)
    ];
    findMany.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      db.filter((i) => i.startsAt < where.startsAt.lt && i.endsAt >= where.endsAt.gte),
    );

    const out = await svc.list('u1', { from: from.toISOString(), to: to.toISOString() });

    expect(out.items.map((i) => i.id)).toEqual(['esq', 'dir', 'contido', 'encostado_ini']);
  });
});

void (null as unknown as Prisma.TransactionClient); // garante que o import de Prisma continua usado
