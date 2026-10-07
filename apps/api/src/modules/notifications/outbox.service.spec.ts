import { computeTriggers } from '@agendabo/schedule-core';
import { OutboxService, toCoreRule, type DispatchQueueLike } from './outbox.service';

/**
 * Materialização do outbox (Fase 3, spec regras 6–10). Prisma `tx` e fila são mocks
 * planos; computeTriggers (schedule-core) roda de verdade — é a regra em teste.
 */

const NOW = new Date('2026-10-08T12:00:00Z');

function makeQueue() {
  const added: { data: { outboxId: string }; delay: number }[] = [];
  const queue: DispatchQueueLike = {
    async add(_name, data, opts) {
      added.push({ data, delay: opts.delay });
    },
  };
  return { queue, added };
}

function makeTx() {
  const created: Record<string, unknown>[] = [];
  let nextId = 1;
  return {
    created,
    notificationOutbox: {
      createManyAndReturn: async ({ data }: { data: Record<string, unknown>[] }) => {
        const rows = data.map((d) => ({ status: 'pending', ...d, id: `o${nextId++}` }));
        created.push(...rows);
        return rows;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const row of created) {
          const match = where.appointmentId === row.appointmentId && where.status === row.status;
          if (match) {
            Object.assign(row, data);
            count += 1;
          }
        }
        return { count };
      },
      findMany: async () =>
        created
          .filter((r) => r.status === 'pending')
          .map((r) => ({ id: r.id, firesAt: r.firesAt })),
    },
  };
}

const appointment = {
  id: 'a1',
  userId: 'u1',
  startsAt: new Date('2026-10-10T17:00:00Z'), // sábado 14:00 (-03:00)
};

describe('OutboxService.materializeInTx', () => {
  it('3-2-1 => 3 linhas pending (kind reminder, ruleType por linha) — spec regra 6', async () => {
    const { queue } = makeQueue();
    const svc = new OutboxService(queue);
    const tx = makeTx();
    const out = await svc.materializeInTx(
      tx as never,
      appointment,
      [{ type: 'countdown_3_2_1', value: null }],
      NOW,
    );
    // compromisso em 10/10 14:00Z e NOW = 08/10 12:00Z: o gatilho de 3 dias (07/10) já
    // passou e cai (computeTriggers); sobram os de 2 e 1 dia — 2 linhas.
    expect(out.outboxIds).toHaveLength(2);
    expect(out.triggers.map((t) => t.ruleType)).toEqual(['countdown_3_2_1', 'countdown_3_2_1']);
    // firesAt = startsAt - 3/2/1 dias (mesmo horário) — confere com o schedule-core
    const expected = computeTriggers(appointment.startsAt, [{ type: 'countdown_3_2_1' }], {
      now: NOW,
    });
    expect(tx.created.map((r) => (r.firesAt as Date).toISOString())).toEqual(
      expected.map((t) => t.firesAt.toISOString()),
    );
    expect(tx.created.every((r) => r.kind === 'reminder' && r.userId === 'u1')).toBe(true);
  });

  it('regra `none` ou todas retroativas => zero linhas, zero jobs (spec regra 7)', async () => {
    const { queue } = makeQueue();
    const svc = new OutboxService(queue);
    const none = await svc.materializeInTx(
      makeTx() as never,
      appointment,
      [{ type: 'none', value: null }],
      NOW,
    );
    expect(none).toEqual({ outboxIds: [], triggers: [] });

    const retro = await svc.materializeInTx(
      makeTx() as never,
      { ...appointment, startsAt: new Date('2026-10-08T13:00:00Z') }, // 1h à frente
      [{ type: 'before_days', value: 3 }],
      NOW,
    );
    expect(retro.triggers).toHaveLength(0);
  });

  it('multi-regra gera uma linha por gatilho (spec regra 1/6)', async () => {
    const { queue } = makeQueue();
    const svc = new OutboxService(queue);
    const out = await svc.materializeInTx(
      makeTx() as never,
      appointment,
      [
        { type: 'before_hours', value: 5 },
        { type: 'before_hours', value: 2 },
      ],
      NOW,
    );
    expect(out.outboxIds).toHaveLength(2); // gatilhos em instantes diferentes
  });

  it('"1 dia antes" + "24h antes" colapsam num só gatilho (dedupe do computeTriggers, spec 1)', async () => {
    const { queue } = makeQueue();
    const svc = new OutboxService(queue);
    const out = await svc.materializeInTx(
      makeTx() as never,
      appointment,
      [
        { type: 'before_days', value: 1 },
        { type: 'before_hours', value: 24 },
      ],
      NOW,
    );
    expect(out.outboxIds).toHaveLength(1); // dedupe por firesAt preserva a primeira regra
  });
});

describe('OutboxService.enqueueJobs', () => {
  it('delay = firesAt - now; Redis caído loga e NAO lança (linha fica p/ o sweeper)', async () => {
    const { queue, added } = makeQueue();
    const svc = new OutboxService(queue);
    const firesAt = new Date(NOW.getTime() + 60 * 60_000);
    await svc.enqueueJobs([{ outboxId: 'o1', firesAt }], NOW);
    expect(added).toEqual([{ data: { outboxId: 'o1' }, delay: 3_600_000 }]);

    const broken = new OutboxService({
      async add() {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(broken.enqueueJobs([{ outboxId: 'o2', firesAt }], NOW)).resolves.toBeUndefined();
  });
});

describe('OutboxService.invalidateForAppointment', () => {
  it('só linhas pending do compromisso viram cancelled; sent fica intacta (spec 9/10)', async () => {
    const { queue } = makeQueue();
    const svc = new OutboxService(queue);
    const tx = makeTx();
    await svc.materializeInTx(
      tx as never,
      appointment,
      [
        { type: 'before_hours', value: 5 },
        { type: 'before_hours', value: 2 },
      ],
      NOW,
    );
    tx.created[0]!.status = 'sent'; // uma já disparou
    const count = await svc.invalidateForAppointment(tx as never, 'a1');
    expect(count).toBe(tx.created.length - 1);
    expect(tx.created[0]!.status).toBe('sent');
    expect(tx.created[1]!.status).toBe('cancelled');
    if (tx.created[2]) expect(tx.created[2]!.status).toBe('cancelled');
  });
});

describe('toCoreRule', () => {
  it('linhas Prisma (type/value) => regras do domínio', () => {
    expect(toCoreRule({ type: 'before_hours', value: 2 })).toEqual({
      type: 'before_hours',
      hours: 2,
    });
    expect(toCoreRule({ type: 'before_days', value: null })).toEqual({
      type: 'before_days',
      days: 0,
    });
    expect(toCoreRule({ type: 'countdown_3_2_1', value: null })).toEqual({
      type: 'countdown_3_2_1',
    });
    expect(toCoreRule({ type: 'none', value: null })).toEqual({ type: 'none' });
  });
});
