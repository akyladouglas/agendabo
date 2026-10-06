import { Module } from '@nestjs/common';
import { AnthropicClientProvider } from './anthropic-client.provider';

/**
 * Unico modulo autorizado a importar @anthropic-ai/sdk (regra no-restricted-imports
 * no eslint + dependency-cruiser). Expoe `AnthropicMessagesClient` (interface minima)
 * para os services de bot/consulta — nunca o SDK cru.
 */
@Module({
  providers: [AnthropicClientProvider],
  exports: [AnthropicClientProvider],
})
export class AiModule {}
