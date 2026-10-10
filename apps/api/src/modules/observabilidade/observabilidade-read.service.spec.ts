import { NotFoundException } from '@nestjs/common';
import { ObservabilidadeReadService } from './observabilidade-read.service';

/**
 * Leitura de auditoria (Fase 9, spec B5/B6/C4) — jest com mock plano. O que a
 * spec cobra e este spec nao negocia:
 *  - rollout SEM flag: 404 (a rota nao existe — nao vaza nada);
 *  - rollout COM flag: so os PROPRIOS eventos, mesmo se a query pedir outro
 *    userId (identidade nunca vem da query — padrao do repo);
 *  - admin: filtros livres e userId por linha na resposta;
 *  - PATCH rollout: so a flag (.strict), 404 em alvo inexistente.
 */

const ROW = {
  id: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
  type: 'flow_completed',
  stage: 'flow.criado',
  outcome: 'ok',
  metadata: { appointmentId: '3f0f1e2c-2222-4aaa-8bbb-ccccdddd0002' },
  createdAt: new Date('2026-10-09T12:00:00Z'),
  userId: '3f0f1e2c-3333-4aaa-8bbb-ccccdddd0003',
};

function make(opts?: {
  me?: { observabilidadeEventosAtivo: boolean } | null;
  rows?: unknown[];
  total?: number;
}) {
  const botEvent = {
    findMany: jest.fn().mockResolvedValue(opts?.rows ?? [ROW]),
    count: jest.fn().mockResolvedValue(opts?.total ?? 1),
  };
  const user = {
    findUnique: jest
      .fn()
      .mockResolvedValue(opts?.me === undefined ? { observabilidadeEventosAtivo: true } : opts.me),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const llmCall = {
    groupBy: jest.fn().mockResolvedValue([
      {
        purpose: 'intent_classification',
        _count: { _all: 3 },
        _sum: { inputTokens: 300, outputTokens: 150, costUsdMicros: 1050 },
      },
      {
        purpose: 'scheduling_extraction',
        _count: { _all: 2 },
        _sum: { inputTokens: null, outputTokens: null, costUsdMicros: null },
      },
    ]),
  };
  const prisma = {
    botEvent,
    user,
    llmCall,
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  const svc = new ObservabilidadeReadService(prisma as never);
  return { svc, botEvent, user, llmCall, prisma };
}

describe('ObservabilidadeReadService.listBotEvents (B5/B6)', () => {
  it('rollout SEM flag: 404 — a rota nao existe para o chamador', async () => {
    const { svc, botEvent } = make({ me: { observabilidadeEventosAtivo: false } });
    await expect(svc.listBotEvents({ id: 'u1', isAdmin: false }, {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(botEvent.findMany).not.toHaveBeenCalled();
  });

  it('rollout COM flag: forca o userId do TOKEN mesmo com outro userId na query', async () => {
    const { svc, botEvent } = make();
    const OTHER = '3f0f1e2c-9999-4aaa-8bbb-ccccdddd9999';
    await svc.listBotEvents({ id: 'u1', isAdmin: false }, { userId: OTHER });
    const where = botEvent.findMany.mock.calls[0]![0]!.where;
    expect(where.userId).toBe('u1'); // o userId da query foi IGNORADO
  });

  it('rollout: resposta sem campo userId por linha (so a visao admin marca dono)', async () => {
    const { svc } = make();
    const res = await svc.listBotEvents({ id: 'u1', isAdmin: false }, {});
    expect(res.items[0]).not.toHaveProperty('userId');
  });

  it('admin: filtros livres (type/from) e userId por linha na resposta', async () => {
    const { svc, botEvent } = make();
    const res = await svc.listBotEvents(
      { id: 'admin', isAdmin: true },
      { type: 'flow_completed', from: '2026-10-01T00:00:00Z' },
    );
    const where = botEvent.findMany.mock.calls[0]![0]!.where;
    expect(where.type).toBe('flow_completed');
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    expect(res.items[0]).toHaveProperty('userId', '3f0f1e2c-3333-4aaa-8bbb-ccccdddd0003');
    expect(res.total).toBe(1);
  });

  it('query invalida (type inventado / limit acima do teto) vira ZodError', async () => {
    const { svc } = make();
    await expect(
      svc.listBotEvents({ id: 'admin', isAdmin: true }, { type: 'usuario_inventou' }),
    ).rejects.toThrow();
    await expect(
      svc.listBotEvents({ id: 'admin', isAdmin: true }, { limit: '9999' }),
    ).rejects.toThrow();
  });

  it('paginacao: take/skip dos defaults do zod (50/0)', async () => {
    const { svc, botEvent } = make();
    await svc.listBotEvents({ id: 'admin', isAdmin: true }, {});
    const arg = botEvent.findMany.mock.calls[0]![0]!;
    expect(arg).toMatchObject({ take: 50, skip: 0, orderBy: { createdAt: 'desc' } });
  });
});

describe('ObservabilidadeReadService.llmUsage (C4 — admin-only)', () => {
  it('agrupa por purpose (default) com soma inteira e callsWithoutUsage nas linhas sem tokens', async () => {
    const { svc, llmCall } = make();
    const res = await svc.llmUsage({});
    expect(llmCall.groupBy.mock.calls[0]![0]!.by).toEqual(['purpose']);
    expect(res.buckets).toHaveLength(2);
    expect(res.buckets[0]).toEqual({
      key: 'intent_classification',
      calls: 3,
      inputTokens: 300,
      outputTokens: 150,
      costUsdMicros: 1050,
      callsWithoutUsage: 0,
    });
    // linhas sem custo somado => denuncia custo parcial
    expect(res.buckets[1]).toMatchObject({
      key: 'scheduling_extraction',
      calls: 2,
      costUsdMicros: 0,
      callsWithoutUsage: 2,
    });
  });

  it('groupBy=user agrupa por userId (uuid; null vira "sem_usuario")', async () => {
    const { svc, llmCall } = make();
    llmCall.groupBy.mockResolvedValueOnce([
      {
        userId: 'u1',
        _count: { _all: 1 },
        _sum: { inputTokens: 1, outputTokens: 1, costUsdMicros: 5 },
      },
      {
        userId: null,
        _count: { _all: 1 },
        _sum: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
      },
    ]);
    const res = await svc.llmUsage({ groupBy: 'user' });
    expect(llmCall.groupBy.mock.calls[0]![0]!.by).toEqual(['userId']);
    // ordem contratada (P2-5): custo 5 (u1) antes de custo 0 (sem_usuario)
    expect(res.buckets.map((b) => b.key)).toEqual(['u1', 'sem_usuario']);
  });

  // P1-6 do review: isolamento de bucket — o caminho da KEY (null→"sem_usuario"
  // fica por ultimo no sort) e da leitura de tokens NAO pode contaminar outro
  // bucket. Um unico grupo com dados completos + assertions exatas.
  it('bucket unico: soma inteira isolada do bucket null (chave e leitura independentes)', async () => {
    const { svc, llmCall } = make();
    llmCall.groupBy.mockResolvedValueOnce([
      {
        userId: null,
        _count: { _all: 4 },
        _sum: { inputTokens: 8, outputTokens: 4, costUsdMicros: null },
      },
      {
        userId: 'u7',
        _count: { _all: 2 },
        _sum: { inputTokens: 100, outputTokens: 50, costUsdMicros: 350 },
      },
    ]);
    const res = await svc.llmUsage({ groupBy: 'user' });
    // ordem contratada: maior custo primeiro (P2-5) — u7 (350) antes do null (0)
    expect(res.buckets.map((b) => b.key)).toEqual(['u7', 'sem_usuario']);
    expect(res.buckets[0]).toEqual({
      key: 'u7',
      calls: 2,
      inputTokens: 100,
      outputTokens: 50,
      costUsdMicros: 350,
      callsWithoutUsage: 0,
    });
    // bucket null: custo null vira 0 na soma + denuncia as 4 chamadas sem usage
    expect(res.buckets[1]).toEqual({
      key: 'sem_usuario',
      calls: 4,
      inputTokens: 8,
      outputTokens: 4,
      costUsdMicros: 0,
      callsWithoutUsage: 4,
    });
  });

  // P2-4: sem `from` o escopo default sao os ultimos 90 dias (auditavel)
  it('sem from: where cria gte default de ~90 dias atras', async () => {
    const { svc, llmCall } = make();
    llmCall.groupBy.mockResolvedValueOnce([]);
    await svc.llmUsage({});
    const where = llmCall.groupBy.mock.calls[0]![0]!.where;
    expect(where.createdAt.gte).toBeInstanceOf(Date);
    const ageMs = Date.now() - (where.createdAt.gte as Date).getTime();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    expect(ageMs).toBeGreaterThanOrEqual(ninetyDays - 60_000);
    expect(ageMs).toBeLessThanOrEqual(ninetyDays + 60_000);
  });
});

describe('ObservabilidadeReadService.setRollout (B6)', () => {
  it('grava somente a flag', async () => {
    const { svc, user } = make();
    const res = await svc.setRollout('u2', { observabilidadeEventosAtivo: true });
    expect(user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u2' },
      data: { observabilidadeEventosAtivo: true },
    });
    expect(res).toEqual({ userId: 'u2', observabilidadeEventosAtivo: true });
  });

  it('qualquer outro campo no body e rejeitado (.strict — isAdmin nao passa)', async () => {
    const { svc, user } = make();
    await expect(
      svc.setRollout('u2', { observabilidadeEventosAtivo: true, isAdmin: true }),
    ).rejects.toThrow();
    expect(user.updateMany).not.toHaveBeenCalled();
  });

  it('alvo inexistente (count 0) vira 404', async () => {
    const { svc, user } = make();
    user.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      svc.setRollout('nao-existe', { observabilidadeEventosAtivo: false }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ObservabilidadeReadService.meFlags / listUsers (pagina Admin da web)', () => {
  it('meFlags: flags lidos da FONTE (web decide a rota com isto)', async () => {
    const { svc, user } = make();
    user.findUnique.mockResolvedValueOnce({ isAdmin: true, observabilidadeEventosAtivo: false });
    const res = await svc.meFlags('u1');
    expect(user.findUnique.mock.calls[0]![0]!.select).toEqual({
      isAdmin: true,
      observabilidadeEventosAtivo: true,
    });
    expect(res).toEqual({ isAdmin: true, observabilidadeEventosAtivo: false });
  });

  it('meFlags: usuario inexistente no banco NAO explode — flags false', async () => {
    const { svc } = make({ me: null });
    await expect(svc.meFlags('fantasma')).resolves.toEqual({
      isAdmin: false,
      observabilidadeEventosAtivo: false,
    });
  });

  it('listUsers: select minimo (nunca passwordHash), ordem estavel, shape do contracts', async () => {
    const { svc, user } = make();
    user.findMany.mockResolvedValueOnce([
      {
        id: '3f0f1e2c-1111-4aaa-8bbb-ccccdddd0001',
        email: 'admin@example.com',
        name: 'Admin',
        isAdmin: true,
        observabilidadeEventosAtivo: true,
        createdAt: new Date('2026-10-01T00:00:00Z'),
      },
    ]);
    const res = await svc.listUsers();
    const arg = user.findMany.mock.calls[0]![0]!;
    expect(arg.orderBy).toEqual({ createdAt: 'asc' });
    expect(Object.keys(arg.select).sort()).toEqual(
      ['createdAt', 'email', 'id', 'isAdmin', 'name', 'observabilidadeEventosAtivo'].sort(),
    );
    expect(res.items[0]).toMatchObject({ email: 'admin@example.com', isAdmin: true });
  });
});
