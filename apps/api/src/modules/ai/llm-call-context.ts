import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { LlmCallPurposeValue } from '@agendabo/contracts';

/** O que o servico de IA declara sobre a chamada que esta prestes a fazer. */
export interface LlmCallScope {
  userId?: string;
  purpose: LlmCallPurposeValue;
}

type LlmCallStore = Partial<LlmCallScope>;

/**
 * Contexto da chamada LLM em curso (Fase 9, D-P2 do plano; ADR-0017).
 *
 * Os 5 services de IA NAO conhecem `llm_calls` nem recebem `userId` do chamador:
 * cada service marca o turno com `run({ userId, purpose }, ...)` e o
 * `AnthropicClientProvider` le o mesmo store no ponto unico por onde as 5 saidas
 * passam. AsyncLocalStorage (e nao um campo mutavel) porque o mesmo processo
 * atende turnos concorrentes — um campo compartilhado misturaria usuarios.
 *
 * Escopo lexico: `run()` ARCADE a chamada (`await run(scope, () => client
 * .create(params))`), nunca o resultado — e assim que a assincronia propaga o
 * contexto (o teste do provider prende essa regra).
 */
@Injectable()
export class LlmCallContextService {
  private readonly als = new AsyncLocalStorage<LlmCallStore>();

  /** Roda `fn` com o escopo da chamada visivel ao provider. */
  run<T>(scope: LlmCallScope, fn: () => T): T {
    return this.als.run({ ...scope }, fn);
  }

  /** O que o provider enxerga agora (parcial; ausente = chamada sem contexto). */
  get current(): LlmCallStore {
    return this.als.getStore() ?? {};
  }
}
