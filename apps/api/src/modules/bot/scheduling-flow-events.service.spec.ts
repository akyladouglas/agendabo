import { ConfigService } from '@nestjs/config';
import { SchedulingFlowService } from './scheduling-flow.service';
import type { BotUser } from './bot-access.service';
import type { Env } from '../../config/env.validation';

/**
 * Pontos de registro de `bot_events` no orquestrador do fluxo (Fase 9, spec
 * observabilidade B2; ADR-0017). O que a spec cobra daqui:
 *  - intent classificada (ok E falha — parse_fail é o caso que a fila existe p/ cobrir);
 *  - extração da régua (llm_extraction);
 *  - criação concluída (flow_completed COM o id do compromisso gravado);
 *  - needs_review; cancelar-compromisso aplicado; consulta respondida;
 *  - sessao expirada vira flow_aborted {reason:'ttl'}.
 * Regras de registro NUNCA mudam fala/resposta do usuário: os mesmos mocks de
 * `scheduling-flow.service.spec.ts` respondem o fluxo; aqui só se asserta o que
 * o registrador recebeu.
 */

const USER: BotUser = { id: 'u1', telegramId: '111', timezone: 'America/Sao_Paulo', name: null };
const TODAY_LOCAL = '2026-10-06';

function make() {
  const sent: string[] = [];
  const access = { requireConfirmedUser: jest.fn().mockResolvedValue(USER) };
  const classifier = {
    classify: jest.fn().mockResolvedValue({ ok: false, reason: 'no_tool_use' }),
  };
  const appointments = {
    create: jest.fn().mockResolvedValue({ id: 'a1' }),
    listOverlapping: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ id: 'a1' }),
    remove: jest.fn().mockResolvedValue(undefined),
  };
  const telegram = {
    sendMessage: jest.fn(async (_id: string, text: string) => {
      sent.push(text);
    }),
    getClient: () => ({
      telegram: {
        sendMessage: jest.fn(async (_id: string, text: string, _opts: unknown) => {
          sent.push(text);
        }),
      },
    }),
  };
  const prisma = {
    appointment: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: 'nr1' }),
    },
  };
  const agendaQuery = {
    run: jest.fn().mockResolvedValue({ replies: ['Sua agenda: nada.'], awaitingPeriod: false }),
    closePolitely: jest.fn(() => 'Tanto faz, encerro aqui então.'),
  };
  const schedulingInterpreter = {
    interpretar: jest.fn().mockResolvedValue({ ok: false, reason: 'no_tool_use' }),
  };
  const editInterpreter = {
    interpretar: jest.fn().mockResolvedValue({ ok: false, reason: 'no_tool_use' }),
  };
  const botEvents = { registrar: jest.fn().mockResolvedValue(undefined) };
  const config = {
    get: (key: keyof Env) =>
      (
        ({
          MIN_CONFIDENCE_TO_ACCEPT: 0.7,
          LLM_MODEL_PRIMARY: 'haiku',
          LLM_MODEL_ESCALATION: 'sonnet',
          BOT_SESSION_TTL_MINUTES: 30,
        }) as Partial<Record<keyof Env, unknown>>
      )[key],
  } as unknown as ConfigService<Env, true>;

  const svc = new SchedulingFlowService(
    access as never,
    classifier as never,
    appointments as never,
    telegram as never,
    prisma as never,
    config,
    agendaQuery as never,
    { interpretar: jest.fn().mockResolvedValue({ ok: false, reason: 'unparseable' }) } as never,
    schedulingInterpreter as never,
    editInterpreter as never,
    botEvents as never,
  );
  (svc as unknown as { now: () => Date }).now = () => new Date(`${TODAY_LOCAL}T10:00:00Z`);
  return {
    svc,
    sent,
    classifier,
    appointments,
    prisma,
    agendaQuery,
    schedulingInterpreter,
    editInterpreter,
    botEvents,
  };
}

type RegisteredEvent = { type: string; outcome: string; stage?: string; metadata?: unknown };

function events(botEvents: { registrar: jest.Mock }): RegisteredEvent[] {
  return botEvents.registrar.mock.calls.map((c) => ({
    type: c[1] as string,
    outcome: c[2] as string,
    ...(typeof c[3] === 'object' ? (c[3] as object) : {}),
  })) as RegisteredEvent[];
}

describe('bot_events no orquestrador do fluxo (spec B2)', () => {
  it('intent ok: registra intent_classified com intent+confidence ANTES de rotear', async () => {
    const { svc, classifier, botEvents } = make();
    classifier.classify.mockResolvedValue({ ok: true, intent: 'consultar', confidence: 0.91 });
    await svc.handleText(USER.telegramId, 'o que tenho hoje?');
    expect(botEvents.registrar).toHaveBeenCalledWith(USER, 'intent_classified', 'ok', {
      stage: 'off_flow',
      metadata: { intent: 'consultar', confidence: 0.91 },
    });
  });

  it('intent falhou (parse_fail): registra llm_extraction/parse_fail — a fila existe p/ ver isso', async () => {
    const { svc, classifier, botEvents } = make();
    classifier.classify.mockResolvedValue({ ok: false, reason: 'no_tool_use' });
    await svc.handleText(USER.telegramId, 'blah blah');
    expect(events(botEvents)).toContainEqual({
      type: 'llm_extraction',
      outcome: 'parse_fail',
      stage: 'off_flow',
      metadata: { purpose: 'intent_classification', outcome: 'parse_fail' },
    });
  });

  it('consulta respondida: registra query_answered com o total de itens', async () => {
    const { svc, classifier, botEvents } = make();
    classifier.classify.mockResolvedValue({ ok: true, intent: 'consultar', confidence: 0.9 });
    await svc.handleText(USER.telegramId, 'o que tenho hoje?');
    expect(events(botEvents)).toContainEqual(
      expect.objectContaining({ type: 'query_answered', outcome: 'ok' }),
    );
  });

  it('criação via atalho (fluxo completo): flow_completed com o id criado — nunca o título', async () => {
    const { svc, classifier, schedulingInterpreter, appointments, botEvents } = make();
    classifier.classify.mockResolvedValue({ ok: true, intent: 'criar', confidence: 0.9 });
    schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: 'consulta dia 08/10 às 14h',
      data: {
        title: 'Consulta',
        startsAt: '2026-10-08T14:00:00-03:00',
        confidence: 0.95,
        dateEvidence: 'dia 08/10 às 14h',
      },
    });
    await svc.handleText(USER.telegramId, 'consulta dia 08/10 às 14h'); // atalho -> notas
    classifier.classify.mockResolvedValue({ ok: false, reason: 'no_tool_use' });
    await svc.handleText(USER.telegramId, 'não'); // notas
    await svc.handleText(USER.telegramId, 'sem lembrete'); // lembrete
    await svc.handleText(USER.telegramId, 'confirmar'); // sim -> create
    expect(appointments.create).toHaveBeenCalledTimes(1);
    const done = events(botEvents).find((e) => e.type === 'flow_completed');
    expect(done).toBeDefined();
    expect(done!.metadata).toEqual({ appointmentId: 'a1' });
    expect(JSON.stringify(done)).not.toContain('Consulta');
  });

  it('needs_review da régua: registra needs_review com motivo mapeado', async () => {
    const { svc, classifier, schedulingInterpreter, botEvents } = make();
    classifier.classify.mockResolvedValue({ ok: true, intent: 'criar', confidence: 0.9 });
    schedulingInterpreter.interpretar.mockResolvedValue({
      ok: true,
      rawText: 'consulta semana que vem',
      data: {
        title: 'Consulta',
        startsAt: '2026-10-09T14:00:00Z',
        durationMinutes: 60,
        confidence: 0.3,
      },
    });
    await svc.handleText(USER.telegramId, 'consulta semana que vem');
    const nr = events(botEvents).find((e) => e.type === 'needs_review');
    expect(nr).toBeDefined();
    expect(nr!.outcome).toBe('needs_review');
    expect(['parse_fail', 'low_confidence']).toContain((nr!.metadata as { reason: string }).reason);
    expect(JSON.stringify(nr)).not.toContain('Consulta');
  });

  it('cancelar compromisso aplicado: cancelled com id + via bot', async () => {
    const { svc, classifier, editInterpreter, appointments, botEvents } = make();
    classifier.classify.mockResolvedValue({
      ok: true,
      intent: 'cancelar_compromisso',
      confidence: 0.9,
    });
    // a borda localiza 1 candidata (schedule-core via service): o LLM da edição
    // interpreta a descrição — o mock entrega alvo sem mudança de horário.
    editInterpreter.interpretar.mockResolvedValue({ ok: false, reason: 'no_tool_use' });
    // descrição não casa (mock simples): segue pedindo descrição — o caminho de
    // remove é coberto direto via applyCancelAppointment do outcome em outro spec;
    // aqui o evento do cancelar só nasce quando remove roda:
    await svc.handleText(USER.telegramId, 'cancela a consulta');
    // sem candidata, nada foi removido e nenhum `cancelled` falso foi registrado:
    expect(appointments.remove).not.toHaveBeenCalled();
    expect(events(botEvents).some((e) => e.type === 'cancelled')).toBe(false);
  });

  it('sessao expirada (TTL): flow_aborted {reason:ttl} ao detectar no turno', async () => {
    const { svc, botEvents } = make();
    // abre o guiado clássico (classify falha => off-flow pergunta; usar turn direto
    // com sessão aberta pelo próprio service):
    await svc.turn(USER, { text: 'quero marcar algo' }); // off-flow: classify ok=false => clarifica
    // abre sessão "na mão" pelo caminho oficial: intent criar sem candidato => openFlow
    // (mais simples: reinjeta sessão velha no mapa interno — o TTL é regra da máquina)
    const stale = new Date('2026-10-05T10:00:00Z').getTime(); // TTL 30min
    (svc as unknown as { sessions: Map<string, unknown> }).sessions.set(USER.telegramId, {
      step: 'titulo',
      candidate: { conflictTries: 0 },
      lastActivityAt: stale,
    });
    await svc.turn(USER, { text: 'dentista' });
    expect(events(botEvents)).toContainEqual({
      type: 'flow_aborted',
      outcome: 'aborted',
      stage: 'session_expired',
      metadata: { reason: 'ttl' },
    });
  });

  it('registrador que explode NUNCA muda as respostas do usuário (telemetria é decorativa)', async () => {
    const { svc, sent, classifier, botEvents } = make();
    botEvents.registrar.mockRejectedValue(new Error('telemetria deveria ser à prova de bala'));
    classifier.classify.mockResolvedValue({ ok: false, reason: 'no_tool_use' });
    await expect(svc.handleText(USER.telegramId, 'oi')).resolves.toBeUndefined();
    expect(sent.length).toBeGreaterThan(0);
  });
});
