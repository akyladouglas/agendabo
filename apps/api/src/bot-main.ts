/**
 * Processo UNICO do bot (gotcha 5: dois long-polling no mesmo token = 409). Sobe o
 * AppModule inteiro (o gateway do bot vive nele e liga o long-polling no boot; a
 * API HTTP nao e escutada neste processo). Uso: `pnpm dev:bot` (apps/api).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadRootEnv } from './config/load-root-env';
import { readValidatedEnv } from './config/env.validation';
import { initErrorTracker, flushErrorTracker } from './shared/observability/error-tracker';

async function bootstrap(): Promise<void> {
  const logger = new Logger('BotProcess');
  loadRootEnv();
  // Este binario e o DONO do polling (gotcha 5): liga o gateway mesmo com o
  // default off do env (a API HTTP so liga com BOT_GATEWAY_ENABLED=true).
  process.env.BOT_GATEWAY_ENABLED ??= 'true';
  initErrorTracker(readValidatedEnv(), 'bot');
  const app = await NestFactory.create(AppModule);
  // O gateway (BotGatewayService) inicia o long-polling em onApplicationBootstrap;
  // sem HTTP neste processo, basta manter o app vivo.
  await app.init();
  logger.log('processo do bot no ar (long-polling). Ctrl+C para sair.');

  const shutdown = async (code: number): Promise<void> => {
    try {
      await app.close();
    } finally {
      await flushErrorTracker();
      process.exit(code);
    }
  };
  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));
  // falha fatal: flush do tracker antes de morrer (code 1 = crash visivel)
  process.on('unhandledRejection', (reason) => {
    logger.error(`falha nao tratada: ${String(reason)}`);
    void shutdown(1);
  });
}

void bootstrap();
