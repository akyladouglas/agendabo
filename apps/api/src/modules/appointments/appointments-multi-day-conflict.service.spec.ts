import { AppointmentsService } from './appointments.service';

/**
 * multi-dia (spec web/multi-dia-nas-visoes §B.2 / decisões D2+D3 + review 2026-10-11):
 * as CARGAS de conflito (check-conflict, create/update, reschedule, relocation-options)
 * carregam a INTERSEÇÃO MEIA-ABERTA com o candidato EXPANDIDO
 * `[min(now, candidateStart), max(candidateEnd, now + CONFLICT_HORIZON_MS))` — e não
 * mais o horizonte cortado em `now`. Os dois lados do buraco fechado:
 *  - obstáculo multi-dia começado antes de `now` que cobre o candidato;
 *  - candidato NO PASSADO que toca um obstáculo futuro (Gherkin §A.2).
 * A filtragem fina com o candidato é do `findConflict` (puro, já coberto em
 * schedule-core). Estes testes validam o WHERE que vai ao Prisma (mock na fronteira
 * — testing.md), não o SQL.
 */

const NOW = new Date('2026-10-11T15:00:00Z');
const ID1 = '11111111-1111-4111-8111-111111111111';
const HORIZON_MS = 180 * 24 * 60 * 60_000; // espelho CONFLICT_HORIZON_MS do service

function make() {
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = { appointment: { findMany } };
  const outbox = {
    materializeInTx: jest.fn().mockResolvedValue({ outboxIds: [], triggers: [] }),
    enqueueJobs: jest.fn().mockResolvedValue(undefined),
    invalidateForAppointment: jest.fn().mockResolvedValue(0),
  };
  const svc = new AppointmentsService(prisma as never, outbox as never);
  svc.now = () => NOW;
  return { svc, findMany };
}

function whereOf(findMany: jest.Mock) {
  return findMany.mock.calls[findMany.mock.calls.length - 1][0].where as Record<string, any>;
}

describe('cargas de conflito (service): janela = interseção com o candidato expandido', () => {
  it('checkConflict futuro: where = [min(now, cStart), max(cEnd, now+H)) — sem corte em now, sem contenção', async () => {
    const { svc, findMany } = make();

    await svc.checkConflict('u1', {
      startsAt: '2026-10-20T14:00:00.000Z',
      endsAt: '2026-10-20T15:00:00.000Z',
    });

    const where = whereOf(findMany);
    expect(where.userId).toBe('u1');
    expect(where.status.in).toEqual(expect.arrayContaining(['confirmed', 'needs_review']));
    expect(where.endsAt).toEqual({ gte: NOW }); // floor = min(now, cStart) = now
    expect(where.startsAt.lt).toEqual(new Date(NOW.getTime() + HORIZON_MS)); // max(cEnd, now+H)
    expect(where.endsAt.gt).toBeUndefined(); // nunca { gt: now } — era o buraco
    expect(where.startsAt.gte).toBeUndefined(); // sem contenção
    expect(where.endsAt.lte).toBeUndefined();
  });

  it('checkConflict candidato NO PASSADO: o chão da carga desce ao candidateStart (spec §A.2/M6)', async () => {
    const { svc, findMany } = make();

    await svc.checkConflict('u1', {
      startsAt: '2026-10-10T00:00:00.000Z',
      endsAt: '2026-10-20T00:00:00.000Z',
    });

    const where = whereOf(findMany);
    expect(where.endsAt).toEqual({ gte: new Date('2026-10-10T00:00:00.000Z') }); // floor = cStart < now
    expect(where.startsAt.lt).toEqual(new Date(NOW.getTime() + HORIZON_MS));
  });

  it('checkConflict: candidato no passado TOCA obstáculo futuro → CONFLITO (Gherkin §A.2)', async () => {
    const { svc, findMany } = make();
    findMany.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
      // simulando o banco: só o que TOCA [10/10, max(20/10, now+H)) e endsAt >= 10/10
      const items = [
        { id: ID1, title: 'Consulta', startsAt: new Date('2026-10-17T14:00:00Z'), endsAt: new Date('2026-10-17T15:00:00Z'), status: 'confirmed' },
      ];
      return items.filter(
        (i) =>
          i.startsAt < where.startsAt.lt &&
          i.endsAt >= where.endsAt.gte &&
          i.endsAt > NOW, // findConflict ainda descarta encerrados antes de now
      );
    });

    await expect(
      svc.checkConflict('u1', {
        startsAt: '2026-10-10T00:00:00.000Z',
        endsAt: '2026-10-20T00:00:00.000Z',
      }),
    ).resolves.toMatchObject({ conflict: true, with: { id: ID1 } });
  });

  it('checkConflict: multi-dia iniciado antes de now e candidato dentro dele → CONFLITO (buraco D2 fechado)', async () => {
    const { svc, findMany } = make();
    // A: 10/10 23:00 → 12/10 17:00 (começa ANTES de NOW=11/10 15:00 UTC)
    findMany.mockResolvedValue([
      {
        id: ID1,
        title: 'Viagem',
        startsAt: new Date('2026-10-10T23:00:00Z'),
        endsAt: new Date('2026-10-12T17:00:00Z'),
        status: 'confirmed',
      },
    ]);

    await expect(
      svc.checkConflict('u1', {
        startsAt: '2026-10-11T16:00:00.000Z', // dentro da viagem
        endsAt: '2026-10-11T17:00:00.000Z',
      }),
    ).resolves.toMatchObject({ conflict: true, with: { id: ID1 } });
  });

  it('relocationOptions: candidato multi-dia sobreposto a item pontual no meio → 200 com as duas jogadas (a carga nova vê o obstáculo)', async () => {
    const { svc, findMany } = make();
    // A consulta 12/10 14:00–15:00 está CONTIDA no candidato multi-dia. findConflict
    // trata contida como interseção (plan-relocation.test.ts "caso 3" — contida conta),
    // então relocation-options responde as duas jogadas em vez de um falso "sem conflito".
    findMany.mockResolvedValue([
      {
        id: ID1,
        title: 'Consulta',
        startsAt: new Date('2026-10-12T14:00:00Z'),
        endsAt: new Date('2026-10-12T15:00:00Z'),
        status: 'confirmed',
      },
    ]);

    await expect(
      svc.relocationOptions('u1', {
        startsAt: '2026-10-11T20:00:00.000Z',
        endsAt: '2026-10-13T02:00:00.000Z', // multi-dia engolindo a consulta
      }),
    ).resolves.toMatchObject({ kind: 'options' });
  });

  it('checkConflict com ignoreId: o WHERE já traz id.not (filtro na fonte, não só em memória)', async () => {
    const { svc, findMany } = make();

    await svc.checkConflict('u1', {
      startsAt: '2026-10-11T16:00:00.000Z',
      endsAt: '2026-10-11T17:00:00.000Z',
      ignoreId: ID1,
    });

    expect(whereOf(findMany).id).toEqual({ not: ID1 });
  });
});
