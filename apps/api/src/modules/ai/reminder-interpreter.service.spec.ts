import { ConfigService } from '@nestjs/config';
import { extrairLembreteTool } from '@agendabo/contracts';
import type {
  AnthropicMessagesClient,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { ReminderInterpreterService } from './reminder-interpreter.service';
import type { Env } from '../../config/env.validation';

/**
 * Interpretador LLM do esquema de lembrete (Fase 3, spec regras 3–4). Stub plano do
 * client (nunca o SDK real — testing.md). Os 5 payloads canônicos da spec/plano:
 * "24 horas antes", "3 dias antes", "3-2-1", "sem lembrete", multi-regra.
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
    content: [{ type: 'tool_use', id: 'tu_1', name: extrairLembreteTool.name, input }],
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
  return { svc: new ReminderInterpreterService(client as never, env()), client };
}

describe('ReminderInterpreterService', () => {
  it('atalho "24h antes" NÃO gasta LLM (source atalho, zero chamadas — spec 4/D3)', async () => {
    const { svc, client } = service([]);
    const result = await svc.interpretar('24h antes');
    expect(result).toEqual({
      ok: true,
      regras: [{ type: 'before_days', value: 1 }],
      source: 'atalho',
    });
    expect(client.calls).toHaveLength(0);
  });

  it('payload "24 horas antes" do LLM => before_hours 24 (LLM não sabe do atalho — spec regra 2)', async () => {
    const { svc, client } = service([
      toolUse({ regras: [{ type: 'before_hours', value: 24 }], confidence: 0.9 }),
    ]);
    const result = await svc.interpretar('me avisa com 24 horas de antecedência');
    expect(result).toEqual({
      ok: true,
      regras: [{ type: 'before_hours', value: 24 }],
      source: 'llm',
    });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.model).toBe('claude-haiku-4-5-20251001');
  });

  it('payload multi-regra passa inteira (decisão #2: N regras por compromisso)', async () => {
    const { svc } = service([
      toolUse({
        regras: [
          { type: 'before_days', value: 3 },
          { type: 'before_hours', value: 1 },
        ],
        confidence: 0.85,
      }),
    ]);
    const result = await svc.interpretar('me avisa 3 dias antes e 1 hora antes, por favor');
    expect(result).toEqual({
      ok: true,
      regras: [
        { type: 'before_days', value: 3 },
        { type: 'before_hours', value: 1 },
      ],
      source: 'llm',
    });
  });

  it('payload "sem lembrete" => none sozinho (spec regra 3)', async () => {
    const { svc } = service([toolUse({ regras: [{ type: 'none' }], confidence: 0.95 })]);
    const result = await svc.interpretar('pode me deixar sem aviso nenhum');
    expect(result).toEqual({ ok: true, regras: [{ type: 'none' }], source: 'llm' });
  });

  it('confiança baixa NÃO escala: reason low_confidence => bot re-pergunta (spec 4 / ADR-003)', async () => {
    const { svc, client } = service([
      toolUse({ regras: [{ type: 'before_hours', value: 2 }], confidence: 0.3 }),
    ]);
    const result = await svc.interpretar('me avisa antes');
    expect(result).toEqual({ ok: false, reason: 'low_confidence' });
    expect(client.calls).toHaveLength(1); // não escalou
  });

  it('parse falho no primário escala p/ o modelo maior e usa o resultado bom (cascata llm.md)', async () => {
    const { svc, client } = service([
      toolUse({ regras: [{ type: 'antes' }], confidence: 0.9 }), // shape inválida
      toolUse({ regras: [{ type: 'countdown_3_2_1' }], confidence: 0.9 }),
    ]);
    const result = await svc.interpretar('faz aquela contagem pra mim');
    expect(result).toEqual({ ok: true, regras: [{ type: 'countdown_3_2_1' }], source: 'llm' });
    expect(client.calls.map((c) => c.model)).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5-5',
    ]);
  });

  it('erro de rede no primário tenta a escalada; sem tool_use => no_tool_use (llm.md #7)', async () => {
    const { svc } = service([
      new Error('timeout'),
      {
        content: [{ type: 'text', text: 'oi' }],
        stop_reason: 'end_turn',
      } as unknown as MessagesCreateResult,
    ]);
    const result = await svc.interpretar('me avisa quando der');
    expect(result).toEqual({ ok: false, reason: 'no_tool_use' });
  });
});
