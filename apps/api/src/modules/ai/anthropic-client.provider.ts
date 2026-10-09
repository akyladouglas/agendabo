import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Anthropic } from '@anthropic-ai/sdk';
import type { LlmCallPurposeValue } from '@agendabo/contracts';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { Env } from '../../config/env.validation';
import { LlmCallContextService } from './llm-call-context';
import type {
  AnthropicMessagesClient,
  MessagesCreateParams,
  MessagesCreateResult,
} from './anthropic-messages-client';

/** Adaptador fino sobre o SDK. Fora de modules/ai ninguem ve o SDK (ver ai.module.ts). */
@Injectable()
export class AnthropicClientProvider implements AnthropicMessagesClient {
  private readonly logger = new Logger(AnthropicClientProvider.name);
  private sdk: Anthropic | null = null;
  private readonly priceInMicro: number;
  private readonly priceOutMicro: number;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
    private readonly ctx: LlmCallContextService,
  ) {
    // D-P8: o env e em MICRO-USD/Mtok e obrigatorio, mas o construtor nao
    // chuta — preco ausente/<=0 (test sem env) desliga a estimativa (custo
    // null), nunca 0 "degratis". Guard numerico: o tipo pode menteR (test mock).
    const toMicro = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    this.priceInMicro = toMicro(this.config.get('LLM_PRICE_INPUT_USD_PER_MTOK', { infer: true }));
    this.priceOutMicro = toMicro(this.config.get('LLM_PRICE_OUTPUT_USD_PER_MTOK', { infer: true }));
  }

  async create(params: MessagesCreateParams): Promise<MessagesCreateResult> {
    this.sdk ??= new Anthropic({ apiKey: this.config.get('ANTHROPIC_API_KEY', { infer: true }) });
    const startedAt = Date.now();
    try {
      const response = await this.sdk.messages.create(params);
      const result: MessagesCreateResult = {
        content: response.content as MessagesCreateResult['content'],
        stop_reason: response.stop_reason,
        model: response.model,
        usage: response.usage
          ? {
              input_tokens: response.usage.input_tokens,
              output_tokens: response.usage.output_tokens,
              // P2-2 do review: cache a preco diferenciado (leitura = 10% do
              // input). Captura honesta: so o numero cru do SDK, null ausente.
              cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
              cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? undefined,
            }
          : undefined,
      };
      this.registrar(result, startedAt, 'ok');
      return result;
    } catch (err) {
      // timeout/erro de rede: a cascata decide o que fazer em cima do erro;
      // o evento so registra que a tentativa aconteceu e morreu (spec C3).
      this.registrar({ content: [], stop_reason: null }, startedAt, 'error');
      throw err;
    }
  }

  /**
   * Linha em `llm_calls` (Fase 9; ADR-0017) — best-effort pos-chamada (D-P6):
   * telemetria nunca derruba nem atrasa a fala do usuario. Uma linha POR
   * tentativa, inclusive a de escalada. Sem contexto = linha sem userId + warn
   * (em producao contexto vazio e bug — o warn e o alarme).
   *
   * O `create` pode REJEITAR de forma síncrona (serializacao de input invalido,
   * validacao local do Prisma) — dentro de `void` isso viraria unhandled
   * rejection e o OnUncaughtException derrubaria o processo inteiro por um
   * log. Por isso o try/catch envolver o disparo, alem do .catch (P1-5).
   */
  private registrar(
    result: MessagesCreateResult,
    startedAt: number,
    outcome: 'ok' | 'error',
  ): void {
    const { userId, purpose } = this.ctx.current;
    const resolvedPurpose: LlmCallPurposeValue = purpose ?? 'escalation';
    if (!purpose) {
      this.logger.warn(
        'llm_calls: chamada SEM contexto (purpose ausente) — gravando fallback; verificar run() no service de IA',
      );
    }
    const cost = this.estimateCostMicros(result.usage);
    try {
      this.prisma.llmCall
        .create({
          data: {
            userId: userId ?? null,
            purpose: resolvedPurpose,
            outcome,
            modelUsed: result.model ?? null,
            inputTokens: result.usage?.input_tokens ?? null,
            outputTokens: result.usage?.output_tokens ?? null,
            cacheReadInputTokens: result.usage?.cache_read_input_tokens ?? null,
            cacheCreationInputTokens: result.usage?.cache_creation_input_tokens ?? null,
            costUsdMicros: cost,
            latencyMs: Date.now() - startedAt,
          },
        })
        .catch((err: unknown) => {
          this.logger.error(
            `llm_calls: falha ao registrar ${resolvedPurpose}/${outcome}: ${String(err)}`,
          );
        });
    } catch (err) {
      this.logger.error(
        `llm_calls: falha ao registrar ${resolvedPurpose}/${outcome}: ${String(err)}`,
      );
    }
  }

  /**
   * Estimativa declarada em micro-USD INTEIRO (ADR-0017: float somado em SQL e
   * armadilha). Conta exata com inteiros: microUSD/Mtok * tokens / 1e6 =
   * micro-USD (1 Mtok = 1e6 tokens). `round` so absorve FP de tokens gigantes.
   * escalada usa o MESMO preco do primario (spec: estimativa declarada, nao
   * billing); precos por modelo = env extra quando doer (ADR-0017). Sem usage
   * ou sem preco declarado (env) => null: recusa estimar sem preco (D-P8).
   */
  private estimateCostMicros(usage?: {
    input_tokens: number;
    output_tokens: number;
  }): number | null {
    if (!usage) return null;
    if (this.priceInMicro <= 0 || this.priceOutMicro <= 0) return null;
    return Math.round(
      (usage.input_tokens * this.priceInMicro + usage.output_tokens * this.priceOutMicro) / 1e6,
    );
  }
}
