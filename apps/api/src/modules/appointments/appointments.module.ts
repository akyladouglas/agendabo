import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SharedAgendasModule } from '../shared-agendas/shared-agendas.module';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { ReviewController } from './review.controller';
import { ReviewService } from './review.service';

/**
 * Compromissos da web/API. Consome `OutboxService` (notifications) p/ materializar e
 * invalidar lembretes na MESMA transação do create/update (spec Fase 3, regras 6/9;
 * aresta declarada em .dependency-cruiser.cjs). `ReviewService` é a fila needs_review
 * da Fase 4 (confirmar materializa os lembretes na mesma transação; descartar apaga).
 * `SharedAgendasModule` (aresta declarada no depcruise, D1): a leitura emprestada
 * `GET /appointments?owner=` resolve o vinculo ativo e audita `access_read` (Etapa 3).
 */
@Module({
  imports: [NotificationsModule, SharedAgendasModule],
  controllers: [AppointmentsController, ReviewController],
  providers: [AppointmentsService, ReviewService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
