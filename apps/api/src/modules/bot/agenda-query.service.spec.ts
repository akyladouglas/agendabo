import { AgendaQueryService, AGENDA_QUERY_MAX_LIST } from './agenda-query.service';
import type { ConsultaPeriodo } from '../ai/consulta-interpreter.service';
import type { BotUser } from './bot-access.service';

/**
 * AgendaQueryService (Fase 2): orquestração do turno de leitura com bordas mockadas
 * (LLM interpretador + banco). Casos: símbolos (via stub do interpretador que devolve
 * o resultado já classificado), intervalo explícito, vazio, truncamento (decisão #4),
 * agregado (decisão #8), falha do interpretador => pergunta (spec #5).
 */

const USER: BotUser = { id: 'u1', telegramId: '111', timezone: 'America/Sao_Paulo', name: null };
const NOW = new Date('2026-10-07T11:00:00Z'); // 08:00 local SP
const OFFSET = -180;

function make(interpreterResult: ConsultaPeriodo) {
  const findMany = jest.fn().mockResolvedValue([]);
  const interpreter = { interpret: jest.fn().mockResolvedValue(interpreterResult) };
  const appointments = { listOverlapping: jest.fn().mockResolvedValue([]) };
  const svc = new AgendaQueryService(interpreter as never, appointments as never);
  const run = (text = 'o que tenho hoje?') =>
    svc.run(USER, { text, offsetMinutes: OFFSET, now: NOW });
  return { svc, run, findMany, interpreter, appointments };
}

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    title: `Compromisso ${i + 1}`,
    startsAt: new Date(`2026-10-0${(i % 3) + 7}T12:00:00Z`),
    endsAt: new Date(`2026-10-0${(i % 3) + 7}T13:00:00Z`),
    status: 'confirmed',
  }));

describe('AgendaQueryService', () => {
  it('símbolo "hoje": resolve no tz do usuário, lista e formata no cabeçalho (spec #9)', async () => {
    const { run, appointments } = make({ ok: true, simbolo: 'hoje', confidence: 0.95 });
    appointments.listOverlapping.mockResolvedValue([
      {
        id: 'a1',
        title: 'Consulta dentista',
        startsAt: new Date('2026-10-07T15:00:00Z'), // 12:00 local
        endsAt: new Date('2026-10-07T16:00:00Z'), // 13:00 local
        status: 'confirmed',
      },
    ]);

    const result = await run();

    // meia-noite local SP = 03:00Z (ADR-002): nunca 00:00Z
    expect(appointments.listOverlapping).toHaveBeenCalledWith(
      'u1',
      new Date('2026-10-07T03:00:00Z'),
      new Date('2026-10-08T03:00:00Z'),
      ['confirmed', 'needs_review'],
    );
    expect(result.awaitingPeriod).toBe(false);
    expect(result.replies[0]).toContain('Isto é o que você tem em 07/10:');
    expect(result.replies[0]).toContain('12:00–13:00 — Consulta dentista');
    expect(result.replies).toHaveLength(1);
  });

  it('intervalo explícito: datas locais -> UTC meia-noite local (spec #6)', async () => {
    const { run, appointments } = make({
      ok: true,
      intervalo: { from: '2026-10-10', to: '2026-10-13' },
      confidence: 0.9,
    });

    await run('o que tenho de 10 a 12?');

    expect(appointments.listOverlapping).toHaveBeenCalledWith(
      'u1',
      new Date('2026-10-10T03:00:00Z'),
      new Date('2026-10-13T03:00:00Z'),
      ['confirmed', 'needs_review'],
    );
  });

  it('vazio: mensagem de vazio e NADA mais (spec #10)', async () => {
    const { run } = make({ ok: true, simbolo: 'amanha', confidence: 0.9 });

    const result = await run('amanhã?');

    expect(result.replies).toEqual(['Você não tem nada nesse período 👌']);
  });

  it(`muitos resultados: truncar em ${AGENDA_QUERY_MAX_LIST} e oferecer o resto (decisão #4)`, async () => {
    const { run, appointments } = make({ ok: true, simbolo: 'este_mes', confidence: 0.9 });
    appointments.listOverlapping.mockResolvedValue(rows(12));

    const result = await run();

    expect(result.replies).toHaveLength(2);
    expect(result.replies[0]).toContain('Compromisso 10');
    expect(result.replies[0]).not.toContain('Compromisso 11');
    expect(result.replies[1]).toContain('E mais 2');
  });

  it('período muito amplo (>=30): resposta agregada com contagem (decisão #8)', async () => {
    const { run, appointments } = make({ ok: true, simbolo: 'este_ano', confidence: 0.9 });
    appointments.listOverlapping.mockResolvedValue(rows(34));

    const result = await run();

    expect(result.replies).toHaveLength(1);
    expect(result.replies[0]).toContain('34 compromissos');
    expect(result.replies[0]).toContain('mês a mês');
    expect(result.replies[0]).not.toContain('Compromisso 11');
  });

  it('interpretador falhou (confiança baixa): PERGUNTA o período, nenhuma query ao banco (spec #5)', async () => {
    const { run, appointments } = make({ ok: false, reason: 'low_confidence' });

    const result = await run('meus compromissos');

    expect(result.awaitingPeriod).toBe(true);
    expect(result.replies[0]).toContain('Para qual período');
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
  });

  it('interpretador devolveu intervalo inválido: pergunta, não chuta (ADR-003)', async () => {
    // o serviço recebe o resultado normalizado; o caso "to < from" é rejeitado na
    // camada pura — simulamos o guard pedindo o período de volta.
    const { run, appointments } = make({
      ok: true,
      intervalo: { from: '2026-10-12', to: '2026-10-11' },
      confidence: 0.9,
    });

    const result = await run();

    expect(result.awaitingPeriod).toBe(true);
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
  });

  it('fora_do_escopo no interpretador: pergunta educadamente (a intent já roteou)', async () => {
    const { run } = make({ ok: false, reason: 'fora_do_escopo' });

    const result = await run('blz?');

    expect(result.awaitingPeriod).toBe(true);
    expect(result.replies[0]).toContain('Para qual período');
  });

  it('needs_review aparece com o marcador; confirmed sem (decisão #3)', async () => {
    const { run, appointments } = make({ ok: true, simbolo: 'hoje', confidence: 0.9 });
    appointments.listOverlapping.mockResolvedValue([
      {
        id: 'a1',
        title: 'Aprovado',
        startsAt: new Date('2026-10-07T12:00:00Z'),
        endsAt: new Date('2026-10-07T13:00:00Z'),
        status: 'confirmed',
      },
      {
        id: 'a2',
        title: 'Dentista <10>',
        startsAt: new Date('2026-10-07T14:00:00Z'),
        endsAt: new Date('2026-10-07T15:00:00Z'),
        status: 'needs_review',
      },
    ]);

    const result = await run();

    expect(result.replies[0]).toContain('Aprovado');
    expect(result.replies[0]).toContain('⚠️ conferindo');
    // gotcha 6: título dinâmico com < precisa chegar escapado no HTML do Telegram
    expect(result.replies[0]).toContain('Dentista &lt;10&gt;');
  });
});

// ---------------------------------------------------------------------------
// alvo compartilhado (spec compartilhamento E.24, decisão D6)
// ---------------------------------------------------------------------------

const OWNER_LINK = { id: 'link-a', ownerId: 'dono-ana', ownerName: 'Ana Souza' };
const OWNER_LINK2 = { id: 'link-b', ownerId: 'dono-ana2', ownerName: 'Ana Souza' };

function makeShared(
  interpreterResult: ConsultaPeriodo,
  fx: { links?: { id: string; ownerId: string; ownerName: string | null }[]; linksFail?: boolean } = {},
) {
  const interpreter = { interpret: jest.fn().mockResolvedValue(interpreterResult) };
  // T3 (review): o mock HONRA o argumento de statuses (como o service real) e a
  // cena do dono tem um needs_review. Se o bot regredir e pedir os statuses
  // completos (ou esquecer o filtro), o needs_review volta na lista e o ⚠️
  // aparece — os asserts `not.toContain('⚠️')` passam a FALHAR de verdade.
  const ownerRows: Record<string, unknown>[] = [
    {
      id: 'x1',
      title: 'Reunião',
      startsAt: new Date('2026-10-08T15:00:00Z'), // 12:00 local do CONVIDADO
      endsAt: new Date('2026-10-08T16:00:00Z'),
      status: 'confirmed',
    },
    {
      id: 'x2',
      title: 'Segredo do dono',
      startsAt: new Date('2026-10-08T17:00:00Z'),
      endsAt: new Date('2026-10-08T18:00:00Z'),
      status: 'needs_review',
    },
  ];
  const appointments = {
    listOverlapping: jest.fn(
      async (_userId: string, _from: Date, _to: Date, statuses?: string[]) =>
        statuses ? ownerRows.filter((r) => statuses.includes(String(r.status))) : ownerRows,
    ),
  };
  const sharedAgendas = {
    activeIncomingLinks: jest.fn(async () => {
      if (fx.linksFail) throw new Error('banco caiu');
      return fx.links ?? [];
    }),
  };
  const auditEvents: Record<string, unknown>[] = [];
  const sharedAudit = {
    registrar: jest.fn(async (actorId: string | null, kind: string, ctx: Record<string, unknown>) => {
      auditEvents.push({ actorId, kind, ...ctx });
    }),
  };
  const svc = new AgendaQueryService(
    interpreter as never,
    appointments as never,
    sharedAgendas as never,
    sharedAudit as never,
  );
  const run = (text = 'como está a agenda da Ana Souza amanhã?') =>
    svc.run(USER, { text, offsetMinutes: OFFSET, now: NOW });
  return { svc, run, interpreter, appointments, sharedAgendas, auditEvents };
}

describe('AgendaQueryService — alvo compartilhado (E.24)', () => {
  const sharedOk: ConsultaPeriodo = {
    ok: true,
    simbolo: 'amanha',
    confidence: 0.9,
    alvo: 'compartilhada',
    alvo_nome: 'Ana Souza',
  };

  it('single: lista os confirmed do DONO no mesmo período (sem needs_review), cabeçalho com a fonte, tz do convidado', async () => {
    // T3: o mock honra `statuses` e a cena tem um needs_review do dono — o
    // resultado PROVA o filtro (com a regressão, o ⚠️ aparece e isto falha).
    const { run, appointments, auditEvents } = makeShared(sharedOk, { links: [OWNER_LINK] });

    const result = await run();

    // a query é do DONO, só confirmed (B.13 — needs_review do dono é invisível)
    expect(appointments.listOverlapping).toHaveBeenCalledWith(
      'dono-ana',
      new Date('2026-10-08T03:00:00Z'),
      new Date('2026-10-09T03:00:00Z'),
      ['confirmed'],
    );
    expect(result.awaitingPeriod).toBe(false);
    expect(result.count).toBe(1);
    expect(result.replies[0]).toContain('Isto é o que Ana Souza tem em 08/10:');
    expect(result.replies[0]).toContain('12:00–13:00 — Reunião');
    expect(result.replies[0]).not.toContain('⚠️'); // sem marcador no emprestado
    expect(result.replies[0]).not.toContain('Segredo do dono'); // needs_review nunca vaza (T3)
    // F.4: access_read na consulta do bot também (mesmo evento da web)
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      kind: 'access_read',
      actorId: 'u1',
      ownerId: 'dono-ana',
      metadata: { count: 1 },
    });
  });

  it('single vazio: mensagem de vazio (a mesma da consulta própria)', async () => {
    const { run, appointments } = makeShared(sharedOk, { links: [OWNER_LINK] });
    appointments.listOverlapping.mockResolvedValue([]); // cena sem nada no período
    const result = await run();
    expect(result.replies).toEqual(['Você não tem nada nesse período 👌']);
    expect(result.count).toBe(0);
  });

  it('single com muitos: truncar em 10 com a MESMA régua (decisão #4 vale p/ emprestada)', async () => {
    const { run, appointments } = makeShared(
      { ...sharedOk, simbolo: 'este_mes' },
      { links: [OWNER_LINK] },
    );
    appointments.listOverlapping.mockResolvedValue(rows(12));
    const result = await run();
    expect(result.replies).toHaveLength(2);
    expect(result.replies[0]).toContain('Compromisso 10');
    expect(result.replies[0]).not.toContain('Compromisso 11');
    expect(result.replies[1]).toContain('E mais 2');
  });

  it('ambiguous (N vínculos casam): lista numerada e NENHUMA query ao banco (nunca chuta)', async () => {
    const { run, appointments } = makeShared(sharedOk, { links: [OWNER_LINK, OWNER_LINK2] });
    const result = await run();
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
    expect(result.awaitingPeriod).toBe(false);
    expect(result.replies[0]).toContain('1. Ana Souza');
    expect(result.replies[0]).toContain('2. Ana Souza');
    expect(result.replies[0]).toContain('Responda com o número');
  });

  it('ambiguous escapa o nome do dono (gotcha 6)', async () => {
    const { run } = makeShared(
      {
        ok: true,
        simbolo: 'amanha',
        confidence: 0.9,
        alvo: 'compartilhada',
        alvo_nome: 'ana <x>',
      },
      {
        links: [
          { id: 'l1', ownerId: 'o1', ownerName: 'Ana <x>' },
          { id: 'l2', ownerId: 'o2', ownerName: 'ana <x>' },
        ],
      },
    );
    const result = await run('a agenda da ana <x> amanhã?');
    expect(result.replies[0]).toContain('Ana &lt;x&gt;');
    expect(result.replies[0]).not.toContain('<x>');
  });

  it('none com nome dito (0 vínculos que casam): "sem acesso", sem query', async () => {
    const { run, appointments } = makeShared(sharedOk, { links: [] });
    const result = await run();
    expect(result.replies).toEqual(['Você não tem essa agenda compartilhada.']);
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
  });

  it('alvo duvidoso (compartilhada SEM nome): pergunta "De qual agenda?" e nunca chuta', async () => {
    const { run, appointments } = makeShared(
      { ok: true, simbolo: 'amanha', confidence: 0.9, alvo: 'compartilhada' },
      { links: [OWNER_LINK] },
    );
    const result = await run('como está a agenda compartilhada amanhã?');
    expect(result.replies[0]).toContain('De qual agenda?');
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
  });

  it('leitura de vínculos falhou: "sem acesso" conservador, nunca a agenda própria no chute', async () => {
    const { run, appointments } = makeShared(sharedOk, { links: [OWNER_LINK], linksFail: true });
    const result = await run();
    expect(result.replies).toEqual(['Você não tem essa agenda compartilhada.']);
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
  });

  it('alvo ausente no ok:true: caminho EXATO de hoje — vínculos nem são lidos (regressão zero)', async () => {
    const { run, appointments, sharedAgendas } = makeShared(
      { ok: true, simbolo: 'hoje', confidence: 0.95 },
      { links: [OWNER_LINK] },
    );
    await run('o que tenho hoje?');
    expect(sharedAgendas.activeIncomingLinks).not.toHaveBeenCalled();
    expect(appointments.listOverlapping).toHaveBeenCalledWith(
      'u1',
      expect.any(Date),
      expect.any(Date),
      ['confirmed', 'needs_review'],
    );
  });

  it("alvo 'minha' explícito: também o caminho de hoje", async () => {
    const { run, sharedAgendas } = makeShared(
      { ok: true, simbolo: 'hoje', confidence: 0.95, alvo: 'minha' },
      { links: [OWNER_LINK] },
    );
    await run();
    expect(sharedAgendas.activeIncomingLinks).not.toHaveBeenCalled();
  });

  it('interpretação FALHA (low_confidence) com alvo na fala: pergunta o PERÍODO como hoje (sem regressão no awaitingPeriod)', async () => {
    const { run, sharedAgendas } = makeShared({ ok: false, reason: 'low_confidence' }, { links: [OWNER_LINK] });
    const result = await run('a agenda da Ana amanhã?');
    expect(result.awaitingPeriod).toBe(true);
    expect(result.replies[0]).toContain('Para qual período');
    expect(sharedAgendas.activeIncomingLinks).not.toHaveBeenCalled();
  });

  it('service sem SharedAgendasService injetado: alvo compartilhado => "sem acesso" (fail-closed)', async () => {
    const interpreter = {
      interpret: jest.fn().mockResolvedValue(sharedOk),
    };
    const appointments = { listOverlapping: jest.fn().mockResolvedValue([]) };
    const svc = new AgendaQueryService(interpreter as never, appointments as never);
    const result = await svc.run(USER, { text: 'x', offsetMinutes: OFFSET, now: NOW });
    expect(result.replies).toEqual(['Você não tem essa agenda compartilhada.']);
    expect(appointments.listOverlapping).not.toHaveBeenCalled();
  });
});
