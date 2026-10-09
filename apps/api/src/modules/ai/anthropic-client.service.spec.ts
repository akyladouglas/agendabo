import { Logger } from '@nestjs/common';
import { AnthropicClientProvider } from './anthropic-client.provider';
import { LlmCallContextService } from './llm-call-context';
import type { Env } from '../../config/env.validation';

/**
 * Hook de captura de `llm_calls` no provider Anthropic (Fase 9, spec C1-C3;
 * ADR-0017; D-P1/D-P2/D-P8 do plano). O provider e o UNICO ponto por onde as
 * 5 saidas de IA passam — capturar aqui fecha o cano sem tocar nos services.
 * O spec garante:
 *  - usage/model chegam ao service que consome (antes eram descartados);
 *  - a linha nasce com purpose/userId do AsyncLocalStorage e custo em micro-USD
 *    INTEIRO a partir dos precos do env (sem preco => custo null, nunca chute);
 *  - uma chamada = uma linha POR TENTATIVA (a cascata de escalada e 2 linhas);
 *  - erro de rede vira outcome=error; sem contexto => linha sem userId e warn
 *    (contexto vazio em producao e o bug que este teste prende).
 */

const ENV_VALUES: Partial<Record<keyof Env, unknown>> = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  // MICRO-USD/Mtok (o env real e int — D-P8): Haiku $1/$5 => 1e6/5e6
  LLM_PRICE_INPUT_USD_PER_MTOK: 1_000_000,
  LLM_PRICE_OUTPUT_USD_PER_MTOK: 5_000_000,
};

function make() {
  const llmCall = { create: jest.fn().mockResolvedValue({ id: 'c1' }) };
  const prisma = { llmCall };
  const config = {
    get: (key: keyof Env) => ENV_VALUES[key],
  } as never;
  const ctx = new LlmCallContextService();
  const provider = new AnthropicClientProvider(config, prisma as never, ctx);
  // SDK fake: o provider CHAMA messages.create; nos controlamos a resposta.
  const sdkCreate = jest.fn();
  (provider as unknown as { sdk: unknown }).sdk = {
    messages: { create: sdkCreate },
  };
  jest.spyOn(Logger.prototype, 'error').mockImplementation();
  jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  return { provider, sdkCreate, llmCall, ctx, prisma };
}

const OK_RESPONSE = {
  content: [{ type: 'text', text: 'ok' }],
  stop_reason: 'tool_use',
  model: 'claude-haiku-4-5-20251001',
  usage: { input_tokens: 1000, output_tokens: 500 },
};

const PARAMS = { model: 'claude-haiku-4-5-20251001', max_tokens: 256, messages: [] } as never;

describe('AnthropicClientProvider — captura llm_calls (ADR-0017)', () => {
  it('passa usage/model adiante E grava a linha com custo em micro-USD inteiro', async () => {
    const { provider, sdkCreate, llmCall, ctx } = make();
    sdkCreate.mockResolvedValue(OK_RESPONSE);
    const result = await ctx.run({ userId: 'u1', purpose: 'intent_classification' }, () =>
      provider.create(PARAMS),
    );
    expect(result.usage).toEqual({ input_tokens: 1000, output_tokens: 500 });
    expect(result.model).toBe('claude-haiku-4-5-20251001');
    expect(llmCall.create).toHaveBeenCalledTimes(1);
    const data = llmCall.create.mock.calls[0]![0]!.data;
    expect(data).toMatchObject({
      userId: 'u1',
      purpose: 'intent_classification',
      outcome: 'ok',
      modelUsed: 'claude-haiku-4-5-20251001',
      inputTokens: 1000,
      outputTokens: 500,
    });
    // 1000 tokens * 1e6 micro-USD/Mtok / 1e6 tokens = 1000 micro-USD; saida:
    // 500 * 5e6 / 1e6 = 2500 => 3500 micro-USD exato ($0.0035 — a conta do ADR)
    expect(data.costUsdMicros).toBe(3_500);
    expect(Number.isInteger(data.costUsdMicros)).toBe(true);
    expect(data.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('uma chamada por tentativa: escalada da cascata = 2 linhas (modelo de cada tentativa)', async () => {
    const { provider, sdkCreate, llmCall, ctx } = make();
    sdkCreate
      .mockResolvedValueOnce({
        ...OK_RESPONSE,
        model: 'haiku',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
      .mockResolvedValueOnce({
        ...OK_RESPONSE,
        model: 'sonnet',
        usage: { input_tokens: 12, output_tokens: 6 },
      });
    await ctx.run({ userId: 'u1', purpose: 'scheduling_extraction' }, () =>
      provider.create(PARAMS),
    );
    await ctx.run({ userId: 'u1', purpose: 'scheduling_extraction' }, () =>
      provider.create(PARAMS),
    );
    expect(llmCall.create).toHaveBeenCalledTimes(2);
    expect(llmCall.create.mock.calls[0]![0]!.data.modelUsed).toBe('haiku');
    expect(llmCall.create.mock.calls[1]![0]!.data.modelUsed).toBe('sonnet');
  });

  it('erro de rede/timeout: linha outcome=error e o erro segue adiante (cascata decide)', async () => {
    const { provider, sdkCreate, llmCall, ctx } = make();
    sdkCreate.mockRejectedValue(new Error('timeout'));
    await expect(
      ctx.run({ userId: 'u1', purpose: 'query_interpretation' }, () => provider.create(PARAMS)),
    ).rejects.toThrow('timeout');
    expect(llmCall.create).toHaveBeenCalledTimes(1);
    expect(llmCall.create.mock.calls[0]![0]!.data).toMatchObject({
      outcome: 'error',
      purpose: 'query_interpretation',
    });
  });

  it('usage ausente na resposta: tokens/custo null (jamais chute), linha nasce igual', async () => {
    const { provider, sdkCreate, llmCall, ctx } = make();
    sdkCreate.mockResolvedValue({ content: [], stop_reason: null, model: 'm' });
    await ctx.run({ userId: 'u1', purpose: 'edit_interpretation' }, () => provider.create(PARAMS));
    const data = llmCall.create.mock.calls[0]![0]!.data;
    expect(data.inputTokens).toBeNull();
    expect(data.outputTokens).toBeNull();
    expect(data.costUsdMicros).toBeNull();
  });

  it('sem contexto no store: linha SEM userId e warn (producao sem run() = bug visivel)', async () => {
    const { provider, sdkCreate, llmCall, ctx } = make();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    sdkCreate.mockResolvedValue(OK_RESPONSE);
    await (ctx as unknown as { run: (s: object, f: () => unknown) => unknown }).run({}, () =>
      provider.create(PARAMS),
    );
    const data = llmCall.create.mock.calls[0]![0]!.data;
    expect(data.userId).toBeNull();
    expect(data.purpose).toBe('escalation'); // fallback declarado, nunca inventado
    expect(warn).toHaveBeenCalled();
  });

  it('falha do banco NUNCA derruba a chamada de IA (best-effort)', async () => {
    const { provider, sdkCreate, ctx } = make();
    sdkCreate.mockResolvedValue(OK_RESPONSE);
    (provider as unknown as { sdk: unknown }).sdk = {
      messages: { create: jest.fn().mockResolvedValue(OK_RESPONSE) },
    };
    const prismaFalho = {
      llmCall: { create: jest.fn().mockRejectedValue(new Error('banco caiu')) },
    };
    (provider as unknown as { prisma: unknown }).prisma = prismaFalho;
    await expect(
      ctx.run({ userId: 'u1', purpose: 'intent_classification' }, () => provider.create(PARAMS)),
    ).resolves.toMatchObject({ stop_reason: 'tool_use' });
  });

  it('escalonamento da chamada aninhada: run() do service cobre create e await', async () => {
    // o padrao oficial: ctx.run(...) ARCADE a chamada — se o store for lexico
    // (nao escalonado) o provider nao ve contexto e este teste falha.
    const { provider, sdkCreate, llmCall, ctx } = make();
    sdkCreate.mockResolvedValue(OK_RESPONSE);
    await ctx.run({ userId: 'u9', purpose: 'reminder_extraction' }, async () => {
      return provider.create(PARAMS);
    });
    expect(llmCall.create.mock.calls[0]![0]!.data.userId).toBe('u9');
  });
});
