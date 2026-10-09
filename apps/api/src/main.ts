import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { loadRootEnv } from './config/load-root-env';
import { readValidatedEnv } from './config/env.validation';
import { initErrorTracker } from './shared/observability/error-tracker';

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
  await app.listen(port);
  process.stderr.write(`[api] ouvindo em http://localhost:${port}\n`);
}

void bootstrap();
