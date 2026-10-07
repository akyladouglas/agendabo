import { AppointmentsService } from './appointments.service';

/**
 * Fiação do outbox no create/update (Fase 3, spec regras 6/9/10 + plano etapa 4):
 * linhas nascem na MESMA tx, enqueue é SEMPRE pós-commit, edição invalida e recria.
 * Prisma mock plano; OutboxService é mock de Espião (a regra dele tem spec própria).
 */

const NOW = new Date('2026-10-08T12:00:00Z');

function make(
  opts: { current?: Record<string, unknown>; existingRules?: Record<string, unknown>[] } = {},
) {
  const calls: string[] = [];
  const tx = {
    appointment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('tx.appointment.create');
        return { id: 'a1', ...data };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('tx.appointment.update');
        return { id: 'a1', ...data };
      },
    },
    notificationRule: {
      deleteMany: async () => {
        calls.push('tx.rule.deleteMany');
        return { count: 1 };
      },
      createMany: async () => {
        calls.push('tx.rule.createMany');
        return { count: 1 };
      },
    },
  };
  const prisma = {
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      calls.push('tx.begin');
      const out = await fn(tx);
      calls.push('tx.commit');
      return out;
    },
    appointment: {
      findFirst: async () => opts.current ?? null,
      findMany: async () => [], // existingFor do assertNoConflict: sem conflitos nos testes de outbox
    },
    notificationRule: {
      findMany: async () => opts.existingRules ?? [{ type: 'before_hours', value: 2 }],
    },
  };
  const materializeInTx = jest.fn<
    Promise<{ outboxIds: string[]; triggers: { firesAt: Date; ruleType: string }[] }>,
    []
  >(async () => {
    calls.push('outbox.materializeInTx');
    return {
      outboxIds: ['o1'],
      triggers: [{ firesAt: new Date('2026-10-10T17:00:00Z'), ruleType: 'before_days' }],
    };
  });
  const enqueueJobs = jest.fn<Promise<void>, [{ outboxId: string; firesAt: Date }[]], never>(
    async () => {
      calls.push('outbox.enqueueJobs');
    },
  );
  const invalidateForAppointment = jest.fn(async () => {
    calls.push('outbox.invalidate');
    return 1;
  });
  const outbox = { materializeInTx, enqueueJobs, invalidateForAppointment };
  const svc = new AppointmentsService(prisma as never, outbox as never);
  svc.now = () => NOW;
  return { svc, calls, materializeInTx, enqueueJobs, invalidateForAppointment };
}

const createInput = (rules: unknown[]) => ({
  title: 'Consulta',
  startsAt: new Date('2026-10-10T17:00:00Z'),
  endsAt: new Date('2026-10-10T18:00:00Z'),
  notificationRules: rules,
});

describe('AppointmentsService.create — outbox', () => {
  it('com regras: materializa DENTRO da tx e enfileira SÓ depois do commit (spec 6)', async () => {
    const { svc, calls, materializeInTx, enqueueJobs } = make();
    await svc.create('u1', createInput([{ type: 'before_days', value: 3 }]), { origin: 'bot' });
    expect(materializeInTx).toHaveBeenCalledTimes(1);
    expect(enqueueJobs).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('outbox.materializeInTx')).toBeLessThan(calls.indexOf('tx.commit'));
    expect(calls.indexOf('tx.commit')).toBeLessThan(calls.indexOf('outbox.enqueueJobs'));
    // o job carrega o outboxId da linha criada
    expect(enqueueJobs.mock.calls[0]![0]).toEqual([
      { outboxId: 'o1', firesAt: new Date('2026-10-10T17:00:00Z') },
    ]);
  });

  it('sem regras (ou none): zero linhas de outbox; o enqueue pós-commit é vazio (spec 7)', async () => {
    const { svc, materializeInTx, enqueueJobs } = make();
    await svc.create('u1', createInput([{ type: 'none' }]));
    expect(materializeInTx).not.toHaveBeenCalled();
    expect(enqueueJobs).toHaveBeenCalledWith([], NOW);
  });
});

describe('AppointmentsService.update — outbox', () => {
  const current = {
    id: 'a1',
    userId: 'u1',
    startsAt: new Date('2026-10-10T17:00:00Z'),
    endsAt: new Date('2026-10-10T18:00:00Z'),
  };

  it('mudou startsAt: cancela pending na tx e re-materializa com o novo horário (spec 9)', async () => {
    const { svc, invalidateForAppointment, materializeInTx, enqueueJobs } = make({ current });
    await svc.update('u1', 'a1', { startsAt: new Date('2026-10-11T17:00:00Z') });
    expect(invalidateForAppointment).toHaveBeenCalledTimes(1);
    expect(materializeInTx).toHaveBeenCalledTimes(1);
    expect(enqueueJobs).toHaveBeenCalledTimes(1);
  });

  it('mudou só o título: outbox intacto (nem cancela, nem recria)', async () => {
    const { svc, invalidateForAppointment, materializeInTx, enqueueJobs } = make({ current });
    await svc.update('u1', 'a1', { title: 'Novo título' });
    expect(invalidateForAppointment).not.toHaveBeenCalled();
    expect(materializeInTx).not.toHaveBeenCalled();
    expect(enqueueJobs).not.toHaveBeenCalled();
  });

  it('trocou as regras mantendo o horário: invalida, recria regras e re-materializa', async () => {
    const { svc, invalidateForAppointment, materializeInTx, calls } = make({ current });
    await svc.update('u1', 'a1', { notificationRules: [{ type: 'countdown_3_2_1' }] });
    expect(invalidateForAppointment).toHaveBeenCalledTimes(1);
    expect(materializeInTx).toHaveBeenCalledTimes(1);
    expect(calls).toContain('tx.rule.deleteMany');
    expect(calls).toContain('tx.rule.createMany');
  });

  it('mudou só endsAt (mesmo início): cancela pendências mas NÃO re-materializa (firesAt seguem válidos)', async () => {
    const { svc, invalidateForAppointment, materializeInTx, enqueueJobs } = make({ current });
    await svc.update('u1', 'a1', { endsAt: new Date('2026-10-10T19:00:00Z') });
    expect(invalidateForAppointment).toHaveBeenCalledTimes(1);
    expect(materializeInTx).not.toHaveBeenCalled();
    expect(enqueueJobs).toHaveBeenCalledTimes(1); // sem triggers novos => lista vazia
    expect(enqueueJobs.mock.calls[0]![0]).toEqual([]);
  });
});
