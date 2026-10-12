import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SharedAgendasModule } from '../shared-agendas/shared-agendas.module';
import { DigestSchedulingService } from './digest-scheduling.service';
import { DispatchService } from './dispatch.service';
import { OutboxService } from './outbox.service';
import { NOTIFICATIONS_QUEUE } from './notifications.queue';

/**
 * Notificações (Fase 3 — spec lembretes-e-resumo-diario):
 * - computeTriggers (schedule-core) decide QUANDO; OutboxService materializa as linhas
 *   do outbox (mesma tx de quem cria) e enfileira jobs `{ outboxId }` pós-commit;
 * - DigestSchedulingService (cron fino, processo do bot) materializa o resumo diário
 *   idempotente por única parcial (userId, kind, firesAt);
 * - DispatchService é a lógica do WORKER (`src/workers/notifications-worker.ts`,
 *   processo próprio via `dev:worker` — gotcha 5/ADR-009): idempotência pela linha,
 *   gate de conta, needs_review→cancelled, stale→failed, retry limitado;
 * - envio via shared/telegram (TelegramClientService.sendMessage, escape HTML na origem).
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }),
    // E.23 (digest com seção compartilhada): DispatchService resolve os vínculos
    // recebidos ativos + audit `shared_section_built` (aresta notifications →
    // shared-agendas declarada em .dependency-cruiser.cjs / plano D1).
    SharedAgendasModule,
  ],
  providers: [
    DigestSchedulingService,
    DispatchService,
    // A fila BullMQ vista pela camada de aplicação é a shape mínima `DispatchQueueLike`
    // (mock plano nos testes — testing.md). O worker usa o BullMQ diretamente.
    OutboxService,
  ],
  exports: [OutboxService, DigestSchedulingService, DispatchService],
})
export class NotificationsModule {}
