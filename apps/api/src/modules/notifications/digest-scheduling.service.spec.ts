import { DigestSchedulingService, parseHourOfDay } from './digest-scheduling.service';

/**
 * Materialização idempotente do resumo diário (Fase 3, spec regras 15–16).
 * `now` injetado, fuso via `offsetProvider` fixo, Prisma mock plano (testing.md).
 *
 * Cenário: SP (-03:00); resumo às 07:00 local = 10:00Z.
 */

const OFFSET = -180;

function make(
  users: Record<string, unknown>[],
  existingFiresAt: Date | null = null,
  offsetFor?: (tz: string) => number,
) {
  let createdCount = 0;
  const prisma = {
    user: {
      findMany: async () => users,
    },
    notificationOutbox: {
      create: async ({ data }: { data: { firesAt: Date } }) => {
        if (existingFiresAt && data.firesAt.getTime() === existingFiresAt.getTime()) {
          throw { code: 'P2002' }; // única parcial (userId, kind, firesAt)
        }
        createdCount += 1;
        return { id: `o${createdCount}`, firesAt: data.firesAt };
      },
    },
  };
  const outbox = { enqueueJobs: async () => undefined };
  const svc = new DigestSchedulingService(prisma as never, outbox as never);
  svc.offsetProvider = (_tz, _at) => (offsetFor ? offsetFor(_tz) : OFFSET);
  return { svc, prisma };
}

const user = (overrides: Record<string, unknown> = {}) => ({
  id: 'u1',
  timezone: 'America/Sao_Paulo',
  resumoDiarioHora: '07:00',
  ...overrides,
});

describe('DigestSchedulingService.materializeDueDigests', () => {
  it('no minuto alvo local (10:00Z = 07:00 SP) materializa 1 linha + job com firesAt do dia civil', async () => {
    const { svc } = make([user()]);
    const { materialized, jobs } = await svc.materializeDueDigests(
      new Date('2026-10-08T10:00:00Z'),
    );
    expect(materialized).toBe(1);
    expect(jobs).toEqual([{ outboxId: 'o1', firesAt: new Date('2026-10-08T10:00:00Z') }]);
  });

  it('fora da janela (06:00 local) não materializa nada (a hora é LOCAL, não do servidor)', async () => {
    const { svc } = make([user()]);
    const { materialized, jobs } = await svc.materializeDueDigests(
      new Date('2026-10-08T09:00:00Z'),
    );
    expect(materialized).toBe(0);
    expect(jobs).toEqual([]);
  });

  it('mesmo instante UTC em fusos diferentes: hora LOCAL manda (spec 15)', async () => {
    // 13:00Z: SP 10:00 (acordou tarde, resumo das 07h já passou => fora) |
    //         UTC+0 13:00... também não. O alvo só bate p/ quem tem 13:00 local = 16:00Z.
    const { svc } = make(
      [
        user({ id: 'u1', timezone: 'Etc/UTC', resumoDiarioHora: '13:00' }),
        user({ id: 'u2', timezone: 'America/Sao_Paulo', resumoDiarioHora: '13:00' }),
      ],
      null,
      (tz) => (tz === 'Etc/UTC' ? 0 : OFFSET),
    );
    // 13:00Z = 13:00 local em UTC+0 (NA HORA) mas 10:00 em SP (FORA)
    const { materialized, jobs } = await svc.materializeDueDigests(
      new Date('2026-10-08T13:00:00Z'),
    );
    expect(materialized).toBe(1);
    expect(jobs).toHaveLength(1);
  });

  it('P2002 (única parcial) = já materializado hoje => 0 jobs, sem erro (idempotência, spec 16)', async () => {
    const firesAt = new Date('2026-10-08T10:00:00Z');
    const { svc } = make([user()], firesAt);
    const now = new Date('2026-10-08T10:01:00Z'); // sweep seguinte da janela
    const { materialized, jobs } = await svc.materializeDueDigests(now);
    expect(materialized).toBe(0);
    expect(jobs).toEqual([]);
  });

  it('varredura atrasada (API reiniciada): até +5min do alvo ainda materializa, com o MESMO firesAt (idempotência)', async () => {
    const { svc } = make([user()]);
    const a = await svc.materializeDueDigests(new Date('2026-10-08T10:04:30Z'));
    expect(a.jobs[0]!.firesAt).toEqual(new Date('2026-10-08T10:00:00Z'));
    const b = await svc.materializeDueDigests(new Date('2026-10-08T10:06:00Z')); // passou a janela
    expect(b.jobs).toEqual([]);
  });

  it('resumo DESLIGADO no perfil não materializa nem no minuto alvo (Fase 5, Aberto #2 → (a))', async () => {
    // A guarda vive no WHERE da busca: usuário com resumoDiarioAtivo=false nem é
    // carregado. O mock abaixo honra o where para provar o filtro, não o if.
    const seen: Record<string, unknown>[] = [];
    const prisma = {
      user: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          seen.push(where);
          return []; // resumoDiarioAtivo=false => fora da carga
        },
      },
      notificationOutbox: { create: async () => ({ id: 'o1', firesAt: new Date() }) },
    };
    const outbox = { enqueueJobs: async () => undefined };
    const svc = new DigestSchedulingService(prisma as never, outbox as never);
    svc.offsetProvider = () => OFFSET;
    const { materialized, jobs } = await svc.materializeDueDigests(
      new Date('2026-10-08T10:00:00Z'),
    );
    expect(materialized).toBe(0);
    expect(jobs).toEqual([]);
    expect(seen[0]).toMatchObject({ resumoDiarioAtivo: true });
  });
});

describe('parseHourOfDay', () => {
  it('HH:mm válido; lixo cai no default 07:00 (defesa na borda)', () => {
    expect(parseHourOfDay('07:00')).toEqual({ hour: 7, minute: 0 });
    expect(parseHourOfDay('23:59')).toEqual({ hour: 23, minute: 59 });
    expect(parseHourOfDay('7:00')).toEqual({ hour: 7, minute: 0 });
    expect(parseHourOfDay('24:00')).toEqual({ hour: 7, minute: 0 });
    expect(parseHourOfDay('')).toEqual({ hour: 7, minute: 0 });
  });
});
