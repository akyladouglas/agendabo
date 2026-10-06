/**
 * Processo UNICO do bot (gotcha 5: dois long-polling no mesmo token = 409). Sobe o
 * AppModule inteiro (o gateway do bot vive nele e liga o long-polling no boot; a
 * API HTTP nao e escutada neste processo). Uso: `pnpm dev:bot` (apps/api).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const logger = new Logger('BotProcess');
  const app = await NestFactory.create(AppModule);
  // O gateway (BotGatewayService) inicia o long-polling em onApplicationBootstrap;
  // sem HTTP neste processo, basta manter o app vivo.
  await app.init();
  logger.log('processo do bot no ar (long-polling). Ctrl+C para sair.');

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

void bootstrap();
