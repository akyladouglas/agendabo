import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/** Nome da fila de disparos de lembrete (outbox). Consumido pelo worker da Fase 4. */
export const NOTIFICATIONS_QUEUE = 'notifications-dispatch';
/** Fila auxiliar: criacao das linhas de outbox apos criacao do compromisso (Fase 3/4). */
export const OUTBOX_SCHEDULING_QUEUE = 'notifications-schedule';

/**
 * Notificacoes (Fases 3-4):
 * - computeTriggers (schedule-core) decide QUANDO;
 * - este modulo materializa NotificationOutbox e enfileira jobs BullMQ;
 * - worker envia via TelegramClientService com retry/backoff e marca sent/failed;
 * - digest diario (2.1) via @nestjs/schedule com idempotencia por usuario/dia.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATIONS_QUEUE }, { name: OUTBOX_SCHEDULING_QUEUE }),
  ],
})
export class NotificationsModule {}
