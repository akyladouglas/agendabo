import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AgendaQueryService } from './agenda-query.service';
import { BotAccessService } from './bot-access.service';
import { BotGatewayService } from './bot-gateway.service';
import { ObservabilidadeModule } from '../observabilidade/observabilidade.module';
import { SchedulingFlowService } from './scheduling-flow.service';

/**
 * Bot Telegram (Fase 1): fluxo conversacional de agendamento + gateway long-polling.
 * Regra da casa: o handler do bot e FINO — classificacao de intencao vai para
 * modules/ai, decisao de conflito vai para schedule-core via AppointmentsService
 * (arestas bot->ai e bot->appointments declaradas em .dependency-cruiser.cjs).
 * Fase 2: consulta de agenda sob demanda (AgendaQueryService, somente leitura).
 */
@Module({
  imports: [AiModule, AppointmentsModule, ObservabilidadeModule],
  providers: [BotAccessService, SchedulingFlowService, AgendaQueryService, BotGatewayService],
  exports: [BotAccessService, SchedulingFlowService, AgendaQueryService],
})
export class BotModule {}
