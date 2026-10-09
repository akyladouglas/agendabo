import { Module } from '@nestjs/common';
import { BotEventsService } from './bot-events.service';

/**
 * Observabilidade (Fase 9, spec observabilidade; ADR-0016/0017): registro de
 * interacoes do bot (`bot_events`) e, nas etapas seguintes, custo de LLM
 * (`llm_calls`) e as rotas de consulta/rollout. Consumido pelo bot; o tracker
 * (GlitchTip via SDK Sentry) e init por processo, nao modulo (ADR-0016).
 */
@Module({
  providers: [BotEventsService],
  exports: [BotEventsService],
})
export class ObservabilidadeModule {}
