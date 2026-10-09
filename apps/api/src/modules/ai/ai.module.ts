import { Module } from '@nestjs/common';
import { AnthropicClientProvider } from './anthropic-client.provider';
import { AppointmentEditInterpreterService } from './appointment-edit-interpreter.service';
import { ConsultaInterpreterService } from './consulta-interpreter.service';
import { IntentClassifierService } from './intent-classifier.service';
import { LlmCallContextService } from './llm-call-context';
import { ReminderInterpreterService } from './reminder-interpreter.service';
import { SchedulingInterpreterService } from './scheduling-interpreter.service';
import { PrismaModule } from '../../shared/prisma/prisma.module';

/**
 * Unico modulo autorizado a importar @anthropic-ai/sdk (regra no-restricted-imports
 * no eslint + dependency-cruiser). Expoe `AnthropicMessagesClient` (interface minima)
 * para os services de bot/consulta — nunca o SDK cru.
 * Fase 9 (observabilidade): PrismaModule para o hook de `llm_calls` no provider
 * (captura centralizada — ADR-0017) e o contexto AsyncLocalStorage compartilhado.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    AnthropicClientProvider,
    LlmCallContextService,
    IntentClassifierService,
    ConsultaInterpreterService,
    ReminderInterpreterService,
    SchedulingInterpreterService,
    AppointmentEditInterpreterService,
  ],
  exports: [
    AnthropicClientProvider,
    LlmCallContextService,
    IntentClassifierService,
    ConsultaInterpreterService,
    ReminderInterpreterService,
    SchedulingInterpreterService,
    AppointmentEditInterpreterService,
  ],
})
export class AiModule {}
