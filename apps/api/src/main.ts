import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { BOT_WEBHOOK_HANDLER } from './shared/telegram/bot-webhook.token';
import type { Env } from './config/env.validation';
import { loadRootEnv } from './config/load-root-env';
import { readValidatedEnv } from './config/env.validation';
import { initErrorTracker, attachNestErrorFilter } from './shared/observability/error-tracker';

async function bootstrap(): Promise<void> {
  // tracker ANTES do AppModule: erros do proprio boot sobem (Fase 9/ADR-0016).
  loadRootEnv();
  initErrorTracker(readValidatedEnv(), 'api');
  const app: INestApplication = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.get('WEB_ORIGIN', { infer: true }),
    credentials: true,
  });
  // Zod nas bordas (contratos em @agendabo/contracts), nao class-validator global.
  app.useGlobalPipes(new ValidationPipe({ whitelist: false, transform: false }));

  const port = config.get('API_PORT', { infer: true });
  // Webhook do bot: rota crua antes do router do Nest (o corpo e o Update bruto
  // do Telegram). O handler mora no BotGatewayService (modules/bot) e e resolvido
  // pelo DI via token — o entrypoint nao conhece a classe.
  if (config.get('TELEGRAM_WEBHOOK_URL', { infer: true })) {
    const expressApp = app.getHttpAdapter().getInstance() as {
      post: (path: string, handler: (req: never, res: never) => void) => void;
    };
    const handler = app.get<unknown>(BOT_WEBHOOK_HANDLER, { strict: false });
    expressApp.post('/telegram/webhook', handler as (req: never, res: never) => void);
  }
  // filtro de excecao do SDK (canal oficial do Nest): captura o que escapa dos
  // handlers sem mudar a resposta HTTP (Fase 9; sem DSN e no-op).
  attachNestErrorFilter(app);
  await app.listen(port);
  process.stderr.write(`[api] ouvindo em http://localhost:${port}\n`);
}

void bootstrap();
