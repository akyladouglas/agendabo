import { ConfigService } from '@nestjs/config';
import { interpretarConsultaTool } from '@agendabo/contracts';
import type {
  AnthropicMessagesClient,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { ConsultaInterpreterService } from './consulta-interpreter.service';
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
    content: [{ type: 'tool_use', id: 'tu_1', name: interpretarConsultaTool.name, input }],
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

const TODAY = 'quarta, 07 de outubro de 2026';

describe('ConsultaInterpreterService', () => {
  it('simbolo claro ("hoje"): ok:true com o simbolo e SEM intervalo (spec #6)', async () => {
    const client = new StubClient([toolUse({ tipo: 'listar', simbolo: 'hoje', confidence: 0.95 })]);
    const svc = new ConsultaInterpreterService(client as never, env());

    const result = await svc.interpret('o que tenho hoje?', { todayLocal: TODAY });

    expect(result).toEqual({ ok: true, simbolo: 'hoje', confidence: 0.95 });
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]?.model).toBe('claude-haiku-4-5-20251001');
  });

  it('payload plano ({from, to}) e canonizado p/ intervalo aninhado (normaliza antes do safeParse)', async () => {
    const client = new StubClient([
      toolUse({ tipo: 'listar', from: '2026-10-10', to: '2026-10-13', confidence: 0.9 }),
    ]);
    const svc = new ConsultaInterpreterService(client as never, env());

    const result = await svc.interpret('o que tenho de 10 a 12?', { todayLocal: TODAY });

    expect(result).toEqual({
      ok: true,
      intervalo: { from: '2026-10-10', to: '2026-10-13' },
      confidence: 0.9,
    });
  });

  it('simbolo presente: intervalo do payload e IGNORADO (contrato do contracts/llm)', async () => {
    const client = new StubClient([
      toolUse({
        tipo: 'listar',
        simbolo: 'amanha',
        from: '2026-01-01',
        to: '2026-01-02',
        confidence: 0.9,
      }),
    ]);
    const svc = new ConsultaInterpreterService(client as never, env());

    const result = await svc.interpret('amanhã?', { todayLocal: TODAY });

    expect(result).toEqual({ ok: true, simbolo: 'amanha', confidence: 0.9 });
  });

  it('confianca baixa: ok:false low_confidence SEM escalar (spec #5, ADR-003)', async () => {
    const client = new StubClient([toolUse({ tipo: 'listar', simbolo: 'hoje', confidence: 0.4 })]);
    const svc = new ConsultaInterpreterService(client as never, env());

    expect(await svc.interpret('meus compromissos?', { todayLocal: TODAY })).toEqual({
      ok: false,
      reason: 'low_confidence',
    });
    expect(client.calls).toHaveLength(1);
  });

  it('parse falho no primario: escala ao sonnet; falha nos dois => ok:false parse', async () => {
    const client = new StubClient([
      toolUse({ tipo: 'listar', simbolo: 'da_qui_pras_frente', confidence: 0.9 }), // fora do enum
      toolUse({ confidence: 0.9 }), // falta tipo
    ]);
    const svc = new ConsultaInterpreterService(client as never, env());

    expect(await svc.interpret('semana que vem?', { todayLocal: TODAY })).toEqual({
      ok: false,
      reason: 'parse',
    });
    expect(client.calls.map((c) => c.model)).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5-5',
    ]);
  });

  it('sem tool_use: ok:false no_tool_use apos a cascata', async () => {
    const client = new StubClient([
      { content: [{ type: 'text', text: 'não usei a tool' }], stop_reason: 'end_turn' },
    ]);
    const svc = new ConsultaInterpreterService(client as never, env());

    expect(await svc.interpret('blz?', { todayLocal: TODAY })).toEqual({
      ok: false,
      reason: 'no_tool_use',
    });
    expect(client.calls).toHaveLength(2);
  });

  it('fora_do_escopo: ok:false fora_do_escopo (a intent ja deveria ter roteado)', async () => {
    const client = new StubClient([toolUse({ tipo: 'fora_do_escopo', confidence: 0.95 })]);
    const svc = new ConsultaInterpreterService(client as never, env());

    expect(await svc.interpret('me conta uma piada', { todayLocal: TODAY })).toEqual({
      ok: false,
      reason: 'fora_do_escopo',
    });
  });

  it('listar sem simbolo e sem intervalo: ok:false parse (bot pergunta o periodo)', async () => {
    const client = new StubClient([toolUse({ tipo: 'listar', confidence: 0.9 })]);
    const svc = new ConsultaInterpreterService(client as never, env());

    expect(await svc.interpret('meus compromissos', { todayLocal: TODAY })).toEqual({
      ok: false,
      reason: 'parse',
    });
  });

  it('campo extra da resposta e ignorado (strip — gotcha 4)', async () => {
    const client = new StubClient([
      toolUse({ tipo: 'listar', simbolo: 'hoje', confidence: 0.9, motivo: 'pergunta direta' }),
    ]);
    const svc = new ConsultaInterpreterService(client as never, env());

    expect(await svc.interpret('o que tenho hoje?', { todayLocal: TODAY })).toEqual({
      ok: true,
      simbolo: 'hoje',
      confidence: 0.9,
    });
  });

  it('data de hoje no timezone do usuario vai no bloco volatile (prompt, llm.md #4)', async () => {
    const client = new StubClient([toolUse({ tipo: 'listar', simbolo: 'hoje', confidence: 0.9 })]);
    const svc = new ConsultaInterpreterService(client as never, env());

    await svc.interpret('o que tenho hoje?', {
      todayLocal: TODAY,
      inFlowStep: 'notas',
    });

    const content = String(client.calls[0]?.messages[0]?.content);
    expect(content).toContain(TODAY);
    expect(content).toContain('etapa: notas');
    // cache_control so no system estavel
    const system = client.calls[0]?.system as Array<{ cache_control?: unknown }> | undefined;
    expect(system?.[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });
});
