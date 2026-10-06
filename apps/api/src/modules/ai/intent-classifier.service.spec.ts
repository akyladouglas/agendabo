import { ConfigService } from '@nestjs/config';
import { classifyIntentTool } from '@agendabo/contracts';
import type {
  AnthropicMessagesClient,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { IntentClassifierService } from './intent-classifier.service';
import type { Env } from '../../config/env.validation';

/** Stub plano do AnthropicMessagesClient (nunca o SDK real — ver testing.md). */
class StubClient implements AnthropicMessagesClient {
  readonly calls: MessagesCreateParams[] = [];
  /** Fila de resultados/erros por chamada; cai no ultimo item se a fila acabar. */
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
    content: [{ type: 'tool_use', id: 'tu_1', name: classifyIntentTool.name, input }],
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

describe('IntentClassifierService', () => {
  it('intencao clara com confianca alta: ok:true e usa o modelo primario', async () => {
    const client = new StubClient([toolUse({ intent: 'criar', confidence: 0.95 })]);
    const svc = new IntentClassifierService(client as never, env());

    const result = await svc.classify('quero marcar uma consulta terça às 14h');

    expect(result).toEqual({ ok: true, intent: 'criar', confidence: 0.95 });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.model).toBe('claude-haiku-4-5-20251001');
  });

  it('contexto do fluxo vai no conteudo do usuario (prompt, nunca no banco)', async () => {
    const client = new StubClient([toolUse({ intent: 'remarcar', confidence: 0.9 })]);
    const svc = new IntentClassifierService(client as never, env());

    const result = await svc.classify('e as 16h?', {
      inFlow: true,
      step: 'conflito',
      conflictPending: true,
    });

    expect(result).toEqual({ ok: true, intent: 'remarcar', confidence: 0.9 });
    const content = String(client.calls[0]?.messages[0]?.content);
    expect(content).toContain('etapa: conflito');
    expect(content).toContain('conflito pendente');
  });

  it('confianca baixa: ok:false low_confidence SEM escalar de modelo (spec #13)', async () => {
    const client = new StubClient([toolUse({ intent: 'cancelar', confidence: 0.4 })]);
    const svc = new IntentClassifierService(client as never, env());

    expect(await svc.classify('deixa pra lá')).toEqual({ ok: false, reason: 'low_confidence' });
    expect(client.calls).toHaveLength(1);
  });

  it('sem tool_use: ok:false no_tool_use', async () => {
    const client = new StubClient([
      { content: [{ type: 'text', text: 'não usei a tool' }], stop_reason: 'end_turn' },
    ]);
    const svc = new IntentClassifierService(client as never, env());

    expect(await svc.classify('oi')).toEqual({ ok: false, reason: 'no_tool_use' });
    expect(client.calls).toHaveLength(2); // primario + escalada
    expect(client.calls[1]?.model).toBe('claude-sonnet-5-5');
  });

  it('JSON invalido no primario: escala ao Sonnet e ali aceita', async () => {
    const client = new StubClient([
      toolUse({ intent: 'telepatia', confidence: 0.9 }), // intent fora do enum -> parse falha
      toolUse({ intent: 'criar', confidence: 0.8 }),
    ]);
    const svc = new IntentClassifierService(client as never, env());

    expect(await svc.classify('marca aí')).toEqual({ ok: true, intent: 'criar', confidence: 0.8 });
    expect(client.calls.map((c) => c.model)).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5-5',
    ]);
  });

  it('campo extra da resposta e ignorado (strip — gotcha 4)', async () => {
    const client = new StubClient([
      toolUse({ intent: 'continuar_fluxo', confidence: 0.9, motivo: 'respondeu a pergunta' }),
    ]);
    const svc = new IntentClassifierService(client as never, env());

    expect(await svc.classify('Consulta dentista')).toEqual({
      ok: true,
      intent: 'continuar_fluxo',
      confidence: 0.9,
    });
  });

  it('timeout no primario: re-tenta no escalada e falha final vem do ultimo modelo', async () => {
    const client = new StubClient([
      new Error('timeout'),
      toolUse({ intent: 'criar', confidence: 0.99 }),
    ]);
    const svc = new IntentClassifierService(client as never, env());

    expect(await svc.classify('novo compromisso')).toEqual({
      ok: true,
      intent: 'criar',
      confidence: 0.99,
    });
  });

  it('parse falho nos dois modelos: ok:false reason parse (nunca age no chute)', async () => {
    const client = new StubClient([
      toolUse({ confidence: 0.9 }), // falta intent
      toolUse({ intent: 'criar' }), // falta confidence
    ]);
    const svc = new IntentClassifierService(client as never, env());

    expect(await svc.classify('?')).toEqual({ ok: false, reason: 'parse' });
    expect(client.calls).toHaveLength(2);
  });
});
