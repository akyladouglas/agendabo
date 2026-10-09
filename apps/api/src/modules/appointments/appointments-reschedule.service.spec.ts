import {
  AppointmentConflictError,
  AppointmentsService,
  RelocationNotAvailableError,
} from './appointments.service';

/**
 * Reagendamento Assistido no service (Fase 8, Etapa 0 — ADR-0015): a escrita
 * dupla é transacional, o server recomputa a jogada (client obsoleto não
 * escreve) e os lembretes de CADA lado que mudou de instante são invalidados +
 * re-materializados na MESMA tx; Redis só pós-commit.
 */

const NOW = new Date('2026-10-08T12:00:00Z');
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

function appt(id: string, start: string, end: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `appt ${id}`,
    startsAt: new Date(start),
    endsAt: new Date(end),
    userId: 'u1',
    status: 'confirmed',
    ...overrides,
  };
}

function make(opts: { rows?: Record<string, ReturnType<typeof appt>> } = {}) {
  const rows = opts.rows ?? {};
  const calls: string[] = [];
  const tx = {
    appointment: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows[where.id as string] ?? null,
      findMany: async () => Object.values(rows),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('tx.create');
        return { id: ID3, ...data };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        calls.push(`tx.update:${where.id}`);
        return { id: where.id, ...rows[where.id], ...data };
      },
    },
    notificationRule: {
      findMany: async () => [{ type: 'before_hours', value: 2 }],
      deleteMany: async () => ({ count: 0 }),
      createMany: async () => ({ count: 0 }),
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
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        rows[where.id as string] ?? null,
      findMany: async () => Object.values(rows),
    },
    notificationRule: { findMany: async () => [{ type: 'before_hours', value: 2 }] },
  };
  const materializeInTx = jest.fn(async () => {
    calls.push('outbox.materialize');
    return {
      outboxIds: ['o1'],
      triggers: [{ firesAt: new Date('2026-10-10T17:00:00Z'), ruleType: 'before_hours' }],
      droppedRuleTypes: [],
    };
  });
  const enqueueJobs = jest.fn(async () => {
    calls.push('outbox.enqueue');
  });
  const invalidateForAppointment = jest.fn(async () => {
    calls.push('outbox.invalidate');
    return 1;
  });
  const outbox = { materializeInTx, enqueueJobs, invalidateForAppointment };
  const svc = new AppointmentsService(prisma as never, outbox as never);
  svc.now = () => NOW;
  return { svc, calls, materializeInTx, enqueueJobs, invalidateForAppointment };
}

describe('AppointmentsService.relocationOptions', () => {
  it('destino sobreposto a um futuro: 200 com as duas jogadas (move-other + move-self)', async () => {
    const A = appt(ID1, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const { svc } = make({ rows: { [ID1]: A } });

    const result = await svc.relocationOptions('u1', {
      startsAt: '2026-10-12T14:30:00.000Z',
      endsAt: '2026-10-12T15:30:00.000Z',
    });

    expect(result.kind).toBe('options');
    if (result.kind === 'options') {
      expect(result.options.map((o) => o.kind)).toEqual(['move-other', 'move-self']);
    }
  });

  it('destino sobreposto a DOIS futuros: AppointmentConflictError com o primeiro (409 único)', async () => {
    const A = appt(ID1, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const B = appt(ID2, '2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z');
    const { svc } = make({ rows: { [ID1]: A, [ID2]: B } });

    await expect(
      svc.relocationOptions('u1', {
        startsAt: '2026-10-12T14:30:00.000Z',
        endsAt: '2026-10-12T16:30:00.000Z',
      }),
    ).rejects.toThrow(AppointmentConflictError);
  });

  it('destino livre: kind ok', async () => {
    const A = appt(ID1, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const { svc } = make({ rows: { [ID1]: A } });

    const result = await svc.relocationOptions('u1', {
      startsAt: '2026-10-12T18:00:00.000Z',
      endsAt: '2026-10-12T19:00:00.000Z',
    });
    expect(result.kind).toBe('ok');
  });

  it('e2e do ramo blocked: controller devolve 409 {message, conflictWith} e NUNCA 500 (bug do smoke)', async () => {
    // regressão: relocation-options com 2+ conflitos lançava ConflictError sem
    // handler no controller → 500 cru. O corpo é o mesmo shape do check-conflict.
    const { AppointmentsController } = await import('./appointments.controller');
    const A = appt(ID1, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const B = appt(ID2, '2026-10-12T16:00:00Z', '2026-10-12T17:00:00Z');
    const { svc } = make({ rows: { [ID1]: A, [ID2]: B } });
    const ctrl = new AppointmentsController(svc);

    await expect(
      ctrl.relocationOptions(
        { id: 'u1' },
        {
          startsAt: '2026-10-12T14:30:00.000Z',
          endsAt: '2026-10-12T16:30:00.000Z',
        },
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({ conflictWith: expect.objectContaining({ id: ID1 }) }),
    });
  });
});

describe('AppointmentsService.reschedule — variante move', () => {
  it('destino livre (sem otherId): update único do movido, outbox re-materializado', async () => {
    const M = appt(ID1, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const { svc, calls, invalidateForAppointment } = make({ rows: { [ID1]: M } });

    const res = await svc.reschedule('u1', {
      mode: 'move',
      movedId: ID1,
      newStart: '2026-10-12T18:00:00.000Z',
      newEnd: '2026-10-12T19:00:00.000Z',
    });

    expect(calls).toContain('tx.update:' + ID1);
    expect(invalidateForAppointment).toHaveBeenCalled();
    expect(calls.indexOf('outbox.materialize')).toBeLessThan(calls.indexOf('outbox.enqueue'));
    expect(calls.indexOf('outbox.enqueue')).toBeGreaterThan(calls.indexOf('tx.commit'));
    expect(res.other).toBeNull();
  });

  it('com otherId: os DOIS são gravados na MESMA tx e os dois lados mudados re-materializam', async () => {
    const M = appt(ID1, '2026-10-12T14:30:00Z', '2026-10-12T15:30:00Z');
    const O = appt(ID2, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const { svc, calls } = make({ rows: { [ID1]: M, [ID2]: O } });

    // destino = lugar atual do outro; jogada move-other empurra O para 15:00
    const res = await svc.reschedule('u1', {
      mode: 'move',
      movedId: ID1,
      otherId: ID2,
      newStart: '2026-10-12T14:00:00.000Z',
      newEnd: '2026-10-12T15:00:00.000Z',
    });

    expect(calls).toContain('tx.update:' + ID1);
    expect(calls).toContain('tx.update:' + ID2);
    // M mudou de instante e O também: materialização para os dois
    expect(calls.filter((c) => c === 'outbox.materialize').length).toBe(2);
    expect(res.other).toBeTruthy();
  });

  it('jogada desfeita por terceiro criado no meio: RelocationNotAvailableError e NADA escrito', async () => {
    const M = appt(ID1, '2026-10-12T14:30:00Z', '2026-10-12T15:30:00Z');
    const O = appt(ID2, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    // C cobre 15:00–20:00: o primeiro vão livre p/ O (60min) passa a ser 20:00
    // — a jogada que o client viu (15:00) não existe mais, e a variante `move`
    // transporta o slot mostrado (otherStart/otherEnd): mudou = recusa (D4).
    const C = appt(ID3, '2026-10-12T15:00:00Z', '2026-10-12T20:00:00Z');
    const { svc, calls } = make({ rows: { [ID1]: M, [ID2]: O, [ID3]: C } });

    await expect(
      svc.reschedule('u1', {
        mode: 'move',
        movedId: ID1,
        otherId: ID2,
        newStart: '2026-10-12T14:00:00.000Z',
        newEnd: '2026-10-12T15:00:00.000Z',
        otherStart: '2026-10-12T15:00:00.000Z',
        otherEnd: '2026-10-12T16:00:00.000Z',
      }),
    ).rejects.toThrow(RelocationNotAvailableError);
    expect(calls).not.toContain('tx.update:' + ID1);
    expect(calls).not.toContain('tx.update:' + ID2);
  });

  it('movedId de outro dono (findFirst sem linha): NotFoundException e nada escrito', async () => {
    const { svc, calls } = make({ rows: {} });
    await expect(
      svc.reschedule('u1', {
        mode: 'move',
        movedId: ID1,
        newStart: '2026-10-12T18:00:00.000Z',
        newEnd: '2026-10-12T19:00:00.000Z',
      }),
    ).rejects.toThrow('Not Found');
    expect(calls).not.toContain('tx.begin');
  });
});

describe('AppointmentsService.reschedule — variante create', () => {
  it('create + otherId: cria e desloca o existente no MESMO request (tx única)', async () => {
    const O = appt(ID2, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const { svc, calls } = make({ rows: { [ID2]: O } });

    const res = await svc.reschedule('u1', {
      mode: 'create',
      create: {
        title: 'Consulta',
        startsAt: '2026-10-12T14:00:00.000Z',
        endsAt: '2026-10-12T15:00:00.000Z',
        notificationRules: [],
      },
      otherId: ID2,
    });

    expect(calls).toContain('tx.create');
    expect(calls).toContain('tx.update:' + ID2);
    expect(calls.indexOf('tx.begin')).toBeLessThan(calls.indexOf('tx.create'));
    expect(res.other).toBeTruthy();
  });
});

describe('AppointmentsService — invariante ADR-0015 (create/update sem override)', () => {
  it('create em conflito: AppointmentConflictError mesmo com a chave force no payload (ignorada)', async () => {
    const A = appt(ID1, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const { svc, calls } = make({ rows: { [ID1]: A } });

    await expect(
      svc.create('u1', {
        title: 'Outro',
        startsAt: '2026-10-12T14:30:00.000Z',
        endsAt: '2026-10-12T15:30:00.000Z',
        force: true,
      }),
    ).rejects.toThrow(AppointmentConflictError);
    expect(calls).not.toContain('tx.create');
  });

  it('update em conflito: AppointmentConflictError e nenhuma escrita', async () => {
    const M = appt(ID1, '2026-10-12T09:00:00Z', '2026-10-12T10:00:00Z');
    const A = appt(ID2, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z');
    const { svc, calls } = make({ rows: { [ID1]: M, [ID2]: A } });

    await expect(
      svc.update('u1', ID1, {
        startsAt: '2026-10-12T14:30:00.000Z',
        endsAt: '2026-10-12T15:30:00.000Z',
      }),
    ).rejects.toThrow(AppointmentConflictError);
    expect(calls).not.toContain('tx.begin');
  });

  it('needs_review sobreposto agora É obstáculo (D6 fecha o bug real A3)', async () => {
    const R = appt(ID2, '2026-10-12T14:00:00Z', '2026-10-12T15:00:00Z', { status: 'needs_review' });
    const { svc } = make({ rows: { [ID2]: R } });

    await expect(
      svc.checkConflict('u1', {
        startsAt: '2026-10-12T14:30:00.000Z',
        endsAt: '2026-10-12T15:30:00.000Z',
      }),
    ).resolves.toMatchObject({ conflict: true });
  });
});
