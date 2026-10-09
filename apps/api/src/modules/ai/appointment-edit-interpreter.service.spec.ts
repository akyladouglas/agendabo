import { ConfigService } from '@nestjs/config';
import { interpretarEdicaoTool } from '@agendabo/contracts';
import type {
  AnthropicMessagesClient,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';
import { AppointmentEditInterpreterService } from './appointment-edit-interpreter.service';
import { LlmCallContextService } from './llm-call-context';
import type { Env } from '../../config/env.validation';

/**
 * Extrator LLM do EDITAR/CANCELAR pelo chat (Fase 4, spec llm-avancado regra 10/B).
 * Stub plano do client (testing.md). Diferença-chave vs. o extrator do criar:
 * confiança baixa AQUI é falha (no editar NUNCA há needs_review — spec regra 20).
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
    content: [{ type: 'tool_use', id: 'tu_1', name: interpretarEdicaoTool.name, input }],
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
    svc: new AppointmentEditInterpreterService(client as never, env(), new LlmCallContextService()),
    client,
  };
}

const CTX = { todayLocal: 'terça-feira, 6 de outubro de 2026' };

describe('AppointmentEditInterpreterService (extrator do editar — Fase 4)', () => {
  it('alvo + data nova: ok com descricao/alvoData/novoInicio (tradução, não decisão)', async () => {
    const { svc, client } = service([
      toolUse({
        acao: 'editar',
        descricao: 'reunião',
        alvoData: { simbolo: 'semana_que_vem' },
        novoInicio: '2026-10-09T16:00:00-03:00',
        confidence: 0.9,
      }),
    ]);
    const result = await svc.interpretar('muda a reunião pra sexta que vem 16h', CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.acao).toBe('editar');
      expect(result.data.descricao).toBe('reunião');
      expect(result.data.alvoData?.simbolo).toBe('semana_que_vem');
      expect(result.data.novoInicio).toBe('2026-10-09T16:00:00-03:00');
    }
    expect(client.calls[0]?.messages[0]?.content).toContain(CTX.todayLocal);
  });

  it('payload PLANO do modelo (simbolo no topo) é canonizado pelo normalizador', async () => {
    const { svc } = service([
      toolUse({
        acao: 'editar',
        descricao: 'consulta',
        simbolo: 'amanha',
        novoInicio: '2026-10-07T15:00:00-03:00',
        confidence: 0.85,
      }),
    ]);
    const result = await svc.interpretar('joga a consulta pra amanhã 15h', CTX);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.alvoData?.simbolo).toBe('amanha');
  });

  it('"adianta 1h" => só deslocamentoMin negativo (modelo nunca calcula a data nova)', async () => {
    const { svc } = service([
      toolUse({ acao: 'editar', descricao: 'daily', deslocamentoMin: -60, confidence: 0.9 }),
    ]);
    const result = await svc.interpretar('adianta o daily em 1 hora', CTX);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.deslocamentoMin).toBe(-60);
      expect(result.data.novoInicio).toBeUndefined();
    }
  });

  it('cancelar: acao cancelar com descricao (localização é determinística depois)', async () => {
    const { svc } = service([
      toolUse({ acao: 'cancelar', descricao: 'consulta no dentista', confidence: 0.95 }),
    ]);
    const result = await svc.interpretar('cancela a consulta no dentista de quinta', CTX);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.acao).toBe('cancelar');
  });

  it('confiança baixa => low_confidence SEM escalar (editar nunca tem needs_review — regra 20)', async () => {
    const { svc, client } = service([
      toolUse({ acao: 'editar', descricao: 'reunião', deslocamentoMin: -60, confidence: 0.4 }),
    ]);
    const result = await svc.interpretar('mexe na reunião aí', CTX);
    expect(result).toEqual({ ok: false, reason: 'low_confidence' });
    expect(client.calls).toHaveLength(1); // não escalou
  });

  it('parse falho escala p/ o modelo maior e usa o resultado bom (cascata llm.md)', async () => {
    const { svc, client } = service([
      toolUse({ acao: 'mudar', confidence: 0.9 }), // enum inválido
      toolUse({
        acao: 'editar',
        descricao: 'x',
        novoInicio: '2026-10-09T16:00:00-03:00',
        confidence: 0.9,
      }),
    ]);
    const result = await svc.interpretar('muda o x', CTX);
    expect(result.ok).toBe(true);
    expect(client.calls.map((c) => c.model)).toEqual([
      'claude-haiku-4-5-20251001',
      'claude-sonnet-5-5',
    ]);
  });
});
