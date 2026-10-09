import { Module } from '@nestjs/common';
import { AdminGuard } from './admin.guard';
import { BotEventsService } from './bot-events.service';
import { ObservabilidadeController } from './observabilidade.controller';
import { ObservabilidadeReadService } from './observabilidade-read.service';

/**
 * Observabilidade (Fase 9, spec observabilidade; ADR-0016/0017): registro de
 * interacoes do bot (`bot_events`), custo de LLM (`llm_calls` — hook no
 * AiModule) e as rotas de consulta/rollout (admin + flag). O tracker
 * (GlitchTip via SDK Sentry) e init por processo, nao modulo (ADR-0016).
 */
@Module({
  controllers: [ObservabilidadeController],
  providers: [BotEventsService, ObservabilidadeReadService, AdminGuard],
  exports: [BotEventsService],
})
export class ObservabilidadeModule {}
