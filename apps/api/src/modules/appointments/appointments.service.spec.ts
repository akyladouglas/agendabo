import { AppointmentStatus, Prisma } from '@prisma/client';
import { AppointmentsService } from './appointments.service';

/**
 * listOverlapping (Fase 2, spec #8): o bot lista por INTERSECÇÃO half-open, não por
 * contenção (a `list` da web fica como está). O teste valida o WHERE que vai ao Prisma
 * (mock na fronteira — testing.md), não o SQL.
 */

function make() {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { appointment: { findMany } };
  const svc = new AppointmentsService(prisma as never);
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

  it('a `list` da web continua com contenção (não mudou — spec #8)', async () => {
    const { svc, findMany } = make();

    await svc.list('u1', { from: from.toISOString(), to: to.toISOString() });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u1', startsAt: { gte: from }, endsAt: { lte: to } },
      }),
    );
  });
});

void (null as unknown as Prisma.TransactionClient); // garante que o import de Prisma continua usado
