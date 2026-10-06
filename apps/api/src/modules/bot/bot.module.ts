import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { BotAccessService } from './bot-access.service';
import { BotGatewayService } from './bot-gateway.service';
import { SchedulingFlowService } from './scheduling-flow.service';

/**
 * Bot Telegram (Fase 1): fluxo conversacional de agendamento + gateway long-polling.
 * Regra da casa: o handler do bot e FINO — classificacao de intencao vai para
 * modules/ai, decisao de conflito vai para schedule-core via AppointmentsService
 * (arestas bot->ai e bot->appointments declaradas em .dependency-cruiser.cjs).
 */
@Module({
  imports: [AiModule, AppointmentsModule],
  providers: [BotAccessService, SchedulingFlowService, BotGatewayService],
  exports: [BotAccessService, SchedulingFlowService],
})
export class BotModule {}
