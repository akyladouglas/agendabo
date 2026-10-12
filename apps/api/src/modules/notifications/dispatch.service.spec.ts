import { ConfigService } from '@nestjs/config';
import { DispatchService, STALE_ERROR } from './dispatch.service';
import type { Env } from '../../config/env.validation';

/**
 * Lógica de disparo do worker (Fase 3, spec regras 11–14/17–18). Prisma, Telegram e
 * relógio entram mockados/injetados; fuso via `offsetProvider` (nada de Intl real).
 *
 * Cenário: America/Sao_Paulo (-03:00); NOW = 08/10 12:00Z (09:00 local).
 */

const NOW = new Date('2026-10-08T12:00:00Z');
const OFFSET = -180;

interface RowFixtures {
  outbox?: Record<string, unknown> | null;
  appointments?: Record<string, unknown>[];
  dueReminders?: Record<string, unknown>[];
  /** Vínculos recebidos ativos devolvidos pelo SharedAgendasService (E.23). */
  incomingLinks?: { id: string; ownerId: string; ownerName: string | null }[];
  /** Compromissos por dono (chave ownerId) para a carga das seções. */
  ownerAppointments?: Record<string, Record<string, unknown>[]>;
  /** true = não injeta SharedAgendasService (comportamento pré-E.23 — regressão). */
  noShared?: boolean;
  /** true = activeIncomingLinks/consulta de dono lança (a seção deve sumir, o digest não). */
  sharedFail?: boolean;
}

function make(rowFixtures: RowFixtures, telegramFail = false) {
  const updates: Record<string, unknown>[] = [];
  const sent: { chatId: string; text: string }[] = [];
  const ownerQueries: { ownerId: string; where: Record<string, unknown> }[] = [];
  const prisma = {
    notificationOutbox: {
      findUnique: async () => rowFixtures.outbox ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where?: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const current = rowFixtures.outbox as Record<string, unknown> | null;
        if (!current) return { count: 0 };
        // `where` no teste é sempre { id, status? } — o status só vale enquanto bate
        if (where?.status !== undefined && where.status !== current.status) return { count: 0 };
        const set = { ...data };
        delete set.attempts; // increment: o mock só registra a intenção, sem aritmética
        // sem `where.status` (updates de lastError/failed), o update é incondicional:
        // é assim que a última tentativa marca `failed` numa linha que o claim já marcara sent
        updates.push(set);
        Object.assign(current, set);
        return { count: 1 };
      },
      findMany: async () => rowFixtures.dueReminders ?? [],
    },
    appointment: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        const whereUserId = args.where.userId;
        if (whereUserId === 'u1') return rowFixtures.appointments ?? [];
        // carga compartilhada (M6): `userId: { in: [donos] }` com o WHERE
        // registrado p/ asserção. O mock espelha o banco: filtra PELA MESMA
        // lista do `in` (donos duplicados = uma linha, como o `in` real) e
        // devolve o select do service (id/título/início/fim + userId — é com o
        // userId CRU que o service agrupa por dono antes de montar a seção).
        // carga compartilhada (M6): `userId: { in: [donos] }` com o WHERE
        // registrado p/ asserção. O mock espelha o banco: respeita o `in`,
        // APLICA a interseção half-open do where (é o where do service que
        // decide o que toca o dia — M5; um where de contenção cortaria o
        // Virada/Jantar-vira e os asserts de corpo pegariam) e devolve o
        // select do service (id/título/início/fim + userId — é com o userId
        // CRU que o service agrupa por dono antes de montar a seção).
        const ownerIds = (whereUserId as { in: string[] }).in;
        ownerQueries.push({ ownerId: ownerIds.join(','), where: args.where });
        if (rowFixtures.sharedFail) throw new Error('banco compartilhado caiu');
        const startsLt = (args.where.startsAt as { lt: Date }).lt.getTime();
        const endsGte = (args.where.endsAt as { gte: Date }).gte.getTime();
        const rows: Record<string, unknown>[] = [];
        for (const ownerId of new Set(ownerIds)) {
          for (const row of rowFixtures.ownerAppointments?.[ownerId] ?? []) {
            const { id, title, startsAt, endsAt } = row as Record<string, unknown>;
            if (!((startsAt as Date).getTime() < startsLt && (endsAt as Date).getTime() >= endsGte))
              continue;
            rows.push({ id, title, startsAt, endsAt, userId: ownerId });
          }
        }
        return rows;
      },
    },
  };
  const telegram = {
    sendMessage: async (chatId: string, text: string) => {
      if (telegramFail) throw new Error('telegram 429');
      sent.push({ chatId, text });
    },
  };
  const config = {
    get: (key: keyof Env) =>
      ({ NOTIFY_MAX_ATTEMPTS: 3, NOTIFY_STALE_MINUTES: 30 })[key as 'NOTIFY_MAX_ATTEMPTS'],
  } as unknown as ConfigService<Env, true>;
  const auditEvents: Record<string, unknown>[] = [];
  const sharedAgendas = rowFixtures.noShared
    ? undefined
    : ({
        activeIncomingLinks: async () => {
          if (rowFixtures.sharedFail) throw new Error('vínculos falharam');
          return rowFixtures.incomingLinks ?? [];
        },
      } as never);
  const sharedAudit = {
    registrar: async (actorId: string | null, kind: string, ctx: Record<string, unknown>) => {
      auditEvents.push({ actorId, kind, ...ctx });
    },
  } as never;

  const svc = new DispatchService(prisma as never, telegram as never, config, sharedAgendas, sharedAudit);
  svc.offsetProvider = () => OFFSET;
  // relógio da borda do service fixo (testing.md): dispatch sem 2º argumento usa este now
  (svc as unknown as { now: () => Date }).now = () => NOW;
  return { svc, prisma, updates, sent, ownerQueries, auditEvents };
}

function reminderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'o1',
    kind: 'reminder',
    firesAt: new Date('2026-10-08T12:00:00Z'),
    status: 'pending',
    attempts: 0,
    ruleType: 'before_hours',
    appointment: {
      id: 'a1',
      title: 'Consulta <dr>',
      startsAt: new Date('2026-10-08T17:00:00Z'), // 14:00 local
      endsAt: new Date('2026-10-08T18:00:00Z'),
      notes: 'levar exame',
      status: 'confirmed',
    },
    user: {
      id: 'u1',
      telegramId: '111',
      emailConfirmedAt: new Date('2026-01-01T00:00:00Z'),
      timezone: 'America/Sao_Paulo',
      name: null,
    },
    ...overrides,
  };
}

describe('DispatchService.dispatch — lembrete', () => {
  it('linha pending boa => claim pending→sent + envio com título/quando/antecedência (spec 13)', async () => {
    // firesAt = 16:00Z (13:00 local) = startsAt - 1h => "daqui a 4 horas" a partir das 12:00Z
    const row = reminderRow({ firesAt: new Date('2026-10-08T16:00:00Z') });
    const { svc, sent, updates } = make({ outbox: row });
    const result = await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'sent' });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.chatId).toBe('111');
    expect(sent[0]!.text).toContain('Consulta &lt;dr&gt;'); // escape HTML no worker (gotcha 6)
    expect(sent[0]!.text).toContain('qui 08/10 às 14:00');
    expect(sent[0]!.text).toContain('daqui a 4 horas');
    expect(sent[0]!.text).toContain('levar exame');
    const claim = updates.find((u) => u.status === 'sent');
    expect(claim).toBeDefined();
    expect(row.status).toBe('sent');
  });

  it('linha já sent (restart do worker) => no-op, nada é reenviado (spec regra 12)', async () => {
    const { svc, sent } = make({ outbox: reminderRow({ status: 'sent' }) });
    const result = await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'noop', reason: 'not_pending' });
    expect(sent).toHaveLength(0);
  });

  it('linha inexistente (compromisso removido) => no-op not_found (spec regra 12)', async () => {
    const { svc, sent } = make({ outbox: null });
    const result = await svc.dispatch({ outboxId: 'oX' }, NOW);
    expect(result).toEqual({ kind: 'noop', reason: 'not_found' });
    expect(sent).toHaveLength(0);
  });

  it('conta sem email confirmado => cancelled, nada envia (spec regra 12)', async () => {
    const row = reminderRow();
    (row.user as Record<string, unknown>).emailConfirmedAt = null;
    const { svc, sent, updates } = make({ outbox: row });
    const result = await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'cancelled', reason: 'gate_conta' });
    expect(sent).toHaveLength(0);
    expect(updates.some((u) => u.status === 'cancelled' && u.lastError === 'gate_conta')).toBe(
      true,
    );
  });

  it('compromisso needs_review na hora do disparo => cancelled (spec regra 11 / D8)', async () => {
    const row = reminderRow();
    (row.appointment as Record<string, unknown>).status = 'needs_review';
    const { svc, sent } = make({ outbox: row });
    const result = await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'cancelled', reason: 'not_confirmed' });
    expect(sent).toHaveLength(0);
  });

  it('atraso > NOTIFY_STALE_MINUTES => failed atraso_excedido, não envia (spec regra 14)', async () => {
    const row = reminderRow({ firesAt: new Date(NOW.getTime() - 31 * 60_000) });
    const { svc, sent, updates } = make({ outbox: row });
    const result = await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'failed', reason: STALE_ERROR });
    expect(sent).toHaveLength(0);
    expect(updates.some((u) => u.status === 'failed' && u.lastError === STALE_ERROR)).toBe(true);
  });

  it('atraso dentro da janela ainda envia (Redis caiu 10min, nada de perder)', async () => {
    const row = reminderRow({ firesAt: new Date(NOW.getTime() - 10 * 60_000) });
    const { svc, sent } = make({ outbox: row });
    expect(await svc.dispatch({ outboxId: 'o1' }, NOW)).toEqual({ kind: 'sent' });
    expect(sent).toHaveLength(1);
  });

  it('Telegram falha: lança p/ backoff do BullMQ; última tentativa => failed (spec regra 14)', async () => {
    // tentativa 1 de 3: relança (a linha saiu de pending — reenvio paralelo não existe)
    const row1 = reminderRow();
    const { svc: svc1, sent } = make({ outbox: row1 }, true);
    await expect(svc1.dispatch({ outboxId: 'o1' }, NOW)).rejects.toThrow('telegram 429');
    expect(sent).toHaveLength(0);

    // tentativa "3" de 3 no MESMO serviço: esgota NOTIFY_MAX_ATTEMPTS => failed +
    // lastError, SEM relançar (decisão final do dispatch — spec regra 14; o worker
    // BullMQ também marca failed nas tentativas dele, mas o `failed` com lastError
    // é responsabilidade daqui, sem linha pendente eterna)
    const row3 = reminderRow();
    const { svc: svc3, updates } = make({ outbox: row3 }, true);
    await expect(svc3.dispatch({ outboxId: 'o1' }, NOW)).rejects.toThrow('telegram 429');
    row3.status = 'pending'; // simula o job reprocessado após o backoff (2ª tentativa)
    await expect(svc3.dispatch({ outboxId: 'o1' }, NOW)).rejects.toThrow('telegram 429');
    row3.status = 'pending'; // 3ª tentativa idem (no worker real, o job re-entrega e a linha
    // voltaria a ser aceita porque o retry é decisão do dispatch, não do banco — spec 14)
    const result = await svc3.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'failed', reason: 'envio' });
    // o `failed` vem com o motivo no lastError (o "429" já foi logado em cada tentativa)
    expect(updates.some((u) => u.status === 'failed' && u.lastError != null)).toBe(true);
  });
});

describe('DispatchService.dispatch — resumo diário', () => {
  function digestRow(userOverrides: Record<string, unknown> = {}) {
    return reminderRow({
      kind: 'daily_digest',
      appointment: null,
      ruleType: null,
      firesAt: NOW, // digere p/ teste: disparo exatamente no agora
      user: {
        id: 'u1',
        telegramId: '111',
        emailConfirmedAt: new Date('2026-01-01T00:00:00Z'),
        timezone: 'America/Sao_Paulo',
        name: null,
        ...userOverrides,
      },
    });
  }

  it('compromissos do DIA CIVIL local (não UTC) + seção de lembretes vencendo hoje', async () => {
    const { svc, sent } = make({
      outbox: digestRow(),
      appointments: [
        {
          id: 'a1',
          title: 'Consulta',
          startsAt: new Date('2026-10-08T17:00:00Z'), // qui 14:00 local — hoje
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
        {
          id: 'a2',
          title: 'Futruga',
          startsAt: new Date('2026-10-09T17:00:00Z'), // amanhã
          endsAt: new Date('2026-10-09T18:00:00Z'),
        },
        {
          // 02:00Z de 08/10 = 23:00 de QUARTA local: não é do dia civil de hoje
          id: 'a3',
          title: 'Virada',
          startsAt: new Date('2026-10-08T02:00:00Z'),
          endsAt: new Date('2026-10-08T03:00:00Z'),
        },
      ],
      dueReminders: [
        { id: 'o9', appointment: { title: 'Prova', startsAt: new Date('2026-10-20T16:00:00Z') } },
      ],
    });
    const result = await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'sent' });
    const text = sent[0]!.text;
    expect(text).toContain('📋 Resumo de quinta-feira, 08/10');
    expect(text).toContain('Consulta');
    expect(text).not.toContain('Futruga');
    expect(text).not.toContain('Virada');
    expect(text).toContain('Lembrete hoje — "Prova"');
  });

  it('dia livre => "☀️ Hoje você está livre!" (decisão #5)', async () => {
    const { svc, sent } = make({ outbox: digestRow(), appointments: [], dueReminders: [] });
    await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(sent[0]!.text).toBe('☀️ Hoje você está livre!');
  });

  it('resumo com nome: saudação "Bom dia, Ana!" antes do cabeçalho (decisão 7, Fase 5)', async () => {
    const { svc, sent } = make({
      outbox: digestRow({ name: 'Ana' }),
      appointments: [
        {
          id: 'a1',
          title: 'Consulta',
          startsAt: new Date('2026-10-08T17:00:00Z'),
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [],
    });
    await svc.dispatch({ outboxId: 'o1' }, NOW); // NOW = 07:00 local => "Bom dia"
    expect(sent[0]!.text).toContain('Bom dia, Ana!');
    expect(sent[0]!.text).toContain('📋 Resumo de quinta-feira, 08/10');
  });

  it('resumo sem nome mantém o texto vigente (fallback da decisão 7)', async () => {
    const { svc, sent } = make({
      outbox: digestRow(), // user.name = null
      appointments: [
        {
          id: 'a1',
          title: 'Consulta',
          startsAt: new Date('2026-10-08T17:00:00Z'),
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [],
    });
    await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(sent[0]!.text).toContain('Bom dia!');
    expect(sent[0]!.text).not.toMatch(/Bom dia, /);
  });

  it('needs_review não aparece no digest (só confirmed passa no WHERE — spec regra 11)', async () => {
    // o WHERE do findMany é status confirmed; o teste abaixo passa a carga JÁ filtrada
    // como a produção entrega (mock devolve só o que o filtro pegaria)
    const { svc, sent } = make({
      outbox: digestRow(),
      appointments: [
        {
          id: 'ok',
          title: 'Confirmado',
          startsAt: new Date('2026-10-08T17:00:00Z'),
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [],
    });
    await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(sent[0]!.text).toContain('Confirmado');
    expect(sent[0]!.text).not.toContain('revisão');
  });

  // ---------- E.23/D8: seções compartilhadas no corpo (vínculos recebidos ativos) ----------

  it('zero vínculos recebidos: corpo IDÊNTICO ao de hoje (regressão zero, sem audit)', async () => {
    const withSvc = make({
      outbox: digestRow(),
      appointments: [
        {
          id: 'a1',
          title: 'Consulta',
          startsAt: new Date('2026-10-08T17:00:00Z'),
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [],
      incomingLinks: [],
    });
    const legacy = make({
      outbox: digestRow(),
      appointments: [
        {
          id: 'a1',
          title: 'Consulta',
          startsAt: new Date('2026-10-08T17:00:00Z'),
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [],
      noShared: true,
    });
    await withSvc.svc.dispatch({ outboxId: 'o1' }, NOW);
    await legacy.svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(withSvc.sent[0]!.text).toBe(legacy.sent[0]!.text);
    expect(withSvc.auditEvents).toHaveLength(0);
  });

  it('1 vínculo ativo: bloco "🤝 Agenda de X:" com os confirmed do dono que TOCAM o dia civil do CONVIDADO + audit shared_section_built', async () => {
    const { svc, sent, auditEvents, ownerQueries } = make({
      outbox: digestRow(),
      appointments: [], // dia do convidado vazio
      dueReminders: [],
      incomingLinks: [{ id: 'link-1', ownerId: 'dono-1', ownerName: 'Ana' }],
      ownerAppointments: {
        'dono-1': [
          {
            id: 'd1',
            title: 'Reunião',
            startsAt: new Date('2026-10-08T17:00:00Z'), // 14:00 local do convidado — hoje
            endsAt: new Date('2026-10-08T18:00:00Z'),
          },
          {
            id: 'd2',
            title: 'Futruga',
            startsAt: new Date('2026-10-09T17:00:00Z'), // 14:00 de sexta: fora do dia
            endsAt: new Date('2026-10-09T18:00:00Z'),
          },
          {
            // M5 (E.23 + C.19/B.19 — INTERSEÇÃO half-open): começou ONTEM
            // (17:00 qua local) e morre 15:00 de hoje. A contenção antiga
            // (startsAt dentro do dia) o cortava; o where de interseção do M5
            // (startsAt < dia.end AND endsAt >= dia.start) o inclui — o mock
            // NÃO filtra datas: o teste de where abaixo prova o formato.
            id: 'd2b',
            title: 'Cauda',
            startsAt: new Date('2026-10-07T20:00:00Z'),
            endsAt: new Date('2026-10-08T18:00:00Z'),
          },
          {
            // M5 (E.23 + C.19/B.19 — INTERSEÇÃO half-open): 23:30 de QUARTA
            // local morre 00:30 de HOJE: só a cauda toca o dia do convidado ⇒
            // APARECE (a contenção antiga, por startsAt, o cortava).
            id: 'd3',
            title: 'Virada',
            startsAt: new Date('2026-10-08T02:30:00Z'), // 23:30 qua 07/10 local
            endsAt: new Date('2026-10-08T03:30:00Z'), // 00:30 qui 08/10 local — cauda toca hoje
          },
          {
            // 23:00→01:00 local do convidado: TOCA o dia pelo começo e morre no
            // dia seguinte — o caso exato da decisão humana (M5).
            id: 'd4',
            title: 'Jantar-vira',
            startsAt: new Date('2026-10-09T02:00:00Z'), // 23:00 qui local
            endsAt: new Date('2026-10-09T04:00:00Z'), // 01:00 sex local
          },
          {
            // fora do dia: 14:00 de SEXTA (09/10) local — nem toca.
            id: 'd5',
            title: 'Amanha',
            startsAt: new Date('2026-10-09T17:00:00Z'),
            endsAt: new Date('2026-10-09T18:00:00Z'),
          },
        ],
      },
    });
    const result = await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'sent' });
    const text = sent[0]!.text;
    // o dia livre do convidado deu lugar ao resumo com a seção
    expect(text).not.toBe('☀️ Hoje você está livre!');
    expect(text).toContain('🤝 Agenda de Ana:');
    expect(text).toContain('• 08/10 14:00–15:00 — Reunião'); // horário LOCAL do convidado
    expect(text).toContain('Virada'); // 23:30 qua → 00:30 qui: só a cauda toca hoje — M5
    expect(text).toContain('Jantar-vira'); // 23:00→01:00: aparece no dia (M5)
    expect(text).toContain('Cauda'); // começou ontem, toca hoje pela cauda — M5
    expect(text).not.toContain('Futruga'); // o mock aplica o where: fora do dia fica fora
    // B.13 + M6: confirmed fixo e UMA consulta com `userId: { in: [donos] }`
    expect(ownerQueries).toHaveLength(1);
    expect(ownerQueries[0]!.where).toMatchObject({
      userId: { in: ['dono-1'] },
      status: 'confirmed',
      // M5: o where É a interseção half-open com o dia civil do CONVIDADO
      // (03:00Z→03:00Z de -03:00) — nunca contenção (startsAt nos dois lados).
      startsAt: { lt: new Date('2026-10-09T03:00:00.000Z') },
      endsAt: { gte: new Date('2026-10-08T03:00:00.000Z') },
    });
    // F.4: audit best-effort com a contagem da seção (nunca conteúdo)
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({
      kind: 'shared_section_built',
      actorId: 'u1',
      ownerId: 'dono-1',
      guestId: 'u1',
      metadata: { count: 4 }, // Reunião + Cauda + Virada + Jantar-vira (d2 Amanhã fica fora do dia)
    });
  });

  it('N vínculos: uma seção por dono na ordem dos vínculos; dono sem nome NÃO gera seção (e-mail nunca vaza)', async () => {
    const { svc, sent, auditEvents } = make({
      outbox: digestRow(),
      appointments: [],
      dueReminders: [],
      incomingLinks: [
        { id: 'link-1', ownerId: 'dono-1', ownerName: 'Ana' },
        { id: 'link-2', ownerId: 'dono-2', ownerName: null }, // sem rótulo: pulada
        { id: 'link-3', ownerId: 'dono-3', ownerName: 'Bruno' },
      ],
      ownerAppointments: {
        'dono-1': [
          {
            id: 'd1',
            title: 'Consulta',
            startsAt: new Date('2026-10-08T17:00:00Z'),
            endsAt: new Date('2026-10-08T18:00:00Z'),
          },
        ],
        'dono-2': [
          {
            id: 'd2',
            title: 'Ninguém Vê',
            startsAt: new Date('2026-10-08T17:00:00Z'),
            endsAt: new Date('2026-10-08T18:00:00Z'),
          },
        ],
        'dono-3': [
          {
            id: 'd3',
            title: 'Obra',
            startsAt: new Date('2026-10-08T16:00:00Z'),
            endsAt: new Date('2026-10-08T17:00:00Z'),
          },
        ],
      },
    });
    await svc.dispatch({ outboxId: 'o1' }, NOW);
    const text = sent[0]!.text;
    const lines = text.split('\n');
    expect(lines.indexOf('🤝 Agenda de Ana:')).toBeGreaterThan(-1);
    expect(lines.indexOf('🤝 Agenda de Bruno:')).toBeGreaterThan(lines.indexOf('🤝 Agenda de Ana:'));
    expect(text).toContain('• 08/10 13:00–14:00 — Obra');
    expect(text).not.toContain('Ninguém Vê');
    expect(text).not.toContain('null');
    // audit só das seções construídas (2), pareadas por dono
    expect(auditEvents.map((e) => e.ownerId).sort()).toEqual(['dono-1', 'dono-3']);
  });

  it('vínculo ativo mas dono sem nada no dia: sem seção, sem audit, corpo de hoje', async () => {
    const { svc, sent, auditEvents } = make({
      outbox: digestRow(),
      appointments: [],
      dueReminders: [],
      incomingLinks: [{ id: 'link-1', ownerId: 'dono-1', ownerName: 'Ana' }],
      ownerAppointments: { 'dono-1': [] },
    });
    await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(sent[0]!.text).toBe('☀️ Hoje você está livre!');
    expect(auditEvents).toHaveLength(0);
  });

  it('falha na carga compartilhada: o digest próprio sai normal (a seção é enfeite, nunca derruba)', async () => {
    const { svc, sent } = make({
      outbox: digestRow(),
      appointments: [
        {
          id: 'a1',
          title: 'Consulta',
          startsAt: new Date('2026-10-08T17:00:00Z'),
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [],
      incomingLinks: [{ id: 'link-1', ownerId: 'dono-1', ownerName: 'Ana' }],
      sharedFail: true,
    });
    const result = await svc.dispatch({ outboxId: 'o1' }, NOW);
    expect(result).toEqual({ kind: 'sent' });
    expect(sent[0]!.text).toContain('Consulta');
    expect(sent[0]!.text).not.toContain('Agenda de');
  });

  it('seção + lembretes vencendo hoje coexistem: ordem próprio → seções → vencendo hoje', async () => {    const { svc, sent } = make({
      outbox: digestRow(),
      appointments: [
        {
          id: 'a1',
          title: 'Próprio',
          startsAt: new Date('2026-10-08T17:00:00Z'),
          endsAt: new Date('2026-10-08T18:00:00Z'),
        },
      ],
      dueReminders: [
        { id: 'o9', appointment: { title: 'Prova', startsAt: new Date('2026-10-20T16:00:00Z') } },
      ],
      incomingLinks: [{ id: 'link-1', ownerId: 'dono-1', ownerName: 'Ana' }],
      ownerAppointments: {
        'dono-1': [
          {
            id: 'd1',
            title: 'Reunião',
            startsAt: new Date('2026-10-08T21:00:00Z'),
            endsAt: new Date('2026-10-08T22:00:00Z'),
          },
        ],
      },
    });
    await svc.dispatch({ outboxId: 'o1' }, NOW);
    const lines = sent[0]!.text.split('\n');
    expect(lines.indexOf('🤝 Agenda de Ana:')).toBeGreaterThan(
      lines.findIndex((l) => l.includes('— Próprio')),
    );
    expect(lines.indexOf('⏰ Lembretes que vencem hoje:')).toBeGreaterThan(
      lines.indexOf('🤝 Agenda de Ana:'),
    );
  });
});
