import { Module } from '@nestjs/common';
import { AnthropicClientProvider } from './anthropic-client.provider';
import { AppointmentEditInterpreterService } from './appointment-edit-interpreter.service';
import { ConsultaInterpreterService } from './consulta-interpreter.service';
import { IntentClassifierService } from './intent-classifier.service';
import { ReminderInterpreterService } from './reminder-interpreter.service';
import { SchedulingInterpreterService } from './scheduling-interpreter.service';

/**
 * Unico modulo autorizado a importar @anthropic-ai/sdk (regra no-restricted-imports
 * no eslint + dependency-cruiser). Expoe `AnthropicMessagesClient` (interface minima)
 * para os services de bot/consulta — nunca o SDK cru.
 */
@Module({
  providers: [
    AnthropicClientProvider,
    IntentClassifierService,
    ConsultaInterpreterService,
    ReminderInterpreterService,
    SchedulingInterpreterService,
    AppointmentEditInterpreterService,
  ],
  exports: [
    AnthropicClientProvider,
    IntentClassifierService,
    ConsultaInterpreterService,
    ReminderInterpreterService,
    SchedulingInterpreterService,
    AppointmentEditInterpreterService,
  ],
})
export class AiModule {}
