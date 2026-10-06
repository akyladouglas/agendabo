import { Module } from '@nestjs/common';
import { BotAccessService } from './bot-access.service';

/**
 * Bot Telegram (Fase 3): fluxo conversacional de agendamento.
 * Regra da casa: o handler do bot e FINO — extracao vai para modules/ai,
 * decisao de conflito/notificacao vai para schedule-core via services.
 */
@Module({
  providers: [BotAccessService],
  exports: [BotAccessService],
})
export class BotModule {}
