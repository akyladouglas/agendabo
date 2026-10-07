import { Module } from '@nestjs/common';
import { AnthropicClientProvider } from './anthropic-client.provider';
import { ConsultaInterpreterService } from './consulta-interpreter.service';
import { IntentClassifierService } from './intent-classifier.service';
import { ReminderInterpreterService } from './reminder-interpreter.service';

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
  ],
  exports: [
    AnthropicClientProvider,
    IntentClassifierService,
    ConsultaInterpreterService,
    ReminderInterpreterService,
  ],
})
export class AiModule {}
