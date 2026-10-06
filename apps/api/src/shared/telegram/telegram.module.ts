import { Global, Module } from '@nestjs/common';
import { TelegramClientService } from './telegram-client.service';

/** Unico modulo autorizado a falar com a API do Telegram (padrao financas: SDK isolado). */
@Global()
@Module({
  providers: [TelegramClientService],
  exports: [TelegramClientService],
})
export class TelegramModule {}
