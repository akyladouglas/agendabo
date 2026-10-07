import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';

/**
 * Compromissos da web/API. Consome `OutboxService` (notifications) p/ materializar e
 * invalidar lembretes na MESMA transação do create/update (spec Fase 3, regras 6/9;
 * aresta declarada em .dependency-cruiser.cjs).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
