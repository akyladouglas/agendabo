import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SharedAgendaAuditService } from './shared-agenda-audit.service';
import { SharedAgendasController } from './shared-agendas.controller';
import { SharedAgendasService } from './shared-agendas.service';

/**
 * Compartilhamento de agenda (spec F.6/plano D1). PrismaService vem do
 * PrismaModule (@Global); AuthModule e importado pelo MailService (exportado
 * la — unico ponto de saida de email, regra depcruise resend-encapsulation).
 * Exporta os dois services: a Etapa 3 (leitura emprestada) consome
 * `activeLinkBetween`; Etapas 4+ consomem auditoria/listas.
 */
@Module({
  imports: [AuthModule],
  controllers: [SharedAgendasController],
  providers: [SharedAgendasService, SharedAgendaAuditService],
  exports: [SharedAgendasService, SharedAgendaAuditService],
})
export class SharedAgendasModule {}
