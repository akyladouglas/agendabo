import { ConfigService } from '@nestjs/config';
import { extrairAgendamentoTool } from '@agendabo/contracts';
import type {
  AnthropicMessagesClient,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { SchedulingInterpreterService } from './scheduling-interpreter.service';
import { LlmCallContextService } from './llm-call-context';
import type { Env } from '../../config/env.validation';

/**
 * Extrator LLM do CRIAR em fala solta (Fase 4, spec llm-avancado regra 5/A). Stub plano
 * do client (nunca o SDK real — testing.md). O service NÃO aplica a régua: ele entrega o
 * payload safeParseado (inclusive de confiança baixa — a régua decide needs_review).
 */

class StubClient implements AnthropicMessagesClient {
  readonly calls: MessagesCreateParams[] = [];
  constructor(private readonly script: Array<MessagesCreateResult | Error>) {}

  async create(params: MessagesCreateParams): Promise<MessagesCreateResult> {
    this.calls.push(params);
    const next = this.script.length > 1 ? this.script.shift() : this.script[0];
    if (next instanceof Error) throw next;
    return next as MessagesCreateResult;
  }
}

function toolUse(input: unknown): MessagesCreateResult {
  return {
    content: [{ type: 'tool_use', id: 'tu_1', name: extrairAgendamentoTool.name, input }],
    stop_reason: 'tool_use',
  };
}

function env(overrides: Partial<Env> = {}): ConfigService<Env, true> {
  const values = {
    LLM_MODEL_PRIMARY: 'claude-haiku-4-5-20251001',
    LLM_MODEL_ESCALATION: 'claude-sonnet-5-5',
    MIN_CONFIDENCE_TO_ACCEPT: 0.7,
    ...overrides,
  } as Env;
  return { get: (key: keyof Env) => values[key] } as ConfigService<Env, true>;
}

function service(script: Array<MessagesCreateResult | Error>) {
  const client = new StubClient(script);
  return {
    svc: new SchedulingInterpreterService(client as never, env(), new LlmCallContextService()),
    client,
  };
}

const CTX = { todayLocal: 'terça-feira, 6 de outubro de 2026' };

describe('SchedulingInterpreterService (extrator do criar — Fase 4)', () => {
  it('payload válido: ok com data + rawText da fala (insumo da régua)', async () => {
    const { svc, client } = service([
      toolUse({
        title: 'Consulta',
        startsAt: '2026-10-08T14:00:00-03:00',
        durationMinutes: 60,
        confidence: 0.9,
        dateEvidence: 'quinta que vem umas 14h',
      }),
    ]);
    const result = await svc.interpretar('marca consulta quinta que vem umas 14h', CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.title).toBe('Consulta');
      expect(result.data.startsAt).toBe('2026-10-08T14:00:00-03:00');
      expect(result.rawText).toBe('marca consulta quinta que vem umas 14h');
    }
    expect(client.calls).toHaveLength(1);
    // "hoje no tz do usuário" vai no bloco volátil, nunca no system (llm.md #4)
    expect(client.calls[0]?.messages[0]?.content).toContain(CTX.todayLocal);
  });

  it('confiança baixa NÃO é recusada aqui: a RÉGUA é que decide needs_review (regra 6)', async () => {
    const { svc } = service([
      toolUse({ title: 'consulta', startsAt: '2026-10-08T14:00:00-03:00', confidence: 0.3 }),
    ]);
    const result = await svc.interpretar('mais ou menos uma consulta quinta', CTX);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.confidence).toBe(0.3);
  });

  it('sem tool_use => no_tool_use (cai no guiado, nunca hipótese — spec A5)', async () => {
    const { svc } = service([
      { content: [{ type: 'text', text: 'não entendi' }], stop_reason: 'end_turn' },
    ]);
    const result = await svc.interpretar('oi tudo bem?', CTX);
    expect(result).toEqual({ ok: false, reason: 'no_tool_use' });
  });

  it('parse falho no primário escala p/ o modelo maior (cascata llm.md #7)', async () => {
    const { svc, client } = service([
      toolUse({ title: 'X', startsAt: 'quinta 14h', confidence: 0.9 }), // sem offset: zod barra
      toolUse({ title: 'X', startsAt: '2026-10-08T14:00:00-03:00', confidence: 0.9 }),
    ]);
    const result = await svc.interpretar('marca x quinta 14h', CTX);
    expect(result.ok).toBe(true);
    expect(client.calls.map((c) => c.model)).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5-5',
    ]);
  });

  it('timeout no primário tenta a escalada uma vez e falha em parse (llm.md #7)', async () => {
    const { svc, client } = service([new Error('timeout'), new Error('timeout')]);
    const result = await svc.interpretar('marca alguma coisa', CTX);
    expect(result).toEqual({ ok: false, reason: 'parse' });
    expect(client.calls).toHaveLength(2);
  });
});
