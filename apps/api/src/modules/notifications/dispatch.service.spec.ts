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
}

function make(rowFixtures: RowFixtures, telegramFail = false) {
  const updates: Record<string, unknown>[] = [];
  const sent: { chatId: string; text: string }[] = [];
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
      findMany: async () => rowFixtures.appointments ?? [],
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

  const svc = new DispatchService(prisma as never, telegram as never, config);
  svc.offsetProvider = () => OFFSET;
  // relógio da borda do service fixo (testing.md): dispatch sem 2º argumento usa este now
  (svc as unknown as { now: () => Date }).now = () => NOW;
  return { svc, prisma, updates, sent };
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
  function digestRow() {
    return reminderRow({
      kind: 'daily_digest',
      appointment: null,
      ruleType: null,
      firesAt: NOW, // digere p/ teste: disparo exatamente no agora
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
});
